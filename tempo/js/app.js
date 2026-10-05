import { planDays, updateAnchors, diffPlans, fmtMin, parseHM, dateKey, addDays, dayLabel, WINDOWS } from './scheduler.js';
import { load, save, applyOps, pushUndo, popUndo, canUndo, hasUndo, computeStats, uid, prefLabel } from './store.js';
import { runTurn, localParse, MODELS } from './ai.js';
import { runOpenTurn, preloadLocal, listModels, testOnline, presetOf, DEFAULT_PRESET, LOCAL_MODELS, ONLINE_PRESETS, webgpuAvailable, localModelLoaded } from './ai-open.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const durLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + "'" : ''}` : `${m} min`);

const state = load();
let plan = {};
let view = 'home';
let selDay = dateKey(new Date());
let busy = false;
let pending = null; // proposta in attesa di conferma: { draft, msgId }

// ---------------------------------------------------------------- piano
function replan() {
  const now = Date.now();
  plan = planDays(state, now, 7);
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
  if (e?.code === 'webgpu') return 'Questo iPhone non può far girare modelli in locale: serve Safari con WebGPU (iOS 26 o successivo). Aggiorna iOS oppure scegli «Modello open online» in Memoria → Assistente AI.';
  if (aiMode() === 'local' && /memory|out of memory|device lost|allocation/i.test(e?.message || '')) return 'Il modello è troppo pesante per la memoria del telefono. Scegli un modello più piccolo in Memoria → Assistente AI.';
  if (aiMode() === 'local' && /fetch|network|load/i.test(e?.message || '')) return 'Non riesco a scaricare il modello: controlla la connessione (meglio il Wi-Fi) e riprova. Dopo il primo download funziona anche offline.';
  const svc = ONLINE_PRESETS[presetOf(state.settings)]?.label || 'servizio online';
  if (e?.code === 'nokey') return `Manca la chiave di ${svc}. Creala gratis e incollala in Memoria → Assistente AI (lì trovi i passaggi).`;
  if (e?.code === 'badkey' || (aiMode() === 'online' && st === 401)) return `${svc} non accetta la chiave (${e.message}). Ricopiala per intero in Memoria → Assistente AI e tocca «Prova».`;
  if (e?.code === 'nofree') return e.message + ' Riprova tra qualche minuto: i modelli gratuiti a volte sono sovraccarichi.';
  if (aiMode() === 'online' && (st === 404 || st === 400)) return 'Il servizio non riconosce il modello indicato (' + (e.message || '') + '). Controlla il nome del modello in Memoria → Assistente AI.';
  if (st === 401) return 'La chiave API non è valida. Controllala in Memoria → Assistente AI.';
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
  const undoId = commit(log[0] || 'Modifica', () => Object.assign(state, pick(draft)));
  addMsg({ role: 'assistant', text, changes, applied: true, undoId });
}
const pick = (d) => ({ items: d.items, prefs: d.prefs, recurring: d.recurring, memory: d.memory, anchors: d.anchors });

function applyPending() {
  if (!pending) return;
  const m = state.chat.find((x) => x.id === pending.msgId);
  const draft = pending.draft;
  pending = null;
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

// ---------------------------------------------------------------- render: chat
const seenMsgs = new Set();
/** Riproduce l'animazione d'ingresso di un contenitore (solo quando ci si entra, non a ogni aggiornamento). */
function animateIn(el) {
  if (!el) return;
  el.classList.remove('enter');
  void el.offsetWidth;
  el.classList.add('enter');
  clearTimeout(el._enterT);
  el._enterT = setTimeout(() => el.classList.remove('enter'), 900);
}

function renderChat() {
  const el = $('#chat');
  $('#chips').hidden = !state.chat.length;
  if (!state.chat.length) {
    const sugg = [
      ['Organizzami la giornata: oggi lavoro fino alle 18:30, poi voglio fare un beat e la spesa', 'Organizza la mia giornata', ICONS.e2],
      ['Cosa riesco realisticamente a fare oggi?', 'Cosa riesco a fare oggi?', ICONS.e3],
      ['Sono in ritardo di 30 minuti', 'Sono in ritardo di 30 minuti', ICONS.ev],
      ['Fammi una giornata più leggera', 'Fammi una giornata più leggera', ICONS.e1],
    ];
    el.innerHTML = `<div class="hello">
      <h2>Ciao,<br>come posso <em>aiutarti?</em></h2>
      <p>Dimmi cosa devi fare, gli impegni fissi e cosa conta di più: stimo le durate, organizzo la giornata e la riorganizzo quando qualcosa cambia.${aiMode() !== 'base' ? '' : ' <a href="#" data-goto="settings">Scegli un assistente AI gratuito</a> per la conversazione completa.'}</p>
      <div class="suggest">${sugg.map(([q, l, ic]) => `<button class="sugg glass" data-ask="${esc(q)}"><span>${esc(l)}</span><span class="sg-ico">${ic.replace('<svg ', '<svg width="17" height="17" ')}</span></button>`).join('')}</div>
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

function renderComposer() {
  $('#send').disabled = busy;
  const cur = currentBlock();
  const chips = aiMode() !== 'base'
    ? [
      cur && cur.item && !String(cur.id).startsWith('rec:') && cur.item.kind === 'task' ? `Ho finito ${cur.item.title.toLowerCase()}` : null,
      'Cosa riesco realisticamente a fare oggi?',
      'Organizzami domani',
      'Sono in ritardo di 30 minuti',
      'Fammi una giornata più leggera',
      'Cosa posso rimandare senza problemi?',
    ]
    : [
      cur && cur.item && cur.item.kind === 'task' ? `Ho finito ${cur.item.title.toLowerCase()}` : null,
      'Sono in ritardo di 30 min',
      'Domani alle 10 appuntamento',
    ];
  $('#chips').hidden = !state.chat.length; // a chat vuota ci sono già le carte dei suggerimenti
  $('#chips').innerHTML = chips.filter(Boolean).map((c) => `<button type="button" class="chip">${esc(c)}</button>`).join('');
}

// ---------------------------------------------------------------- render: sommario
function currentBlock() {
  const p = plan[today()];
  if (!p) return null;
  const d = new Date();
  const n = d.getHours() * 60 + d.getMinutes();
  return p.blocks.find((b) => b.type !== 'done' && b.start <= n && n < b.end) || null;
}
function nextBlock() {
  const p = plan[today()];
  if (!p) return null;
  const d = new Date();
  const n = d.getHours() * 60 + d.getMinutes();
  return p.blocks.find((b) => b.type !== 'done' && b.start > n) || null;
}

const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const ICONS = {
  e3: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg>',
  e2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3Z"/></svg>',
  e1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c8 1 14-5 14-14-8 0-14 5-14 14Z"/><path d="M5 19 13 11"/></svg>',
  ev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};
const kindOf = (it) => (it.kind === 'event' ? 'ev' : 'e' + (it.energy || 2));

// ---- indicatore a semicerchio
const G = { cx: 170, cy: 178, r: 146, w: 30 };
const gp = (deg) => { const a = (deg * Math.PI) / 180; return [G.cx + G.r * Math.cos(a), G.cy - G.r * Math.sin(a)]; };
const arc = (a0, a1) => { const [x0, y0] = gp(a0), [x1, y1] = gp(a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${G.r} ${G.r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
let gaugeN = 0, gaugeShown = 0, gaugeAnim = 0, lastNowKey = '';

function renderGauge(pct, n) {
  const svg = $('#gauge-svg');
  if (n !== gaugeN || !svg.firstChild) {
    gaugeN = n;
    const cap = ((G.w / 2 + 3) / G.r) * (180 / Math.PI); // spazio occupato dalle estremità arrotondate
    const span = 180 / n;
    let segs = '';
    for (let i = 0; i < n; i++) {
      const a0 = 180 - i * span - cap, a1 = 180 - (i + 1) * span + cap;
      segs += `<path d="${arc(a0, a1)}" stroke-width="${G.w}"/>`;
    }
    const L = Math.PI * G.r;
    svg.innerHTML = `
      <defs>
        <linearGradient id="gGrad" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#C8001F"/><stop offset="0.6" stop-color="#FF2D55"/><stop offset="1" stop-color="#FF7A93"/></linearGradient>
        <mask id="gMask" maskUnits="userSpaceOnUse" x="0" y="0" width="340" height="200"><g fill="none" stroke="#fff" stroke-linecap="round">${segs}</g></mask>
      </defs>
      <path class="track" d="${arc(180, 0)}"/>
      <g class="seg">${segs}</g>
      <path class="prog" id="g-prog" d="${arc(180, 0)}" stroke-width="${G.w + 2}" mask="url(#gMask)" stroke-dasharray="${L}" stroke-dashoffset="${L}"/>
      <g id="g-tip" style="transform-origin:${G.cx}px ${G.cy}px;transform-box:view-box"><rect class="tip" x="${G.cx - G.r - G.w / 2 - 4}" y="${G.cy - 1.5}" width="${G.w + 8}" height="3" rx="1.5"/></g>`;
  }
  const L = Math.PI * G.r;
  requestAnimationFrame(() => {
    const prog = $('#g-prog'), tip = $('#g-tip');
    if (prog) prog.style.strokeDashoffset = String(L * (1 - pct));
    if (tip) { tip.style.transform = `rotate(${180 * pct}deg)`; tip.style.opacity = pct > 0.005 && pct < 0.995 ? '1' : '0'; tip.style.transition = 'transform 1.4s cubic-bezier(.22,1,.36,1), opacity .4s'; }
  });
  // conteggio animato della percentuale
  const target = Math.round(pct * 100), from = gaugeShown, t0 = performance.now();
  cancelAnimationFrame(gaugeAnim);
  const stepFn = (t) => {
    const k = Math.min(1, (t - t0) / 1200), e = 1 - Math.pow(1 - k, 3);
    gaugeShown = Math.round(from + (target - from) * e);
    $('#gauge-pct').textContent = gaugeShown + '%';
    if (k < 1) gaugeAnim = requestAnimationFrame(stepFn);
  };
  gaugeAnim = requestAnimationFrame(stepFn);
}

function renderHome() {
  const d = new Date();
  $('#today-label').textContent = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const p = plan[today()];
  if (!p) return;
  const n = nowMin();

  // avanzamento = attività fatte / attività di oggi: percentuale, segmenti e conteggio coincidono
  const taskBlocks = p.blocks.filter((b) => b.item.kind === 'task');
  const doneN = taskBlocks.filter((b) => b.type === 'done').length;
  const total = taskBlocks.length + p.unscheduled.length;
  const pct = total ? doneN / total : 0;
  renderGauge(pct, total ? Math.min(8, total) : 4);
  $('#gauge-label').textContent = !total ? 'nessuna attività oggi' : doneN === total ? 'tutto fatto, bravo' : `${doneN} di ${total} attività fatte`;
  $('#gauge-sub').textContent = total && p.free > 0 ? `Ti restano ${durLabel(p.free)} liberi oggi` : '';

  const cur = currentBlock(), nxt = nextBlock();
  const missed = (p.missed || [])[0];
  const isTask = (b) => b.item.kind === 'task' && !String(b.id).startsWith('rec:');
  // "Poi": la prossima cosa dopo quella mostrata
  const after = (b) => p.blocks.find((x) => x.type !== 'done' && x.start >= (b ? b.end : n) && x !== b);
  const poi = (b) => {
    const x = after(b);
    return x ? `<button class="now-next" data-item="${esc(x.id)}"><span>Poi</span><b>${esc(x.item.title)}</b><span>${fmtMin(x.start)}</span></button>` : '';
  };
  let html;
  if (cur) {
    const it = cur.item;
    const prog = Math.max(0, Math.min(1, (n - cur.start) / Math.max(1, cur.end - cur.start)));
    const doing = it.status === 'doing';
    const lead = isTask(cur)
      ? `<button class="play${doing ? '' : ' pulse'}" data-now="${doing ? 'complete' : 'start'}" data-id="${esc(it.id)}" aria-label="${doing ? 'Segna come fatta' : 'Inizia'}">${doing ? ICONS.check : ICONS.play}</button>`
      : `<span class="now-ico" aria-hidden="true">${ICONS.ev}</span>`;
    html = `<div class="now${isTask(cur) ? '' : ' event'}">
      <span class="now-tag">${isTask(cur) ? (doing ? 'In corso' : 'Adesso') : 'Impegno fisso'}</span>
      <div class="now-main" data-item="${esc(cur.id)}">
        ${lead}
        <div class="now-body">
          <div class="now-title">${esc(it.title)}</div>
          <div class="now-meta"><span>fino alle ${fmtMin(cur.end)}</span><i></i><span>${durLabel(Math.max(1, cur.end - n))} rimasti</span></div>
          <div class="now-bar"><i style="width:${Math.round(prog * 100)}%"></i></div>
        </div>
      </div>
      ${isTask(cur) ? `<div class="now-hint">${doing ? 'Tocca ✓ quando hai finito' : 'Tocca ▶ quando inizi'}</div>` : ''}
      ${poi(cur)}
    </div>`;
  } else if (missed) {
    html = `<div class="now calm">
      <span class="now-tag">Da confermare</span>
      <div class="now-body">
        <div class="now-title">Hai fatto «${esc(missed.item.title)}»?</div>
        <div class="now-meta"><span>era previsto alle ${fmtMin(missed.start)}</span></div>
        <div class="now-actions"><button class="btn primary" data-now="complete" data-id="${esc(missed.item.id)}">Sì, fatto</button><button class="btn" data-now="notyet" data-id="${esc(missed.item.id)}">Non ancora</button></div>
      </div>
    </div>`;
  } else if (nxt) {
    const it = nxt.item;
    html = `<div class="now calm">
      <span class="now-tag">Tra ${durLabel(nxt.start - n)}</span>
      <div class="now-main" data-item="${esc(nxt.id)}">
        <span class="now-ico" aria-hidden="true">${ICONS[kindOf(it)]}</span>
        <div class="now-body">
          <div class="now-title">${esc(it.title)}</div>
          <div class="now-meta"><span>alle ${fmtMin(nxt.start)}</span><i></i><span>${durLabel(nxt.end - nxt.start)}</span></div>
        </div>
      </div>
      ${isTask(nxt) ? `<div class="now-actions"><button class="btn primary" data-now="start" data-id="${esc(it.id)}">Inizia adesso</button></div>` : ''}
      ${poi(nxt)}
    </div>`;
  } else {
    html = `<button class="now calm empty-now" data-goto="chat" data-focus="1">
      <span class="now-tag">${state.items.length ? 'Per oggi hai finito' : 'Giornata vuota'}</span>
      <div class="now-title">${state.items.length ? 'Niente altro in programma' : 'Cosa vuoi fare oggi?'}</div>
      <div class="now-meta"><span>Scrivimelo in Parla e la organizzo io →</span></div>
    </button>`;
  }
  const key = (cur?.id || missed?.item.id || nxt?.id || 'none') + (cur?.item.status || '');
  if (key === lastNowKey) html = html.replace(/class="now/, 'class="still now');
  lastNowKey = key;
  $('#now-card').innerHTML = html;

  // un solo avviso, solo se richiede un'azione
  const issues = p.conflicts.length ? `${p.conflicts.length === 1 ? 'Un conflitto' : p.conflicts.length + ' conflitti'} tra impegni`
    : p.unscheduled.length ? `${p.unscheduled.length === 1 ? '1 attività non entra' : p.unscheduled.length + ' attività non entrano'} oggi` : '';
  $('#home-alert').innerHTML = issues ? `<button class="home-alert" data-goto="day"><i></i><span>${issues}</span><b>Risolvi →</b></button>` : '';
}

function moveTabIndicator() {
  const btn = document.querySelector(`.tabbar button[data-view="${view}"]`);
  const ind = $('#tab-ind');
  if (!btn) { ind.style.opacity = '0'; return; }
  ind.style.opacity = '1';
  ind.style.width = btn.offsetWidth + 'px';
  ind.style.transform = `translateX(${btn.offsetLeft - 6}px)`;
}

// ---------------------------------------------------------------- render: giornata
const PX = 1.15;

function renderDays() {
  const t = today();
  let html = '';
  for (let i = 0; i < 7; i++) {
    const k = addDays(t, i);
    const [y, m, dd] = k.split('-').map(Number);
    const wd = new Date(y, m - 1, dd).toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '');
    const p = plan[k];
    const warn = p && (p.conflicts.length || p.unscheduled.length);
    html += `<button class="day-pill${k === selDay ? ' active' : ''}" data-day="${k}" role="tab" aria-selected="${k === selDay}"><span>${i === 0 ? 'oggi' : i === 1 ? 'domani' : wd}</span><b>${dd}</b>${warn ? '<i class="dot"></i>' : ''}</button>`;
  }
  $('#days').innerHTML = html;
}

function renderDay() {
  if (!plan[selDay]) selDay = today();
  renderDays();
  const t = today();
  const p = plan[selDay];
  const [y, m, dd] = selDay.split('-').map(Number);
  const dt = new Date(y, m - 1, dd);
  $('#day-eyebrow').textContent = dt.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#day-title').textContent = selDay === t ? 'Oggi' : selDay === addDays(t, 1) ? 'Domani' : dt.toLocaleDateString('it-IT', { weekday: 'long' });

  // avvisi
  let notes = '';
  if (p.missed?.length) {
    notes += `<div class="notice"><h3>Com'è andata?</h3><ul>${p.missed.map((x) => `<li><div>${esc(x.item.title)}<small>previsto ${fmtMin(x.start)}–${fmtMin(x.end)}</small></div><span><button class="btn primary" data-done="${x.item.id}">Fatto</button> <button class="btn" data-notyet="${x.item.id}">Non ancora</button></span></li>`).join('')}</ul></div>`;
  }
  if (p.conflicts.length) {
    notes += `<div class="notice bad"><h3>Conflitti</h3><ul>${p.conflicts.map(([a, b]) => `<li>${esc(title(state, a))} si sovrappone a ${esc(title(state, b))}</li>`).join('')}</ul></div>`;
  }
  if (p.unscheduled.length) {
    notes += `<div class="notice warn"><h3>Non entra ${selDay === t ? 'oggi' : 'in questa giornata'}</h3><ul>${p.unscheduled.map((u) => `<li><div>${esc(u.item.title)}<small>${durLabel(u.item.duration)} · ${esc(u.reason)}${u.atRisk ? ' · scadenza a rischio' : ''}</small></div><button class="btn" data-tomorrow="${u.item.id}">Sposta al giorno dopo</button></li>`).join('')}</ul></div>`;
  }
  if (p.deferred?.length) {
    notes += `<div class="notice"><h3>Slittano al giorno dopo</h3><ul>${p.deferred.map((x) => `<li><div>${esc(x.title)}<small>${durLabel(x.duration)} · non c'è spazio realistico</small></div></li>`).join('')}</ul></div>`;
  }
  $('#notices').innerHTML = notes;

  // timeline
  const blocks = p.blocks;
  let s0 = state.prefs.dayStart, s1 = state.prefs.dayEnd;
  for (const b of blocks) { s0 = Math.min(s0, b.start); s1 = Math.max(s1, b.end); }
  s0 = Math.floor(s0 / 60) * 60; s1 = Math.min(24 * 60, Math.ceil(s1 / 60) * 60);
  const y0 = (mm) => (mm - s0) * PX;
  let html = '';
  for (let h = s0; h <= s1; h += 60) html += `<div class="hour" style="top:${y0(h)}px"><span>${fmtMin(h)}</span></div>`;
  for (const [a, b] of p.gaps || []) {
    if (b - a < 20) continue;
    html += `<div class="gap" style="top:${y0(a) + 1}px;height:${(b - a) * PX - 2}px">libero ${durLabel(b - a)}</div>`;
  }
  const conflictIds = new Set(p.conflicts.flat());
  const overlapRight = new Set(p.conflicts.map(([, b]) => b));
  const overlapLeft = new Set(p.conflicts.map(([a]) => a));
  for (const b of blocks) {
    const it = b.item;
    const h = Math.max(22, (b.end - b.start) * PX - 3);
    const short = h < 40;
    const cls = ['block', b.type === 'current' ? 'flex' : b.type, it.priority === 3 ? 'high' : '', short ? 'short' : '',
      conflictIds.has(b.id) ? 'conflict' : '', overlapRight.has(b.id) ? 'overlap' : overlapLeft.has(b.id) ? 'overlap-l' : ''].join(' ');
    const tag = b.type === 'done' ? '✓ ' : b.type === 'doing' ? '▶ ' : b.type === 'pinned' ? '📌 ' : it.recurring ? '⟳ ' : '';
    const meta = `${fmtMin(b.start)}–${fmtMin(b.end)}${b.type === 'flex' || b.type === 'current' ? ` · ${durLabel(it.duration)}${it.durationEstimated ? ' (stima)' : ''}` : ''}${b.carried ? ' · rimandata' : ''}`;
    html += `<button class="${cls}" style="top:${y0(b.start) + 1}px;height:${h}px" data-item="${esc(b.id)}"><span class="b-title">${tag}${esc(it.title)}</span><span class="b-meta">${meta}</span></button>`;
  }
  if (selDay === t) {
    const d = new Date();
    const n = d.getHours() * 60 + d.getMinutes();
    if (n >= s0 && n <= s1) html += `<div class="now-line" style="top:${y0(n)}px" id="now-line"></div>`;
  }
  const tl = $('#timeline');
  tl.style.height = `${(s1 - s0) * PX + 20}px`;
  tl.innerHTML = html;
  if (!blocks.length && !p.unscheduled.length) tl.insertAdjacentHTML('beforeend', `<div class="empty-day" style="position:absolute;top:${y0(s0 + 120)}px;left:0;right:0">Nessuna attività. Dimmi cosa vuoi fare in chat.</div>`);
}

function scrollToNow() {
  const nl = $('#now-line');
  const wrap = $('#timeline-wrap');
  if ($('#notices').children.length) wrap.scrollTop = 0;
  else if (nl) wrap.scrollTop = Math.max(0, nl.offsetTop - 120);
  else wrap.scrollTop = 0;
}

// ---------------------------------------------------------------- scheda modifica
function openSheet(id, preset = {}) {
  let it;
  let isRec = false;
  if (id && String(id).startsWith('rec:')) {
    const [, recId, day] = String(id).split(':');
    const r = state.recurring.find((x) => x.id === recId);
    if (!r) return;
    isRec = true;
    $('#sheet-form').innerHTML = `
      <h2 id="sheet-title">⟳ ${esc(r.title)}</h2>
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
  it = id ? state.items.find((x) => x.id === id) : null;
  const isNew = !it;
  const v = it || { title: '', kind: 'task', date: selDay, start: null, duration: 45, priority: 2, energy: 2, window: null, deadline: null, status: 'todo', ...preset };
  const seg = (name, opts, val) => `<div class="seg" data-seg="${name}">${opts.map(([k, l]) => `<button type="button" data-v="${k}" class="${String(val) === String(k) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  $('#sheet-form').innerHTML = `
    <h2 id="sheet-title">${isNew ? 'Nuova attività' : it.status === 'done' ? 'Completata' : 'Modifica'}</h2>
    <input class="title-input" name="title" value="${esc(v.title)}" placeholder="Titolo" required>
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
  showSheet();
  if (isNew) setTimeout(() => $('#sheet-form .title-input').focus(), 250);
}
function showSheet() { $('#sheet').hidden = false; $('#sheet-backdrop').hidden = false; }
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

function sheetSave() {
  const id = $('#sheet-form').dataset.id;
  const v = readSheet();
  if (!v.title) { toast('Serve un titolo'); return; }
  if (v.kind === 'event' && v.start == null) { toast('Un impegno fisso ha bisogno di un orario'); return; }
  if (v.kind === 'event' && !v.date) v.date = selDay;
  commit(id ? 'Modifica manuale' : 'Nuova attività', () => {
    if (id) {
      const it = state.items.find((x) => x.id === id);
      if (it.duration !== v.duration) it.durationEstimated = false;
      Object.assign(it, v, { updatedAt: Date.now() });
      if (state.anchors) delete state.anchors[id];
    } else {
      state.items.push({ id: uid(), ...v, durationEstimated: false, status: 'todo', startedAt: null, doneAt: null, actual: null, dependsOn: [], notes: '', createdAt: Date.now(), updatedAt: Date.now() });
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
        base: 'Senza AI la chat capisce solo frasi semplici. Pianificazione, timeline e annullamento funzionano comunque.',
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
    .then((list) => { S.freeModels = list.slice(0, 40); S.freeModelsAt = Date.now(); S.freeModelsPreset = preset; save(state); if (view === 'settings') renderSettings(); })
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

function setView(v) {
  if (v === view && document.querySelector('#view-' + v).classList.contains('active')) { if (v === 'home') $('#home').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  view = v;
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + v));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  moveTabIndicator();
  if (v === 'home') renderHome();
  if (v === 'day') { renderDay(); animateIn($('#timeline-wrap')); requestAnimationFrame(scrollToNow); }
  if (v === 'settings') { renderSettings(); animateIn($('#settings')); ensureFreeModels(); }
  if (v === 'chat') renderChat();
}

function renderAll() {
  if (view === 'home') renderHome();
  $('#undo-btn').disabled = !canUndo();
  renderComposer();
  const mode = aiMode();
  $('#chat-mode').textContent = { claude: 'Claude', online: (ONLINE_PRESETS[presetOf(state.settings)]?.label || 'Online') + ' · gratis', local: 'Sul telefono · gratis', base: 'Modalità base' }[mode];
  if (view === 'day') renderDay();
  if (view === 'settings') renderSettings();
  if (view === 'chat') renderChat();
}

// ---------------------------------------------------------------- eventi
function bind() {
  $('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });
  $('#undo-btn').addEventListener('click', () => doUndo());
  // dalla Giornata aggiunge al giorno che stai guardando, altrove a oggi
  $('#fab').addEventListener('click', () => { if (view !== 'day') selDay = today(); openSheet(null); });
  window.addEventListener('resize', moveTabIndicator);
  // collegamenti tra le viste (avatar, "Vedi giornata", "Parla con Tempo"…)
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (!g) return;
    e.preventDefault();
    if (g.dataset.goto === 'day') selDay = today();
    setView(g.dataset.goto);
    if (g.dataset.focus) setTimeout(() => $('#input').focus(), 350);
  });
  $('#now-card').addEventListener('click', (e) => {
    const b = e.target.closest('[data-now]');
    if (b) {
      e.stopPropagation();
      const id = b.dataset.id;
      if (b.dataset.now === 'notyet') { delete state.anchors[id]; replan(); save(state); renderAll(); return; }
      quickOp(b.dataset.now, id);
      return;
    }
    const c = e.target.closest('[data-item]');
    if (c) openSheet(c.dataset.item);
  });
  $('#home-alert').addEventListener('click', () => { selDay = today(); });


  const input = $('#input');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(132, input.scrollHeight) + 'px'; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
  });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = ''; grow();
    send(v);
  });
  $('#chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) send(c.textContent); });

  $('#chat').addEventListener('click', (e) => {
    const sg = e.target.closest('[data-ask]');
    if (sg) { send(sg.dataset.ask); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'apply') applyPending();
    if (b.dataset.act === 'discard') discardPending();
    if (b.dataset.act === 'undo') doUndo(b.dataset.id);
  });

  $('#days').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (b) { selDay = b.dataset.day; renderDay(); animateIn($('#timeline-wrap')); $('#timeline-wrap').scrollTop = 0; if (selDay === today()) requestAnimationFrame(scrollToNow); } });
  $('#timeline').addEventListener('click', (e) => { const b = e.target.closest('[data-item]'); if (b) openSheet(b.dataset.item); });
  $('#notices').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tomorrow) {
      const it = state.items.find((x) => x.id === b.dataset.tomorrow);
      quickOp('move', b.dataset.tomorrow, { date: addDays(it?.date && it.date > today() ? it.date : selDay, 1) });
    }
    if (b.dataset.done) quickOp('complete', b.dataset.done, { actual_min: null });
    if (b.dataset.notyet) { delete state.anchors[b.dataset.notyet]; replan(); save(state); renderAll(); }
  });

  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('#sheet-form').addEventListener('submit', (e) => { e.preventDefault(); sheetSave(); });
  $('#sheet-form').addEventListener('click', (e) => {
    const sb = e.target.closest('.seg button');
    if (sb) {
      sb.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === sb));
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
    else if (a === 'delete') { if (confirm('Eliminare questa attività?')) quickOp('delete', id); }
    else if (a === 'skip') {
      commit('Salta ricorrenza', () => { const r = state.recurring.find((x) => x.id === b.dataset.rec); r.skip = [...(r.skip || []), b.dataset.day]; });
      closeSheet(); toastUndo('Saltato');
    } else if (a === 'delrec') {
      if (!confirm('Eliminare l\'impegno ricorrente?')) return;
      commit('Elimina ricorrenza', () => { state.recurring = state.recurring.filter((x) => x.id !== b.dataset.rec); });
      closeSheet(); toastUndo('Ricorrenza eliminata');
    }
  });

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

  // il tempo passa: aggiorna piano e vista
  const tick = () => { replan(); save(state); if (view === 'home') renderHome(); renderComposer(); if (view === 'day') { const top = $('#timeline-wrap').scrollTop; renderDay(); $('#timeline-wrap').scrollTop = top; } };
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
requestAnimationFrame(moveTabIndicator);
document.fonts?.ready.then(moveTabIndicator);
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
window.__tempo = { state, get plan() { return plan; }, send, replan, renderAll };
