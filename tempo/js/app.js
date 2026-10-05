import { planDays, updateAnchors, diffPlans, fmtMin, parseHM, dateKey, addDays, dayLabel, WINDOWS } from './scheduler.js';
import { load, save, applyOps, pushUndo, popUndo, canUndo, hasUndo, computeStats, uid, prefLabel } from './store.js';
import { runTurn, localParse, MODELS } from './ai.js';
import { runOpenTurn, preloadLocal, listModels, testOnline, presetOf, DEFAULT_PRESET, LOCAL_MODELS, ONLINE_PRESETS, webgpuAvailable, localModelLoaded } from './ai-open.js';
import { putImage, deleteImage, imageUrl, cachedImageUrl, compressImage } from './images.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const durLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + "'" : ''}` : `${m} min`);

const state = load();
let plan = {};
let mode = 'day'; // 'day' | 'overview'
const DAYS = 14;
let selDay = dateKey(new Date());
let busy = false;
let pending = null; // proposta in attesa di conferma: { draft, msgId }

// ---------------------------------------------------------------- piano
function replan() {
  const now = Date.now();
  plan = planDays(state, now, DAYS);
  updateAnchors(state, plan, now);
}
const today = () => dateKey(new Date());

function commit(label, mutate) {
  const undoId = pushUndo(state, label);
  mutate();
  const t = today();
  state.stats.replans[t] = (state.stats.replans[t] || 0) + 1;
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
const draftOf = () => clone({ items: state.items, prefs: state.prefs, recurring: state.recurring, memory: state.memory, anchors: state.anchors });
function addMsg(m) {
  const msg = { id: uid(), ts: Date.now(), ...m };
  state.chat.push(msg);
  save(state);
  renderChat();
  return msg;
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  if (/^annulla( l'ultima modifica)?\.?$/i.test(text)) { addMsg({ role: 'user', text }); doUndo(); return; }
  const prior = state.chat.slice();
  openConvo();
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
      const out = await runOpenTurn({
        state, plan, now: Date.now(), userText: text, chat: prior,
        onProgress: (f) => {
          typing.progress = f;
          if (Date.now() - lastPaint > 400 || f >= 1) { lastPaint = Date.now(); renderChat(); }
        },
      });
      removeMsg(typing.id);
      if (out.ops.length) {
        const draft = draftOf();
        const res = applyOps(draft, out.ops);
        const deletesFixed = out.ops.some((o) => o.action === 'delete' && itemsBefore.find((x) => x.id === o.id)?.kind === 'event');
        finishChange({ text: out.text + (res.errors.length ? '\n(' + res.errors.join('; ') + ')' : ''), draft, log: res.log, confirm: out.confirm || deletesFixed, before, itemsBefore });
      } else addMsg({ role: 'assistant', text: out.text });
    } catch (e) {
      removeMsg(typing.id);
      addMsg({ role: 'assistant', error: true, text: errorText(e) });
    } finally {
      busy = false;
      renderComposer();
    }
    return;
  }

  if (mode === 'base') {
    const before = plan;
    const itemsBefore = JSON.parse(JSON.stringify(state.items));
    const r = localParse(text, state, Date.now());
    if (!r.ops) { addMsg({ role: 'assistant', text: r.reply }); return; }
    const draft = JSON.parse(JSON.stringify({ items: state.items, prefs: state.prefs, recurring: state.recurring, memory: state.memory, anchors: state.anchors }));
    const res = applyOps(draft, r.ops);
    finishChange({ text: r.reply + (res.errors.length ? '\n' + res.errors.join('\n') : ''), draft, log: res.log, confirm: r.confirm, before, itemsBefore });
    return;
  }

  busy = true;
  renderComposer();
  const typing = addMsg({ role: 'assistant', pending: true });
  const before = plan;
  const itemsBefore = JSON.parse(JSON.stringify(state.items));
  let draft = null, log = [], confirm = false;

  const hooks = {
    apply(input) {
      draft ||= JSON.parse(JSON.stringify({ items: state.items, prefs: state.prefs, recurring: state.recurring, memory: state.memory, anchors: state.anchors, settings: state.settings }));
      const res = applyOps(draft, input.ops);
      log.push(...res.log);
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
    const out = await runTurn({ state, plan, now: Date.now(), userText: text, hooks, chat: prior });
    removeMsg(typing.id);
    if (draft) finishChange({ text: out.text, draft, log, confirm, before, itemsBefore });
    else addMsg({ role: 'assistant', text: out.text });
  } catch (e) {
    removeMsg(typing.id);
    addMsg({ role: 'assistant', error: true, text: errorText(e) });
  } finally {
    busy = false;
    renderComposer();
  }
}

const title = (s, id) => (s.items.find((x) => x.id === id) || {}).title || (String(id).startsWith('rec:') ? 'ricorrente' : id);

function errorText(e) {
  const st = e?.status;
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

function finishChange({ text, draft, log, confirm, before, itemsBefore }) {
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
  const changes = [...log, ...placed, ...moved.map((m) => '↦ ' + m)];
  if (!changes.length) { addMsg({ role: 'assistant', text }); return; }
  if (confirm) {
    const msg = addMsg({ role: 'assistant', text, changes, applied: null });
    pending = { draft, msgId: msg.id };
    renderChat();
    return;
  }
  markChanged(itemsBefore, draft.items);
  const undoId = commit(log[0] || 'Modifica', () => Object.assign(state, pick(draft)));
  addMsg({ role: 'assistant', text, changes, applied: true, undoId });
}
const pick = (d) => ({ items: d.items, prefs: d.prefs, recurring: d.recurring, memory: d.memory, anchors: d.anchors });

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

// ---------------------------------------------------------------- conversazione
let convoOpen = false;
function openConvo() {
  if (convoOpen) return;
  convoOpen = true;
  closePlus();
  const c = $('#convo');
  c.hidden = false;
  c.classList.remove('closing');
  renderChat();
  renderComposer();
}
function closeConvo() {
  if (!convoOpen) return;
  convoOpen = false;
  const c = $('#convo');
  c.classList.add('closing');
  setTimeout(() => { if (!convoOpen) { c.hidden = true; c.classList.remove('closing'); } }, 300);
  $('#input').blur();
  renderComposer();
}

function renderChat() {
  const el = $('#chat');
  if (!state.chat.length) {
    const sugg = [
      ['Oggi lavoro fino alle 18:30, poi voglio fare un beat e la spesa', 'Organizza la mia giornata'],
      ['Cosa riesco realisticamente a fare oggi?', 'Cosa riesco a fare oggi?'],
      ['Sono in ritardo di 30 minuti', 'Sono in ritardo di 30 minuti'],
      ['Fammi una giornata più leggera', 'Una giornata più leggera'],
    ];
    el.innerHTML = `<div class="hello">
      <h2>Dimmi cosa devi fare,<br>al resto penso io.</h2>
      <p>Impegni fissi, attività, cosa conta di più: stimo le durate, organizzo la giornata e la riorganizzo quando qualcosa cambia.${aiMode() !== 'base' ? '' : ' <a href="#" data-goto="settings">Scegli un assistente AI gratuito</a> per la conversazione completa.'}</p>
      <div class="suggest">${sugg.map(([q, l]) => `<button class="sugg" data-ask="${esc(q)}">${esc(l)}</button>`).join('')}</div>
    </div>`;
    return;
  }
  const fresh = (m) => { const isNew = !seenMsgs.has(m.id); seenMsgs.add(m.id); return isNew ? ' anim' : ''; };
  el.innerHTML = state.chat.map((m) => {
    if (m.pending && m.progress != null && m.progress < 1) return `<div class="msg assistant${fresh(m)}">Preparo il modello sul telefono… ${Math.round(m.progress * 100)}%<div class="applied-note">Solo la prima volta: il modello viene scaricato e salvato sul telefono. Meglio con il Wi-Fi.</div></div>`;
    if (m.pending) return `<div class="msg assistant typing${fresh(m)}" aria-label="Sto pensando"><i></i><i></i><i></i></div>`;
    let extra = '';
    if (m.changes?.length) {
      extra += `<ul class="changes">${m.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`;
      if (m.applied === null && pending?.msgId === m.id) {
        extra += `<div class="actions"><button class="btn primary" data-act="apply">Applica</button><button class="btn" data-act="discard">Lascia com'è</button></div>`;
      } else if (m.applied === null || m.applied === false) {
        extra += `<div class="applied-note">Non applicate.</div>`;
      } else if (m.undone) {
        extra += `<div class="applied-note">Annullate.</div>`;
      } else if (m.undoId && undoExists(m.undoId)) {
        extra += `<div class="actions"><button class="btn" data-act="undo" data-id="${m.undoId}">Annulla</button></div>`;
      }
    }
    return `<div class="msg ${m.role}${m.error ? ' error' : ''}${fresh(m)}">${esc(m.text)}${extra}</div>`;
  }).join('');
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

let rec = null;
function renderComposer() {
  const has = $('#input').value.trim().length > 0;
  $('#send').disabled = busy;
  $('#mic').hidden = !SR || (has && !rec);
  $('#send').hidden = !!SR && !has && !busy;
  const cur = currentBlock();
  const chips = (aiMode() !== 'base'
    ? [cur && cur.item.kind === 'task' && !String(cur.id).startsWith('rec:') ? `Ho finito ${cur.item.title.toLowerCase()}` : null,
      'Cosa riesco a fare oggi?', 'Organizzami domani', 'Sono in ritardo di 30 minuti', 'Cosa posso rimandare?']
    : [cur && cur.item.kind === 'task' ? `Ho finito ${cur.item.title.toLowerCase()}` : null, 'Sono in ritardo di 30 min', 'Domani alle 10 appuntamento']
  ).filter(Boolean);
  $('#chips').hidden = !convoOpen || !state.chat.length;
  $('#chips').innerHTML = chips.map((c) => `<button type="button" class="chip">${esc(c)}</button>`).join('');
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

function greeting(day) {
  const t = today();
  if (day === t) { const h = new Date().getHours(); return h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera'; }
  if (day === addDays(t, 1)) return 'Domani';
  return cap(dateOf(day).toLocaleDateString('it-IT', { weekday: 'long' }));
}

function itemCard(b, place, i, isToday) {
  const it = b.item;
  const id = String(b.id);
  const isTask = it.kind === 'task' && !id.startsWith('rec:');
  const done = b.type === 'done';
  const time = done ? `Fatto alle ${fmtMin(b.end)}` : it.kind === 'event' ? `${fmtMin(b.start)} – ${fmtMin(b.end)}` : `${fmtMin(b.start)}${b.type === 'pinned' ? ' · orario fissato' : ''}`;
  const foot = it.kind === 'event' ? (it.recurring ? 'Impegno ricorrente' : 'Impegno fisso')
    : `${(it.energy || 2) >= 3 ? 'Concentrazione' : (it.energy || 2) <= 1 ? 'Leggera' : 'Attività'} · ${durLabel(b.end - b.start)}${it.durationEstimated && !done ? ' (stima)' : ''}`;
  const cls = ['pc', it.kind === 'event' ? 'event' : 'task', done ? 'done' : '', it.image ? 'photo' : '', changedIds.has(it.id) ? 'flash' : ''].join(' ');
  const style = `--x:${place.x}%;--r:${place.r}deg;--z:${place.z};--i:${i}`;
  const check = isTask ? `<button class="pc-check" data-check="${esc(id)}" aria-label="${done ? 'Riapri' : 'Segna come fatta'}">${ICON_CHECK}</button>` : '';
  const title = `${it.priority === 3 && !done ? '<i class="imp" title="Importante"></i>' : ''}${esc(it.title)}`;
  if (it.image) {
    return `<div class="${cls}" role="button" tabindex="0" data-item="${esc(id)}" style="${style}">${imgTag(it.image)}${check}
      <div class="ph-cap"><div class="pc-time">${time}</div><div class="pc-title">${title}</div></div></div>`;
  }
  return `<div class="${cls}" role="button" tabindex="0" data-item="${esc(id)}" style="${style}">
    <div class="pc-time">${time}</div>
    <div class="pc-title">${title}</div>
    <div class="pc-foot"><span>${foot}</span>${check}</div>
  </div>`;
}

function renderDayView(animate) {
  const t = today();
  if (!plan[selDay]) selDay = t;
  const p = plan[selDay];
  const isToday = selDay === t;
  const n = nowMin();
  const d = dateOf(selDay);

  $('#hero-time').textContent = isToday ? fmtMin(n) : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  const g = greeting(selDay);
  const ht = $('#hero-title');
  if (ht.dataset.g !== g || animate) {
    ht.innerHTML = g.split(' ').map((w, i) => `<span style="animation-delay:${i * 90}ms">${esc(w)}</span>`).join('<br>');
    ht.dataset.g = g;
    if (animate) animateIn(ht, 1200);
  }

  let html = '';
  let i = 0, z = 1, side = 0;
  const next = (id, wide) => {
    if (wide) return { x: 4, r: 0, z: z++ };
    const pl = { x: side % 2 ? 38 : 0, r: tilt(id), z: z++ };
    side++;
    return pl;
  };

  // 1. riepilogo della giornata
  const taskBlocks = p.blocks.filter((b) => b.item.kind === 'task');
  const doneN = taskBlocks.filter((b) => b.type === 'done').length;
  const total = taskBlocks.length + p.unscheduled.length;
  const capTxt = [total ? `${doneN} di ${total} fatte` : 'Nessuna attività', p.free > 0 ? `${durLabel(p.free)} libere` : null].filter(Boolean).join(' · ');
  const ovPl = next('ov' + selDay);
  html += `<div class="pc ov" role="button" tabindex="0" data-goto="overview" style="--x:${ovPl.x}%;--r:-2deg;--z:${ovPl.z};--i:${i++}">
    <div class="ov-day">${esc(cap(d.toLocaleDateString('it-IT', { weekday: 'long' })))}</div>
    <div class="ov-date">${d.getDate()} ${esc(d.toLocaleDateString('it-IT', { month: 'short' }).replace('.', ''))}</div>
    <div class="ov-bar" style="--w:${total ? Math.round((doneN / total) * 100) : 0}%"><i></i></div>
    <div class="ov-cap">${capTxt}</div>
  </div>`;

  // 2. adesso (solo oggi)
  const cur = isToday ? currentBlock() : null;
  if (cur) {
    const it = cur.item;
    const isTask = it.kind === 'task' && !String(cur.id).startsWith('rec:');
    const doing = it.status === 'doing';
    const prog = Math.max(0, Math.min(1, (n - cur.start) / Math.max(1, cur.end - cur.start)));
    const pl = next(cur.id, true);
    html += `<div class="pc now wide${isTask ? '' : ' event'}${changedIds.has(it.id) ? ' flash' : ''}" role="button" tabindex="0" data-item="${esc(cur.id)}" style="--z:${pl.z};--i:${i++}">
      <div class="pc-time">${isTask ? (doing ? 'In corso' : 'Adesso') : 'Adesso · impegno fisso'}</div>
      <div class="now-row">
        <div class="pc-title">${esc(it.title)}</div>
        ${isTask ? `<button class="play${doing ? '' : ' pulse'}" data-now="${doing ? 'complete' : 'start'}" data-id="${esc(it.id)}" aria-label="${doing ? 'Segna come fatta' : 'Inizia'}">${doing ? ICON_CHECK : ICON_PLAY}</button>`
          : `<span class="play" aria-hidden="true">${ICON_CAL}</span>`}
      </div>
      <div class="now-bar" style="--w:${Math.round(prog * 100)}%"><i></i></div>
      <div class="now-meta"><span>fino alle ${fmtMin(cur.end)}</span><span>${durLabel(Math.max(1, cur.end - n))} rimasti</span></div>
    </div>`;
  }

  // 3. da confermare
  for (const m of isToday ? p.missed || [] : []) {
    const pl = next('m' + m.item.id);
    html += `<div class="pc note-card" style="--x:${pl.x}%;--r:${pl.r}deg;--z:${pl.z};--i:${i++}">
      <div class="pc-time">Era previsto alle ${fmtMin(m.start)}</div>
      <div class="pc-title">Hai fatto «${esc(m.item.title)}»?</div>
      <div class="pc-actions"><button class="mini-btn primary" data-act2="done" data-id="${esc(m.item.id)}">Sì</button><button class="mini-btn" data-act2="notyet" data-id="${esc(m.item.id)}">Non ancora</button></div>
    </div>`;
  }

  // 4. le attività della giornata, in ordine di orario
  for (const b of p.blocks) {
    if (b === cur) continue;
    html += itemCard(b, next(b.id), i++, isToday);
  }

  // 5. cose che non entrano o si sovrappongono
  for (const u of p.unscheduled) {
    const pl = next('u' + u.item.id);
    html += `<div class="pc note-card" role="button" tabindex="0" data-item="${esc(u.item.id)}" style="--x:${pl.x}%;--r:${pl.r}deg;--z:${pl.z};--i:${i++}">
      <div class="pc-time">Non entra ${isToday ? 'oggi' : 'in questa giornata'}</div>
      <div class="pc-title">${esc(u.item.title)}</div>
      <div class="pc-foot"><span>${durLabel(u.item.duration)} · ${esc(u.reason)}</span></div>
      <div class="pc-actions"><button class="mini-btn primary" data-act2="move" data-id="${esc(u.item.id)}">Sposta a ${selDay === t ? 'domani' : 'giorno dopo'}</button></div>
    </div>`;
  }
  for (const [a, b] of p.conflicts) {
    const pl = next('c' + a + b);
    html += `<div class="pc note-card" style="--x:${pl.x}%;--r:${pl.r}deg;--z:${pl.z};--i:${i++}">
      <div class="pc-time">Conflitto</div>
      <div class="pc-title">${esc(title(state, a))} si sovrappone a ${esc(title(state, b))}</div>
    </div>`;
  }
  if (!p.blocks.length && !p.unscheduled.length) {
    html += `<p class="empty-hint">${isToday ? 'Giornata libera.' : 'Niente in programma.'} Scrivi qui sotto cosa vuoi fare, oppure tocca + per aggiungere un'attività.</p>`;
  }

  const col = $('#collage');
  col.innerHTML = html;
  fillImages(col);
  if (animate) animateIn(col, 300 + i * 70 + 800);
  $('#undo-btn').hidden = !canUndo();
}

// ---------------------------------------------------------------- tutti i giorni
const HUES = [300, 330, 20, 280, 345, 250, 200];
function renderOverview(animate) {
  const t = today();
  const days = Object.keys(plan).sort();
  const spots = [{ x: '0%', y: '8px', r: -3 }, { x: '34.5%', y: '18px', r: 2.5 }, { x: '69%', y: '4px', r: -1.5 }];
  $('#ov-scroll').innerHTML = days.map((k, i) => {
    const p = plan[k];
    const d = dateOf(k);
    const tasks = p.blocks.filter((b) => b.item.kind === 'task').length + p.unscheduled.length;
    const evs = p.blocks.filter((b) => b.item.kind === 'event').length;
    const sub = [tasks ? `${tasks} attività` : null, evs ? `${evs} impegni` : null, `${durLabel(p.free)} libere`].filter(Boolean).join(' · ');
    const minis = p.blocks.filter((b) => b.type !== 'done').slice(0, 3).map((b, j) => {
      const s = spots[j];
      const st = `--x:${s.x};--y:${s.y};--r:${s.r}deg`;
      return b.item.image ? `<div class="mini photo" style="${st}">${imgTag(b.item.image)}</div>`
        : `<div class="mini" style="${st}"><small>${fmtMin(b.start)}</small>${esc(b.item.title)}</div>`;
    }).join('');
    const name = k === t ? 'Oggi' : k === addDays(t, 1) ? 'Domani' : cap(d.toLocaleDateString('it-IT', { weekday: 'long' }));
    return `<button class="tile${k === selDay ? ' sel' : ''}" data-day="${k}" style="--h:${HUES[d.getDay()]};--i:${i}">
      <div class="t-head"><b>${esc(name)}</b><span>${esc(d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }))}</span></div>
      <div class="t-sub">${sub}</div>
      <div class="t-mini">${minis || '<div class="t-empty">Giornata libera</div>'}</div>
    </button>`;
  }).join('');
  fillImages($('#ov-scroll'));
  if (animate) animateIn($('#ov-scroll'), 1400);
}

function openOverview() {
  if (mode === 'overview') return;
  closeConvo();
  closePlus();
  mode = 'overview';
  renderOverview(true);
  const ov = $('#overview');
  ov.hidden = false;
  void ov.offsetWidth;
  const tile = document.querySelector(`.tile[data-day="${selDay}"]`);
  if (tile) $('#ov-scroll').scrollTop = Math.max(0, tile.offsetTop - 100);
  $('#app').classList.add('mode-overview');
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
      target = document.elementFromPoint(mx, my)?.closest('.tile') || null;
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
      if (scale > 1.1) {
        const k = tl?.dataset.day || selDay;
        openDay(k, tl || document.querySelector(`.tile[data-day="${k}"]`));
      }
    }
  };
  app.addEventListener('touchend', end);
  app.addEventListener('touchcancel', end);
}

// ---------------------------------------------------------------- menu "+" e foto
function togglePlus(force) {
  const m = $('#plus-menu');
  const open = force ?? m.hidden;
  m.hidden = !open;
  $('#plus').classList.toggle('open', open);
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
  else renderPhotoField();
}
function renderPhotoField() {
  const el = $('#photo-field');
  if (!el) return;
  const id = $('#sheet-form').dataset.id;
  const it = id ? state.items.find((x) => x.id === id) : null;
  const src = sheetPhoto?.url || (!sheetPhoto?.remove && it?.image ? cachedImageUrl(it.image) : null);
  const hasImg = sheetPhoto?.url || (!sheetPhoto?.remove && it?.image);
  el.className = 'photo-field' + (hasImg ? '' : ' empty');
  el.innerHTML = hasImg
    ? `<img ${src ? `src="${src}"` : `data-img="${esc(it.image)}"`} alt=""><span class="rm" data-photo="remove" aria-label="Togli la foto">×</span>`
    : `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="12" cy="12.5" r="3.5"/></svg> Aggiungi una foto`;
  fillImages(el);
}

// ---------------------------------------------------------------- scheda modifica
function openSheet(id, preset = {}, keepPhoto = false) {
  if (!keepPhoto) sheetPhoto = null;
  closePlus();
  if (id && String(id).startsWith('rec:')) {
    const [, recId, day] = String(id).split(':');
    const r = state.recurring.find((x) => x.id === recId);
    if (!r) return;
    $('#sheet-form').innerHTML = `
      <h2 id="sheet-title">${esc(r.title)}</h2>
      <div class="card"><div class="row"><span class="lbl">Orario</span><span>${fmtMin(r.start)}–${fmtMin(r.end)}</span></div>
      <div class="row"><span class="lbl">Giorni</span><span>${r.weekdays.map((d) => ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'][d]).join(' ')}</span></div></div>
      <div class="sheet-actions">
        <button type="button" class="btn" data-sheet="skip" data-rec="${r.id}" data-day="${day}">Salta solo ${esc(dayLabel(day, today()))}</button>
        <button type="button" class="btn danger" data-sheet="delrec" data-rec="${r.id}">Elimina ricorrenza</button>
        <button type="button" class="btn full" data-sheet="close">Chiudi</button>
      </div>`;
    showSheet();
    return;
  }
  const it = id ? state.items.find((x) => x.id === id) : null;
  const isNew = !it;
  const v = it || { title: '', kind: 'task', date: selDay, start: null, duration: 45, priority: 2, energy: 2, window: null, deadline: null, status: 'todo', ...preset };
  const seg = (name, opts, val) => `<div class="seg" data-seg="${name}">${opts.map(([k, l]) => `<button type="button" data-v="${k}" class="${String(val) === String(k) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  $('#sheet-form').innerHTML = `
    <h2 id="sheet-title">${isNew ? 'Nuova attività' : it.status === 'done' ? 'Completata' : 'Modifica'}</h2>
    <input class="title-input" name="title" value="${esc(v.title)}" placeholder="Cosa devi fare?" required>
    <button type="button" class="photo-field" id="photo-field" data-photo="pick"></button>
    <div class="card">
      <div class="row"><span class="lbl">Tipo</span>${seg('kind', [['task', 'Flessibile'], ['event', 'Impegno fisso']], v.kind)}</div>
      <div class="row"><label for="f-date">Giorno</label><input type="date" id="f-date" name="date" value="${v.date || ''}"></div>
      <div class="row"><label for="f-start">Orario<small>${v.kind === 'task' ? 'vuoto = lo sceglie l\'app' : ''}</small></label><input type="time" id="f-start" name="start" value="${v.start != null ? fmtMin(v.start) : ''}"></div>
      <div class="row"><label for="f-dur">Durata (min)${v.durationEstimated ? '<small>stimata</small>' : ''}</label><input type="number" id="f-dur" name="duration" min="5" max="960" step="5" value="${v.duration}" inputmode="numeric"></div>
      <div class="row"><span class="lbl">Priorità</span>${seg('priority', [[1, 'Bassa'], [2, 'Normale'], [3, 'Alta']], v.priority)}</div>
      <div class="row"><span class="lbl">Energia</span>${seg('energy', [[1, 'Leggera'], [2, 'Media'], [3, 'Pesante']], v.energy)}</div>
      <div class="row"><label for="f-win">Fascia preferita</label><select id="f-win" name="window"><option value="">Qualsiasi</option>${Object.keys(WINDOWS).map((w) => `<option ${v.window === w ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
      <div class="row"><label for="f-dl">Scadenza</label><input type="date" id="f-dl" name="deadline" value="${v.deadline || ''}"></div>
    </div>
    <div class="sheet-actions">
      ${isNew ? '' : it.status === 'done'
        ? `<button type="button" class="btn" data-sheet="reopen">Riapri</button>`
        : `<button type="button" class="btn" data-sheet="done">✓ Fatto</button>${it.kind === 'task' && it.status !== 'doing' ? `<button type="button" class="btn" data-sheet="start">▶ Inizia ora</button>` : `<button type="button" class="btn" data-sheet="tomorrow">Sposta a domani</button>`}`}
      ${isNew ? '' : `<button type="button" class="btn danger${it.status === 'done' ? '' : ' full'}" data-sheet="delete">Elimina</button>`}
      <button type="button" class="btn" data-sheet="close">Annulla</button>
      <button type="submit" class="btn primary">${isNew ? 'Aggiungi' : 'Salva'}</button>
    </div>`;
  $('#sheet-form').dataset.id = it ? it.id : '';
  renderPhotoField();
  showSheet();
  if (isNew && !keepPhoto) setTimeout(() => $('#sheet-form .title-input').focus(), 300);
}
function showSheet() { const sh = $('#sheet'); sh.classList.remove('closing'); sh.hidden = false; $('#sheet-backdrop').hidden = false; }
function closeSheet() {
  const sh = $('#sheet'), bd = $('#sheet-backdrop');
  if (sh.hidden) return;
  sh.classList.add('closing'); bd.classList.add('closing');
  setTimeout(() => { sh.hidden = true; bd.hidden = true; sh.classList.remove('closing'); bd.classList.remove('closing'); }, 260);
}

function readSheet() {
  const f = $('#sheet-form');
  const segv = (n) => f.querySelector(`[data-seg="${n}"] .on`)?.dataset.v;
  return {
    title: f.title.value.trim(),
    kind: segv('kind'),
    date: f.date.value || null,
    start: parseHM(f.start.value),
    duration: Math.max(5, Math.min(960, +f.duration.value || 30)),
    priority: +segv('priority') || 2,
    energy: +segv('energy') || 2,
    window: f.window.value || null,
    deadline: f.deadline.value || null,
  };
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
  commit(id ? 'Modifica manuale' : 'Nuova attività', () => {
    if (old) {
      if (old.duration !== v.duration) old.durationEstimated = false;
      Object.assign(old, v, { updatedAt: Date.now() });
      if (state.anchors) delete state.anchors[id];
    } else {
      state.items.push({ id: newId, ...v, durationEstimated: false, status: 'todo', startedAt: null, doneAt: null, actual: null, dependsOn: [], notes: '', createdAt: Date.now(), updatedAt: Date.now() });
    }
  });
  closeSheet();
  toastUndo(id ? 'Salvato' : 'Aggiunto');
}

function quickOp(action, id, extra = {}) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  const label = { complete: 'Fatto', start: 'Iniziata', reopen: 'Riaperta', delete: 'Eliminata', move: 'Spostata' }[action];
  commit(`${label}: ${it.title}`, () => applyOps(state, [{ action, id, ...extra }]));
  closeSheet();
  toastUndo(`${label}: ${it.title}`);
}

// ---------------------------------------------------------------- impostazioni
let settingsOpen = false;
function openSettings() {
  settingsOpen = true;
  closeConvo();
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
  const st = computeStats(state);
  const prov = S.provider || (S.apiKey ? 'claude' : 'base');
  const preset = presetOf(S);
  const listed = S.freeModelsPreset === preset || (!S.freeModelsPreset && preset === 'openrouter') ? (S.freeModels || []) : [];
  const wd = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  $('#settings').innerHTML = `
    <div class="group"><h2>Come stai andando</h2>
      <div class="card stat-grid">
        <div class="stat"><b>${st.pct}%</b><span>attività completate (${st.done}/${st.total})</span></div>
        <div class="stat"><b>${st.ratio ? (st.ratio > 1 ? '+' : '') + Math.round((st.ratio - 1) * 100) + '%' : '—'}</b><span>durata reale vs stimata${st.samples ? ` (${st.samples})` : ''}</span></div>
        <div class="stat"><b>${st.replansPerDay}</b><span>ripianificazioni al giorno</span></div>
        <div class="stat"><b>${state.memory.length}</b><span>preferenze ricordate</span></div>
      </div>
    </div>

    <div class="group"><h2>Cosa ricordo di te</h2>
      <div class="card">
        ${state.memory.map((m) => `<div class="row"><div class="mem-item"><span>${esc(m.text)}</span></div><button class="x" data-forget="${m.id}" aria-label="Dimentica">×</button></div>`).join('')}
        <div class="row"><input type="text" class="wide" id="mem-new" placeholder="Aggiungi una preferenza…" enterkeyhint="done"><button class="btn" id="mem-add">Aggiungi</button></div>
      </div>
      <p class="note">L'assistente impara da quello che gli dici. Qui vedi e modifichi tutto: niente scatole nere.</p>
    </div>

    <div class="group"><h2>Impegni ricorrenti</h2>
      <div class="card">
        ${state.recurring.length ? state.recurring.map((r) => `<div class="row"><span class="lbl">${esc(r.title)}<small>${fmtMin(r.start)}–${fmtMin(r.end)} · ${r.weekdays.map((d) => wd[d]).join(' ')}</small></span><button class="x" data-delrec="${r.id}" aria-label="Elimina">×</button></div>`).join('') : '<div class="row"><span class="lbl" style="color:var(--ink-3)">Nessuno. Dillo in chat: «lavoro dal lunedì al venerdì 9–18».</span></div>'}
      </div>
    </div>

    <div class="group"><h2>La tua giornata</h2>
      <div class="card">
        <div class="row"><label for="p-ds">Inizio giornata</label><input type="time" id="p-ds" data-pref="dayStart" value="${fmtMin(P.dayStart)}"></div>
        <div class="row"><label for="p-de">Fine giornata</label><input type="time" id="p-de" data-pref="dayEnd" value="${fmtMin(Math.min(P.dayEnd, 1439))}"></div>
        <div class="row"><label for="p-buf">Pausa tra attività<small>minuti</small></label><input type="number" id="p-buf" data-pref="buffer" min="0" max="60" step="5" value="${P.buffer}" inputmode="numeric"></div>
        <div class="row"><label for="p-sl">Margine per imprevisti<small>% di tempo libero da non riempire</small></label><input type="number" id="p-sl" data-pref="slack" min="0" max="50" step="5" value="${Math.round(P.slack * 100)}" inputmode="numeric"></div>
        <div class="row"><label for="p-fw">Rendi di più<small>per le attività pesanti</small></label><select id="p-fw" data-pref="focusWindow"><option value="">Indifferente</option>${Object.keys(WINDOWS).map((w) => `<option ${P.focusWindow === w ? 'selected' : ''} value="${w}">la ${w === 'sera' ? 'sera' : w}</option>`).join('')}</select></div>
      </div>
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

    <div class="group"><h2>Dati</h2>
      <div class="card">
        <div class="row"><span class="lbl">Esporta un backup</span><button class="btn" id="export">Esporta</button></div>
        <div class="row"><span class="lbl">Ripristina da backup</span><label class="btn" for="import-file">Importa</label><input type="file" id="import-file" accept="application/json,.json" hidden></div>
        <div class="row"><span class="lbl">Svuota la chat</span><button class="btn" id="clear-chat">Svuota</button></div>
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
      commit('Ripristino backup', () => Object.assign(state, { items: d.items, prefs: { ...state.prefs, ...d.prefs }, recurring: d.recurring || [], memory: d.memory || [], anchors: {}, chat: d.chat || state.chat }));
      toast('Backup ripristinato');
    }).catch((err) => toast('Backup non valido: ' + err.message));
  }
}

function addMemory() {
  const inp = $('#mem-new');
  const v = inp.value.trim();
  if (!v) return;
  commit('Memoria', () => state.memory.push({ id: uid(), text: v, at: Date.now() }));
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
  if (mode === 'day') renderDayView(false); else renderOverview(false);
  $('#undo-btn').hidden = !canUndo();
  renderComposer();
  $('#chat-mode').textContent = { claude: 'Claude', online: (ONLINE_PRESETS[presetOf(state.settings)]?.label || 'Online') + ' · gratis', local: 'Sul telefono · gratis', base: 'Modalità base, senza AI' }[aiMode()];
  if (convoOpen) renderChat();
  if (settingsOpen) renderSettings();
}

// ---------------------------------------------------------------- eventi
function bind() {
  $('#to-overview').addEventListener('click', openOverview);
  $('#ov-today').addEventListener('click', () => { const k = today(); openDay(k, document.querySelector(`.tile[data-day="${k}"]`)); });
  $('#ov-scroll').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) openDay(t.dataset.day, t); });
  $('#open-settings').addEventListener('click', openSettings);
  $('#close-settings').addEventListener('click', closeSettings);
  $('#undo-btn').addEventListener('click', () => doUndo());
  $('#convo-close').addEventListener('click', closeConvo);

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
    const nw = e.target.closest('[data-now]');
    if (nw) { e.stopPropagation(); quickOp(nw.dataset.now, nw.dataset.id); return; }
    const a2 = e.target.closest('[data-act2]');
    if (a2) {
      e.stopPropagation();
      const id = a2.dataset.id;
      if (a2.dataset.act2 === 'done') quickOp('complete', id);
      if (a2.dataset.act2 === 'notyet') { delete state.anchors[id]; replan(); save(state); renderAll(); }
      if (a2.dataset.act2 === 'move') quickOp('move', id, { date: addDays(selDay, 1) });
      return;
    }
    const c = e.target.closest('[data-item]');
    if (c) openSheet(c.dataset.item);
  });
  col.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.item) openSheet(e.target.dataset.item); });

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
  input.addEventListener('focus', () => { closePlus(); openConvo(); });
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
  $('#mic').addEventListener('click', () => { openConvo(); toggleMic(); });
  $('#plus').addEventListener('click', () => togglePlus());
  $('#plus-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-plus]');
    if (!b) return;
    closePlus();
    closeConvo();
    if (b.dataset.plus === 'task') openSheet(null);
    else pickPhoto('new');
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#plus-menu, #plus')) closePlus(); });
  $('#photo-input').addEventListener('change', (e) => onPhotoPicked(e.target.files[0]));
  $('#chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) send(c.textContent); });

  // conversazione
  $('#chat').addEventListener('click', (e) => {
    const sg = e.target.closest('[data-ask]');
    if (sg) { send(sg.dataset.ask); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'apply') applyPending();
    if (b.dataset.act === 'discard') discardPending();
    if (b.dataset.act === 'undo') doUndo(b.dataset.id);
  });
  // trascinando in giù dall'alto la conversazione si chiude
  let y0 = null;
  $('#convo').addEventListener('touchstart', (e) => { y0 = $('#chat').scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
  $('#convo').addEventListener('touchmove', (e) => { if (y0 != null && e.touches[0].clientY - y0 > 90) { y0 = null; closeConvo(); } }, { passive: true });

  // scheda
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('#sheet-form').addEventListener('submit', (e) => { e.preventDefault(); sheetSave(); });
  $('#sheet-form').addEventListener('click', (e) => {
    const sb = e.target.closest('.seg button');
    if (sb) {
      sb.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === sb));
      return;
    }
    const ph = e.target.closest('[data-photo]');
    if (ph) {
      e.preventDefault();
      if (ph.dataset.photo === 'remove') { e.stopPropagation(); sheetPhoto = { remove: true }; renderPhotoField(); }
      else if ($('#photo-field').classList.contains('empty')) pickPhoto('sheet');
      return;
    }
    const b = e.target.closest('[data-sheet]');
    if (!b) return;
    const id = $('#sheet-form').dataset.id;
    const a = b.dataset.sheet;
    if (a === 'close') closeSheet();
    else if (a === 'done') quickOp('complete', id);
    else if (a === 'start') quickOp('start', id);
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
    if (t.id === 'clear-chat' && confirm('Svuotare la conversazione? Attività e memoria restano.')) { state.chat = []; pending = null; save(state); toast('Chat svuotata'); }
    if (t.id === 'reset' && confirm('Cancellare tutte le attività, la memoria e la chat? (La chiave API resta.)')) {
      commit('Cancella tutto', () => Object.assign(state, { items: [], recurring: [], memory: [], anchors: {}, chat: [] }));
      toastUndo('Tutto cancellato');
    }
  });
  st.addEventListener('keydown', (e) => { if (e.target.id === 'mem-new' && e.key === 'Enter') { e.preventDefault(); addMemory(); } });

  bindPinch();

  // tastiera iOS: adatta l'altezza all'area visibile
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv) return;
    if (vv.height < window.innerHeight - 80) document.documentElement.style.setProperty('--vvh', vv.height + 'px');
    else document.documentElement.style.removeProperty('--vvh');
    window.scrollTo(0, 0);
  };
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  fit();
  document.addEventListener('focusin', (e) => { if (e.target.matches('textarea, input[type=text], input[type=password], input[type=number]')) document.body.classList.add('kb'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.matches('textarea, input')) document.body.classList.remove('kb'); }, 50));

  // il tempo passa: aggiorna piano e carte
  const tick = () => {
    replan();
    save(state);
    if (mode === 'day') renderDayView(false); else renderOverview(false);
    renderComposer();
  };
  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

function exportData() {
  const data = JSON.stringify({ app: 'tempo', version: 1, exportedAt: new Date().toISOString(), items: state.items, prefs: state.prefs, recurring: state.recurring, memory: state.memory, chat: state.chat }, null, 2);
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
bind();
renderAll();
renderDayView(true);
navigator.storage?.persist?.().catch(() => {});
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
