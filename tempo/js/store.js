// Stato, persistenza locale, annullamento e applicazione delle modifiche strutturate.
// Qui vengono validati orari, durate e vincoli: l'AI propone, il codice decide.
import { DEFAULT_PREFS, parseHM, fmtMin, dateKey, addDays, WINDOWS } from './scheduler.js';

const KEY = 'tempo.v1';
const UNDO_KEY = 'tempo.undo.v1';

export const uid = () => Math.random().toString(36).slice(2, 8);

export function emptyState() {
  return {
    items: [],
    prefs: { ...DEFAULT_PREFS },
    recurring: [],
    memory: [],
    goals: [],      // obiettivi: { id, title, due, projectId, note }
    projects: [],   // progetti: { id, name, color }
    log: [],        // cosa è successo: sessioni saltate, completate…
    onboarded: false,
    anchors: {},
    chat: [],
    settings: { apiKey: '', model: 'claude-opus-5-5', name: '' },
    stats: { replans: {}, createdAt: Date.now() },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    const e = emptyState();
    // chi usava già l'app ha già un contesto: niente presentazione iniziale
    if (s.onboarded === undefined) s.onboarded = (s.items || []).length > 0;
    return { ...e, ...s, prefs: { ...e.prefs, ...s.prefs }, settings: { ...e.settings, ...s.settings }, stats: { ...e.stats, ...s.stats } };
  } catch {
    return emptyState();
  }
}

export function save(state) {
  try {
    if (state.chat.length > 200) state.chat = state.chat.slice(-200);
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) { console.warn('save failed', e); }
}

// ---- Annulla ----
let undo = [];
try { undo = JSON.parse(localStorage.getItem(UNDO_KEY) || '[]'); } catch { undo = []; }
const persistUndo = () => { try { localStorage.setItem(UNDO_KEY, JSON.stringify(undo.slice(-30))); } catch {} };

const snapshotOf = (s) => JSON.stringify({ items: s.items, prefs: s.prefs, recurring: s.recurring, memory: s.memory, anchors: s.anchors, goals: s.goals, projects: s.projects });

export function pushUndo(state, label) {
  const id = uid();
  undo.push({ id, label, at: Date.now(), snap: snapshotOf(state) });
  undo = undo.slice(-30);
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

/** "tra 6 settimane", "tra 2 mesi", "entro 3 settimane" → data. */
export function dueFromText(text, today) {
  const NUMS = { una: 1, un: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, dodici: 12 };
  const m = String(text || '').toLowerCase().match(/(?:tra|fra|entro)\s+(\d+|una|un|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|dodici)\s+(giorn|settiman|mes)/);
  if (!m) return null;
  const n = +m[1] || NUMS[m[1]] || 1;
  return addDays(today, m[2] === 'giorn' ? n : m[2] === 'settiman' ? n * 7 : n * 30);
}

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
            spent: 0,
            createdAt: now, updatedAt: now,
          };
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
          if (op.duration_min != null) { it.duration = clampInt(op.duration_min, 5, 960); it.durationEstimated = !!op.duration_is_estimate; ch.push(`${it.duration} min`); }
          if (op.end_time && it.start != null) { const e = parseHM(op.end_time); if (e > it.start) { it.duration = e - it.start; ch.push(`fino alle ${fmtMin(e)}`); } }
          if (op.priority != null) { it.priority = clampInt(op.priority, 1, 3); ch.push(['', 'priorità bassa', 'priorità media', 'priorità alta'][it.priority]); }
          if (op.deadline !== undefined && op.deadline !== null) { it.deadline = validDate(op.deadline); ch.push(`scadenza ${it.deadline || 'nessuna'}`); }
          if (op.earliest_date) it.earliest = validDate(op.earliest_date);
          if (op.window) it.window = WINDOWS[op.window] ? op.window : null;
          if (op.energy != null) { it.energy = clampInt(op.energy, 1, 3); ch.push(['', 'leggera', 'media', 'pesante'][it.energy]); }
          if (op.kind && op.kind !== it.kind) { it.kind = op.kind === 'event' ? 'event' : 'task'; if (it.kind === 'event' && it.start == null) it.kind = 'task'; }
          if (op.depends_on) it.dependsOn = resolveDeps(op.depends_on);
          if (op.note) it.notes = op.note;
          if (op.project) { it.project = projectId(state, op.project); ch.push(projectOf(state, it.project)?.name || ''); }
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
          state.log ||= [];
          state.log.push({ type: 'skip', id: it.id, project: it.project, at: now });
          if (state.log.length > 300) state.log = state.log.slice(-300);
          log.push(`↷ ${it.title}: la rimetto più avanti`);
          break;
        }
        case 'set_goal': {
          if (!op.title) { errors.push('Obiettivo senza titolo'); break; }
          state.goals ||= [];
          const due = validDate(op.deadline) || dueFromText(op.note || op.title, today);
          const pid = op.project ? projectId(state, op.project) : null;
          const g = state.goals.find((x) => x.id === op.id || x.title.toLowerCase() === String(op.title).toLowerCase());
          if (g) { Object.assign(g, { title: op.title, due: due || g.due, projectId: pid || g.projectId, note: op.note || g.note }); log.push(`◎ Obiettivo aggiornato: ${g.title}`); }
          else { state.goals.push({ id: 'g_' + uid(), title: String(op.title).slice(0, 120), due, projectId: pid, note: op.note || '', at: now }); log.push(`◎ Nuovo obiettivo: ${op.title}${due ? ' · entro ' + niceDay(due, today) : ''}`); }
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
          else if (k === 'off_days') P.offDays = parseWeekdays(v);
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
  return { log, errors, touchedFixed };
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
  const out = new Set();
  for (const m of t.matchAll(/\d/g)) if (+m[0] <= 6) out.add(+m[0]);
  WD_NAMES.forEach((n, i) => { if (t.includes(n.slice(0, 3))) out.add(i); });
  return [...out];
}

export const prefLabel = (k) => ({
  day_start: 'Inizio giornata', day_end: 'Fine giornata', buffer_min: 'Pausa tra attività',
  slack_percent: 'Margine per imprevisti', focus_window: 'Fascia di concentrazione',
  max_block_min: 'Sessione massima (min)', decompress_min: 'Decompressione dopo il lavoro (min)', off_days: 'Giorni di riposo',
}[k] || k);

/** Statistiche semplici per capire se l'app funziona. */
export function computeStats(state) {
  const tasks = state.items.filter((x) => x.kind === 'task');
  const done = tasks.filter((x) => x.status === 'done');
  const withActual = done.filter((x) => x.actual && x.duration);
  const ratio = withActual.length ? withActual.reduce((s, x) => s + x.actual / x.duration, 0) / withActual.length : null;
  const replans = Object.values(state.stats.replans || {});
  return {
    total: tasks.length,
    done: done.length,
    pct: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
    ratio,
    samples: withActual.length,
    replansPerDay: replans.length ? (replans.reduce((a, b) => a + b, 0) / replans.length).toFixed(1) : '0',
  };
}
