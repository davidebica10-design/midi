import { planDays, planDay, updateAnchors, diffPlans, positions, fmtMin, parseHM, dateKey, addDays, dayLabel, WINDOWS } from './scheduler.js';
import { glowSoon, bindCards, dragging, setActPalette, flipCapture, flipPlay, bump, SPRING } from './motion.js';
import { themeOf } from './themes.js';
import { focusSetup, focusStart, focusPause, focusResume, focusView, focusNext, workedMin, clock, gaugeSvg, gaugeParts, dotRingSvg, pctAt, POMO_ROUNDS } from './focus.js';
import { load, save, applyOps, pushUndo, popUndo, canUndo, hasUndo, computeStats, uid, prefLabel, projectDue, projectOf, migrate, safeColor, saveStatus, archiveCandidates, applyArchive, sanitizeState } from './store.js';
import { nowAdvice, briefing, pickObservations, answerObservation, contextReview, contextOps } from './companion.js';
import { understoodOf } from './parse.js';
import { goalFit, planSummary, horizonFor, trackLate } from './goals.js';
import { validatePlan } from './templates.js';
import { learnedObservations, learnedList, forgetLearned, updateDurations, dropRestDay } from './learn.js';
import * as vm from './viewmodel.js';
import { plural, windowLabel, durLabel } from './format.js';
import { runTurn, localParse, MODELS, claudeGoalPlan, withTimeout, askSystem, claudeAsk } from './ai.js';
import { runOpenTurn, openGoalPlan, openAsk, preloadLocal, listModels, testOnline, presetOf, DEFAULT_PRESET, LOCAL_MODELS, ONLINE_PRESETS, webgpuAvailable, localModelLoaded } from './ai-open.js';
import { putImage, deleteImage, imageUrl, cachedImageUrl, compressImage } from './images.js';
import { archivePut, archiveAll } from './archive.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = load();
let plan = {};
let mode = 'day'; // 'day' | 'overview'
const DAYS = 14;
let selDay = dateKey(new Date());
let busy = false;
let pending = null; // proposta in attesa di conferma: { draft, msgId }

// ---------------------------------------------------------------- piano
let planCache = {};
/** Piano di un giorno qualsiasi: i primi giorni vengono dal piano completo, gli altri si calcolano al volo. */
function planFor(k) {
  return plan[k] || (planCache[k] ||= planDay(k, state.items, { ...state.prefs, projectDue: projectDue(state) }, Date.now(), [], state.recurring, state.anchors || {}));
}
let planRev = 0, fitCache = null;
/** Dove finiscono le sessioni di ogni obiettivo (orizzonte lungo, calcolato solo quando serve). */
function goalFits() {
  if (fitCache?.rev === planRev) return fitCache.fits;
  const now = Date.now();
  const goals = (state.goals || []).filter((g) => state.items.some((x) => x.goalId === g.id && x.status !== 'done'));
  const long = goals.length ? planDays(state, now, horizonFor(state, now)) : {};
  const fits = Object.fromEntries(goals.map((g) => [g.id, goalFit(state, g, now, long)]));
  trackLate(state, fits, now, plan); // «non entra» solo se il ritardo dura da due giorni
  fitCache = { rev: planRev, fits, long };
  return fits;
}
function replan() {
  planCache = {};
  planRev++;
  const now = Date.now();
  plan = planDays(state, now, DAYS);
  updateAnchors(state, plan, now);
}
const today = () => dateKey(new Date());

/** Una ripianificazione fatta dal companion, non chiesta da te (per la statistica). */
function countAutoReplan() {
  const t = today();
  state.stats.replans[t] = (state.stats.replans[t] || 0) + 1;
}

function commit(label, mutate, { auto = false } = {}) {
  const undoId = pushUndo(state, label);
  mutate();
  if (auto) countAutoReplan();
  replan();
  save(state);
  renderAll();
  return undoId;
}

// ---------------------------------------------------------------- chat
/** Quale motore usare: 'claude', 'online', 'local' oppure 'base' (senza AI). */
function aiMode() {
  const S = state.settings;
  const p = S.provider || (S.apiKey ? 'claude' : 'base');
  if (p === 'claude') return S.apiKey ? 'claude' : 'base';
  if (p === 'online') return S.openBaseUrl && (S.openModel || presetOf(S) !== 'custom') ? 'online' : 'base';
  if (p === 'local') return 'local';
  return 'base';
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const DRAFT_KEYS = ['items', 'prefs', 'recurring', 'memory', 'anchors', 'goals', 'projects', 'log'];
const pick = (d) => Object.fromEntries(DRAFT_KEYS.map((k) => [k, d[k]]));
const draftOf = () => clone(pick(state));
function addMsg(m) {
  const msg = { id: uid(), ts: Date.now(), ...m };
  if (msg.role === 'assistant') replyId = msg.id;
  state.chat.push(msg);
  if (state.chat.length > 60) state.chat = state.chat.slice(-60);
  save(state);
  renderChat();
  return msg;
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  if (/^annulla( l'ultima modifica)?\.?$/i.test(text)) { addMsg({ role: 'user', text }); doUndo(); return; }
  // "che faccio?": la risposta è deterministica e immediata, niente attese
  if (/^(e\s+)?(adesso\s+|ora\s+)?(che|cosa)\s+(faccio|devo fare|fare)(\s+(adesso|ora|stasera|oggi))?\s*\??$/i.test(text) && selDay === today()) {
    $('#input').blur(); setComposing(false);
    addMsg({ role: 'user', text });
    const a = nowAdvice(state, plan, Date.now());
    addMsg({ role: 'assistant', text: a ? [a.title, a.why].filter(Boolean).join(' ') : 'Oggi è libero.' });
    return;
  }
  const prior = state.chat.slice();
  // la barra modifica il giorno che stai guardando: l'AI lo deve sapere
  const aiText = selDay !== today() ? `[Sto guardando ${dayLabel(selDay, today())} (${selDay})] ${text}` : text;
  $('#input').blur();
  setComposing(false);
  addMsg({ role: 'user', text });
  if (pending) discardPending(true);
  const mode = aiMode();

  if (mode === 'online' || mode === 'local') {
    busy = true;
    renderComposer();
    const typing = addMsg({ role: 'assistant', pending: true });
    const before = plan;
    const itemsBefore = clone(state.items);
    let lastPaint = 0;
    try {
      const run = (signal) => runOpenTurn({
        state, plan, now: Date.now(), userText: aiText, chat: prior, signal,
        onProgress: (f) => {
          typing.progress = f;
          if (Date.now() - lastPaint > 400 || f >= 1) { lastPaint = Date.now(); renderChat(); }
        },
      });
      // il modello sul telefono la prima volta si scarica: niente tempo massimo
      const out = mode === 'local' ? await run() : await withTimeout(run, AI_TIMEOUT);
      removeMsg(typing.id);
      if (out.ops.length) {
        const draft = draftOf();
        const res = applyOps(draft, out.ops);
        const deletesFixed = out.ops.some((o) => o.action === 'delete' && itemsBefore.find((x) => x.id === o.id)?.kind === 'event');
        finishChange({ text: out.text + (res.errors.length ? '\n(' + res.errors.join('; ') + ')' : ''), draft, log: res.log, confirm: out.confirm || deletesFixed, before, itemsBefore });
      } else addMsg({ role: 'assistant', text: out.text });
    } catch (e) {
      removeMsg(typing.id);
      baseTurn(text, e);
    } finally {
      busy = false;
      renderComposer();
    }
    return;
  }

  if (mode === 'base') { baseTurn(text); return; }

  busy = true;
  renderComposer();
  const typing = addMsg({ role: 'assistant', pending: true });
  const before = plan;
  const itemsBefore = JSON.parse(JSON.stringify(state.items));
  let draft = null, log = [], confirm = false;
  const understood = [];

  const hooks = {
    apply(input) {
      draft ||= draftOf();
      const known = { items: [...itemsBefore, ...draft.items], recurring: [...state.recurring, ...draft.recurring] };
      const res = applyOps(draft, input.ops);
      log.push(...res.log);
      try { understood.push(...understoodOf(input.ops, { items: [...known.items, ...draft.items], recurring: [...known.recurring, ...draft.recurring] }, today())); } catch {}
      const deletesFixed = input.ops.some((o) => (o.action === 'delete' && itemsBefore.find((x) => x.id === o.id)?.kind === 'event') || o.action === 'remove_recurring');
      confirm ||= !!input.requires_confirmation || deletesFixed;
      const p = planDays(draft, Date.now(), 7);
      const moved = diffPlans(before, p, itemsBefore, draft.items, today());
      const t = today(), tm = addDays(t, 1);
      const sum = (d) => {
        const x = p[d];
        return `${d}: ${x.blocks.map((b) => `${fmtMin(b.start)}-${fmtMin(b.end)} ${b.item.title}${b.type === 'flex' ? '' : ' [' + b.type + ']'}`).join(' | ') || 'vuoto'}` +
          (x.unscheduled.length ? `\n  non entra: ${x.unscheduled.map((u) => `${u.item.title} (${u.reason})`).join(', ')}` : '') +
          ((x.deferred || []).length ? `\n  slitta al giorno dopo: ${x.deferred.map((u) => u.title).join(', ')}` : '') +
          (x.conflicts.length ? `\n  CONFLITTI: ${x.conflicts.map(([a, b]) => `${title(draft, a)} / ${title(draft, b)}`).join(', ')}` : '') +
          `\n  tempo libero residuo: ${x.free} min`;
      };
      return {
        text: [
          res.log.length ? 'Applicato in bozza:\n' + res.log.join('\n') : 'Nessuna modifica.',
          res.errors.length ? 'Errori:\n' + res.errors.join('\n') : '',
          moved.length ? 'Spostamenti:\n' + moved.join('\n') : '',
          'Nuovo piano:\n' + sum(t) + '\n' + sum(tm),
          confirm ? 'Le modifiche richiedono conferma: l\'utente vedrà i pulsanti Applica/Annulla. Descrivi brevemente cosa cambierà.' : 'Le modifiche verranno applicate subito (l\'utente può annullarle).',
        ].filter(Boolean).join('\n\n'),
        error: !!res.errors.length && !res.log.length,
      };
    },
  };

  try {
    const out = await withTimeout((signal) => runTurn({ state, plan, now: Date.now(), userText: aiText, hooks, chat: prior, signal }), AI_TIMEOUT * 2);
    removeMsg(typing.id);
    if (draft) finishChange({ text: out.text, draft, log, confirm, before, itemsBefore, understood });
    else addMsg({ role: 'assistant', text: out.text });
  } catch (e) {
    removeMsg(typing.id);
    baseTurn(text, e);
  } finally {
    busy = false;
    renderComposer();
  }
}

const AI_TIMEOUT = 25000;
/**
 * Modalità base. Con `aiError` è il ripiego quando l'AI sbaglia o non risponde in tempo:
 * la frase viene capita senza AI, con una nota chiara.
 */
function baseTurn(text, aiError = null) {
  const before = plan;
  const itemsBefore = clone(state.items);
  const r = localParse(text, state, Date.now());
  if (r.ops && selDay !== today()) for (const o of r.ops) if (o.action === 'add' && !o.date) o.date = selDay;
  if (!r.ops) { addMsg(aiError ? { role: 'assistant', error: true, text: errorText(aiError) } : { role: 'assistant', text: r.reply }); return; }
  const note = aiError ? `${aiError.code === 'timeout' ? 'L\'AI non risponde' : 'L\'AI ha avuto un problema'}: ho usato la modalità base. ` : '';
  const draft = draftOf();
  const res = applyOps(draft, r.ops);
  finishChange({ text: note + r.reply + (res.errors.length ? '\n' + res.errors.join('\n') : ''), draft, log: res.log, confirm: r.confirm, before, itemsBefore, understood: r.understood });
}

const title = (s, id) => (s.items.find((x) => x.id === id) || {}).title || (String(id).startsWith('rec:') ? 'ricorrente' : id);

function errorText(e) {
  const st = e?.status;
  if (e?.code === 'timeout') return 'L\'AI non risponde e senza AI non ho capito la frase. Riprova tra poco, o scrivila più semplice.';
  if (e?.code === 'webgpu') return 'Questo iPhone non può far girare modelli in locale: serve Safari con WebGPU (iOS 26 o successivo). Aggiorna iOS oppure scegli «Online · gratis» in Impostazioni (⋯ in alto) → Assistente AI.';
  if (aiMode() === 'local' && /memory|out of memory|device lost|allocation/i.test(e?.message || '')) return 'Il modello è troppo pesante per la memoria del telefono. Scegli un modello più piccolo in Impostazioni (⋯ in alto) → Assistente AI.';
  if (aiMode() === 'local' && /fetch|network|load/i.test(e?.message || '')) return 'Non riesco a scaricare il modello: controlla la connessione (meglio il Wi-Fi) e riprova. Dopo il primo download funziona anche offline.';
  const svc = ONLINE_PRESETS[presetOf(state.settings)]?.label || 'servizio online';
  if (e?.code === 'nokey') return `Manca la chiave di ${svc}. Creala gratis e incollala in Impostazioni (⋯ in alto) → Assistente AI (lì trovi i passaggi).`;
  if (e?.code === 'badkey' || (aiMode() === 'online' && st === 401)) return `${svc} non accetta la chiave (${e.message}). Ricopiala per intero in Impostazioni (⋯ in alto) → Assistente AI e tocca «Prova».`;
  if (e?.code === 'nofree') return e.message + ' Riprova tra qualche minuto: i modelli gratuiti a volte sono sovraccarichi.';
  if (aiMode() === 'online' && (st === 404 || st === 400)) return 'Il servizio non riconosce il modello indicato (' + (e.message || '') + '). Controlla il nome del modello in Impostazioni (⋯ in alto) → Assistente AI.';
  if (st === 401) return 'La chiave API non è valida. Controllala in Impostazioni (⋯ in alto) → Assistente AI.';
  if (st === 429) return 'Troppe richieste in poco tempo. Riprova tra qualche secondo.';
  if (st === 529 || st === 503) return 'Il servizio AI è sovraccarico. Riprova tra poco.';
  if (!navigator.onLine) return 'Sei offline. La giornata resta consultabile; per parlare con l\'assistente serve la connessione.';
  return 'Qualcosa è andato storto: ' + (e?.message || e);
}

function removeMsg(id) {
  state.chat = state.chat.filter((m) => m.id !== id);
  renderChat();
}

function finishChange({ text, draft, log, confirm, before, itemsBefore, understood = [] }) {
  const after = planDays(draft, Date.now(), 7);
  const moved = diffPlans(before, after, itemsBefore, draft.items, today());
  // dove sono finite le attività nuove
  const placed = [];
  for (const it of draft.items) {
    if (itemsBefore.find((x) => x.id === it.id) || it.kind !== 'task' || it.start != null) continue;
    let where = null;
    for (const [d, p] of Object.entries(after)) {
      const b = p.blocks.find((x) => x.id === it.id);
      if (b) { where = `${dayLabel(d, today())} ${fmtMin(b.start)}`; break; }
    }
    placed.push(`↦ ${it.title}: ${where || 'non entra nei prossimi giorni'}`);
  }
  // cosa ho capito, voce per voce («Impegno · Dentista · giovedì 15 alle 17:00»); poi dove sono finite le cose nuove
  const said = understood.length > 0;
  const changes = said ? [...understood, ...placed] : [...log, ...placed, ...moved.map((m) => '↦ ' + m)];
  if (!changes.length) { addMsg({ role: 'assistant', text }); return; }
  if (confirm) {
    const msg = addMsg({ role: 'assistant', text, changes, applied: null, said });
    pending = { draft, msgId: msg.id };
    renderChat();
    return;
  }
  markChanged(itemsBefore, draft.items);
  const undoId = commit(log[0] || 'Modifica', () => Object.assign(state, pick(draft)));
  addMsg({ role: 'assistant', text, changes, applied: true, undoId, said });
}

function applyPending() {
  if (!pending) return;
  const m = state.chat.find((x) => x.id === pending.msgId);
  const draft = pending.draft;
  pending = null;
  markChanged(state.items, draft.items);
  const undoId = commit('Modifica confermata', () => Object.assign(state, pick(draft)));
  if (m) { m.applied = true; m.undoId = undoId; }
  save(state);
  renderChat();
}
function discardPending(silent) {
  if (!pending) return;
  const m = state.chat.find((x) => x.id === pending.msgId);
  if (m) m.applied = false;
  pending = null;
  save(state);
  if (!silent) renderChat();
}

function doUndo(id) {
  const e = popUndo(state, id);
  if (!e) { toast('Niente da annullare'); return; }
  for (const m of state.chat) if (m.undoId && !undoExists(m.undoId)) { m.undoId = null; m.undone = true; }
  replan();
  save(state);
  renderAll();
  toast('Modifica annullata');
}
const undoExists = hasUndo;

// ---------------------------------------------------------------- utilità
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const tilt = (id) => ((hash(id) % 60) / 10 - 3).toFixed(1); // da -3° a +3°, sempre uguale per la stessa carta
const dateOf = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';
const ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>';
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// carte cambiate dall'ultima modifica: lampeggiano una volta
let changedIds = new Set();
function markChanged(before, after) {
  changedIds = new Set(after.filter((x) => {
    const o = before.find((y) => y.id === x.id);
    return !o || JSON.stringify(o) !== JSON.stringify(x);
  }).map((x) => x.id));
  setTimeout(() => { changedIds = new Set(); }, 2500);
}

const seenMsgs = new Set();
/** Riproduce l'animazione d'ingresso di un contenitore (solo quando serve, non a ogni aggiornamento). */
function animateIn(el, ms = 900) {
  if (!el) return;
  el.classList.remove('enter');
  void el.offsetWidth;
  el.classList.add('enter');
  clearTimeout(el._enterT);
  el._enterT = setTimeout(() => el.classList.remove('enter'), ms);
}

function fillImages(root) {
  root.querySelectorAll('img[data-img]').forEach((img) => {
    if (img.getAttribute('src')) return;
    imageUrl(img.dataset.img).then((u) => { if (u) img.src = u; }).catch(() => {});
  });
}
const imgTag = (id) => `<img data-img="${esc(id)}" ${cachedImageUrl(id) ? `src="${cachedImageUrl(id)}"` : ''} alt="">`;

// ---------------------------------------------------------------- scrivere al giorno
// La barra non è una chat: modifica il giorno. Mentre scrivi vedi solo un riassunto;
// dopo l'invio compare una breve nota con l'esito, poi sparisce.
let replyId = null, replyTimer = 0, composing = false;
const seenReply = new Set();

function setComposing(on) {
  composing = on;
  $('#app').classList.toggle('composing', on);
  if (on) { closePlus(); renderMiniSummary(); }
  syncBar();
}

// La barra sta chiusa nel «+» laterale; si apre toccandolo e si richiude quando non serve più
let barForced = false, plusAt = 0;
function syncBar() {
  const input = $('#input');
  const open = barForced || composing || busy || !$('#reply').hidden || !$('#plus-menu').hidden || !!input.value.trim() || !!rec;
  $('#app').classList.toggle('bar-open', open);
  $('#plus').setAttribute('aria-expanded', open);
  $('#plus').setAttribute('aria-label', open ? 'Aggiungi un\'attività' : 'Parla con Tempo');
  if (!open) barForced = false;
}
function openBar() {
  barForced = true;
  syncBar();
  $('#input').focus({ preventScroll: true });
  setTimeout(() => { barForced = false; }, 400);
}

function renderMiniSummary() {
  const t = today();
  const p = planFor(selDay);
  const isToday = selDay === t;
  const d = dateOf(selDay);
  const n = nowMin();
  const tasks = p.blocks.filter((b) => b.item.kind === 'task');
  const doneN = tasks.filter((b) => b.type === 'done').length;
  const total = tasks.length + p.unscheduled.length;
  const cur = isToday ? currentBlock() : null;
  const nxt = p.blocks.find((b) => b.type !== 'done' && (isToday ? b.start > n : true) && b !== cur);
  const name = isToday ? 'Oggi' : selDay === addDays(t, 1) ? 'Domani' : cap(d.toLocaleDateString('it-IT', { weekday: 'long' }));
  const lines = [];
  if (cur) lines.push(`Adesso <b>${esc(cur.item.title)}</b> fino alle ${fmtMin(cur.end)}`);
  if (nxt) lines.push(`${cur ? 'Poi' : isToday ? 'Prossimo' : 'Si parte con'} <b>${esc(nxt.item.title)}</b> alle ${fmtMin(nxt.start)}`);
  if (p.unscheduled.length) lines.push(`<span class="warn">${plural(p.unscheduled.length, 'attività non entra', 'attività non entrano')}</span>`);
  $('#mini-sum').innerHTML = `
    <div class="ms-top"><b>${esc(name)}</b><span>${d.getDate()} ${esc(d.toLocaleDateString('it-IT', { month: 'short' }).replace('.', ''))}${isToday ? ' · ' + fmtMin(n) : ''}</span></div>
    <div class="ms-bar"><i style="width:${total ? Math.round((doneN / total) * 100) : 0}%"></i></div>
    <div class="ms-cap">${total ? `${doneN} di ${total} fatte` : 'Nessuna attività'} · ${durLabel(p.free)} libere</div>
    ${lines.length ? `<div class="ms-lines">${lines.map((l) => `<div>${l}</div>`).join('')}</div>` : ''}
    ${aiMode() === 'base' ? '<div class="ms-hint">Modalità base: capisco frasi semplici. <a href="#" data-goto="settings">Scegli un\'AI gratuita</a></div>' : ''}`;
}

function renderChat() { renderReply(); }
/** «Impegno · Dentista · giovedì 15 alle 17:00» → la prima parola come etichetta. */
function saidLine(c) {
  const i = c.indexOf(' · ');
  if (i < 0 || /^[↦+~−✓◎⟳☆◷↷▶↺◐▣]/.test(c)) return esc(c);
  return `<span class="r-k">${esc(c.slice(0, i))}</span>${esc(c.slice(i + 3))}`;
}

function renderReply() {
  const el = $('#reply');
  const m = replyId ? state.chat.find((x) => x.id === replyId) : null;
  if (!m) { el.innerHTML = ''; el.hidden = true; syncBar(); return; }
  el.hidden = false;
  const isNew = !seenReply.has(m.id + (m.pending ? 'p' : ''));
  seenReply.add(m.id + (m.pending ? 'p' : ''));
  let body;
  if (m.pending) {
    body = m.progress != null && m.progress < 1
      ? `<div class="r-typing"><span>Preparo il modello sul telefono… ${Math.round(m.progress * 100)}%</span></div><div class="r-note">Solo la prima volta: il modello viene scaricato e salvato sul telefono.</div>`
      : `<div class="r-typing"><i></i><i></i><i></i><span>Sto sistemando la giornata…</span></div>`;
  } else {
    body = `<div class="r-text">${esc(m.text)}</div>`;
    if (m.changes?.length) {
      const shown = m.changes.slice(0, 4);
      body += `<ul class="r-changes${m.said ? ' said' : ''}">${shown.map((c) => `<li>${saidLine(c)}</li>`).join('')}${m.changes.length > 4 ? `<li class="more">e altre ${m.changes.length - 4} modifiche</li>` : ''}</ul>`;
      if (m.applied === null && pending?.msgId === m.id) body += `<div class="r-actions"><button class="btn primary" data-act="apply">Applica</button><button class="btn" data-act="discard">Lascia com'è</button></div>`;
      else if (m.applied === false) body += `<div class="r-note">Non applicate.</div>`;
      else if (m.undone) body += `<div class="r-note">Annullate.</div>`;
      else if (m.undoId && undoExists(m.undoId)) body += `<div class="r-actions"><button class="btn" data-act="undo" data-id="${esc(m.undoId)}">${m.said ? 'Non è questo' : 'Annulla'}</button></div>`;
    }
  }
  el.innerHTML = `<div class="reply-card${m.error ? ' error' : ''}${isNew ? ' anim' : ''}">${m.pending ? '' : '<button type="button" class="r-x" data-act="dismiss" aria-label="Chiudi">×</button>'}${body}</div>`;
  // la nota sparisce da sola, tranne quando aspetta una conferma
  clearTimeout(replyTimer);
  if (!m.pending && !(m.applied === null && pending?.msgId === m.id)) replyTimer = setTimeout(hideReply, m.error ? 12000 : 9000);
  syncBar();
}
function hideReply() {
  const el = $('#reply');
  if (el.hidden) return;
  const card = el.querySelector('.reply-card');
  if (card) card.classList.add('out');
  setTimeout(() => { replyId = null; renderReply(); }, 260);
}

let rec = null;
function renderComposer() {
  const has = $('#input').value.trim().length > 0;
  $('#app').classList.toggle('writing', has);
  $('#app').classList.toggle('thinking', busy);
  $('#send').disabled = busy;
  $('#mic').hidden = !SR || (has && !rec);
  $('#send').hidden = !!SR && !has && !busy;
  syncBar();
}

function toggleMic() {
  if (!SR) return;
  if (rec) { rec.stop(); return; }
  rec = new SR();
  rec.lang = 'it-IT';
  rec.interimResults = true;
  const input = $('#input');
  const base = input.value ? input.value.trim() + ' ' : '';
  rec.onresult = (e) => {
    let t = '';
    for (const r of e.results) t += r[0].transcript;
    input.value = base + t;
    input.dispatchEvent(new Event('input'));
  };
  rec.onerror = (e) => toast(e.error === 'not-allowed' ? 'Consenti il microfono a Safari nelle Impostazioni' : 'Dettatura non disponibile: usa il microfono della tastiera');
  rec.onend = () => { rec = null; $('#mic').classList.remove('rec'); renderComposer(); };
  try { rec.start(); $('#mic').classList.add('rec'); } catch { rec = null; }
}

// ---------------------------------------------------------------- giorno
function currentBlock() {
  const p = plan[today()];
  if (!p) return null;
  const n = nowMin();
  return p.blocks.find((b) => b.type !== 'done' && b.start <= n && n < b.end) || null;
}

/** Le carte del giorno (dati da viewmodel.today), nello stile delle carte di Dot. */
const projMark = (p) => p ? `<span class="pc-mark" style="--pc:${safeColor(p.color) || 'var(--accent)'}" aria-hidden="true">${esc(p.name.charAt(0).toUpperCase())}</span>` : '';
function cardHtml(c, i) {
  const st = `--r:${c.r ?? 0}deg;--i:${i}`;
  if (c.type === 'rest') {
    return `<div class="pc rest" role="button" tabindex="0" data-rest="1" style="${st}" aria-label="${esc(`${c.title}, dalle ${c.start} alle ${c.end}. Cambia la pausa`)}">
      <div class="pc-body"><div class="pc-title">${esc(c.title)}</div><div class="pc-desc">${c.start} – ${c.end}</div></div>
      <div class="pc-label">${esc(c.note)}</div></div>`;
  }
  if (c.type === 'missed') {
    return `<div class="pc note-card" style="${st}">
      <div class="pc-body"><div class="pc-title">Hai fatto «${esc(c.title)}»?</div><div class="pc-desc">Era previsto alle ${c.start}.</div>
      <div class="pc-actions"><button class="mini-btn primary" data-act2="done" data-id="${esc(c.id)}">Sì</button><button class="mini-btn" data-act2="part" data-id="${esc(c.id)}" data-min="${c.minutes}">In parte</button><button class="mini-btn" data-act2="notyet" data-id="${esc(c.id)}" data-start="${c.start}">No</button></div></div></div>`;
  }
  if (c.type === 'unscheduled') {
    return `<div class="pc note-card" role="button" tabindex="0" data-item="${esc(c.id)}" style="${st}" aria-label="${esc(`${c.title}: non entra`)}">
      <div class="pc-body"><div class="pc-title">${esc(c.title)}</div><div class="pc-desc">Non entra ${c.moveTo === 'domani' ? 'oggi' : 'in questa giornata'}: ${esc(c.reason)}.</div>
      <div class="pc-actions"><button class="mini-btn primary" data-act2="move" data-id="${esc(c.id)}">Sposta a ${c.moveTo}</button></div></div></div>`;
  }
  if (c.type === 'conflict') {
    return `<div class="pc note-card" style="${st}"><div class="pc-body"><div class="pc-title">Si sovrappongono</div><div class="pc-desc">${esc(c.a)} e ${esc(c.b)}.</div></div></div>`;
  }
  if (c.type === 'stop') {
    return `<div class="pc quote stop" style="${st}"><div class="pc-body"><div class="pc-quote">${esc(c.text)}</div></div><div class="pc-label">${c.at}</div></div>`;
  }
  if (c.type === 'obs') {
    const acts = c.actions ? `<div class="pc-actions">${c.actions.map((ac) => `<button class="mini-btn" data-brief="${esc(ac.act)}" data-arg="${esc(ac.arg)}">${esc(ac.label)}</button>`).join('')}</div>` : '';
    return `<div class="pc obs" style="${st}" data-bid="${esc(c.id)}"><div class="pc-body"><div class="pc-desc strong">${esc(c.text)}</div>${acts}</div><div class="pc-label">Osservazione</div></div>`;
  }
  const isEvent = c.type === 'event';
  const isTask = c.type === 'task';
  const done = !!c.done;
  const when = done ? `Fatto alle ${c.doneAt}` : isEvent ? `${c.start} – ${c.end}` : `${c.start}${c.pinned ? ' · orario fissato' : ''} · ${durLabel(c.minutes)}`;
  const desc = [when, c.pauseBefore ? `dopo ${c.pauseBefore}' di pausa` : null, isTask && !done ? (c.part ? 'una parte' : c.resumed ? 'si riprende' : c.estimated ? 'durata stimata' : null) : null].filter(Boolean).join(' · ');
  const foot = isEvent ? (c.recurring ? 'Impegno ricorrente' : 'Impegno fisso') : c.project ? c.project.name : c.energy >= 3 ? 'Concentrazione' : c.energy <= 1 ? 'Leggera' : 'Attività';
  const cls = ['pc', isEvent ? 'event' : 'task', done ? 'done' : '', c.image ? 'photo' : '', changedIds.has(c.itemId) ? 'flash' : ''].join(' ');
  const label = `${c.title}, ${when}${c.project ? ', ' + c.project.name : ''}`;
  const tint = !c.color && c.project ? ` data-proj style="--pc:${safeColor(c.project.color) || 'var(--accent)'};${st}"` : ` style="${st}"`;
  const open = `role="button" tabindex="0" data-item="${esc(c.id)}" data-c="${c.color || ''}" aria-label="${esc(label)}"${tint}`;
  const check = isTask ? `<button class="pc-check" data-check="${esc(c.id)}" aria-label="${done ? 'Riapri' : 'Segna come fatta'}: ${esc(c.title)}" aria-pressed="${done}">${ICON_CHECK}</button>` : '';
  const th = themeFor(state.items.find((x) => x.id === c.itemId) || { title: c.title, project: c.project?.id });
  const ic = `<i class="act-ic" style="--m:url(icons/act/${th.icon}.svg)" aria-hidden="true"></i>`;
  const title = `${c.important ? '<i class="imp" title="Importante"></i>' : ''}${esc(c.title)}`;
  if (c.image) {
    return `<div class="${cls}" ${open}>${imgTag(c.image)}${check}
      <div class="ph-cap"><b>${title}</b><span>${esc(desc)}</span></div></div>`;
  }
  return `<div class="${cls}" ${open}>
    <div class="pc-body">${ic}<div class="pc-title">${title}</div><div class="pc-desc">${esc(desc)}</div></div>
    <div class="pc-foot">${isTask ? projMark(c.project) : ''}<span>${esc(foot)}</span>${check}</div>
  </div>`;
}

function dayModel() {
  return vm.today({ state, plan, planFor, now: Date.now(), day: selDay, fits: goalFits(), backupDue: backupDue(), env: { online: navigator.onLine, ai: aiMode() } });
}

// la pila delle carte concluse: chiusa come le notifiche dell'iPhone, si apre con un tocco
let doneOpen = false;
const FLIP_SEL = '.pc, .ds-card, .ds-head';
function doneStackHtml(cards, v) {
  if (!cards.length) return '';
  const open = doneOpen || v.past;
  const n = cards.length;
  const label = `<span class="ds-n">${n}</span> ${n === 1 ? 'conclusa' : 'concluse'}`;
  if (open) {
    const cols = [[], []];
    cards.forEach((c, j) => cols[j % 2].push(cardHtml({ ...c, r: 0 }, j)));
    return `<section class="done-stack open" aria-label="Concluse">
      <button type="button" class="ds-head" data-ds="close" data-k="ds-head" aria-expanded="true"><span>${label}</span><span class="ds-hint">${v.past ? '' : 'Nascondi'}</span></button>
      <div class="ds-grid"><div class="col">${cols[0].join('')}</div><div class="col">${cols[1].join('')}</div></div></section>`;
  }
  const top = cards.slice(-3).reverse();
  return `<section class="done-stack" aria-label="Concluse">
    <button type="button" class="ds-head" data-ds="open" data-k="ds-head" aria-expanded="false"><span>${label}</span><span class="ds-hint">Mostra</span></button>
    <button type="button" class="ds-pile" data-ds="open" aria-label="Mostra ${n} ${n === 1 ? 'conclusa' : 'concluse'}">
      ${top.map((c, j) => `<span class="ds-card" data-k="${esc(c.id)}" style="--j:${j}" data-c="${c.color || ''}">
        <i class="ds-ok" aria-hidden="true">${ICON_CHECK}</i><span class="ds-t"><b>${esc(c.title)}</b><small>${esc(c.done && c.doneAt ? `Fatto alle ${c.doneAt}` : `${c.start} – ${c.end}`)}</small></span></span>`).join('')}
    </button></section>`;
}

function renderDayView(animate, opts = {}) {
  const t = today();
  const v = dayModel();
  // osservazioni mostrate oggi: si ricordano (massimo 2 al giorno)
  if (v.isToday && JSON.stringify(v.seen) !== JSON.stringify(state.seenObs)) {
    state.seenObs = v.seen;
    for (const o of v.observations) {
      if (o.goalId && o.id.startsWith('due-')) { const g = state.goals.find((x) => x.id === o.goalId); if (g && !g.askedDueOn) g.askedDueOn = t; }
      if (o.learnKey) { const d = state.learned.durations[o.learnKey]; if (d) d.announced = d.ratio; } // "ho aggiornato le stime": detto una volta
    }
    save(state);
  }

  const sum = v.summary;
  const evN = v.cards.filter((c) => c.type === 'event').length + (v.now?.block?.kind === 'event' ? 1 : 0);
  const prog = sum.total ? `${sum.done} di ${sum.total} fatte` : evN ? plural(evN, 'impegno', 'impegni') : 'giornata libera';
  $('#hero-time').textContent = `${v.header.time} · ${prog}`;
  renderHero(v);
  const g = v.header.greeting;
  const ht = $('#hero-title');
  if (ht.dataset.g !== g || animate) {
    ht.innerHTML = g.split(' ').map((w, i) => `<span style="animation-delay:${i * 90}ms">${esc(w)}</span>`).join('<br>');
    ht.dataset.g = g;
    if (animate) animateIn(ht, 1200);
  }

  // collage su due colonne (come Dot): in ordine di lettura sinistra, destra, sinistra…
  const cols = [[], []];
  let i = 0;
  const put = (html) => { cols[i % 2].push(html); i++; };
  const rot = (id) => (+tilt(id) * 0.8).toFixed(1);

  // 1. "adesso" (oggi) come la carta-affermazione
  if (v.now) {
    const a = v.now;
    const act = a.action ? `<button class="adv-go" data-adv="${a.action.type}" data-id="${esc(a.action.id)}">${a.action.type === 'complete' ? ICON_CHECK : ICON_PLAY}<span>${esc(a.action.label)}</span></button>` : '';
    const blk = a.block ? `<div class="pc-progress" role="progressbar" aria-valuenow="${a.block.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(a.block.title)}"><i style="--w:${a.block.pct}%"></i></div><div class="pc-desc">${esc(a.block.title)} · fino alle ${a.block.until} · ${a.block.left} rimasti</div>` : '';
    const nowId = a.block?.kind === 'rest' ? null : a.block?.itemId || a.block?.id || a.action?.id || null;
    const open = nowId ? ` role="button" tabindex="0" data-item="${esc(nowId)}"` : a.block?.kind === 'rest' ? ' role="button" tabindex="0" data-rest="1"' : '';
    put(`<div class="pc quote adv mood-${a.mood}"${open} style="--r:-2deg;--i:0" aria-live="polite">
      <div class="pc-body"><div class="pc-quote">${esc(a.title)}</div>${a.why ? `<div class="pc-desc">${esc(a.why)}</div>` : ''}${blk}${act}</div>
      <div class="pc-label">Adesso</div></div>`);
  }

  // 2. osservazioni (massimo 2) come carte
  for (const o of v.observations) put(cardHtml({ ...o, type: 'obs', r: rot(o.id) }, i));

  // 3. le carte della giornata; quelle concluse (fatte, o impegni già finiti) vanno nella pila in fondo
  const nowHM = fmtMin(nowMin());
  const concluded = (c) => c.type === 'task' ? !!c.done : c.type === 'event' && (v.past || (v.isToday && c.end <= nowHM));
  const doneCards = [];
  let pauseBefore = 0;
  for (const c of v.cards) {
    if (c.type === 'pause') { pauseBefore = c.minutes; continue; } // la pausa va sulla carta che segue
    if (concluded(c)) { doneCards.push(c); pauseBefore = 0; continue; }
    put(cardHtml({ ...c, pauseBefore, r: rot((c.type === 'missed' ? 'm' : c.type === 'unscheduled' ? 'u' : '') + (c.id || c.at)) }, i));
    pauseBefore = 0;
  }
  const html = `<div class="col">${cols[0].join('')}</div><div class="col">${cols[1].join('')}</div>${doneStackHtml(doneCards, v)}${v.emptyText && !doneCards.length ? `<p class="empty-hint">${esc(v.emptyText)}</p>` : ''}`;

  const col = $('#collage');
  const before = animate || opts.flip === false ? null : flipCapture(col, FLIP_SEL);
  const had = col.querySelector('.done-stack .ds-n')?.textContent;
  col.innerHTML = html;
  flipPlay(col, FLIP_SEL, before);
  const stackEl = col.querySelector('.done-stack');
  if (before && stackEl && had !== stackEl.querySelector('.ds-n')?.textContent) bump(stackEl.querySelector('.ds-pile, .ds-head'), 1.05);
  fillImages(col);
  if (animate) animateIn(col, 300 + i * 70 + 800);
  $('#undo-btn').hidden = !canUndo();
  glowSoon();
}

// ---------------------------------------------------------------- l'attività in corso: icona, orologio a puntini, pomodoro
// In alto, mezzo dietro le carte come il saluto: l'icona dell'attività in corso; quando parte un timer,
// l'orologio a puntini (attività con una durata) o l'arco del pomodoro (studio, lavoro di concentrazione).
const projName = (it) => (it?.project ? projectOf(state, it.project)?.name : '') || '';
const themeFor = (it) => themeOf(it, projName(it));
let heroKey = '', focusOpen = false, tickTimer = 0;
const MIN_CHOICES = { pomodoro: [15, 25, 45, 60], timer: [15, 30, 45, 60, 90] };

function focusTheme(f) {
  const it = state.items.find((x) => x.id === f.itemId);
  return themeOf({ title: f.title, theme: it?.theme || null }, projName(it));
}

function renderHero(v) {
  const f = state.focus;
  const art = $('#hero-art'), ctl = $('#focus-ctl'), hero = $('#hero');
  let mode = 'greet', key = 'greet', th = null, it = null;
  const block = v.isToday ? v.now?.block : null;
  if (f && v.isToday) {
    th = focusTheme(f);
    mode = f.mode === 'pomodoro' ? 'pomo' : 'ring';
    key = `${mode}|${f.itemId}|${f.phase}|${f.round}|${!!f.pausedAt}|${f.minutes}|${focusOpen}`;
    $('#hero-time').textContent = th.label.toLowerCase() === f.title.toLowerCase() ? `${f.title} · ${f.mode === 'pomodoro' ? 'pomodoro' : 'timer'}` : `${th.label} · ${f.title}`;
  } else if (block) {
    const bid = block.itemId || (block.kind === 'event' && !String(block.id).startsWith('rec:') ? block.id : null);
    it = bid ? state.items.find((x) => x.id === bid) : null;
    th = block.kind === 'rest' ? themeOf({ kind: 'rest' }) : themeFor(it || { title: block.title });
    mode = 'icon';
    key = `icon|${th.icon}|${block.title}|${block.itemId}`;
    $('#hero-time').textContent = `${block.title} · fino alle ${block.until}`;
  }
  setActPalette(th?.pal || null);
  hero.dataset.mode = mode;
  $('#app').classList.toggle('focus-open', mode === 'pomo' || mode === 'ring' ? focusOpen : false);
  $('#hero-title').hidden = mode !== 'greet';
  art.hidden = mode === 'greet';
  ctl.hidden = !((mode === 'pomo' || mode === 'ring') && focusOpen);
  if (key !== heroKey) {
    heroKey = key;
    if (mode === 'icon') {
      const startable = !!it && it.status !== 'done';
      art.innerHTML = `<button type="button" class="hero-ic-btn" data-hero="${startable ? 'start' : 'none'}" data-id="${esc(it?.id || '')}" aria-label="${esc(startable ? `Avvia il timer di ${block.title}` : block.title)}"><i class="hero-ic" style="--m:url(icons/act/${th.icon}.svg)"></i></button>`;
    } else if (mode === 'pomo') {
      const run = f.phase === 'work' && !f.pausedAt;
      art.innerHTML = `<button type="button" class="pomo" data-hero="toggle" style="--acc:${f.phase === 'break' ? '#6C5BA8' : th.accent}" aria-label="Pomodoro: ${esc(f.title)}">${gaugeSvg({ pct: 0, running: run || f.phase === 'break', accent: f.phase === 'break' ? '#6C5BA8' : th.accent })}
        <span class="g-num"><b id="f-num"></b><span id="f-lbl"></span></span></button>`;
    } else if (mode === 'ring') {
      const run = f.phase === 'work' && !f.pausedAt;
      art.innerHTML = `<button type="button" class="ring${run ? ' run' : ''}" data-hero="toggle" aria-label="Timer: ${esc(f.title)}"><span class="ring-spin">${dotRingSvg({ colors: [...(th.pal || ['#F4C542', '#C9B6EE', '#F2A7C3']), th.accent] })}</span>
        <span class="r-num"><small id="f-top"></small><b id="f-num"></b><span id="f-lbl"></span><i class="r-ic" style="--m:url(icons/act/${th.icon}.svg)"></i></span></button>`;
    } else art.innerHTML = '';
    if (mode === 'pomo' || mode === 'ring') renderFocusCtl(f);
  }
  updateFocus();
}

/** I comandi del timer (si vedono con il pannello aperto). */
function renderFocusCtl(f) {
  const b = (act, label, cls = '') => `<button type="button" class="fbtn ${cls}" data-f="${act}">${label}</button>`;
  let html = '';
  if (f.phase === 'setup' || f.phase === 'ready') {
    html = `<div class="f-mins" role="radiogroup" aria-label="Quanto dura">${MIN_CHOICES[f.mode].map((m) => `<button type="button" class="ch${m === f.minutes ? ' on' : ''}" data-fmin="${m}" role="radio" aria-checked="${m === f.minutes}">${m}'</button>`).join('')}</div>
      <div class="f-row">${b('go', f.phase === 'ready' ? `Giro ${f.round}` : 'Avvia', 'primary')}${b('cancel', 'Annulla')}</div>`;
  } else if (f.phase === 'work') {
    html = `<div class="f-row">${f.pausedAt ? b('resume', 'Riprendi', 'primary') : b('pause', 'Pausa', 'primary')}${b('end', 'Termina')}${b('collapse', 'Riduci')}</div>`;
  } else if (f.phase === 'break') {
    html = `<div class="f-row">${b('skipbreak', 'Salta la pausa', 'primary')}${b('end', 'Termina')}</div>`;
  } else if (f.phase === 'done') {
    const w = workedMin(f, Date.now());
    html = `<p class="f-note">${w ? `Hai lavorato ${durLabel(w)} su «${esc(f.title)}».` : `«${esc(f.title)}»`} Com'è andata?</p>
      <div class="f-row">${b('done', 'Fatta', 'primary')}${f.mode === 'timer' ? b('more', 'Altri 10\'') : b('go2', 'Un altro giro')}${b('later', 'Non ancora')}</div>`;
  }
  $('#focus-ctl').innerHTML = html;
}

/** Numero, etichetta e progresso: ogni secondo, senza ridisegnare (la luce e la rotazione non si fermano). */
function updateFocus() {
  const f = state.focus;
  clearTimeout(tickTimer);
  if (!f || $('#hero').dataset.mode === 'greet' || $('#hero').dataset.mode === 'icon') return;
  const now = Date.now();
  const v = focusView(f, now);
  if ((f.phase === 'work' || f.phase === 'break') && v.over && !f.pausedAt) { advanceFocus(); return; }
  const num = $('#f-num'), lbl = $('#f-lbl');
  if (!num) return;
  const live = f.phase === 'work' || f.phase === 'break';
  if (f.mode === 'pomodoro') {
    num.textContent = live ? clock(v.left) : f.phase === 'done' ? '✓' : `${f.minutes}'`;
    lbl.textContent = f.phase === 'setup' ? 'Trascina sull\'arco o scegli quanto' : f.phase === 'ready' ? `Pronto per il giro ${f.round}` : f.phase === 'break' ? 'Pausa · respira' : f.phase === 'done' ? 'Fatto' : f.pausedAt ? 'In pausa' : `Giro ${f.round} di ${POMO_ROUNDS}`;
    const pct = f.phase === 'setup' || f.phase === 'ready' ? f.minutes / 60 : f.phase === 'done' ? 1 : v.pct;
    const g = document.querySelector('#hero-art .g-prog');
    if (g) g.innerHTML = gaugeParts(pct);
  } else {
    const mins = Math.ceil(v.left / 60000);
    num.textContent = f.phase === 'done' ? '✓' : String(live ? mins : f.minutes);
    lbl.textContent = f.phase === 'done' ? 'fatto' : f.pausedAt ? 'in pausa' : `di ${Math.round(v.total / 60000)} min`;
    const top = $('#f-top');
    if (top) top.textContent = live && f.startedAt ? `${fmtMin(minOfDay(f.startedAt))} – ${fmtMin(minOfDay(f.startedAt + f.paused + v.total))}` : f.title;
    const lit = Math.round((f.phase === 'done' ? 1 : v.pct) * 112);
    document.querySelectorAll('#hero-art .dotring .d').forEach((d, i) => d.classList.toggle('on', i < lit));
  }
  if (live && !f.pausedAt) tickTimer = setTimeout(updateFocus, 1000 - (now % 1000) + 20);
}
const minOfDay = (t) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };

/** Il tempo della fase è finito. */
function advanceFocus() {
  const f = state.focus;
  const next = focusNext(f, Date.now());
  state.focus = next;
  if (next.phase === 'break') toast(`Giro ${f.round} finito: ${next.round % POMO_ROUNDS === 0 ? 15 : 5} minuti di pausa`);
  else if (next.phase === 'ready') { toast('Pausa finita: quando vuoi, il prossimo giro'); focusOpen = true; }
  else if (next.phase === 'done') { toast(`Tempo finito: «${f.title}»`); focusOpen = true; }
  save(state);
  renderDayView(false);
}

/** «Inizia»: l'attività parte e compare il suo timer (il pomodoro aspetta che scegli quanto). */
function startFocusFor(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  if (state.focus && state.focus.itemId !== id) endFocus('later', true);
  const th = themeFor(it);
  // un impegno già iniziato (lo yoga delle 18): il timer dura fino alla sua fine
  const left = it.kind === 'event' && it.start != null && it.date === today() ? it.start + it.duration - nowMin() : null;
  let f = focusSetup(it, { theme: th, now: Date.now(), minutes: left > 0 && th.tool !== 'pomodoro' ? Math.max(1, left) : undefined });
  if (f.mode !== 'pomodoro') f = focusStart(f, Date.now());
  focusOpen = f.mode === 'pomodoro';
  selDay = today();
  commit(`Iniziata: ${it.title}`, () => { applyOps(state, [{ action: 'start', id }]); state.focus = f; });
  closeSheet();
  $('#day-scroll').scrollTo({ top: 0, behavior: 'smooth' });
}

/** Chiude il timer: «done» = fatta (con i minuti veri), «later» = in parte, «cancel» = niente. */
function endFocus(how, quiet = false) {
  const f = state.focus;
  if (!f) return;
  const w = workedMin(f, Date.now());
  state.focus = null;
  focusOpen = false;
  heroKey = '';
  if (how === 'done') quickOp('complete', f.itemId, w ? { actual_min: w } : {});
  else if (how === 'later' && w) { if (quiet) { applyOps(state, [{ action: 'progress', id: f.itemId, actual_min: w }]); save(state); } else quickOp('progress', f.itemId, { actual_min: w }); }
  else { save(state); renderDayView(false); }
}

function focusAction(act, el) {
  const now = Date.now();
  let f = state.focus;
  if (!f) return;
  if (act === 'go' || act === 'go2') f = focusStart({ ...f, phase: act === 'go2' ? 'ready' : f.phase }, now);
  else if (act === 'pause') f = focusPause(f, now);
  else if (act === 'resume') f = focusResume(f, now);
  else if (act === 'skipbreak') f = focusStart(focusNext(f, now), now);
  else if (act === 'more') f = { ...f, phase: 'work', minutes: 10, startedAt: now, pausedAt: null, paused: 0 };
  else if (act === 'end') {
    const v = focusView(f, now);
    f = { ...f, worked: f.worked + (f.phase === 'work' ? Math.min(v.elapsed, v.total) : 0), phase: 'done', startedAt: null, pausedAt: null, paused: 0 };
  } else if (act === 'collapse') { focusOpen = false; renderDayView(false); return; }
  else if (act === 'done' || act === 'later' || act === 'cancel') { endFocus(act); return; }
  else if (act === 'min') f = { ...f, minutes: +el.dataset.fmin };
  if (act === 'go' || act === 'go2' || act === 'skipbreak' || act === 'more') focusOpen = f.mode === 'pomodoro';
  state.focus = f;
  save(state);
  renderDayView(false);
}

function bindFocus() {
  $('#focus-ctl').addEventListener('click', (e) => {
    const m = e.target.closest('[data-fmin]');
    if (m) { focusAction('min', m); return; }
    const b = e.target.closest('[data-f]');
    if (b) focusAction(b.dataset.f, b);
  });
  const art = $('#hero-art');
  art.addEventListener('click', (e) => {
    const h = e.target.closest('[data-hero]');
    if (!h || Date.now() - dragAt < 400) return;
    if (h.dataset.hero === 'start') startFocusFor(h.dataset.id);
    else if (h.dataset.hero === 'toggle') { focusOpen = !focusOpen; renderDayView(false); }
  });
  // pomodoro: la durata si sceglie anche trascinando sull'arco
  let dragAt = 0, dragging2 = false;
  const pick = (e) => {
    const f = state.focus, g = art.querySelector('.gauge');
    if (!f || !g || !(f.phase === 'setup' || f.phase === 'ready')) return false;
    const m = Math.max(5, Math.min(60, Math.round((pctAt(e.clientX, e.clientY, g.getBoundingClientRect()) * 60) / 5) * 5));
    if (m !== f.minutes) { state.focus = { ...f, minutes: m }; updateFocus(); document.querySelectorAll('#focus-ctl [data-fmin]').forEach((c) => { const on = +c.dataset.fmin === m; c.classList.toggle('on', on); c.setAttribute('aria-checked', on); }); }
    return true;
  };
  art.addEventListener('pointerdown', (e) => { if (e.target.closest('.gauge') && focusOpen && pick(e)) { dragging2 = true; art.setPointerCapture(e.pointerId); e.preventDefault(); } });
  art.addEventListener('pointermove', (e) => { if (dragging2) { pick(e); dragAt = Date.now(); } });
  const stop = () => { if (dragging2) { dragging2 = false; dragAt = Date.now(); save(state); renderFocusCtl(state.focus); } };
  art.addEventListener('pointerup', stop);
  art.addEventListener('pointercancel', stop);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.focus) updateFocus(); });
}

// ---------------------------------------------------------------- tutti i giorni
// ---- vista mese: una carta per ogni giorno con qualcosa in programma
const ovMode = 'month'; // il pizzico porta solo al calendario
const MONTHS = 6;
function renderCalendar(animate) {
  goalFits();
  const months = vm.month({ state, longPlan: { ...(fitCache?.long || {}), ...plan }, planFor, now: Date.now(), months: MONTHS, selected: selDay });
  let html = '', chips = '';
  for (const mo of months) {
    chips += `<button type="button" data-month="${mo.index}"${mo.index === 0 ? ' class="on"' : ''}>${esc(mo.short)}</button>`;
    let cells = '<span class="cd-empty"></span>'.repeat(mo.lead);
    for (const c of mo.cells) {
      const cls = ['cd', c.past ? 'past' : '', c.today ? 'today' : '', c.selected ? 'sel' : ''].join(' ');
      if (c.pick) {
        cells += `<button class="${cls} has${c.pick.image ? ' ph' : ''}${c.allDone ? ' done' : ''}" data-day="${esc(c.day)}" style="--r:${tilt(c.day)}deg" aria-label="${esc(c.label)}">
          <span class="cd-card" data-c="${c.pick.color || ''}"${c.pick.project ? ` data-proj style="--pc:${safeColor(c.pick.project.color) || 'var(--accent)'}"` : ''}>${c.pick.image ? imgTag(c.pick.image) : `<span class="cd-t">${esc(c.pick.title)}</span>`}</span><b>${c.n}</b></button>`;
      } else cells += `<button class="${cls}" data-day="${esc(c.day)}" aria-label="${esc(c.label)}"><b>${c.n}</b></button>`;
    }
    html += `<section class="month" data-mi="${mo.index}" style="--i:${mo.index}">
      <h3>${esc(mo.title)}</h3>
      <div class="wk"><span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span></div>
      <div class="grid">${cells}</div>
    </section>`;
  }
  $('#cal-scroll').innerHTML = html;
  $('#months').innerHTML = chips;
  const td = dateOf(today());
  $('#ov-today-wd').textContent = td.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '');
  $('#ov-today-n').textContent = td.getDate();
  $('#ov-today').setAttribute('aria-label', `Torna a oggi, ${td.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}`);
  glowSoon();
  fillImages($('#cal-scroll'));
  if (animate) animateIn($('#cal-scroll'), 1200);
}

function setOvMode(m, animate) {
  renderCalendar(animate !== false);
  if (mode === 'overview') requestAnimationFrame(() => scrollOverviewTo(selDay));
}

// posizione di scorrimento che porta un mese appena sotto l'intestazione
const monthTop = (sec) => Math.max(0, sec.offsetTop - parseFloat(getComputedStyle($('#cal-scroll')).paddingTop));

function scrollOverviewTo(k) {
  const cell = document.querySelector(`.cd[data-day="${esc(k)}"]`);
  const sec = cell?.closest('.month');
  $('#cal-scroll').scrollTop = sec ? monthTop(sec) : 0;
}

/** Gesti con un dito: giorno precedente/successivo, chiudere la scheda trascinandola, uscire dal riepilogo dal bordo. */
function bindSwipes() {
  const track = (el, { start, move, end }) => {
    let s0 = null;
    el.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { s0 = null; return; } const t = e.touches[0]; s0 = start(e, t) ? { x: t.clientX, y: t.clientY, t: Date.now(), dir: null } : null; }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!s0 || e.touches.length !== 1) return;
      const t = e.touches[0], dx = t.clientX - s0.x, dy = t.clientY - s0.y;
      if (!s0.dir && Math.hypot(dx, dy) > 10) s0.dir = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'h' : 'v';
      if (s0.dir) move?.(e, dx, dy, s0.dir);
    }, { passive: false });
    const fin = (e) => { if (!s0) return; const t = e.changedTouches[0]; end(t.clientX - s0.x, t.clientY - s0.y, s0.dir, Date.now() - s0.t); s0 = null; };
    el.addEventListener('touchend', fin);
    el.addEventListener('touchcancel', () => { if (s0) end(0, 0, null, 0); s0 = null; });
  };

  // giorno: scorri a sinistra = giorno dopo, a destra = giorno prima
  const col = $('#collage');
  track($('#day-scroll'), {
    start: (e) => mode === 'day' && !composing && !e.target.closest('textarea, input, .plus-menu'),
    move: (e, dx, dy, dir) => { if (dragging()) return; if (dir === 'h') { col.style.transition = 'none'; col.style.transform = `translateX(${dx * 0.35}px)`; col.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / 600)); } },
    end: (dx, dy, dir) => {
      col.style.transition = ''; col.style.transform = ''; col.style.opacity = '';
      if (dragging() || dir !== 'h' || Math.abs(dx) < 70) return;
      selDay = addDays(selDay, dx < 0 ? 1 : -1);
      col.classList.remove('slide-l', 'slide-r'); void col.offsetWidth;
      renderDayView(false, { flip: false });
      col.classList.add(dx < 0 ? 'slide-l' : 'slide-r');
      $('#day-scroll').scrollTop = 0;
    },
  });

  // scheda: trascinala giù per chiuderla (dalla maniglia o dall'anteprima della carta)
  const sh = $('#sheet');
  // tirata giù quando è già in cima: niente rimbalzo di iOS, la scheda segue il dito
  let shY = null;
  sh.addEventListener('touchstart', (e) => { shY = e.touches.length === 1 && sh.scrollTop <= 0 && !e.target.closest('input, .chips-x') ? e.touches[0].clientY : null; }, { passive: true });
  sh.addEventListener('touchmove', (e) => { if (shY != null && e.touches[0].clientY > shY && sh.scrollTop <= 0 && e.cancelable) e.preventDefault(); }, { passive: false });
  track(sh, {
    start: (e) => sh.scrollTop <= 0 && !e.target.closest('input, .chips-x'),
    move: (e, dx, dy, dir) => { if (dir === 'v' && dy > 0) { e.preventDefault(); sh.style.transition = 'none'; sh.style.transform = `translateY(${dy}px)`; } },
    end: (dx, dy, dir, ms) => { sh.style.transition = ''; sh.style.transform = ''; if (dir === 'v' && (dy > 110 || (dy > 40 && dy / ms > 0.6))) closeSheet(); },
  });

  // riepilogo: dal bordo sinistro verso destra si torna al calendario
  const sm = $('#summary');
  track(sm, {
    start: (e, t) => t.clientX < 28,
    move: (e, dx, dy, dir) => { if (dir === 'h' && dx > 0) { e.preventDefault(); sm.style.transition = 'none'; sm.style.transform = `translateX(${dx}px)`; } },
    end: (dx, dy, dir) => { sm.style.transition = ''; sm.style.transform = ''; if (dir === 'h' && dx > 90) closeSummary(); },
  });
}

function openOverview() {
  if (mode === 'overview') return;
  setComposing(false);
  closePlus();
  mode = 'overview';
  setOvMode(ovMode, true);
  const ov = $('#overview');
  ov.hidden = false;
  void ov.offsetWidth;
  scrollOverviewTo(selDay);
  $('#app').classList.add('mode-overview');
  $('#sum-fab').inert = false;
  glowSoon();
}

/** Apre un giorno; se arriva da una carta della panoramica, la carta si espande a tutto schermo. */
function openDay(day, fromEl) {
  selDay = day;
  renderDayView(true);
  $('#day-scroll').scrollTop = 0;
  $('#hero').style.setProperty('--p', 0);
  const dayEl = $('#day');
  if (fromEl && mode === 'overview') {
    const r = fromEl.getBoundingClientRect();
    const W = $('#app').clientWidth, H = $('#app').clientHeight;
    const s = r.width / W;
    dayEl.style.transition = 'none';
    dayEl.style.transformOrigin = '0 0';
    dayEl.style.opacity = '1';
    dayEl.style.transform = `translate(${r.left}px, ${r.top}px) scale(${s})`;
    dayEl.style.clipPath = `inset(0 0 ${Math.max(0, H - r.height / s)}px 0 round ${26 / s}px)`;
    $('#app').classList.remove('mode-overview');
    void dayEl.offsetWidth;
    dayEl.style.transition = 'transform .6s cubic-bezier(.22,1,.36,1), clip-path .6s cubic-bezier(.22,1,.36,1)';
    dayEl.style.transform = 'translate(0,0) scale(1)';
    dayEl.style.clipPath = 'inset(0 0 0 0 round 0px)';
    setTimeout(() => { Object.assign(dayEl.style, { transition: '', transformOrigin: '', opacity: '', transform: '', clipPath: '' }); }, 650);
  } else {
    $('#app').classList.remove('mode-overview');
  }
  mode = 'day';
  $('#sum-fab').inert = true; // il riepilogo sta solo nel calendario
  glowSoon();
  setTimeout(() => { if (mode === 'day') $('#overview').hidden = true; }, 600);
}

// pizzico: verso l'interno dal giorno → panoramica; verso l'esterno su un giorno → lo apre
function bindPinch() {
  const app = $('#app'), dayEl = $('#day');
  let startD = 0, scale = 1, active = false, target = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  app.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    startD = dist(e.touches);
    scale = 1;
    active = true;
    if (mode === 'overview') {
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      target = document.elementFromPoint(mx, my)?.closest('.cd') || null;
    }
  }, { passive: true });
  app.addEventListener('touchmove', (e) => {
    if (!active || e.touches.length !== 2) return;
    e.preventDefault();
    scale = dist(e.touches) / startD;
    if (mode === 'day') {
      const s = Math.max(0.72, Math.min(1, scale));
      dayEl.style.transition = 'none';
      dayEl.style.transform = `scale(${s})`;
      dayEl.style.borderRadius = `${(1 - s) * 140}px`;
    } else if (target) {
      target.style.transition = 'none';
      target.style.transform = `scale(${Math.max(1, Math.min(1.12, scale))})`;
    }
  }, { passive: false });
  const end = () => {
    if (!active) return;
    active = false;
    if (mode === 'day') {
      Object.assign(dayEl.style, { transition: '', transform: '', borderRadius: '' });
      if (scale < 0.86) openOverview();
    } else {
      const tl = target;
      target = null;
      if (tl) { tl.style.transition = ''; tl.style.transform = ''; }
      if (scale > 1.1) { // il pizzico al contrario torna al giorno (quello sotto le dita, o quello di prima)
        const k = tl?.dataset.day || selDay;
        openDay(k, tl || document.querySelector(`.cd[data-day="${esc(k)}"]`));
      }
    }
  };
  app.addEventListener('touchend', end);
  app.addEventListener('touchcancel', end);
}


// ---------------------------------------------------------------- riepilogo (chat)
// Dal calendario: i punti chiave su come sta andando, poi le domande. Da qui non si modifica il piano.
let summaryOpen = false, asking = false;
function summaryModel() {
  goalFits();
  return vm.summary({ state, plan, longPlan: fitCache?.long, planFor, now: Date.now(), fits: goalFits() });
}
function openSummary() {
  summaryOpen = true;
  const el = $('#summary');
  el.hidden = false;
  el.classList.remove('closing');
  setComposing(false);
  closePlus();
  $('#input').blur();
  $('#app').classList.add('sum-open');
  $('#day').inert = $('#overview').inert = $('#composer').inert = $('#sum-fab').inert = true;
  renderSummary(true);
  aiIntro();
}
function closeSummary() {
  summaryOpen = false;
  const el = $('#summary');
  el.classList.add('closing');
  $('#app').classList.remove('sum-open');
  $('#day').inert = $('#overview').inert = $('#composer').inert = false;
  $('#sum-fab').inert = mode !== 'overview';
  $('#ask-input').blur();
  glowSoon();
  setTimeout(() => { if (!summaryOpen) { el.hidden = true; el.classList.remove('closing'); } }, 320);
}
const introKey = (sum) => today() + '|' + sum.points.join('|');
function renderSummary(animate) {
  const sum = summaryModel();
  const intro = state.askIntro?.key === introKey(sum) ? state.askIntro.text : null;
  const para = (t) => `<p>${esc(t)}</p>`;
  const lines = (txt) => String(txt).split(/\n+/).filter(Boolean).map(para).join('');
  let html = `<div class="sm-time">${esc(cap(new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })))}</div>`;
  html += `<div class="sm-ai">${intro ? lines(intro) : para(sum.intro) + sum.points.map((p) => para('• ' + p)).join('')}${introPending ? '<p class="sm-typing"><i></i><i></i><i></i></p>' : ''}</div>`;
  if (sum.list.rows.length) {
    html += `<div class="sm-ai"><p>Ecco i prossimi giorni, in base al</p><p class="sm-ref"><i class="ic ic-file" aria-hidden="true"></i><b>tuo calendario e ai tuoi obiettivi.</b></p></div>
    <div class="sm-list"><div class="sl-head"><span>${esc(sum.list.date)}</span><b>${esc(sum.list.title)}</b></div>
      ${sum.list.rows.map((r) => `<button type="button" class="sl-row${r.done ? ' done' : ''}" data-day="${esc(r.day)}"><i class="ic ${r.done ? 'ic-check' : 'ic-circle'}" aria-hidden="true"></i><span><b>${esc(r.title)}</b><small>${esc(r.sub)}</small></span></button>`).join('')}
    </div>`;
  }
  if (sum.projects.length) {
    html += `<div class="sm-ai"><p>E i tuoi progetti:</p></div><div class="sm-cards">${sum.projects.map((p, i) => `<button type="button" class="sm-card" data-day="${esc(p.day)}" style="--pc:${safeColor(p.color) || 'var(--accent)'};--r:${i % 2 ? 1 : -1}deg">
      <span class="sc-body"><b>${esc(p.name)}</b><span>${esc(p.text)}</span></span>
      <span class="sc-foot">${projMark({ name: p.name, color: p.color })}<span>${esc(p.footer)}</span><i class="ic ic-out" aria-hidden="true"></i></span></button>`).join('')}</div>`;
  }
  if (sum.monthSessions) html += `<button type="button" class="sm-more" id="sm-more"><i class="ic ic-grid" aria-hidden="true"></i>Vedi tutto il mese (${plural(sum.monthSessions, 'sessione', 'sessioni')})</button>`;
  // la conversazione
  for (const m of state.askChat || []) {
    if (m.role === 'user') html += `<div class="sm-user"><p>${esc(m.text)}</p></div>`;
    else html += `<div class="sm-ai${m.error ? ' err' : ''}">${m.pending ? '<p class="sm-typing"><i></i><i></i><i></i></p>' : lines(m.text)}</div>`;
  }
  const sc = $('#sum-scroll');
  const atEnd = sc.scrollTop + sc.clientHeight > sc.scrollHeight - 40;
  sc.innerHTML = html;
  if (animate) { animateIn(sc, 1200); sc.scrollTop = 0; } else if (atEnd) sc.scrollTop = sc.scrollHeight;
  $('#ask-send').disabled = asking;
  glowSoon();
}

/** Con un'AI attiva, i punti chiave li scrive l'AI (una volta, finché il piano non cambia). */
let introPending = false;
async function aiIntro() {
  const mode = aiMode();
  const sum = summaryModel();
  if (mode === 'base' || introPending || state.askIntro?.key === introKey(sum) || !navigator.onLine && mode !== 'local') return;
  introPending = true;
  renderSummary(false);
  try {
    const text = await askAi('Fammi il punto: come sto andando e cosa mi aspetta nei prossimi giorni e nel mese, in punti chiave.', sum, []);
    if (text) { state.askIntro = { key: introKey(sum), text: text.slice(0, 2000) }; save(state); }
  } catch (e) { console.warn('riepilogo AI non disponibile', e); }
  introPending = false;
  if (summaryOpen) renderSummary(false);
}

function askAi(question, sum, history) {
  const mode = aiMode();
  const system = askSystem(state, plan, Date.now(), sum);
  const msgs = [...history, { role: 'user', content: question }];
  const run = (signal) => (mode === 'claude' ? claudeAsk(state, system, msgs, signal) : openAsk(state, system, msgs, signal));
  return mode === 'local' ? run() : withTimeout(run, AI_TIMEOUT);
}

async function ask(text) {
  text = text.trim();
  if (!text || asking) return;
  state.askChat ||= [];
  const history = state.askChat.filter((m) => !m.pending && !m.error).slice(-8).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
  state.askChat.push({ id: uid(), role: 'user', text: text.slice(0, 1000), ts: Date.now() });
  const ans = { id: uid(), role: 'assistant', pending: true, text: '', ts: Date.now() };
  state.askChat.push(ans);
  if (state.askChat.length > 40) state.askChat = state.askChat.slice(-40);
  asking = true;
  renderSummary(false);
  $('#sum-scroll').scrollTop = $('#sum-scroll').scrollHeight;
  const sum = summaryModel();
  const local = vm.answerLocally(text, sum, state);
  try {
    if (aiMode() === 'base') ans.text = local || 'Senza AI so rispondere a: come sto andando, cosa ho questa settimana, il mese, le scadenze e i progetti per nome. Per tutto il resto scegli un\'AI gratuita in ⋯ → Assistente AI.';
    else ans.text = (await askAi(text, sum, history)) || local || 'Non ho una risposta.';
  } catch (e) {
    ans.text = local ? `${e.code === 'timeout' ? 'L\'AI non risponde' : 'L\'AI ha avuto un problema'}: ecco cosa so.\n${local}` : errorText(e);
    ans.error = !local;
  }
  ans.pending = false;
  asking = false;
  save(state);
  renderSummary(false);
  $('#sum-scroll').scrollTop = $('#sum-scroll').scrollHeight;
}

// ---------------------------------------------------------------- menu "+" e foto
function togglePlus(force) {
  const m = $('#plus-menu');
  const open = force ?? m.hidden;
  m.hidden = !open;
  $('#plus').classList.toggle('open', open);
  syncBar();
}
const closePlus = () => togglePlus(false);

let sheetPhoto = null; // { blob, url } nuova foto, oppure { remove: true }
let photoTarget = 'new';
function pickPhoto(target) {
  photoTarget = target;
  const inp = $('#photo-input');
  inp.value = '';
  inp.click();
}
async function onPhotoPicked(file) {
  if (!file) return;
  let blob;
  try { blob = await compressImage(file); } catch { toast('Non riesco a leggere questa foto'); return; }
  if (sheetPhoto?.url) URL.revokeObjectURL(sheetPhoto.url);
  sheetPhoto = { blob, url: URL.createObjectURL(blob) };
  if (photoTarget === 'new') openSheet(null, {}, true);
  else renderEditor();
}
// ---------------------------------------------------------------- scheda modifica
function openSheet(id, preset = {}, keepPhoto = false) {
  if (!keepPhoto) sheetPhoto = null;
  closePlus();
  if (id && String(id).startsWith('rec:')) { openRecSheet(id); return; }
  sheetMode = 'item';
  const it = id ? state.items.find((x) => x.id === id) : null;
  const isNew = !it;
  const v = it || { title: '', kind: 'task', date: selDay, start: null, duration: 45, priority: 2, energy: 2, window: null, deadline: null, status: 'todo', project: null, color: null, ...preset };
  ed = { title: v.title, kind: v.kind, date: v.date || null, start: v.start ?? null, duration: v.duration || 45, priority: v.priority || 2, energy: v.energy || 2,
    window: v.window || null, deadline: v.deadline || null, project: v.project || null, color: v.color || null, image: v.image || null, estimated: !!v.durationEstimated };
  const t = today(), tm = addDays(t, 1);
  const chip = (group, val, label, extra = '') => `<button type="button" class="ch" data-ed="${group}" data-v="${esc(String(val))}" ${extra}>${label}</button>`;
  const colors = [['', 'Carta'], ['rose', 'Rosa'], ['lilac', 'Lilla'], ['sage', 'Salvia'], ['sand', 'Sabbia'], ['sky', 'Cielo']];
  $('#sheet-form').innerHTML = `
    <h2 id="sheet-title" class="sr-only">${isNew ? 'Nuova carta' : 'Modifica la carta'}</h2>
    <div class="ed-card" id="ed-card">
      <div class="ed-photo" id="ed-photo"></div>
      <textarea class="ed-title" name="title" rows="2" placeholder="Cosa devi fare?" aria-label="Titolo" maxlength="80">${esc(v.title)}</textarea>
      <div class="ed-sub" id="ed-sub"></div>
      <div class="ed-foot" id="ed-foot"></div>
    </div>
    <div class="ed-colors" role="radiogroup" aria-label="Colore della carta">
      ${colors.map(([c, l]) => `<button type="button" class="sw" data-ed="color" data-v="${c}" data-c="${c}" role="radio" aria-label="${l}"></button>`).join('')}
      <button type="button" class="sw photo" data-photo="pick" aria-label="Foto"><i class="ic ic-photo" aria-hidden="true"></i></button>
    </div>
    <section class="ed-row"><span class="ed-k">Quando</span><div class="chips-x">
      ${v.kind === 'task' ? chip('date', '', 'Quando vuoi') : ''}${chip('date', t, 'Oggi')}${chip('date', tm, 'Domani')}
      <label class="ch ch-in" data-ed-in="date"><span id="ed-date-l">Altro giorno</span><input type="date" id="ed-date" aria-label="Scegli il giorno"></label>
    </div></section>
    <section class="ed-row"><span class="ed-k">Ora</span><div class="chips-x">
      <span id="ed-free-wrap">${chip('start', '', 'La sceglie Tempo')}</span>
      <label class="ch ch-in" data-ed-in="start"><span id="ed-start-l">Scegli l'ora</span><input type="time" id="ed-start" aria-label="Scegli l'ora"></label>
    </div></section>
    <section class="ed-row"><span class="ed-k">Durata</span><div class="chips-x">
      ${[15, 30, 45, 60, 90, 120].map((m) => chip('duration', m, durLabel(m))).join('')}
      <span class="stepper"><button type="button" data-step="-5" aria-label="Meno 5 minuti">−</button><b id="ed-dur">${durLabel(ed.duration)}</b><button type="button" data-step="5" aria-label="Più 5 minuti">+</button></span>
    </div></section>
    ${(state.projects || []).length ? `<section class="ed-row"><span class="ed-k">Progetto</span><div class="chips-x">${chip('project', '', 'Nessuno')}${state.projects.map((p) => chip('project', p.id, `<i class="dot" style="--pc:${safeColor(p.color) || 'var(--accent)'}"></i>${esc(p.name)}`)).join('')}</div></section>` : ''}
    <details class="ed-more"><summary>Altro</summary>
      <section class="ed-row"><span class="ed-k">Tipo</span><div class="chips-x">${chip('kind', 'task', 'Flessibile')}${chip('kind', 'event', 'Orario fisso')}</div></section>
      <section class="ed-row"><span class="ed-k">Importante</span><div class="chips-x">${chip('priority', 3, '★ Sì')}${chip('priority', 2, 'Normale')}${chip('priority', 1, 'Può aspettare')}</div></section>
      <section class="ed-row"><span class="ed-k">Energia</span><div class="chips-x">${chip('energy', 1, 'Leggera')}${chip('energy', 2, 'Media')}${chip('energy', 3, 'Concentrazione')}</div></section>
      <section class="ed-row"><span class="ed-k">Fascia</span><div class="chips-x">${chip('window', '', 'Qualsiasi')}${Object.keys(WINDOWS).map((w) => chip('window', w, cap(w))).join('')}</div></section>
      <section class="ed-row"><span class="ed-k">Scadenza</span><div class="chips-x">${chip('deadline', '', 'Nessuna')}<label class="ch ch-in" data-ed-in="deadline"><span id="ed-dl-l">Scegli</span><input type="date" id="ed-dl" aria-label="Scadenza"></label></div></section>
    </details>
    <div class="ed-actions">
      ${isNew ? '' : `<div class="ed-quick">
        ${it.status === 'done' ? `<button type="button" data-sheet="reopen"><i class="ic ic-undo" aria-hidden="true"></i>Riapri</button>` : `<button type="button" data-sheet="done">${ICON_CHECK}Fatto</button>`}
        ${it.status !== 'done' && it.kind === 'task' && it.status !== 'doing' ? `<button type="button" data-sheet="start">${ICON_PLAY}Inizia</button>` : ''}
        ${it.status !== 'done' ? `<button type="button" data-sheet="tomorrow"><i class="ic ic-next" aria-hidden="true"></i>Domani</button>` : ''}
        <button type="button" data-sheet="delete" class="danger"><i class="ic ic-x" aria-hidden="true"></i>Elimina</button>
      </div>`}
      <button type="submit" class="btn primary ed-save">${isNew ? 'Aggiungi' : 'Salva'}</button>
    </div>`;
  $('#sheet-form').dataset.id = it ? it.id : '';
  renderEditor();
  showSheet();
  if (isNew && !keepPhoto) setTimeout(() => $('#sheet-form .ed-title').focus(), 300);
}

// ---- impegno ricorrente: si modifica come una carta (titolo, orario, giorni, colore)
let sheetMode = 'item', red = null;
const WD_SHORT = ['L', 'M', 'M', 'G', 'V', 'S', 'D'], WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WD_FULL = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
function openRecSheet(id) {
  const [, recId, day] = String(id).split(':');
  const r = state.recurring.find((x) => x.id === recId);
  if (!r) return;
  sheetMode = 'rec';
  ed = null;
  red = { id: r.id, day, title: r.title, start: r.start, end: r.end, weekdays: [...r.weekdays], color: r.color || null };
  const colors = [['', 'Carta'], ['rose', 'Rosa'], ['lilac', 'Lilla'], ['sage', 'Salvia'], ['sand', 'Sabbia'], ['sky', 'Cielo']];
  $('#sheet-form').innerHTML = `
    <h2 id="sheet-title" class="sr-only">Impegno di ogni settimana</h2>
    <div class="ed-card event" id="ed-card">
      <textarea class="ed-title" name="title" rows="2" aria-label="Titolo" maxlength="80">${esc(r.title)}</textarea>
      <div class="ed-sub" id="ed-sub"></div>
      <div class="ed-foot"><span>Ogni settimana</span></div>
    </div>
    <div class="ed-colors" role="radiogroup" aria-label="Colore della carta">
      ${colors.map(([c, l]) => `<button type="button" class="sw" data-rc="${c}" data-c="${c}" role="radio" aria-label="${l}"></button>`).join('')}
    </div>
    <section class="ed-row"><span class="ed-k">Orario</span><div class="chips-x">
      <label class="ch ch-in on"><span id="rec-start-l"></span><input type="time" id="rec-start" aria-label="Inizio"></label>
      <label class="ch ch-in on"><span id="rec-end-l"></span><input type="time" id="rec-end" aria-label="Fine"></label>
    </div></section>
    <section class="ed-row"><span class="ed-k">Giorni</span><div class="chips-x days">
      ${WD_ORDER.map((d) => `<button type="button" class="ch day" data-rd="${d}" aria-label="${WD_FULL[d]}">${WD_SHORT[WD_ORDER.indexOf(d)]}</button>`).join('')}
    </div></section>
    <div class="ed-actions">
      <div class="ed-quick">
        <button type="button" data-sheet="skip" data-rec="${esc(r.id)}" data-day="${esc(day)}"><i class="ic ic-next" aria-hidden="true"></i>Salta ${esc(dayLabel(day, today()))}</button>
        <button type="button" data-sheet="delrec" data-rec="${esc(r.id)}" class="danger"><i class="ic ic-x" aria-hidden="true"></i>Elimina</button>
      </div>
      <button type="submit" class="btn primary ed-save">Salva</button>
    </div>`;
  $('#sheet-form').dataset.id = '';
  renderRec();
  showSheet();
}
function renderRec() {
  if (!red) return;
  const f = $('#sheet-form');
  for (const b of f.querySelectorAll('[data-rc]')) { const on = (red.color || '') === b.dataset.rc; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
  for (const b of f.querySelectorAll('[data-rd]')) { const on = red.weekdays.includes(+b.dataset.rd); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
  $('#rec-start').value = fmtMin(red.start); $('#rec-end').value = fmtMin(red.end);
  $('#rec-start-l').textContent = 'Dalle ' + fmtMin(red.start); $('#rec-end-l').textContent = 'alle ' + fmtMin(red.end);
  $('#ed-card').dataset.c = red.color || '';
  const days = WD_ORDER.filter((d) => red.weekdays.includes(d));
  const dl = days.length === 7 ? 'Tutti i giorni' : days.join() === '1,2,3,4,5' ? 'Dal lunedì al venerdì' : days.map((d) => WD_FULL[d]).join(', ');
  $('#ed-sub').textContent = `${cap(dl || 'nessun giorno')} · ${fmtMin(red.start)}–${fmtMin(red.end)}`;
}
function saveRec() {
  const title = $('#sheet-form').title.value.trim().slice(0, 80);
  if (!title) { toast('Serve un titolo'); return; }
  if (!red.weekdays.length) { toast('Scegli almeno un giorno'); return; }
  if (red.end <= red.start) { toast('La fine deve venire dopo l\'inizio'); return; }
  const r = red;
  commit('Impegno ricorrente', () => { applyOps(state, [{ action: 'update_recurring', id: r.id, title, start_time: fmtMin(r.start), end_time: fmtMin(r.end), weekdays: r.weekdays, color: r.color }]); });
  closeSheet();
  toastUndo('Salvato: vale per tutte le settimane');
}

// ---- la pausa dopo il lavoro: quanto dura (o niente)
function openRestSheet() {
  sheetMode = 'rest';
  ed = null; red = null;
  const cur = state.prefs.decompress ?? 45;
  $('#sheet-form').innerHTML = `
    <h2 id="sheet-title" class="sr-only">Pausa dopo il lavoro</h2>
    <div class="ed-card" id="ed-card"><div class="ed-title" style="padding-bottom:4px">Cena / decompressione</div>
      <div class="ed-sub">Dopo il lavoro tengo libero questo tempo prima delle attività.</div><div class="ed-foot"><span>Pausa</span></div></div>
    <section class="ed-row"><span class="ed-k">Quanto dura</span><div class="chips-x">
      ${[0, 15, 30, 45, 60, 90].map((m) => `<button type="button" class="ch${m === cur ? ' on' : ''}" data-dec="${m}" aria-pressed="${m === cur}">${m ? durLabel(m) : 'Niente pausa'}</button>`).join('')}
    </div></section>
    <div class="ed-actions"><button type="button" class="btn ed-save" data-sheet="close">Chiudi</button></div>`;
  $('#sheet-form').dataset.id = '';
  showSheet();
}

/** Una nuova scadenza per un obiettivo: tre scelte rapide o un giorno preciso. */
function openGoalDateSheet(gid) {
  const g = (state.goals || []).find((x) => x.id === gid);
  if (!g) return;
  sheetMode = 'goal-date';
  ed = null; red = null;
  const t = today();
  const [y, m, d] = t.split('-').map(Number);
  const opts = [['Tra 2 settimane', addDays(t, 14)], ['Tra un mese', dateKey(new Date(y, m, d))], ['Tra 3 mesi', dateKey(new Date(y, m + 2, d))]];
  $('#sheet-form').innerHTML = `
    <h2 id="sheet-title" class="sr-only">Nuova data</h2>
    <div class="ed-card" id="ed-card"><div class="ed-title" style="padding-bottom:4px">${esc(g.title)}</div>
      <div class="ed-sub">Scegli la nuova scadenza: ridistribuisco le sessioni fino a lì.</div><div class="ed-foot"><span>Obiettivo</span></div></div>
    <section class="ed-row"><span class="ed-k">Nuova data</span><div class="chips-x">
      ${opts.map(([l, v]) => `<button type="button" class="ch" data-gdate="${v}" data-gid="${esc(g.id)}">${l}</button>`).join('')}
      <label class="ch ch-in"><span>Scegli il giorno</span><input type="date" id="gd-date" data-gid="${esc(g.id)}" min="${addDays(t, 1)}" aria-label="Scegli il giorno"></label>
    </div></section>
    <div class="ed-actions"><button type="button" class="btn ed-save" data-sheet="close">Chiudi</button></div>`;
  $('#sheet-form').dataset.id = '';
  showSheet();
}
function setGoalDate(gid, date) {
  if (!date || date <= today()) return;
  let res = null;
  commit('Scadenza spostata', () => { res = answerObservation(state, 'extend', `${gid}|${date}`, { now: Date.now(), plan }); });
  closeSheet();
  if (res) toastUndo(res.toast);
}

/** Aggiorna anteprima e scelte dell'editor senza ridisegnarlo (il fuoco resta dov'è). */
let ed = null;
function renderEditor() {
  if (!ed) return;
  const f = $('#sheet-form');
  const t = today();
  for (const b of f.querySelectorAll('[data-ed]')) {
    const g = b.dataset.ed, val = b.dataset.v;
    const cur = ed[g] == null ? '' : String(ed[g]);
    const on = cur === val;
    b.classList.toggle('on', on);
    b.setAttribute(b.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-pressed', on);
  }
  const custom = (key, inId, lblId, fmt) => {
    const inp = $(inId), l = $(lblId);
    if (!inp) return;
    const val = ed[key];
    const isCustom = val != null && (key !== 'date' || (val !== t && val !== addDays(t, 1)));
    inp.value = val == null ? '' : key === 'start' ? fmtMin(val) : val;
    l.textContent = isCustom ? fmt(val) : (key === 'date' ? 'Altro giorno' : key === 'start' ? 'Scegli l\'ora' : 'Scegli');
    inp.closest('.ch').classList.toggle('on', isCustom);
  };
  const dayTxt = (k) => cap(dateOf(k).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }));
  custom('date', '#ed-date', '#ed-date-l', dayTxt);
  custom('start', '#ed-start', '#ed-start-l', fmtMin);
  custom('deadline', '#ed-dl', '#ed-dl-l', dayTxt);
  $('#ed-free-wrap').hidden = ed.kind === 'event';
  $('#ed-dur').textContent = durLabel(ed.duration);
  // anteprima: la carta com'è
  const card = $('#ed-card');
  card.dataset.c = ed.color || '';
  card.classList.toggle('event', ed.kind === 'event');
  const photo = sheetPhoto?.url || (!sheetPhoto?.remove && ed.image ? cachedImageUrl(ed.image) : null);
  card.classList.toggle('has-photo', !!photo);
  $('#ed-photo').innerHTML = photo ? `<img src="${esc(photo)}" alt=""><button type="button" class="ed-rm" data-photo="remove" aria-label="Togli la foto">×</button>` : '';
  if (!photo && ed.image && !sheetPhoto?.remove) imageUrl(ed.image).then((u) => { if (u && ed?.image) renderEditor(); }).catch(() => {});
  const when = [ed.date ? (ed.date === t ? 'Oggi' : ed.date === addDays(t, 1) ? 'Domani' : dayTxt(ed.date)) : 'Quando vuoi', ed.start != null ? fmtMin(ed.start) : ed.kind === 'task' ? 'ora scelta da Tempo' : 'serve un orario', durLabel(ed.duration)];
  $('#ed-sub').textContent = when.join(' · ');
  const pr = ed.project ? projectOf(state, ed.project) : null;
  $('#ed-foot').innerHTML = `${pr ? projMark(pr) + `<span>${esc(pr.name)}</span>` : `<span>${ed.kind === 'event' ? 'Impegno fisso' : 'Attività'}</span>`}${ed.priority === 3 ? '<b class="ed-star" aria-label="Importante">★</b>' : ''}`;
}

// la scheda: se si apre toccando una carta, la carta si solleva e diventa l'anteprima dell'editor
let sheetFrom = null;
function showSheet() {
  const sh = $('#sheet'), from = sheetFrom;
  sheetFrom = null;
  sh.classList.remove('closing');
  sh.classList.toggle('zoom', !!from && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  sh.hidden = false; $('#sheet-backdrop').hidden = false;
  const card = sh.querySelector('#ed-card');
  if (!from || !card || !sh.classList.contains('zoom')) return;
  const to = card.getBoundingClientRect();
  const s = from.width / to.width;
  card.animate([
    { translate: `${from.left - to.left + (from.width - to.width) / 2}px ${from.top - to.top + (from.height - to.height * s) / 2}px`, scale: `${s}`, rotate: '0deg' },
    { translate: '0 0', scale: '1' },
  ], { duration: 640, easing: SPRING });
}
function closeSheet() {
  const sh = $('#sheet'), bd = $('#sheet-backdrop');
  if (sh.hidden) return;
  sh.classList.add('closing'); bd.classList.add('closing');
  setTimeout(() => { sh.hidden = true; bd.hidden = true; sh.classList.remove('closing'); bd.classList.remove('closing'); }, 260);
}

function readSheet() {
  return { ...ed, title: $('#sheet-form').title.value.trim().slice(0, 80) };
}

async function sheetSave() {
  const id = $('#sheet-form').dataset.id;
  const v = readSheet();
  if (!v.title) { toast('Serve un titolo'); return; }
  if (v.kind === 'event' && v.start == null) { toast('Un impegno fisso ha bisogno di un orario'); return; }
  if (v.kind === 'event' && !v.date) v.date = selDay;
  const old = id ? state.items.find((x) => x.id === id) : null;
  try {
    if (sheetPhoto?.blob) {
      const imgId = 'img_' + uid() + uid();
      await putImage(imgId, sheetPhoto.blob);
      if (old?.image) deleteImage(old.image).catch(() => {});
      v.image = imgId;
    } else if (sheetPhoto?.remove && old?.image) {
      deleteImage(old.image).catch(() => {});
      v.image = null;
    }
  } catch { toast('Non sono riuscito a salvare la foto'); }
  sheetPhoto = null;
  const newId = id || uid();
  changedIds = new Set([newId]);
  setTimeout(() => { changedIds = new Set(); }, 2500);
  const clean = {
    title: v.title, kind: v.kind === 'event' ? 'event' : 'task', date: v.date || null, start: v.start ?? null,
    duration: Math.max(5, Math.min(960, Math.round(v.duration) || 30)), priority: [1, 2, 3].includes(v.priority) ? v.priority : 2,
    energy: [1, 2, 3].includes(v.energy) ? v.energy : 2, window: WINDOWS[v.window] ? v.window : null, deadline: v.deadline || null,
    project: v.project && projectOf(state, v.project) ? v.project : null, color: v.color || null,
  };
  if ('image' in v) clean.image = v.image;
  clean.goalId = clean.project ? (state.goals || []).find((g) => g.projectId === clean.project)?.id || null : null;
  commit(id ? 'Modifica manuale' : 'Nuova attività', () => {
    if (old) {
      if (old.duration !== clean.duration) { old.durationEstimated = false; old.baseDuration = null; }
      Object.assign(old, clean, { updatedAt: Date.now() });
      if (state.anchors) delete state.anchors[id];
    } else {
      state.items.push({ id: newId, ...clean, durationEstimated: false, status: 'todo', startedAt: null, doneAt: null, actual: null, dependsOn: [], notes: '', spent: 0, createdAt: Date.now(), updatedAt: Date.now() });
    }
    applyOps(state, []); // abitudini e controlli dopo la modifica
  });
  closeSheet();
  toastUndo(id ? 'Salvato' : 'Aggiunto');
}

function quickOp(action, id, extra = {}, opts = {}) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  const label = { complete: 'Fatto', start: 'Iniziata', reopen: 'Riaperta', delete: 'Eliminata', move: 'Spostata', progress: 'Segnato in parte', skip: 'Rimandata' }[action];
  commit(`${label}: ${it.title}`, () => applyOps(state, [{ action, id, ...extra }]), opts);
  closeSheet();
  toastUndo(`${label}: ${it.title}`);
}

/** Le risposte alle osservazioni del companion (la logica sta in companion.js: answerObservation). */
function briefAction(act, arg) {
  if (act === 'goal-more') { $('#input').focus(); toast('Dimmi il prossimo passo: lo metto al posto giusto.'); return; }
  if (act === 'backup') { exportData(); return; }
  if (act === 'goal-date') { openGoalDateSheet(arg); return; }
  let res = null;
  const undoId = commit('Risposta al companion', () => { res = answerObservation(state, act, arg, { now: Date.now(), plan }); });
  if (!res) { popUndo(state, undoId); replan(); renderAll(); return; }
  if (res.plain) toast(res.toast); else toastUndo(res.toast);
}

// ---------------------------------------------------------------- presentazione
// Quattro domande, una alla volta: cosa vuoi ottenere, cosa non si sposta, su cosa lavori, come rendi meglio.
const ONB = vm.onboarding().map((x) => ({ k: x.key, kick: x.kick, q: x.q, sub: x.sub, ph: x.placeholder, ex: x.examples }));
let onbStep = 0;
const onbAns = {};
/** Mentre la presentazione è aperta, il resto dell'app non si raggiunge (né col tocco né con lo screen reader). */
function setBackgroundInert(on) {
  for (const sel of ['#day', '#overview', '#composer', '#sum-fab', '.glow', '#panel']) { const el = $(sel); if (el) el.inert = on; }
}
function openOnboarding() {
  onbStep = 0;
  setBackgroundInert(true);
  for (const k in onbAns) delete onbAns[k];
  const o = $('#onb');
  o.hidden = false; o.classList.remove('closing');
  setComposing(false);
  renderOnb();
}
function renderOnb() {
  const st = ONB[onbStep];
  $('#onb-dots').innerHTML = ONB.map((_, i) => `<i class="${i === onbStep ? 'on' : ''}"></i>`).join('');
  $('#onb-skip').textContent = onbStep === 0 ? 'Salta' : 'Dopo';
  const body = $('#onb-body');
  body.innerHTML = `<div class="onb-k">${esc(st.kick)}</div><h2 class="onb-q">${esc(st.q)}</h2><p class="onb-sub">${esc(st.sub)}</p>
    ${st.k ? `<div><textarea class="onb-in" id="onb-in" rows="4" aria-label="${esc(st.q)}" placeholder="${esc(st.ph)}">${esc(onbAns[st.k] || '')}</textarea><div class="onb-ex">${st.ex.map((x) => `<button type="button" data-ex="${esc(x)}" aria-label="Aggiungi: ${esc(x)}">${esc(x)}</button>`).join('')}</div></div>` : ''}`;
  animateIn(body, 900);
  $('#onb-next').textContent = onbStep === 0 ? 'Iniziamo' : onbStep === ONB.length - 1 ? 'Costruisci le mie giornate' : 'Avanti';
}
function onbSave() {
  const st = ONB[onbStep];
  const inp = $('#onb-in');
  if (st.k && inp) onbAns[st.k] = inp.value.trim();
}
function closeOnboarding() {
  const o = $('#onb');
  o.classList.add('closing');
  setBackgroundInert(false);
  setTimeout(() => { o.hidden = true; o.classList.remove('closing'); }, 360);
  state.onboarded = true;
  save(state);
}
// Dopo le domande: cosa ho capito, cosa no (da riscrivere), i primi 7 giorni. Solo allora si applica.
let onbReview = null;
async function reviewOnboarding() {
  onbSave();
  let r = contextReview(onbAns, today(), state, Date.now());
  if (!r.ops.some((o) => o.action !== 'remember') && !r.missed.length) { closeOnboarding(); return; }
  onbReview = { ...r, loading: aiMode() !== 'base' && r.ops.some((o) => o.action === 'plan_goal') };
  renderReview();
  if (onbReview.loading) {
    // con un'AI attiva le sessioni degli obiettivi le propone l'AI: l'anteprima mostra quelle vere
    await aiPlans(r.ops);
    if (!onbReview) return;
    r = contextReview(onbAns, today(), state, Date.now(), r.ops);
    onbReview = { ...r, loading: false };
    renderReview();
  }
}
const reviewDay = (k) => (k === today() ? 'Oggi' : k === addDays(today(), 1) ? 'Domani' : cap(dateOf(k).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' })));
function renderReview() {
  const r = onbReview;
  $('#onb-dots').innerHTML = ONB.map(() => '<i></i>').join('') + '<i class="on"></i>';
  $('#onb-skip').textContent = 'Indietro';
  const body = $('#onb-body');
  body.classList.add('review');
  body.innerHTML = `<div class="onb-k">Ecco cosa ho capito</div><h2 class="onb-q">Controlla, poi partiamo.</h2>
    <ul class="onb-list">${r.understood.map((l) => `<li>${saidLine(l)}</li>`).join('') || '<li>Niente di concreto, per ora.</li>'}</ul>
    ${r.missed.length ? `<div class="onb-k2">Non ho capito</div>${r.missed.map((m, i) => `<div class="onb-miss"><p>Non ho capito: «${esc(m.text)}». Riscrivila, oppure lasciala: resta tra le note.</p>
      <div class="onb-redo"><textarea rows="2" id="onb-miss-${i}" aria-label="Riscrivi: ${esc(m.text)}">${esc(m.text)}</textarea><button type="button" class="btn" data-redo="${i}">Riprova</button></div></div>`).join('')}` : ''}
    <div class="onb-k2">I prossimi 7 giorni</div>
    ${r.loading ? '<p class="onb-sub">Preparo le sessioni…</p>' : `<div class="onb-week">${r.week.map((d) => `<div class="ow-day"><b>${esc(reviewDay(d.day))}</b><span>${d.items.length ? d.items.slice(0, 4).map((x) => `${fmtMin(x.start)} ${esc(x.title)}`).join(' · ') + (d.items.length > 4 ? ` · +${d.items.length - 4}` : '') : 'Libero'}</span></div>`).join('')}</div>`}`;
  animateIn(body, 900);
  $('#onb-next').textContent = 'Va bene, costruisci le giornate';
  $('#onb-next').disabled = !!r.loading;
}
function leaveReview() {
  onbReview = null;
  $('#onb-body').classList.remove('review');
  $('#onb-next').disabled = false;
}
async function finishOnboarding() {
  const ops = onbReview?.ops || [];
  leaveReview();
  closeOnboarding();
  if (!ops.length) return;
  const goalsBefore = new Set(state.goals.map((g) => g.id));
  let res;
  const undoId = commit('Il tuo contesto', () => { res = applyOps(state, ops); });
  renderDayView(true);
  goalFits();
  const lines = state.goals.filter((g) => !goalsBefore.has(g.id)).map((g) => planSummary(state, g, Date.now(), fitCache?.long)).filter(Boolean);
  addMsg({ role: 'assistant', text: lines.join(' ') || 'Fatto: ho il tuo contesto. Dimmi cosa vuoi ottenere e preparo le sessioni.', changes: res.log.filter((l) => /^[◎⟳]/.test(l)), applied: true, undoId });
}

/**
 * Con un'AI attiva, il piano di ogni nuovo obiettivo lo propone l'AI (JSON validato, tetto alle sessioni).
 * Se l'AI non risponde in tempo o sbaglia formato, resta il modello per categoria.
 */
async function aiPlans(ops) {
  const mode = aiMode();
  if (mode === 'base') return;
  for (const o of ops) {
    if (o.action !== 'plan_goal' || o.sessions) continue;
    const g0 = ops.find((x) => x.action === 'set_goal' && x.title === o.title);
    if (!g0) continue;
    const goal = { title: g0.title, note: g0.note, due: g0.deadline || null, projectId: (state.projects || []).find((p) => p.name.toLowerCase() === String(g0.project || '').toLowerCase())?.id };
    try {
      const raw = await withTimeout((signal) => (mode === 'claude' ? claudeGoalPlan(state, goal, Date.now(), signal) : openGoalPlan(state, goal, Date.now(), signal)), 25000);
      const v = validatePlan(raw);
      if (v) o.sessions = v;
    } catch (e) { console.warn('piano AI non disponibile, uso il modello', e); }
  }
}

// ---------------------------------------------------------------- impostazioni
let settingsOpen = false;
function openSettings() {
  settingsOpen = true;
  setComposing(false);
  closePlus();
  const p = $('#panel');
  p.hidden = false;
  p.classList.remove('closing');
  renderSettings();
  animateIn($('#settings'));
  ensureFreeModels();
}
function closeSettings() {
  settingsOpen = false;
  const p = $('#panel');
  p.classList.add('closing');
  setTimeout(() => { if (!settingsOpen) { p.hidden = true; p.classList.remove('closing'); } }, 300);
}
// ---------------------------------------------------------------- impostazioni / memoria
function renderSettings() {
  const P = state.prefs, S = state.settings;
  const ctxv = vm.context({ state, now: Date.now(), fits: goalFits() });
  const st = computeStats(state);
  const prov = S.provider || (S.apiKey ? 'claude' : 'base');
  const preset = presetOf(S);
  const listed = S.freeModelsPreset === preset || (!S.freeModelsPreset && preset === 'openrouter') ? (S.freeModels || []) : [];
  const wd = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  $('#settings').innerHTML = `
    <p class="ctx-intro">Quello che so di te. Da qui costruisco ogni giornata: cambialo quando vuoi, oppure dimmelo nella barra.</p>

    <div class="group"><h2>Obiettivi</h2>
      ${ctxv.goals.map((g) => `<div class="goal" style="--pc:${safeColor(g.project?.color) || 'var(--accent)'}">
        <div class="goal-t">${esc(g.title)}</div>
        <div class="goal-m">${g.project ? `<span><i class="proj"></i>${esc(g.project.name)}</span>` : ''}<span>${g.dueText}${g.dueDate ? ' · ' + esc(g.dueDate) : ''}</span>${g.sessions.total ? `<span>${g.sessions.done} di ${plural(g.sessions.total, 'sessione', 'sessioni')}</span>` : ''}${g.late ? `<span>${plural(g.late, 'sessione non entra', 'sessioni non entrano')}</span>` : ''}</div>
        <button class="x" data-delgoal="${esc(g.id)}" aria-label="Rimuovi l'obiettivo ${esc(g.title)}">×</button></div>`).join('')}
      ${ctxv.habits.map((h) => `<div class="card"><div class="row"><span class="lbl">${esc(h.text)}</span><button class="x" data-delhabit="${esc(h.id)}" aria-label="Rimuovi l'abitudine ${esc(h.title)}">×</button></div></div>`).join('')}
      <div class="card"><div class="row"><input type="text" class="wide" id="goal-new" placeholder="Es. far uscire l'EP tra 6 settimane" enterkeyhint="done"><button class="btn" id="goal-add">Aggiungi</button></div></div>
    </div>

    <div class="group"><h2>Progetti</h2>
      <div class="chips">${(state.projects || []).map((p) => `<span class="chip" style="--pc:${safeColor(p.color) || 'var(--accent)'}"><i class="proj"></i>${esc(p.name)}<button class="x" data-delproj="${esc(p.id)}" aria-label="Rimuovi">×</button></span>`).join('')}
        <span class="chip add"><input type="text" id="proj-new" placeholder="+ progetto" enterkeyhint="done"></span></div>
    </div>

    <div class="group"><h2>Vincoli</h2>
      <div class="card">
        ${state.recurring.map((r) => `<div class="row"><span class="lbl">${esc(r.title)}<small>${fmtMin(r.start)}–${fmtMin(r.end)} · ${r.weekdays.map((d) => wd[d]).join(' ')}</small></span><button class="x" data-delrec="${esc(r.id)}" aria-label="Elimina">×</button></div>`).join('')}
        <div class="row"><span class="lbl">Giorni in cui stacchi<small>niente lavoro sui progetti</small></span></div>
        <div class="row days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button class="dchip${(P.offDays || []).includes(d) ? ' on' : ''}" data-offday="${d}" aria-pressed="${(P.offDays || []).includes(d)}" aria-label="${['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'][d]}">${wd[d]}</button>`).join('')}</div>
        ${ctxv.constraints.restDays.map((r) => `<div class="row"><span class="lbl">${esc(r.text)}<small>l'ho proposto io: poi torno a guardare come va</small></span><button class="x" data-restday="${r.wd}" aria-label="Togli: torna un giorno per i progetti">×</button></div>`).join('')}
        ${state.memory.filter((m) => m.category === 'vincolo').map((m) => `<div class="row"><div class="mem-item"><span>${esc(m.text)}</span></div><button class="x" data-forget="${esc(m.id)}" aria-label="Dimentica">×</button></div>`).join('')}
        <div class="row"><input type="text" class="wide" id="vin-new" placeholder="Es. lavoro 9–18:30" enterkeyhint="done"><button class="btn" id="vin-add">Aggiungi</button></div>
      </div>
    </div>

    <div class="group"><h2>Preferenze</h2>
      <div class="card">
        <div class="row"><label for="p-fw">Rendi di più<small>per il lavoro creativo e pesante</small></label><select id="p-fw" data-pref="focusWindow"><option value="">Indifferente</option>${Object.keys(WINDOWS).map((w) => `<option ${P.focusWindow === w ? 'selected' : ''} value="${w}">${windowLabel(w)}</option>`).join('')}</select></div>
        <div class="row"><label for="p-mb">Sessione più lunga<small>poi ti fermo</small></label><select id="p-mb" data-pref="maxBlock">${[45, 60, 90, 120, 150, 180, 240].map((m) => `<option value="${m}" ${P.maxBlock === m ? 'selected' : ''}>${durLabel(m)}</option>`).join('')}</select></div>
        <div class="row"><label for="p-buf">Pausa tra sessioni<small>minuti</small></label><input type="number" id="p-buf" data-pref="buffer" min="0" max="60" step="5" value="${P.buffer}" inputmode="numeric"></div>
        <div class="row"><label for="p-dc">Decompressione<small>dopo una lunga giornata di lavoro</small></label><input type="number" id="p-dc" data-pref="decompress" min="0" max="120" step="5" value="${P.decompress ?? 45}" inputmode="numeric"></div>
        <div class="row"><label for="p-ds">Inizio giornata</label><input type="time" id="p-ds" data-pref="dayStart" value="${fmtMin(P.dayStart)}"></div>
        <div class="row"><label for="p-de">Fine giornata</label><input type="time" id="p-de" data-pref="dayEnd" value="${fmtMin(Math.min(P.dayEnd, 1439))}"></div>
        <div class="row"><label for="p-sl">Margine per imprevisti<small>% di tempo da lasciare libero</small></label><input type="number" id="p-sl" data-pref="slack" min="0" max="50" step="5" value="${Math.round(P.slack * 100)}" inputmode="numeric"></div>
        ${state.memory.filter((m) => m.category !== 'vincolo').map((m) => `<div class="row"><div class="mem-item"><span>${esc(m.text)}</span></div><button class="x" data-forget="${esc(m.id)}" aria-label="Dimentica">×</button></div>`).join('')}
        <div class="row"><input type="text" class="wide" id="mem-new" placeholder="Es. la sera produco meglio" enterkeyhint="done"><button class="btn" id="mem-add">Aggiungi</button></div>
      </div>
      <p class="note">Niente scatole nere: tutto quello che uso per decidere è qui.</p>
      <button class="btn ghost" id="redo-onb">Raccontami di nuovo di te</button>
    </div>

    <div class="group"><h2>Assistente AI</h2>
      <div class="card">
        <div class="row"><label for="provider">Motore</label><select id="provider">
          ${[['base', 'Base, senza AI'], ['local', 'Sul telefono · gratis'], ['online', 'Online · gratis'], ['claude', 'Claude · a pagamento']].map(([v, l]) => `<option value="${v}" ${prov === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
        ${prov === 'claude' ? `
        <div class="row"><input type="password" id="api-key" placeholder="Chiave API Anthropic (sk-ant-…)" value="${esc(S.apiKey)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        <div class="row"><label for="model">Modello</label><select id="model">${MODELS.map((m) => `<option value="${m.id}" ${S.model === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div>` : ''}
        ${prov === 'local' ? `
        <div class="row"><label for="local-model">Modello</label><select id="local-model">${LOCAL_MODELS.map((m) => `<option value="${m.id}" ${(S.localModel || LOCAL_MODELS[0].id) === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div>
        <div class="row"><span class="lbl" id="local-status">${!webgpuAvailable() ? '✗ Questo Safari non supporta WebGPU: serve iOS 26 o successivo' : localModelLoaded(S.localModel || LOCAL_MODELS[0].id) ? '✓ Modello pronto' : 'Il modello si scarica la prima volta che lo usi'}</span><button class="btn" id="local-preload" ${webgpuAvailable() ? '' : 'disabled'}>Prepara ora</button></div>` : ''}
        ${prov === 'online' ? `
        <div class="row"><label for="open-preset">Servizio</label><select id="open-preset">${Object.entries(ONLINE_PRESETS).map(([k, p]) => `<option value="${k}" ${preset === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
        <div class="row"><input type="password" id="open-key" placeholder="${preset === 'gemini' ? 'Chiave Gemini (AIza…)' : preset === 'openrouter' ? 'Chiave OpenRouter (sk-or-v1-…)' : 'Chiave del servizio'}" value="${esc(S.openKey || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        ${preset !== 'custom' ? `
        <div class="row"><label for="open-model-sel">Modello<small>${S.lastWorkingModel && S.lastWorkingPreset === preset ? 'funziona: ' + esc(S.lastWorkingModel) : listed.length ? listed.length + ' modelli disponibili' : S.openKey || preset === 'openrouter' ? 'carico l\'elenco…' : 'inserisci la chiave'}</small></label><select id="open-model-sel">
          <option value="" ${!S.openModel ? 'selected' : ''}>Automatico (consigliato)</option>
          ${listed.map((m) => `<option value="${esc(m.id)}" ${S.openModel === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
          ${S.openModel && !listed.some((m) => m.id === S.openModel) ? `<option value="${esc(S.openModel)}" selected>${esc(S.openModel)}</option>` : ''}
        </select></div>` : `
        <div class="row"><input type="text" class="wide" id="open-model" placeholder="Nome del modello" value="${esc(S.openModel || '')}" autocapitalize="off" spellcheck="false"></div>
        <div class="row"><input type="text" class="wide" id="open-url" placeholder="Indirizzo API (https://…/v1)" value="${esc(S.openBaseUrl || '')}" autocapitalize="off" spellcheck="false" inputmode="url"></div>`}
        <div class="row"><span class="lbl" id="open-status">${S.lastWorkingModel && S.lastWorkingPreset === preset ? '✓ Ultima prova riuscita' : 'Controlla che chiave e modello funzionino'}</span><button class="btn" id="open-test">Prova</button></div>` : ''}
      </div>
      <p class="note">${{
        base: 'Senza AI la chat capisce solo frasi semplici. Pianificazione, carte e annullamento funzionano comunque.',
        local: 'Il modello gira interamente sul tuo iPhone: gratis, privato e anche offline. Il primo avvio scarica il modello (circa 1 GB, meglio con il Wi-Fi). È meno intelligente di un modello grande: per le frasi più complesse può sbagliare, ma ogni modifica si può annullare.',
        online: ({
          gemini: 'Gratis, senza carta di credito. Per la chiave: apri <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>, accedi con il tuo account Google, tocca <b>Create API key</b> (o «Crea chiave API»), copiala e incollala qui sopra, poi tocca <b>Prova</b>. Con «Automatico» l\'app sceglie il modello Gemini migliore e, se uno non risponde, passa al successivo. Nel piano gratuito Google può usare i messaggi per migliorare i suoi modelli.',
          openrouter: 'Crea una chiave su <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener">openrouter.ai</a> senza limite di credito. I modelli gratuiti di OpenRouter cambiano spesso e hanno limiti giornalieri bassi: con «Automatico» l\'app passa da sola al successivo se uno non risponde.',
          groq: 'Crea una chiave gratuita su <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com</a>, incollala qui sopra e tocca <b>Prova</b>.',
          custom: 'Qualsiasi servizio compatibile con l\'API OpenAI: indica indirizzo, modello e chiave.',
        })[preset],
        claude: 'La chiave resta solo su questo iPhone e viene inviata soltanto ad api.anthropic.com. La crei su <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com</a>. L\'uso dell\'API si paga a parte, non è incluso negli abbonamenti Claude.',
      }[prov]}</p>
    </div>

    <div class="group"><h2>Cosa ho imparato</h2>
      <div class="card">
        ${(() => { const rows = learnedList(state, Date.now()); return rows.length ? rows.map((r) => `<div class="row"><span class="lbl">${esc(r.text)}</span>${r.toggle ? `<button class="btn" data-learn-toggle="${esc(r.key)}" aria-pressed="${r.active}">${r.disabled ? 'Usa' : 'Non usare'}</button>` : ''}${r.info ? '' : `<button class="x" data-learn-forget="${esc(r.key)}" aria-label="Dimentica">×</button>`}</div>`).join('')
          : '<div class="row"><span class="lbl" style="color:var(--ink-3)">Ancora niente. Quando segni le attività come fatte imparo quanto durano davvero e quando le fai.</span></div>'; })()}
      </div>
      <p class="note">Le stime cambiano solo con almeno 3 sessioni misurate. Gli orari non li sposto mai senza chiedertelo.</p>
    </div>

    <div class="group"><h2>Come stai andando</h2>
      <div class="card stat-grid">
        <div class="stat"><b>${st.pct}%</b><span>attività completate (${st.done}/${st.total})</span></div>
        <div class="stat"><b>${st.ratio ? (st.ratio > 1 ? '+' : '') + Math.round((st.ratio - 1) * 100) + '%' : '—'}</b><span>durata reale vs stimata${st.samples ? ` (${st.samples})` : ''}</span></div>
        <div class="stat"><b>${st.replansPerDay}</b><span>ripianificazioni automatiche al giorno</span></div>
        <div class="stat"><b>${state.memory.length}</b><span>preferenze ricordate</span></div>
      </div>
    </div>

    <div class="group"><h2>Dati</h2>
      <div class="card">
        <div class="row"><span class="lbl">Esporta un backup</span><button class="btn" id="export">Esporta</button></div>
        <div class="row"><span class="lbl">Ripristina da backup</span><label class="btn" for="import-file">Importa</label><input type="file" id="import-file" accept="application/json,.json" hidden></div>
        <div class="row"><span class="lbl">Dimentica le richieste passate<small>l'AI non ne terrà più conto</small></span><button class="btn" id="clear-chat">Dimentica</button></div>
        <div class="row"><span class="lbl">Cancella tutto</span><button class="btn danger" id="reset">Cancella</button></div>
      </div>
      <p class="note">I dati sono salvati sul dispositivo, nell'app installata. Esporta un backup ogni tanto.</p>
    </div>`;
}

let fetchingModels = false;
function ensureFreeModels(force) {
  const S = state.settings;
  const prov = S.provider || (S.apiKey ? 'claude' : 'base');
  const preset = presetOf(S);
  if (prov !== 'online' || preset === 'custom' || fetchingModels) return;
  if (preset !== 'openrouter' && !S.openKey) return;
  if (!force && S.freeModelsPreset === preset && S.freeModels?.length && Date.now() - (S.freeModelsAt || 0) < 6 * 36e5) return;
  fetchingModels = true;
  listModels(preset, S.openBaseUrl, S.openKey)
    .then((list) => { S.freeModels = list.slice(0, 40); S.freeModelsAt = Date.now(); S.freeModelsPreset = preset; save(state); if (settingsOpen) renderSettings(); })
    .catch(() => {})
    .finally(() => { fetchingModels = false; });
}

function onSettingsChange(e) {
  const t = e.target;
  if (t.dataset.pref) {
    const k = t.dataset.pref;
    let v = t.value;
    if (k === 'dayStart' || k === 'dayEnd') { v = parseHM(v); if (v == null) return; if (k === 'dayEnd' && v === 1439) v = 1440; }
    else if (k === 'buffer') v = Math.max(0, Math.min(60, +v || 0));
    else if (k === 'slack') v = Math.max(0, Math.min(50, +v || 0)) / 100;
    else if (k === 'focusWindow') v = v || null;
    else if (k === 'maxBlock') v = +v || 120;
    else if (k === 'decompress') v = Math.max(0, Math.min(120, +v || 0));
    commit('Preferenze', () => { state.prefs[k] = v; });
  } else if (t.id === 'api-key') {
    state.settings.apiKey = t.value.trim();
    save(state); renderComposer(); renderChat();
    toast(state.settings.apiKey ? 'Chiave salvata' : 'Chiave rimossa');
  } else if (t.id === 'model') {
    state.settings.model = t.value; save(state);
  } else if (t.id === 'provider') {
    const S = state.settings;
    S.provider = t.value;
    if (t.value === 'online' && !S.openBaseUrl) {
      const k = S.openPreset || DEFAULT_PRESET;
      Object.assign(S, { openPreset: k, openBaseUrl: ONLINE_PRESETS[k].baseUrl, openModel: '' });
    }
    save(state); renderSettings(); renderComposer(); ensureFreeModels();
  } else if (t.id === 'open-preset') {
    const pr = ONLINE_PRESETS[t.value];
    // cambiando servizio la chiave precedente non vale più
    Object.assign(state.settings, { openPreset: t.value, openBaseUrl: pr.baseUrl, openModel: '', openKey: '', lastWorkingModel: null, freeModels: [], freeModelsPreset: null, badModels: {} });
    save(state); renderSettings(); renderComposer(); ensureFreeModels();
  } else if (t.id === 'open-key' || t.id === 'open-model' || t.id === 'open-url') {
    const k = { 'open-key': 'openKey', 'open-model': 'openModel', 'open-url': 'openBaseUrl' }[t.id];
    // le chiavi copiate a volte si portano dietro spazi o a capo
    state.settings[k] = t.id === 'open-key' ? t.value.replace(/\s+/g, '') : t.value.trim();
    if (t.id === 'open-key') Object.assign(state.settings, { lastWorkingModel: null, badModels: {} });
    save(state); renderComposer();
    toast('Salvato');
    if (t.id === 'open-key') ensureFreeModels(true);
  } else if (t.id === 'open-model-sel') {
    state.settings.openModel = t.value; state.settings.lastWorkingModel = null; save(state); renderSettings();
  } else if (t.id === 'local-model') {
    state.settings.localModel = t.value; save(state); renderSettings();
  } else if (t.id === 'import-file' && t.files[0]) {
    t.files[0].text().then((txt) => {
      const d = JSON.parse(txt);
      if (!Array.isArray(d.items)) throw new Error('file non valido');
      const { archive, ...rest } = d;
      const m = migrate({ ...rest, settings: state.settings }, Date.now());
      commit('Ripristino backup', () => Object.assign(state, { ...m, settings: state.settings, anchors: {} }));
      // le voci archiviate del backup tornano nell'archivio (ripulite come tutto il resto)
      const arch = Array.isArray(archive) ? sanitizeState({ items: archive }).items : [];
      if (arch.length && typeof indexedDB !== 'undefined') archivePut(arch).then(() => { const ids = new Set(arch.map((x) => x.id)); archived = [...archived.filter((x) => !ids.has(x.id)), ...arch]; }).catch(() => {});
      toast('Backup ripristinato');
    }).catch((err) => toast('Backup non valido: ' + err.message));
  }
}

function addMemory() {
  const v = $('#mem-new').value.trim();
  if (!v) return;
  commit('Preferenza', () => applyOps(state, contextOps({ prefs: v }, today())));
  toast('Me lo ricordo');
}
/** Aggiunte rapide dal pannello del contesto (stessa logica della presentazione). */
function addContext(kind) {
  const inp = $({ goal: '#goal-new', vin: '#vin-new', proj: '#proj-new' }[kind]);
  const v = inp?.value.trim();
  if (!v) return;
  const ans = kind === 'goal' ? { goals: v } : kind === 'vin' ? { constraints: v } : { projects: v };
  if (kind === 'goal') for (const p of state.projects || []) if (v.toLowerCase().includes(p.name.toLowerCase())) ans.projects = p.name;
  commit('Contesto', () => applyOps(state, contextOps(ans, today())));
  toast('Aggiunto');
}

// ---------------------------------------------------------------- utilità UI
let toastTimer;
function toast(text, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.fn(); };
  clearTimeout(toastTimer);
  el.classList.remove('out');
  toastTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 220); }, action ? 5000 : 2200);
}
const toastUndo = (text) => toast(text, { label: 'Annulla', fn: () => doUndo() });

function renderAll() {
  if (state.focus && !state.items.some((x) => x.id === state.focus.itemId && x.status !== 'done')) { state.focus = null; focusOpen = false; heroKey = ''; }
  if (mode === 'day') renderDayView(false); else renderCalendar(false);
  $('#undo-btn').hidden = !canUndo();
  renderComposer();
  if (composing) renderMiniSummary();
  renderReply();
  if (settingsOpen) renderSettings();
}

// ---------------------------------------------------------------- eventi
function bind() {
  $('#to-overview').addEventListener('click', openOverview);
  $('#sum-fab').addEventListener('click', openSummary);
  $('#ov-today').addEventListener('click', () => openDay(today(), document.querySelector(`.cd[data-day="${today()}"]`)));
  $('#sum-close').addEventListener('click', closeSummary);
  $('#sum-scroll').addEventListener('click', (e) => {
    const d = e.target.closest('[data-day]');
    if (d) { closeSummary(); openDay(d.dataset.day); return; }
    if (e.target.closest('#sm-more')) { closeSummary(); openOverview(); }
  });
  const askIn = $('#ask-input');
  const askGrow = () => { askIn.style.height = 'auto'; askIn.style.height = Math.min(askIn.scrollHeight, 120) + 'px'; };
  askIn.addEventListener('input', askGrow);
  askIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#ask').requestSubmit(); } });
  $('#ask').addEventListener('submit', (e) => { e.preventDefault(); const v = askIn.value; askIn.value = ''; askGrow(); ask(v); });
  $('#cal-scroll').addEventListener('click', (e) => { const c = e.target.closest('.cd'); if (c) openDay(c.dataset.day, c); });
  $('#months').addEventListener('click', (e) => {
    const b = e.target.closest('[data-month]');
    const sec = b && document.querySelector(`.month[data-mi="${b.dataset.month}"]`);
    if (sec) $('#cal-scroll').scrollTo({ top: monthTop(sec), behavior: 'smooth' });
  });
  // il mese in alto segue lo scorrimento
  $('#cal-scroll').addEventListener('scroll', () => {
    const top = $('#cal-scroll').scrollTop + 40;
    let cur = 0;
    document.querySelectorAll('.month').forEach((m) => { if (monthTop(m) <= top) cur = +m.dataset.mi; });
    document.querySelectorAll('#months [data-month]').forEach((b) => {
      const on = +b.dataset.month === cur;
      if (on && !b.classList.contains('on')) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      b.classList.toggle('on', on);
    });
  }, { passive: true });
  $('#open-settings').addEventListener('click', openSettings);
  $('#save-alert-export').addEventListener('click', exportData);
  $('#close-settings').addEventListener('click', closeSettings);
  $('#undo-btn').addEventListener('click', () => doUndo());

  // collegamenti (riepilogo → panoramica, "scegli un assistente" → impostazioni)
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (!g) return;
    e.preventDefault();
    if (g.dataset.goto === 'settings') openSettings();
    if (g.dataset.goto === 'overview') openOverview();
  });

  // carte del giorno
  const col = $('#collage');
  col.addEventListener('click', (e) => {
    const chk = e.target.closest('[data-check]');
    if (chk) {
      e.stopPropagation();
      const it = state.items.find((x) => x.id === chk.dataset.check);
      if (it) quickOp(it.status === 'done' ? 'reopen' : 'complete', it.id);
      return;
    }
    const ds = e.target.closest('[data-ds]');
    if (ds) { e.stopPropagation(); doneOpen = ds.dataset.ds === 'open'; renderDayView(false); return; }
    const nw = e.target.closest('[data-now]');
    if (nw) { e.stopPropagation(); quickOp(nw.dataset.now, nw.dataset.id); return; }
    const a2 = e.target.closest('[data-act2]');
    if (a2) {
      e.stopPropagation();
      const id = a2.dataset.id;
      if (a2.dataset.act2 === 'done') quickOp('complete', id);
      if (a2.dataset.act2 === 'part') quickOp('progress', id, { actual_min: Math.max(10, Math.round(+a2.dataset.min / 2 / 5) * 5) });
      if (a2.dataset.act2 === 'notyet') { delete state.anchors[id]; quickOp('skip', id, { start_time: a2.dataset.start }, { auto: true }); }
      if (a2.dataset.act2 === 'move') quickOp('move', id, { date: addDays(selDay, 1) });
      return;
    }
    const ad = e.target.closest('[data-adv]');
    if (ad) { e.stopPropagation(); if (ad.dataset.adv === 'start') startFocusFor(ad.dataset.id); else quickOp(ad.dataset.adv, ad.dataset.id); return; }
    const br = e.target.closest('[data-brief]');
    if (br) { e.stopPropagation(); briefAction(br.dataset.brief, br.dataset.arg); return; }
    if (e.target.closest('[data-rest]')) { openRestSheet(); return; }
    const c = e.target.closest('[data-item]');
    if (c && !/^rest:/.test(c.dataset.item)) { sheetFrom = c.getBoundingClientRect(); openSheet(c.dataset.item); }
  });
  col.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.rest) { e.preventDefault(); openRestSheet(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.item && !/^rest:/.test(e.target.dataset.item)) { e.preventDefault(); openSheet(e.target.dataset.item); }
  });

  // Esc chiude quello che è aperto, dal più in alto
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#onb').hidden) { $('#onb-skip').click(); return; }
    if (summaryOpen) { closeSummary(); return; }
    if (!$('#sheet').hidden) { closeSheet(); return; }
    if (settingsOpen) { closeSettings(); return; }
    if (!$('#plus-menu').hidden) { closePlus(); return; }
    if (mode === 'overview') { openDay(selDay); return; }
    if (composing) { $('#input').blur(); setComposing(false); return; }
    if (!$('#reply').hidden && !pending) hideReply();
  });

  // il saluto sfuma mentre le carte ci scorrono sopra
  const ds = $('#day-scroll');
  let raf = 0;
  ds.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => $('#hero').style.setProperty('--p', Math.min(1, ds.scrollTop / 220).toFixed(3)));
  }, { passive: true });

  // barra in basso
  const input = $('#input');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(132, input.scrollHeight) + 'px'; };
  input.addEventListener('input', () => { grow(); renderComposer(); });
  input.addEventListener('focus', () => setComposing(true));
  input.addEventListener('blur', () => setTimeout(() => {
    if (Date.now() - plusAt < 500) return; // toccando il + a barra aperta si apre il menu, non si chiude la barra
    if (document.activeElement !== input && !input.value.trim() && !rec) setComposing(false);
  }, 120));
  // toccando la giornata mentre scrivi, si torna alle carte
  $('#day-scroll').addEventListener('pointerdown', () => { if (composing) { input.blur(); if (!input.value.trim()) setComposing(false); } });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
  });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    if (!v.trim()) return;
    input.value = ''; grow();
    if (rec) rec.stop();
    send(v);
    renderComposer();
  });
  $('#mic').addEventListener('click', () => { setComposing(true); toggleMic(); });
  $('#plus').addEventListener('pointerdown', () => { if ($('#app').classList.contains('bar-open')) plusAt = Date.now(); });
  $('#plus').addEventListener('click', () => { if (!$('#app').classList.contains('bar-open')) openBar(); else togglePlus(); });
  $('#plus-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-plus]');
    if (!b) return;
    closePlus();
    if (b.dataset.plus === 'task') openSheet(null);
    else pickPhoto('new');
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#plus-menu, #plus')) closePlus(); });
  $('#photo-input').addEventListener('change', (e) => onPhotoPicked(e.target.files[0]));

  // nota con l'esito
  $('#reply').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'apply') applyPending();
    if (b.dataset.act === 'discard') discardPending();
    if (b.dataset.act === 'undo') doUndo(b.dataset.id);
    if (b.dataset.act === 'dismiss') hideReply();
  });

  // scheda
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('#sheet-form').addEventListener('submit', (e) => { e.preventDefault(); if (sheetMode === 'rec') saveRec(); else if (sheetMode === 'item') sheetSave(); });
  $('#sheet-form').addEventListener('change', (e) => {
    if (e.target.id === 'gd-date' && e.target.value) { setGoalDate(e.target.dataset.gid, e.target.value); return; }
    if (!ed) return;
    const id = e.target.id;
    if (id === 'ed-date' && e.target.value) ed.date = e.target.value;
    if (id === 'ed-start') { const m = parseHM(e.target.value); if (m != null) ed.start = m; }
    if (id === 'ed-dl') ed.deadline = e.target.value || null;
    renderEditor();
  });
  $('#sheet-form').addEventListener('change', (e) => {
    if (sheetMode !== 'rec' || !red) return;
    const m = parseHM(e.target.value);
    if (e.target.id === 'rec-start' && m != null) { const len = red.end - red.start; red.start = m; if (red.end <= m) red.end = Math.min(24 * 60 - 1, m + Math.max(30, len)); }
    if (e.target.id === 'rec-end' && m != null) red.end = m;
    renderRec();
  });
  $('#sheet-form').addEventListener('click', (e) => {
    const ph = e.target.closest('[data-photo]');
    if (ph) {
      e.preventDefault();
      if (ph.dataset.photo === 'remove') { e.stopPropagation(); sheetPhoto = { remove: true }; renderEditor(); }
      else pickPhoto('sheet');
      return;
    }
    // impegno ricorrente: colore e giorni
    const rc = e.target.closest('[data-rc]');
    if (rc && red) { red.color = rc.dataset.rc || null; renderRec(); return; }
    const rd = e.target.closest('[data-rd]');
    if (rd && red) { const d = +rd.dataset.rd; red.weekdays = red.weekdays.includes(d) ? red.weekdays.filter((x) => x !== d) : [...red.weekdays, d]; renderRec(); return; }
    // nuova scadenza di un obiettivo
    const gd = e.target.closest('[data-gdate]');
    if (gd) { setGoalDate(gd.dataset.gid, gd.dataset.gdate); return; }
    // pausa dopo il lavoro
    const dec = e.target.closest('[data-dec]');
    if (dec) {
      const v = +dec.dataset.dec;
      commit('Pausa dopo il lavoro', () => { applyOps(state, [{ action: 'set_pref', pref_key: 'decompress_min', pref_value: String(v) }]); });
      closeSheet();
      toastUndo(v ? `Pausa di ${durLabel(v)} dopo il lavoro` : 'Niente pausa dopo il lavoro');
      return;
    }
    // editor: una scelta = un tocco
    const ch = e.target.closest('[data-ed]');
    if (ch && ed) {
      const g = ch.dataset.ed, raw = ch.dataset.v;
      const val = raw === '' ? null : ['duration', 'priority', 'energy'].includes(g) ? +raw : raw;
      ed[g] = g === 'priority' || g === 'energy' ? val || 2 : val;
      if (g === 'kind' && val === 'event') { if (ed.start == null) ed.start = Math.min(23 * 60, Math.ceil(nowMin() / 30) * 30 + 30); if (!ed.date) ed.date = selDay; }
      if (g === 'date' && val == null && ed.kind === 'event') ed.date = selDay;
      if (g === 'duration') ed.estimated = false;
      renderEditor();
      return;
    }
    const st = e.target.closest('[data-step]');
    if (st && ed) { ed.duration = Math.max(5, Math.min(600, ed.duration + +st.dataset.step)); ed.estimated = false; renderEditor(); return; }
    const b = e.target.closest('[data-sheet]');
    if (!b) return;
    const id = $('#sheet-form').dataset.id;
    const a = b.dataset.sheet;
    if (a === 'close') closeSheet();
    else if (a === 'done') quickOp('complete', id);
    else if (a === 'start') { closeSheet(); startFocusFor(id); }
    else if (a === 'reopen') quickOp('reopen', id);
    else if (a === 'tomorrow') quickOp('move', id, { date: addDays(today(), 1) });
    else if (a === 'delete') {
      if (!confirm('Eliminare questa attività?')) return;
      const img = state.items.find((x) => x.id === id)?.image;
      quickOp('delete', id);
      if (img) deleteImage(img).catch(() => {});
    } else if (a === 'skip') {
      commit('Salta ricorrenza', () => { const r = state.recurring.find((x) => x.id === b.dataset.rec); r.skip = [...(r.skip || []), b.dataset.day]; });
      closeSheet(); toastUndo('Saltato');
    } else if (a === 'delrec') {
      if (!confirm('Eliminare l\'impegno ricorrente?')) return;
      commit('Elimina ricorrenza', () => { state.recurring = state.recurring.filter((x) => x.id !== b.dataset.rec); });
      closeSheet(); toastUndo('Ricorrenza eliminata');
    }
  });

  // impostazioni
  const st = $('#settings');
  st.addEventListener('change', onSettingsChange);
  st.addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.forget) commit('Memoria', () => { state.memory = state.memory.filter((m) => m.id !== t.dataset.forget); });
    if (t.dataset.delrec && confirm('Eliminare l\'impegno ricorrente?')) commit('Elimina ricorrenza', () => { state.recurring = state.recurring.filter((x) => x.id !== t.dataset.delrec); });
    if (t.id === 'mem-add') addMemory();
    const tt = t.closest('button');
    if (tt?.dataset.learnToggle) commit('Cosa ho imparato', () => { const d = state.learned.durations[tt.dataset.learnToggle]; if (d) d.disabled = !d.disabled; updateDurations(state); });
    if (tt?.dataset.learnForget) commit('Dimentica', () => forgetLearned(state, tt.dataset.learnForget, Date.now()));
    if (tt?.dataset.delhabit) commit('Abitudine rimossa', () => applyOps(state, [{ action: 'remove_habit', id: tt.dataset.delhabit }]));
    if (tt?.dataset.delgoal) {
      const gid = tt.dataset.delgoal;
      const open = state.items.filter((x) => x.goalId === gid && x.status === 'todo' && !(x.spent > 0));
      const drop = open.length && confirm(`Togliere anche ${plural(open.length, 'sessione non ancora iniziata', 'sessioni non ancora iniziate')}?`);
      commit('Obiettivo rimosso', () => {
        state.goals = state.goals.filter((g) => g.id !== gid);
        if (drop) state.items = state.items.filter((x) => !open.includes(x));
        state.items.forEach((x) => { if (x.goalId === gid) x.goalId = null; });
        state.habits = (state.habits || []).filter((h) => h.goalId !== gid);
      });
      toastUndo('Obiettivo rimosso');
    }
    if (tt?.dataset.delproj) commit('Progetto rimosso', () => {
      state.projects = state.projects.filter((p) => p.id !== tt.dataset.delproj);
      state.items.forEach((x) => { if (x.project === tt.dataset.delproj) x.project = null; });
      state.goals.forEach((g) => { if (g.projectId === tt.dataset.delproj) g.projectId = null; });
    });
    if (tt?.dataset.restday) {
      commit('Giorno di nuovo per i progetti', () => dropRestDay(state, +tt.dataset.restday));
      toastUndo('Quel giorno torna ai progetti');
    }
    if (tt?.dataset.offday) {
      const d = +tt.dataset.offday;
      const o = new Set(state.prefs.offDays || []);
      o.has(d) ? o.delete(d) : o.add(d);
      commit('Giorni di riposo', () => applyOps(state, [{ action: 'set_pref', pref_key: 'off_days', pref_value: [...o].join(',') }]));
    }
    if (t.id === 'goal-add') addContext('goal');
    if (t.id === 'vin-add') addContext('vin');
    if (t.id === 'redo-onb') { closeSettings(); openOnboarding(); }
    if (t.id === 'open-test') {
      const status = $('#open-status');
      t.disabled = true;
      if (status) status.textContent = 'Provo…';
      testOnline(state.settings)
        .then(({ model }) => { save(state); renderSettings(); toast('Funziona: ' + model); })
        .catch((err) => { save(state); renderSettings(); const st2 = $('#open-status'); if (st2) st2.textContent = '✗ ' + errorText(err); });
    }
    if (t.id === 'local-preload') {
      t.disabled = true;
      const status = $('#local-status');
      preloadLocal(state.settings.localModel || LOCAL_MODELS[0].id, (f) => { if (status) status.textContent = `Scarico il modello… ${Math.round(f * 100)}%`; })
        .then(() => { if (status) status.textContent = '✓ Modello pronto'; toast('Modello pronto'); })
        .catch((err) => { if (status) status.textContent = errorText(err); t.disabled = false; });
    }
    if (t.id === 'export') exportData();
    if (t.id === 'clear-chat' && confirm('Dimenticare le richieste passate? Attività e memoria restano.')) { state.chat = []; pending = null; replyId = null; save(state); renderReply(); toast('Fatto'); }
    if (t.id === 'reset' && confirm('Cancellare tutte le attività, la memoria e la chat? (La chiave API resta.)')) {
      commit('Cancella tutto', () => Object.assign(state, { items: [], recurring: [], memory: [], anchors: {}, chat: [] }));
      toastUndo('Tutto cancellato');
    }
  });
  st.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const id = e.target.id;
    if (id === 'mem-new') { e.preventDefault(); addMemory(); }
    if (id === 'goal-new') { e.preventDefault(); addContext('goal'); }
    if (id === 'vin-new') { e.preventDefault(); addContext('vin'); }
    if (id === 'proj-new') { e.preventDefault(); addContext('proj'); }
  });

  // presentazione
  $('#onb-next').addEventListener('click', () => {
    if (onbReview) { if (!onbReview.loading) finishOnboarding(); return; }
    onbSave();
    if (onbStep < ONB.length - 1) { onbStep++; renderOnb(); setTimeout(() => $('#onb-in')?.focus({ preventScroll: true }), 350); }
    else reviewOnboarding();
  });
  $('#onb-skip').addEventListener('click', () => {
    if (onbReview) { leaveReview(); onbStep = ONB.length - 1; renderOnb(); return; }
    if (onbStep === 0) closeOnboarding(); else reviewOnboarding();
  });
  $('#onb-body').addEventListener('click', (e) => {
    // una frase non capita, riscritta: si rifà il riepilogo
    const redo = e.target.closest('[data-redo]');
    if (redo && onbReview) {
      const m = onbReview.missed[+redo.dataset.redo];
      const v = $('#onb-miss-' + redo.dataset.redo).value.trim();
      if (m && v && v !== m.text) { onbAns[m.key] = String(onbAns[m.key] || '').replace(m.text, v); reviewOnboarding(); }
      return;
    }
    const b = e.target.closest('[data-ex]');
    if (!b) return;
    const inp = $('#onb-in');
    const sep = ONB[onbStep].k === 'projects' ? ', ' : '. ';
    inp.value = inp.value.trim() ? inp.value.trim().replace(/[.,]$/, '') + sep + b.dataset.ex : b.dataset.ex;
    b.remove();
  });

  $('#sum-fab').inert = true;
  bindFocus();
  bindPinch();
  bindSwipes();
  bindCards($('#collage'), { canStart: () => mode === 'day' && !composing, scroller: $('#day-scroll') });
  for (const sc of ['#day-scroll', '#cal-scroll', '#sum-scroll']) $(sc).addEventListener('scroll', glowSoon, { passive: true });
  addEventListener('resize', glowSoon);

  // tastiera iOS: adatta l'altezza all'area visibile
  const vv = window.visualViewport;
  // solo con la tastiera aperta: altrimenti l'app occupa tutto lo schermo (niente fascia vuota in basso
  // se iOS lascia un'altezza vecchia dopo aver chiuso la tastiera)
  const fit = () => {
    if (!vv) return;
    const root = document.documentElement.style;
    const editing = document.activeElement?.matches('textarea, input:not([type=date]):not([type=time]):not([type=file])');
    if (editing && vv.height < window.innerHeight - 80) {
      root.setProperty('--vvh', Math.round(vv.height) + 'px');
      root.setProperty('--vvt', Math.round(vv.offsetTop) + 'px');
    } else {
      root.removeProperty('--vvh');
      root.removeProperty('--vvt');
    }
    if (vv.offsetTop === 0) window.scrollTo(0, 0);
  };
  document.addEventListener('focusin', () => setTimeout(fit, 60));
  document.addEventListener('focusout', () => setTimeout(fit, 350));
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 300));
  fit();
  document.addEventListener('focusin', (e) => { if (e.target.matches('textarea, input[type=text], input[type=password], input[type=number]')) document.body.classList.add('kb'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.matches('textarea, input')) document.body.classList.remove('kb'); }, 50));

  // il tempo passa: aggiorna piano e carte
  const tick = () => {
    maybeArchive();
    const before = positions(plan);
    replan();
    const after = positions(plan);
    if ([...after].some(([id, p]) => before.has(id) && (before.get(id).day !== p.day || before.get(id).start !== p.start))) countAutoReplan();
    save(state);
    if (mode === 'day') renderDayView(false); else renderCalendar(false);
    renderComposer();
  };
  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

// ---------------------------------------------------------------- archivio e spazio
// Una volta al giorno le attività fatte e gli impegni passati da più di 60 giorni vanno nell'archivio (IndexedDB).
// Si tolgono dallo stato solo dopo che l'archivio li ha scritti davvero.
let archived = [], archiving = false;
function loadArchive() {
  if (typeof indexedDB === 'undefined') return;
  archiveAll().then((list) => { archived = Array.isArray(list) ? list : []; }).catch(() => {});
}
function maybeArchive() {
  const t = today();
  if (archiving || state.stats.archivedOn === t || typeof indexedDB === 'undefined') return;
  const cands = archiveCandidates(state, Date.now());
  if (!cands.length) { state.stats.archivedOn = t; return; }
  archiving = true;
  const copy = clone(cands);
  archivePut(copy).then(() => {
    const ids = new Set(copy.map((x) => x.id));
    archived = [...archived.filter((x) => !ids.has(x.id)), ...copy];
    applyArchive(state, [...ids], Date.now());
    replan();
    save(state);
    renderAll();
  }).catch((e) => console.warn('archivio non disponibile', e)).finally(() => { archiving = false; });
}

/** Spazio finito: un avviso che resta finché il salvataggio non torna a funzionare, con l'export subito a portata. */
function syncSaveAlert() {
  const el = $('#save-alert');
  if (el) el.hidden = !saveStatus();
}

/** Promemoria di backup: niente export da 14 giorni (e l'app si usa da almeno 14). */
function backupDue() {
  const last = state.settings.lastExportAt || state.stats.createdAt || Date.now();
  return state.items.length > 0 && Date.now() - last > 14 * 864e5;
}

function exportData() {
  // tutto tranne le chiavi API
  const { settings, ...rest } = state;
  // anche l'archivio: un backup deve contenere tutto
  const data = JSON.stringify({ app: 'tempo', version: 3, exportedAt: new Date().toISOString(), ...rest, archive: archived }, null, 2);
  state.settings.lastExportAt = Date.now();
  save(state);
  const file = new File([data], `tempo-backup-${today()}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: 'Backup Tempo' }).catch(() => {});
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

// ---------------------------------------------------------------- avvio
replan();
save(state);
loadArchive();
maybeArchive();
addEventListener('tempo:save-failed', syncSaveAlert);
addEventListener('tempo:save-ok', syncSaveAlert);
bind();
syncSaveAlert();
renderAll();
renderDayView(true);
if (!state.onboarded) openOnboarding();
// i dati non devono essere cancellati dal browser quando lo spazio scarseggia: lo si chiede una volta
if (!state.settings.persistAsked) {
  state.settings.persistAsked = true;
  save(state);
  navigator.storage?.persist?.().catch(() => {});
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // quando arriva una versione nuova dell'app, ricarica una volta per usarla subito
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded && !busy) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
}
// per i test
window.__tempo = { state, get plan() { return plan; }, send, replan, renderAll, openOverview, openDay };
