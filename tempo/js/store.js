// Stato, persistenza locale, annullamento e applicazione delle modifiche strutturate.
// Qui vengono validati orari, durate e vincoli: l'AI propone, il codice decide.
import { DEFAULT_PREFS, parseHM, fmtMin, dateKey, addDays, WINDOWS, weekday, daysBetween, isOffDay } from './scheduler.js';
import { parseDue, weekdaysIn, structureMemory } from './parse.js';
import { sessionsFor, validatePlan, MAX_SESSIONS } from './templates.js';
import { estimate, updateDurations, sampleOf, MAX_SAMPLES } from './learn.js';
import { sanitizeFocus } from './focus.js';
import { THEME_KEYS } from './themes.js';

const KEY = 'tempo.v1';
const UNDO_KEY = 'tempo.undo.v1';

export const uid = () => Math.random().toString(36).slice(2, 8);

export const SCHEMA = 4;

export function emptyState() {
  return {
    schema: SCHEMA,
    items: [],
    habits: [],     // abitudini con frequenza: { id, title, perWeek, duration, project, goalId, window }
    learned: { durations: {}, slots: {}, samples: [] }, // cosa ha imparato dal tuo comportamento (samples: durate vere delle attività archiviate)
    seenObs: { day: null, ids: [] },       // osservazioni già mostrate oggi (massimo 2)
    askChat: [],    // le domande del riepilogo e le risposte
    askIntro: null, // i punti chiave scritti dall'AI: { key, text }
    focus: null,    // il timer o pomodoro in corso (focus.js)
    prefs: structuredClone(DEFAULT_PREFS), // copia profonda: availability e gli elenchi non si condividono tra stati
    recurring: [],
    memory: [],
    goals: [],      // obiettivi: { id, title, due, projectId, note }
    projects: [],   // progetti: { id, name, color }
    log: [],        // cosa è successo: sessioni saltate, completate…
    onboarded: false,
    anchors: {},
    chat: [],
    settings: { apiKey: '', model: 'claude-opus-5-5', name: '' },
    stats: { replans: {}, createdAt: Date.now(), archived: { tasks: 0, done: 0 }, archivedOn: null },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return migrate(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

// ---- Sicurezza: uno stato che arriva da fuori (backup importato) non deve poter iniettare codice nella pagina
const SAFE_ID = /^[A-Za-z0-9_:-]{1,64}$/;
const SAFE_COLOR = /^#[0-9a-fA-F]{3,8}$/;
export const safeId = (v) => (typeof v === 'string' && SAFE_ID.test(v) ? v : null);
export const CARD_COLORS = ['rose', 'lilac', 'sage', 'sand', 'sky'];
export const cardColor = (v) => (CARD_COLORS.includes(v) ? v : null);
export const safeColor = (v) => (typeof v === 'string' && SAFE_COLOR.test(v) ? v : null);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const num = (v, lo, hi, dflt = null) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : dflt);
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/**
 * Tiene solo voci ben formate: identificativi sicuri, colori #rrggbb, date e orari validi, testi come testo.
 * Le voci con un identificativo non valido vengono scartate (in uso normale non succede mai).
 */
export function sanitizeState(s) {
  const ids = (list) => arr(list).filter((x) => x && typeof x === 'object' && safeId(x.id));
  s.items = ids(s.items).map((x) => ({
    ...x, title: str(x.title, 80), notes: str(x.notes, 500), kind: x.kind === 'event' ? 'event' : 'task',
    date: validDate(x.date), deadline: validDate(x.deadline), earliest: validDate(x.earliest),
    start: num(x.start, 0, 1440), duration: num(x.duration, 1, 1440, 30), status: ['todo', 'doing', 'done'].includes(x.status) ? x.status : 'todo',
    dependsOn: arr(x.dependsOn).filter(safeId), project: safeId(x.project), goalId: safeId(x.goalId), habitId: safeId(x.habitId), image: safeId(x.image),
    window: WINDOWS[x.window] ? x.window : null, color: cardColor(x.color), theme: THEME_KEYS.includes(x.theme) ? x.theme : null,
  }));
  s.focus = sanitizeFocus(s.focus);
  if (s.focus && !s.items.some((x) => x.id === s.focus.itemId)) s.focus = null;
  s.projects = ids(s.projects).map((p, i) => ({ ...p, name: str(p.name, 40) || 'Progetto', color: safeColor(p.color) || COLORS[i % COLORS.length], due: validDate(p.due), aliases: arr(p.aliases).map((a) => str(a, 40)) }));
  s.goals = ids(s.goals).map((g) => ({ ...g, title: str(g.title, 120), note: str(g.note, 300), due: validDate(g.due), projectId: safeId(g.projectId), lateSince: validDate(g.lateSince) }));
  s.habits = ids(s.habits).map((h) => ({ ...h, title: str(h.title, 60), perWeek: num(h.perWeek, 1, 7, 1), duration: num(h.duration, 10, 240, 60), project: safeId(h.project), goalId: safeId(h.goalId), window: WINDOWS[h.window] ? h.window : null }));
  s.memory = ids(s.memory).map((m) => ({ ...m, text: str(m.text, 200), category: ['vincolo', 'preferenza', 'obiettivo', 'nota'].includes(m.category) ? m.category : 'nota' }));
  s.recurring = ids(s.recurring).map((r) => ({ ...r, title: str(r.title, 80), start: num(r.start, 0, 1440, 540), end: num(r.end, 0, 1440, 600), weekdays: arr(r.weekdays).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6), skip: arr(r.skip).filter(validDate), color: cardColor(r.color) }));
  s.chat = arr(s.chat).filter((m) => m && typeof m === 'object' && safeId(m.id)).map((m) => ({ ...m, text: str(m.text, 4000), changes: arr(m.changes).map((c) => str(c, 300)), undoId: safeId(m.undoId) }));
  s.askChat = arr(s.askChat).filter((m) => m && typeof m === 'object' && safeId(m.id) && !m.pending).map((m) => ({ id: m.id, role: m.role === 'user' ? 'user' : 'assistant', text: str(m.text, 4000), ts: num(m.ts, 0, 9e15, 0), error: !!m.error })).slice(-40);
  s.askIntro = s.askIntro && typeof s.askIntro === 'object' ? { key: str(s.askIntro.key, 2000), text: str(s.askIntro.text, 2000) } : null;
  s.anchors = Object.fromEntries(Object.entries(obj(s.anchors)).filter(([k]) => safeId(k)));
  s.log = arr(s.log).filter((e) => e && typeof e === 'object').map((e) => ({ ...e, id: safeId(e.id), project: safeId(e.project) }));
  const L = obj(s.learned);
  s.learned = { ...L, durations: Object.fromEntries(Object.entries(obj(L.durations)).filter(([k]) => safeId(k))), slots: obj(L.slots), ignoreBefore: obj(L.ignoreBefore),
    samples: arr(L.samples).filter((x) => x && typeof x === 'object' && Number.isFinite(+x.base) && Number.isFinite(+x.actual))
      .map((x) => ({ keys: arr(x.keys).filter((k) => typeof k === 'string').map((k) => k.slice(0, 64)).slice(0, 2), base: num(x.base, 1, 1440, 30), actual: num(x.actual, 1, 1440, 30), doneAt: num(x.doneAt, 0, 9e15, 0) })).slice(-MAX_SAMPLES) };
  const A = obj(obj(s.stats).archived);
  s.stats = { ...obj(s.stats), archived: { tasks: num(A.tasks, 0, 1e7, 0), done: num(A.done, 0, 1e7, 0) } };
  const P = obj(s.prefs);
  s.prefs = { ...P, offDays: arr(P.offDays).map(Number).filter((d) => d >= 0 && d <= 6), freeDays: arr(P.freeDays).map(Number).filter((d) => d >= 0 && d <= 6),
    restDays: arr(P.restDays).filter((r) => r && Number.isInteger(+r.wd) && +r.wd >= 0 && +r.wd <= 6 && validDate(r.until)).map((r) => ({ wd: +r.wd, until: r.until })),
    focusWindow: WINDOWS[P.focusWindow] ? P.focusWindow : null,
    dayStart: num(P.dayStart, 0, 1440, DEFAULT_PREFS.dayStart), dayEnd: num(P.dayEnd, 0, 1440, DEFAULT_PREFS.dayEnd), buffer: num(P.buffer, 0, 120, DEFAULT_PREFS.buffer),
    slack: num(P.slack, 0, 0.9, DEFAULT_PREFS.slack), maxBlock: num(P.maxBlock, 20, 600, DEFAULT_PREFS.maxBlock), decompress: num(P.decompress, 0, 180, DEFAULT_PREFS.decompress), heavyRest: num(P.heavyRest, 0, 120, 0),
    availability: Object.fromEntries(Object.entries(obj(P.availability)).filter(([k]) => validDate(k))) };
  return s;
}

/** Porta uno stato salvato (di qualsiasi versione) allo schema attuale, senza perdere niente. */
export function migrate(s, now = Date.now()) {
  const e = emptyState();
  // chi usava già l'app ha già un contesto: niente presentazione iniziale
  if (s.onboarded === undefined) s.onboarded = (s.items || []).length > 0;
  const out = { ...e, ...s, prefs: { ...e.prefs, ...s.prefs }, settings: { ...e.settings, ...s.settings }, stats: { ...e.stats, ...s.stats },
    learned: { ...e.learned, ...s.learned } };
  sanitizeState(out);
  if ((s.schema || 1) < 2) {
    // v1 → v2: le note di memoria che si possono strutturare diventano preferenze vere
    const ctx = { offDays: [...(out.prefs.offDays || [])], projects: out.projects };
    const ops = [];
    for (const m of out.memory || []) ops.push(...structureMemory(m.text, ctx));
    const keep = ops.filter((o) => !(o.pref_key === 'max_block_min' && s.prefs?.maxBlock) && !(o.pref_key === 'focus_window' && s.prefs?.focusWindow));
    if (keep.length) applyOps(out, keep, now);
    // le attività dei progetti con un obiettivo si collegano all'obiettivo
    for (const it of out.items) if (it.project && !it.goalId) it.goalId = goalOfProject(out, it.project)?.id || null;
    out.stats.replans = {}; // prima contava ogni modifica: si riparte da zero
  }
  // v2 → v3: archivio delle attività vecchie (learned.samples, stats.archived): i valori vuoti li mette già emptyState
  if ((s.schema || 1) < 4) {
    // v3 → v4: i giorni liberati dal companion non sono più per sempre. Erano finiti in offDays:
    // si riconoscono dalla risposta salvata in learned.slots['d<giorno>'] e dal fatto che non li hai detti tu
    // (nessun vincolo in memoria che nomina quel giorno). Diventano giorni liberi per altre 4 settimane.
    const NAMES = ['domenic', 'luned', 'marted', 'mercoled', 'gioved', 'venerd', 'sabat'];
    const said = (wd) => (out.memory || []).some((m) => String(m.text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(NAMES[wd]));
    const today = dateKey(new Date(now));
    const fromCompanion = (out.prefs.offDays || []).filter((wd) => out.learned.slots?.['d' + wd] && !said(wd));
    if (fromCompanion.length) {
      out.prefs.offDays = out.prefs.offDays.filter((wd) => !fromCompanion.includes(wd));
      out.prefs.restDays = [...(out.prefs.restDays || []), ...fromCompanion.map((wd) => ({ wd, until: addDays(today, 28) }))];
    }
  }
  out.schema = SCHEMA;
  return out;
}

// ---- Salvataggio ----
// Se lo spazio finisce: prima si libera la cronologia dell'annulla e si riprova; se non basta,
// lo si segnala (evento «tempo:save-failed») e il salvataggio precedente resta com'era.
let saveError = null;
/** null se l'ultimo salvataggio è riuscito, altrimenti { at, error }. */
export const saveStatus = () => saveError;
const emit = (name, detail) => { try { globalThis.dispatchEvent?.(new CustomEvent(name, { detail })); } catch {} };

export function save(state) {
  if (state.chat.length > 200) state.chat = state.chat.slice(-200);
  const json = JSON.stringify(state);
  const write = () => { localStorage.setItem(KEY, json); return true; };
  try { write(); }
  catch {
    try { localStorage.removeItem(UNDO_KEY); } catch {}
    try { write(); }
    catch (e) {
      saveError = { at: Date.now(), error: String(e?.name || e) };
      emit('tempo:save-failed', saveError);
      return false;
    }
  }
  if (saveError) { saveError = null; emit('tempo:save-ok', null); }
  return true;
}

// ---- Annulla ----
// In memoria le ultime 20 modifiche; su disco solo le ultime 3, e solo se stanno in 300 mila caratteri:
// l'annulla non deve mai crescere con lo stato e riempire lo spazio del telefono.
const UNDO_MEM = 20, UNDO_DISK = 3, UNDO_DISK_MAX = 300_000;
let undo = [];
const storage = () => globalThis.localStorage;
const persistUndo = () => {
  try {
    // si misura prima di serializzare: le copie troppo grandi non vengono nemmeno scritte
    const keep = [];
    let size = 2;
    for (const u of undo.slice(-UNDO_DISK).reverse()) {
      size += u.snap.length * 1.1 + 120;
      if (size > UNDO_DISK_MAX) break;
      keep.unshift(u);
    }
    let json = JSON.stringify(keep);
    while (keep.length && json.length > UNDO_DISK_MAX) { keep.shift(); json = JSON.stringify(keep); }
    if (keep.length) storage().setItem(UNDO_KEY, json); else storage().removeItem(UNDO_KEY);
  } catch { try { storage().removeItem(UNDO_KEY); } catch {} }
};
/** All'avvio: legge l'annulla salvato e, se è troppo grande (versioni precedenti), lo riduce o lo elimina. */
export function trimUndoStorage() {
  let raw = null;
  try { raw = storage()?.getItem(UNDO_KEY); } catch { return; }
  if (!raw) { undo = []; return; }
  try {
    const list = JSON.parse(raw);
    undo = Array.isArray(list) ? list.filter((u) => u && typeof u.snap === 'string' && u.snap.length < UNDO_DISK_MAX).slice(-UNDO_DISK) : [];
  } catch { undo = []; }
  if (raw.length > UNDO_DISK_MAX || !undo.length) persistUndo();
}
trimUndoStorage();

const snapshotOf = (s) => JSON.stringify({ items: s.items, prefs: s.prefs, recurring: s.recurring, memory: s.memory, anchors: s.anchors, goals: s.goals, projects: s.projects, habits: s.habits, learned: s.learned });

export function pushUndo(state, label) {
  const id = uid();
  undo.push({ id, label, at: Date.now(), snap: snapshotOf(state) });
  undo = undo.slice(-UNDO_MEM);
  persistUndo();
  return id;
}
export const canUndo = () => undo.length > 0;
export const hasUndo = (id) => undo.some((u) => u.id === id);
export const lastUndo = () => undo[undo.length - 1];

/** Ripristina lo stato a prima della modifica `id` (o dell'ultima). */
export function popUndo(state, id) {
  let idx = id ? undo.findIndex((u) => u.id === id) : undo.length - 1;
  if (idx < 0) return null;
  const entry = undo[idx];
  const snap = JSON.parse(entry.snap);
  Object.assign(state, snap);
  undo = undo.slice(0, idx);
  persistUndo();
  return entry;
}

// ---- Archivio ----
// Le attività fatte e gli impegni passati da più di 60 giorni escono dallo stato (vanno in IndexedDB, archive.js):
// lo stato resta piccolo e il piano non li rilegge ogni 30 secondi. Le durate vere restano per l'apprendimento.
export const ARCHIVE_AFTER_DAYS = 60;
/** Le voci da archiviare oggi. Le sessioni di un obiettivo ancora aperto restano (servono al suo avanzamento). */
export function archiveCandidates(state, now = Date.now()) {
  const limit = addDays(dateKey(new Date(now)), -ARCHIVE_AFTER_DAYS);
  const openGoals = new Set((state.goals || []).filter((g) => !g.archivedAt).map((g) => g.id));
  const pinned = new Set([state.focus?.itemId].filter(Boolean));
  return (state.items || []).filter((x) => {
    if (pinned.has(x.id) || (x.goalId && openGoals.has(x.goalId))) return false;
    if (x.status === 'done') return !!x.doneAt && dateKey(new Date(x.doneAt)) < limit;
    return x.kind === 'event' && !!x.date && x.date < limit;
  });
}
/** Toglie dallo stato le voci archiviate (dopo che sono state scritte nell'archivio), tenendo i campioni delle durate. */
export function applyArchive(state, ids, now = Date.now()) {
  const set = new Set(ids);
  const gone = state.items.filter((x) => set.has(x.id));
  if (!gone.length) return 0;
  const L = (state.learned ||= { durations: {}, slots: {} });
  const fresh = gone.map((x) => sampleOf(x)).filter(Boolean);
  L.samples = [...(L.samples || []), ...fresh].sort((a, b) => a.doneAt - b.doneAt).slice(-MAX_SAMPLES);
  state.items = state.items.filter((x) => !set.has(x.id));
  for (const x of state.items) if (x.dependsOn?.length) x.dependsOn = x.dependsOn.filter((d) => !set.has(d));
  if (state.anchors) for (const id of set) delete state.anchors[id];
  const A = ((state.stats ||= {}).archived ||= { tasks: 0, done: 0 });
  A.tasks += gone.filter((x) => x.kind === 'task').length;
  A.done += gone.filter((x) => x.kind === 'task' && x.status === 'done').length;
  state.stats.archivedOn = dateKey(new Date(now));
  return gone.length;
}

// ---- Progetti ----
const COLORS = ['#E0457B', '#8466C8', '#E0894A', '#3E9C6B', '#3D7FD6', '#C9821B', '#D4567F', '#5B9AA8'];
/** Trova un progetto per nome (o id); se non esiste lo crea. */
export function projectId(state, name) {
  if (!name) return null;
  state.projects ||= [];
  const n = String(name).trim();
  const low = n.toLowerCase();
  const found = state.projects.find((p) => p.id === n || p.name.toLowerCase() === low)
    || state.projects.find((p) => low.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(low));
  if (found) return found.id;
  const p = { id: 'p_' + uid(), name: n.charAt(0).toUpperCase() + n.slice(1, 40), color: COLORS[state.projects.length % COLORS.length] };
  state.projects.push(p);
  return p.id;
}
export const projectOf = (state, id) => (state.projects || []).find((p) => p.id === id) || null;

/** Scadenza dell'obiettivo collegato a ogni progetto (serve al motore per dare priorità). */
export function projectDue(state) {
  const out = {};
  for (const g of state.goals || []) if (g.projectId && g.due && (!out[g.projectId] || g.due < out[g.projectId])) out[g.projectId] = g.due;
  return out;
}

/** "tra 6 settimane", "entro fine novembre", "entro il 15/12"… → data. */
export const dueFromText = (text, today) => parseDue(text, today)?.due || null;
export const goalOfProject = (state, pid) => (state.goals || []).find((g) => g.projectId === pid) || null;

// ---- Operazioni ----
const clampInt = (v, lo, hi) => (v == null || isNaN(+v) ? null : Math.min(hi, Math.max(lo, Math.round(+v))));
const validDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export function findItem(state, ref) {
  if (!ref) return null;
  const r = String(ref).toLowerCase();
  return state.items.find((x) => x.id === ref) ||
    state.items.find((x) => x.status !== 'done' && x.title.toLowerCase() === r) ||
    state.items.find((x) => x.status !== 'done' && x.title.toLowerCase().includes(r)) ||
    null;
}

/**
 * Applica un elenco di operazioni allo stato (mutandolo).
 * Restituisce { log: [testi leggibili], errors: [testi], touchedFixed: bool }.
 */
export function applyOps(state, ops, now = Date.now()) {
  const log = [], errors = [];
  let touchedFixed = false;
  const today = dateKey(new Date(now));
  const created = {}; // titolo → id, per dipendenze tra attività create insieme

  const resolveDeps = (arr) => (arr || []).map((ref) => created[String(ref).toLowerCase()] || findItem(state, ref)?.id).filter(Boolean);

  for (const op of ops || []) {
    try {
      const it = op.id ? findItem(state, op.id) : null;
      if (it && state.anchors && ['update', 'move', 'start', 'complete', 'reopen', 'delete'].includes(op.action)) delete state.anchors[it.id];
      const start = parseHM(op.start_time);
      const date = validDate(op.date);
      switch (op.action) {
        case 'add': {
          if (!op.title) { errors.push('Attività senza titolo ignorata'); break; }
          const kind = op.kind === 'event' ? 'event' : 'task';
          if (kind === 'event' && start == null) { errors.push(`«${op.title}»: manca l'orario dell'impegno`); break; }
          let duration = clampInt(op.duration_min, 5, 16 * 60);
          if (kind === 'event' && op.end_time) {
            const e = parseHM(op.end_time);
            if (e != null && e > start) duration = e - start;
          }
          const item = {
            id: uid(), title: String(op.title).slice(0, 80), kind,
            date: date || (kind === 'event' ? today : null),
            start: start,
            duration: duration || (kind === 'event' ? 60 : 30),
            durationEstimated: kind === 'event' ? false : op.duration_min == null ? true : !!op.duration_is_estimate,
            priority: clampInt(op.priority, 1, 3) || 2,
            deadline: validDate(op.deadline),
            earliest: validDate(op.earliest_date),
            window: WINDOWS[op.window] ? op.window : null,
            energy: clampInt(op.energy, 1, 3) || 2,
            status: 'todo', startedAt: null, doneAt: null, actual: null,
            dependsOn: resolveDeps(op.depends_on),
            notes: op.note || '',
            project: op.project ? projectId(state, op.project) : null,
            theme: THEME_KEYS.includes(op.theme) ? op.theme : null,
            goalId: null,
            spent: 0,
            createdAt: now, updatedAt: now,
          };
          item.goalId = item.project ? goalOfProject(state, item.project)?.id || null : null;
          if (kind === 'task' && item.durationEstimated) { item.baseDuration = item.duration; item.duration = estimateFor(state, item.title, item.project, item.duration); }
          state.items.push(item);
          created[item.title.toLowerCase()] = item.id;
          const when = item.start != null ? ` ${niceDay(item.date, today)} ${fmtMin(item.start)}` : item.date ? ` (${niceDay(item.date, today)})` : '';
          log.push(`+ ${item.title}${when} · ${item.duration} min${item.durationEstimated ? ' (stima)' : ''}${item.priority === 3 ? ' · alta priorità' : ''}`);
          break;
        }
        case 'update': case 'move': {
          if (!it) { errors.push(`Non trovo «${op.id}»`); break; }
          if (it.kind === 'event') touchedFixed = true;
          const ch = [];
          if (op.title) { it.title = String(op.title).slice(0, 80); ch.push('titolo'); }
          if (date) { it.date = date; ch.push(niceDay(date, today)); }
          if (start != null) { it.start = start; ch.push(`ore ${fmtMin(start)}`); }
          if (op.unpin && it.kind === 'task') { it.start = null; ch.push('orario libero'); }
          if (op.duration_min != null) { it.duration = clampInt(op.duration_min, 5, 960); it.durationEstimated = !!op.duration_is_estimate; it.baseDuration = it.durationEstimated ? it.duration : null; ch.push(`${it.duration} min`); }
          if (op.end_time && it.start != null) { const e = parseHM(op.end_time); if (e > it.start) { it.duration = e - it.start; ch.push(`fino alle ${fmtMin(e)}`); } }
          if (op.priority != null) { it.priority = clampInt(op.priority, 1, 3); ch.push(['', 'priorità bassa', 'priorità media', 'priorità alta'][it.priority]); }
          if (op.deadline !== undefined && op.deadline !== null) { it.deadline = validDate(op.deadline); ch.push(`scadenza ${it.deadline || 'nessuna'}`); }
          if (op.earliest_date) it.earliest = validDate(op.earliest_date);
          if (op.window) { it.window = WINDOWS[op.window] ? op.window : null; if (it.window) ch.push(it.window === 'pomeriggio' ? 'il pomeriggio' : `la ${it.window}`); }
          if (op.energy != null) { it.energy = clampInt(op.energy, 1, 3); ch.push(['', 'leggera', 'media', 'pesante'][it.energy]); }
          if (op.kind && op.kind !== it.kind) { it.kind = op.kind === 'event' ? 'event' : 'task'; if (it.kind === 'event' && it.start == null) it.kind = 'task'; }
          if (op.depends_on) it.dependsOn = resolveDeps(op.depends_on);
          if (op.note) it.notes = op.note;
          if (op.color !== undefined) { it.color = cardColor(op.color); ch.push(it.color ? 'colore' : 'colore normale'); }
          if (op.theme && THEME_KEYS.includes(op.theme)) it.theme = op.theme;
          if (op.project) { it.project = projectId(state, op.project); it.goalId = goalOfProject(state, it.project)?.id || it.goalId || null; ch.push(projectOf(state, it.project)?.name || ''); }
          if (it.status === 'doing' && (date || start != null)) { it.status = 'todo'; it.startedAt = null; }
          it.updatedAt = now;
          log.push(`~ ${it.title}: ${ch.join(', ') || 'aggiornata'}`);
          break;
        }
        case 'start': {
          if (!it) { errors.push(`Non trovo «${op.id}»`); break; }
          it.status = 'doing'; it.startedAt = start != null ? atToday(now, start) : now; it.updatedAt = now;
          log.push(`▶ ${it.title} iniziata`);
          break;
        }
        case 'complete': {
          if (!it) { errors.push(`Non trovo «${op.id}»`); break; }
          let actual = clampInt(op.actual_min, 1, 960);
          if (!actual && it.startedAt) actual = Math.max(1, Math.round((now - it.startedAt) / 60000));
          it.status = 'done'; it.doneAt = now; it.actual = actual || null; it.updatedAt = now;
          logEvent(state, { type: 'done', id: it.id, project: it.project, at: now, start: it.startedAt ? minOf(it.startedAt) : minOf(now) - (actual || it.duration || 30) });
          log.push(`✓ ${it.title}${actual ? ` (${actual} min reali)` : ''}`);
          break;
        }
        case 'reopen': {
          if (!it) { errors.push(`Non trovo «${op.id}»`); break; }
          it.status = 'todo'; it.doneAt = null; it.startedAt = null; it.updatedAt = now;
          log.push(`↺ ${it.title} riaperta`);
          break;
        }
        case 'delete': {
          if (!it) { errors.push(`Non trovo «${op.id}»`); break; }
          if (it.kind === 'event') touchedFixed = true;
          state.items = state.items.filter((x) => x !== it);
          state.items.forEach((x) => { if (x.dependsOn) x.dependsOn = x.dependsOn.filter((d) => d !== it.id); });
          log.push(`− ${it.title} rimossa`);
          break;
        }
        case 'progress': {
          // lavoro fatto in parte: si ricorda quanto manca, non si riparte da zero
          if (!it) { errors.push(`Non trovo «${op.id}»`); break; }
          const mins = clampInt(op.actual_min, 1, 960) || (it.startedAt ? Math.max(1, Math.round((now - it.startedAt) / 60000)) : 0);
          it.spent = (it.spent || 0) + mins;
          it.status = 'todo'; it.startedAt = null; it.updatedAt = now;
          if (it.spent >= it.duration) {
            it.status = 'done'; it.doneAt = now; it.actual = it.spent;
            log.push(`✓ ${it.title} (${it.spent} min in tutto)`);
          } else log.push(`◐ ${it.title}: fatti ${it.spent} min, ne mancano ${it.duration - it.spent}`);
          (state.log ||= []).push({ type: 'progress', id: it.id, project: it.project, minutes: mins, at: now });
          break;
        }
        case 'skip': {
          // sessione saltata: resta da fare, ma il companion se ne ricorda
          if (!it) { errors.push(`Non trovo «${op.id}»`); break; }
          logEvent(state, { type: 'skip', id: it.id, project: it.project, at: now, start: start ?? null });
          log.push(`↷ ${it.title}: la rimetto più avanti`);
          break;
        }
        case 'set_goal': {
          if (!op.title) { errors.push('Obiettivo senza titolo'); break; }
          state.goals ||= [];
          const due = validDate(op.deadline) || dueFromText(op.note || op.title, today);
          const pid = op.project ? projectId(state, op.project) : null;
          let g = state.goals.find((x) => x.id === op.id || x.title.toLowerCase() === String(op.title).toLowerCase());
          if (g) { Object.assign(g, { title: op.title, due: due || g.due, projectId: pid || g.projectId, note: op.note || g.note }); log.push(`◎ Obiettivo aggiornato: ${g.title}`); }
          else { g = { id: 'g_' + uid(), title: String(op.title).slice(0, 120), due, projectId: pid, note: op.note || '', at: now, askedDue: false }; state.goals.push(g); log.push(`◎ Nuovo obiettivo: ${op.title}${due ? ' · entro ' + niceDay(due, today) : ''}`); }
          // la scadenza dell'obiettivo è anche quella del progetto; le attività del progetto si collegano all'obiettivo
          if (g.projectId) {
            const pr = projectOf(state, g.projectId);
            if (pr && g.due) pr.due = g.due;
            for (const it of state.items) if (it.project === g.projectId && !it.goalId) it.goalId = g.id;
          }
          break;
        }
        case 'plan_goal': {
          // obiettivo → sessioni concrete (dall'AI, già validate, oppure dal modello per categoria)
          const g = (state.goals || []).find((x) => x.id === op.id || x.title.toLowerCase() === String(op.title || '').toLowerCase());
          if (!g) { errors.push(`Obiettivo non trovato: ${op.title || op.id}`); break; }
          const pr = g.projectId ? projectOf(state, g.projectId) : null;
          const fromAi = op.sessions ? validatePlan({ sessions: op.sessions }) : null;
          const tpl = fromAi ? { sessions: fromAi } : sessionsFor(g, { today, project: pr?.name });
          if (tpl.habit) {
            if (!(state.habits || []).some((h) => h.goalId === g.id)) {
              (state.habits ||= []).push({ id: 'h_' + uid(), title: tpl.habit.title, perWeek: tpl.habit.perWeek, duration: tpl.habit.duration, project: g.projectId, goalId: g.id, window: null });
              log.push(`⟳ ${tpl.habit.title} ${tpl.habit.perWeek} volte a settimana`);
            }
            g.planned = true;
            break;
          }
          const existing = state.items.filter((x) => x.goalId === g.id && x.status !== 'done').length;
          const room = Math.max(0, MAX_SESSIONS - existing);
          const ids = {};
          let n = 0;
          for (const ses of tpl.sessions.slice(0, room)) {
            const dup = state.items.find((x) => x.goalId === g.id && x.status !== 'done' && x.title.toLowerCase() === ses.title.toLowerCase());
            if (dup) { ids[ses.key] = dup.id; continue; }
            const item = {
              id: uid(), title: ses.title, kind: 'task', date: null, start: null,
              duration: estimateFor(state, ses.title, g.projectId, ses.duration), baseDuration: ses.duration, durationEstimated: true,
              priority: ses.optional ? 1 : 2, deadline: validDate(ses.deadline) || g.due || null, earliest: null, window: null,
              energy: ses.energy || 2, status: 'todo', startedAt: null, doneAt: null, actual: null,
              dependsOn: (ses.after || []).map((k) => ids[k]).filter(Boolean), notes: '', project: g.projectId, goalId: g.id,
              optional: !!ses.optional, spent: 0, createdAt: now + n, updatedAt: now,
            };
            ids[ses.key] = item.id;
            state.items.push(item);
            n++;
          }
          g.planned = true;
          log.push(`◎ ${n} ${n === 1 ? 'sessione' : 'sessioni'} per «${g.title}»`);
          break;
        }
        case 'add_habit': {
          const per = clampInt(op.pref_value ?? op.per_week, 1, 7);
          if (!op.title || !per) { errors.push('Abitudine incompleta'); break; }
          state.habits ||= [];
          const pid = op.project ? projectId(state, op.project) : null;
          const h = state.habits.find((x) => x.title.toLowerCase() === String(op.title).toLowerCase());
          const dur = clampInt(op.duration_min, 10, 240) || 60;
          if (h) Object.assign(h, { perWeek: per, duration: dur });
          else state.habits.push({ id: 'h_' + uid(), title: String(op.title).slice(0, 60), perWeek: per, duration: dur, project: pid, goalId: pid ? goalOfProject(state, pid)?.id || null : null, window: WINDOWS[op.window] ? op.window : null });
          log.push(`⟳ ${op.title}: ${per === 7 ? 'ogni giorno' : `${per} volte a settimana`}`);
          break;
        }
        case 'remove_habit': {
          const h = (state.habits || []).find((x) => x.id === op.id || x.title.toLowerCase() === String(op.title || op.id || '').toLowerCase());
          if (!h) { errors.push('Abitudine non trovata'); break; }
          state.habits = state.habits.filter((x) => x !== h);
          state.items = state.items.filter((x) => !(x.habitId === h.id && x.status !== 'done'));
          log.push(`− ${h.title} (abitudine) rimossa`);
          break;
        }
        case 'remove_goal': {
          const before = (state.goals || []).length;
          state.goals = (state.goals || []).filter((g) => g.id !== op.id && g.title.toLowerCase() !== String(op.title || '').toLowerCase());
          if (state.goals.length < before) log.push('◎ Obiettivo rimosso');
          break;
        }
        case 'add_project': {
          if (!op.title) break;
          const had = (state.projects || []).length;
          const pid = projectId(state, op.title);
          if (state.projects.length > had) log.push(`▣ Nuovo progetto: ${projectOf(state, pid).name}`);
          break;
        }
        case 'set_availability': {
          // "stasera ho 2 ore", "domani sono libero dalle 15"
          const d = date || today;
          const st = parseHM(op.start_time), en = parseHM(op.end_time);
          state.prefs.availability ||= {};
          if (st == null && en == null) { delete state.prefs.availability[d]; log.push(`◷ ${niceDay(d, today)}: orari normali`); break; }
          state.prefs.availability[d] = { start: st, end: en };
          log.push(`◷ ${niceDay(d, today)}: disponibile${st != null ? ' dalle ' + fmtMin(st) : ''}${en != null ? ' fino alle ' + fmtMin(en) : ''}`);
          break;
        }
        case 'remember': {
          if (!op.note) break;
          if (state.memory.some((m) => m.text.toLowerCase() === String(op.note).toLowerCase())) break;
          state.memory.push({ id: uid(), text: String(op.note).slice(0, 200), at: now, category: ['vincolo', 'preferenza', 'obiettivo', 'nota'].includes(op.category) ? op.category : 'nota' });
          log.push(`☆ Ricorderò: ${op.note}`);
          break;
        }
        case 'forget': {
          const before = state.memory.length;
          state.memory = state.memory.filter((m) => m.id !== op.id);
          if (state.memory.length < before) log.push('☆ Nota rimossa dalla memoria');
          break;
        }
        case 'set_pref': {
          const k = op.pref_key, v = op.pref_value;
          const P = state.prefs;
          if (k === 'day_start' && parseHM(v) != null) P.dayStart = parseHM(v);
          else if (k === 'day_end' && parseHM(v) != null) P.dayEnd = Math.min(parseHM(v), 24 * 60);
          else if (k === 'buffer_min' && !isNaN(+v)) P.buffer = clampInt(v, 0, 60);
          else if (k === 'slack_percent' && !isNaN(+v)) P.slack = clampInt(v, 0, 50) / 100;
          else if (k === 'focus_window') P.focusWindow = WINDOWS[v] ? v : null;
          else if (k === 'max_block_min' && !isNaN(+v)) P.maxBlock = clampInt(v, 20, 600);
          else if (k === 'decompress_min' && !isNaN(+v)) P.decompress = clampInt(v, 0, 120);
          else if (k === 'off_days') P.offDays = parseWeekdays(v).sort();
          else if (k === 'free_days') { const f = parseWeekdays(v); P.freeDays = [...new Set([...(P.freeDays || []), ...f])]; P.offDays = (P.offDays || []).filter((d) => !f.includes(d)); }
          else { errors.push(`Preferenza non valida: ${k}`); break; }
          log.push(`⚙ ${prefLabel(k)}: ${v}`);
          break;
        }
        case 'add_recurring': {
          const e = parseHM(op.end_time);
          const days = (op.weekdays || []).filter((d) => d >= 0 && d <= 6);
          if (!op.title || start == null || e == null || e <= start || !days.length) { errors.push('Impegno ricorrente incompleto'); break; }
          state.recurring.push({ id: uid(), title: op.title, start, end: e, weekdays: days, skip: [] });
          log.push(`⟳ ${op.title} ${fmtMin(start)}–${fmtMin(e)} (${days.map((d) => 'DLMMGVS'[d]).join('')})`);
          break;
        }
        case 'update_recurring': {
          const r = state.recurring.find((x) => x.id === op.id);
          if (!r) { errors.push('Impegno ricorrente non trovato'); break; }
          touchedFixed = true;
          const e = parseHM(op.end_time);
          const days = Array.isArray(op.weekdays) ? op.weekdays.filter((d) => d >= 0 && d <= 6) : null;
          if (op.title) r.title = String(op.title).slice(0, 80);
          if (start != null) r.start = start;
          if (e != null) r.end = e;
          if (r.end <= r.start) r.end = Math.min(24 * 60 - 1, r.start + 60);
          if (days && days.length) r.weekdays = [...new Set(days)].sort();
          if (op.color !== undefined) r.color = cardColor(op.color);
          log.push(`⟳ ${r.title} ${fmtMin(r.start)}–${fmtMin(r.end)} (${r.weekdays.map((d) => 'DLMMGVS'[d]).join('')})`);
          break;
        }
        case 'remove_recurring': {
          const r = state.recurring.find((x) => x.id === op.id || x.title.toLowerCase() === String(op.id || op.title || '').toLowerCase());
          if (!r) { errors.push('Impegno ricorrente non trovato'); break; }
          touchedFixed = true;
          if (date) { r.skip = [...(r.skip || []), date]; log.push(`− ${r.title} saltato il ${date}`); }
          else { state.recurring = state.recurring.filter((x) => x !== r); log.push(`− ${r.title} (ricorrente) rimosso`); }
          break;
        }
        default:
          errors.push(`Azione sconosciuta: ${op.action}`);
      }
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  if ((state.habits || []).length || state.items.some((x) => x.habitId)) refreshHabits(state, today);
  if ((ops || []).some((o) => ['complete', 'progress', 'add', 'plan_goal', 'update'].includes(o.action))) updateDurations(state);
  return { log, errors, touchedFixed };
}

const minOf = (ts) => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); };
function logEvent(state, e) {
  state.log ||= [];
  state.log.push(e);
  if (state.log.length > 400) state.log = state.log.slice(-400);
}

/** Stima di durata corretta da ciò che il companion ha imparato (vedi learn.js). */
const estimateFor = (state, title, project, minutes) => estimate(state, title, project, minutes);

/**
 * Le abitudini diventano sessioni vere nelle prossime 4 settimane:
 * N a settimana (lunedì–domenica), sparse, una al giorno al massimo, mai nei giorni di stacco.
 * Le sessioni passate non fatte vengono tolte e annotate come saltate.
 */
export function refreshHabits(state, today) {
  const offOn = (d) => isOffDay(state.prefs, d);
  const habits = state.habits || [];
  const live = new Set(habits.map((h) => h.id));
  state.items = state.items.filter((x) => {
    if (!x.habitId || x.status === 'done') return true;
    if (!live.has(x.habitId)) return false;
    // segnata come saltata dall'app, non da te (auto): non conta per le statistiche su giorni e fasce
    if (x.date < today) { logEvent(state, { type: 'skip', id: x.id, project: x.project, at: Date.parse(x.date + 'T21:00'), habit: x.habitId, auto: true }); return false; }
    return !offOn(x.date); // un giorno appena diventato di stacco libera la sessione
  });
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  for (const h of habits) {
    for (let w = 0; w < 4; w++) {
      const days = Array.from({ length: 7 }, (_, i) => addDays(monday, w * 7 + i));
      const mine = state.items.filter((x) => x.habitId === h.id && days.includes(x.date) && (x.status !== 'done' || true));
      const doneIn = state.items.filter((x) => x.habitId === h.id && x.status === 'done' && x.doneAt && days.includes(dateKey(new Date(x.doneAt))) && !days.includes(x.date)).length;
      let need = h.perWeek - mine.length - doneIn;
      if (need <= 0) continue;
      const taken = new Set(mine.map((x) => x.date));
      const free = days.filter((d) => d >= today && !offOn(d) && !taken.has(d));
      need = Math.min(need, free.length);
      for (let i = 0; i < need; i++) {
        const d = free[Math.floor(((i + 0.5) * free.length) / need)];
        state.items.push({
          id: uid(), title: h.title, kind: 'task', date: d, start: null, duration: h.duration, durationEstimated: false,
          priority: 2, deadline: null, earliest: null, window: h.window || null, energy: 2, status: 'todo', startedAt: null,
          doneAt: null, actual: null, dependsOn: [], notes: '', project: h.project || null, goalId: h.goalId || null,
          habitId: h.id, spent: 0, createdAt: Date.parse(d + 'T00:00'), updatedAt: Date.parse(d + 'T00:00'),
        });
      }
    }
  }
}

// ---- Validazione di ciò che arriva dall'AI: tipi, formati, azioni ammesse
const ACTIONS = ['add', 'update', 'move', 'start', 'complete', 'reopen', 'delete', 'progress', 'skip', 'remember', 'forget', 'set_pref',
  'add_recurring', 'update_recurring', 'remove_recurring', 'set_goal', 'remove_goal', 'plan_goal', 'add_project', 'set_availability', 'add_habit', 'remove_habit'];
const FIELD = {
  id: 'str', title: 'str', kind: ['task', 'event'], date: 'date', start_time: 'time', end_time: 'time', duration_min: 'int', duration_is_estimate: 'bool',
  priority: 'int', deadline: 'date', earliest_date: 'date', window: ['mattina', 'pomeriggio', 'sera'], energy: 'int', depends_on: 'strs', actual_min: 'int',
  note: 'str', project: 'str', color: ['rose', 'lilac', 'sage', 'sand', 'sky'], theme: THEME_KEYS, category: ['vincolo', 'preferenza', 'obiettivo', 'nota'], pref_key: 'str', pref_value: 'str', weekdays: 'ints', unpin: 'bool', sessions: 'sessions',
};
/** Tiene solo operazioni e campi validi; restituisce { ops, dropped }. */
export function sanitizeOps(raw) {
  const ops = [];
  let dropped = 0;
  for (const o of Array.isArray(raw) ? raw.slice(0, 40) : []) {
    if (!o || typeof o !== 'object' || !ACTIONS.includes(o.action)) { dropped++; continue; }
    const out = { action: o.action };
    for (const [k, t] of Object.entries(FIELD)) {
      const v = o[k];
      if (v == null) continue;
      if (Array.isArray(t)) { if (t.includes(v)) out[k] = v; }
      else if (t === 'str') { if (typeof v === 'string' || typeof v === 'number') out[k] = String(v).slice(0, 200); }
      else if (t === 'int') { if (Number.isFinite(+v)) out[k] = Math.round(+v); }
      else if (t === 'bool') out[k] = !!v;
      else if (t === 'date') { if (validDate(v)) out[k] = v; }
      else if (t === 'time') { if (parseHM(v) != null) out[k] = String(v); }
      else if (t === 'strs') { if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string').slice(0, 10); }
      else if (t === 'ints') { if (Array.isArray(v)) out[k] = v.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6); }
      else if (t === 'sessions') { const p = validatePlan({ sessions: v }); if (p) out[k] = p; }
    }
    if (['update', 'move', 'start', 'complete', 'reopen', 'delete', 'progress', 'skip'].includes(o.action) && !out.id) { dropped++; continue; }
    ops.push(out);
  }
  return { ops, dropped };
}

function niceDay(date, today) {
  if (date === today) return 'oggi';
  if (date === addDays(today, 1)) return 'domani';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' });
}

function atToday(now, min) {
  const d = new Date(now);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.getTime();
}

const WD_NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
/** "0,6" oppure "sabato e domenica" → [6, 0] */
export function parseWeekdays(v) {
  const t = String(v ?? '').toLowerCase();
  const out = new Set(weekdaysIn(t));
  for (const m of t.matchAll(/\d/g)) if (+m[0] <= 6) out.add(+m[0]);
  return [...out];
}

export const prefLabel = (k) => ({
  day_start: 'Inizio giornata', day_end: 'Fine giornata', buffer_min: 'Pausa tra attività',
  slack_percent: 'Margine per imprevisti', focus_window: 'Fascia di concentrazione',
  max_block_min: 'Sessione massima (min)', free_days: 'Giorni liberi per i progetti', decompress_min: 'Decompressione dopo il lavoro (min)', off_days: 'Giorni di riposo',
}[k] || k);

/** Statistiche semplici per capire se l'app funziona. */
export function computeStats(state) {
  const tasks = state.items.filter((x) => x.kind === 'task');
  const done = tasks.filter((x) => x.status === 'done');
  const arch = state.stats?.archived || { tasks: 0, done: 0 };
  const withActual = done.filter((x) => x.actual && x.duration);
  const ratio = withActual.length ? withActual.reduce((s, x) => s + x.actual / x.duration, 0) / withActual.length : null;
  const replans = Object.values(state.stats.replans || {});
  return {
    total: tasks.length + arch.tasks,
    done: done.length + arch.done,
    pct: tasks.length + arch.tasks ? Math.round(((done.length + arch.done) / (tasks.length + arch.tasks)) * 100) : 0,
    ratio,
    samples: withActual.length,
    replansPerDay: replans.length ? (replans.reduce((a, b) => a + b, 0) / replans.length).toFixed(1) : '0',
  };
}
