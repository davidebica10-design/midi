// Motore di pianificazione deterministico.
// Riceve attività strutturate e decide dove collocarle. Non usa l'AI:
// stesso input → stesso output.

export const WINDOWS = {
  mattina: [6 * 60, 12 * 60],
  pomeriggio: [12 * 60, 18 * 60],
  sera: [18 * 60, 24 * 60],
};

export const pad = (n) => String(n).padStart(2, '0');
export const fmtMin = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
export const parseHM = (s) => {
  if (s == null || s === '') return null;
  const m = String(s).match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const h = +m[1], mi = +(m[2] || 0);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
};
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n));
};
export const daysBetween = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 864e5);
};
export const weekday = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0 = domenica
};
const minOfTs = (ts) => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); };
const ceil5 = (m) => Math.ceil(m / 5) * 5;

export const DEFAULT_PREFS = {
  dayStart: 8 * 60,
  dayEnd: 23 * 60,
  buffer: 15,        // pausa tra un blocco e l'altro
  slack: 0.15,       // quota di tempo libero da NON riempire
  focusWindow: null, // 'mattina' | 'pomeriggio' | 'sera'
  heavyRest: 0,      // pausa extra tra due attività pesanti
  maxBlock: 120,     // sessione più lunga di fila: oltre, il resto va al giorno dopo
  offDays: [],       // giorni di riposo (0 = domenica): niente attività flessibili
  decompress: 45,    // minuti di "cena / decompressione" dopo una lunga giornata di lavoro
  availability: {},  // finestre speciali per giorno: { 'YYYY-MM-DD': { start, end } }
  projectDue: {},    // progetto → scadenza dell'obiettivo collegato
  freeDays: [],      // giorni interamente liberi per i progetti
  projectDayCap: null, // minuti massimi dello stesso progetto in un giorno (null = una sessione, due nei giorni liberi)
};
const remaining = (t) => Math.max(5, (t.duration || 30) - (t.spent || 0));

// Sottrae intervalli occupati da un intervallo [a,b]
function subtract(gaps, busy) {
  let out = gaps;
  for (const [bs, be] of busy) {
    const next = [];
    for (const [gs, ge] of out) {
      if (be <= gs || bs >= ge) { next.push([gs, ge]); continue; }
      if (bs > gs) next.push([gs, bs]);
      if (be < ge) next.push([be, ge]);
    }
    out = next;
  }
  return out.filter(([a, b]) => b - a >= 5);
}

let prefsRef = {};
function score(t, day) {
  let s = (t.priority || 2) * 100;
  if (t.deadline) {
    const d = daysBetween(day, t.deadline);
    s += d <= 0 ? 300 : d === 1 ? 200 : d === 2 ? 120 : d <= 7 ? 50 : 0;
  }
  if (t.date === day) s += 30;
  if (t.date && t.date < day) s += 60; // in ritardo
  if (t.spent > 0) s += 50; // finire ciò che è iniziato prima di aprire altro
  if (t.project && prefsRef.projectDue?.[t.project]) {
    const d = daysBetween(day, prefsRef.projectDue[t.project]);
    s += d <= 7 ? 60 : d <= 21 ? 30 : 10; // obiettivi vicini contano di più
  }
  return s;
}

function windowOrder(t, prefs) {
  const order = [];
  if (t.window && WINDOWS[t.window]) order.push(WINDOWS[t.window]);
  // lavoro pesante e lavoro sui progetti: nella fascia in cui rendi di più
  else if (((t.energy || 2) >= 3 || t.project) && prefs.focusWindow && WINDOWS[prefs.focusWindow]) order.push(WINDOWS[prefs.focusWindow]);
  order.push([0, 24 * 60]);
  return order;
}

// Eventi virtuali dagli impegni ricorrenti
export function recurringFor(day, recurring = []) {
  const wd = weekday(day);
  return recurring
    .filter((r) => (r.weekdays || []).includes(wd) && !(r.skip || []).includes(day))
    .map((r) => ({
      id: `rec:${r.id}:${day}`, recId: r.id, title: r.title, kind: 'event', date: day,
      start: r.start, duration: r.end - r.start, priority: 2, energy: 2, status: 'todo', recurring: true,
    }));
}

/**
 * Pianifica una singola giornata.
 * pool: attività senza data (o in ritardo) ancora da collocare; viene consumato.
 */
export function planDay(day, items, prefs, now, pool, recurring, anchors = {}) {
  const P = { ...DEFAULT_PREFS, ...prefs };
  prefsRef = P;
  const win = (P.availability || {})[day];
  const dayStart = win?.start ?? P.dayStart, dayEnd = win?.end ?? P.dayEnd;
  const today = dateKey(new Date(now));
  const isToday = day === today;
  const nowMin = minOfTs(now);
  const blocks = [];
  const conflicts = [];
  const unscheduled = [];
  const missed = [];

  // 1. Blocchi completati (storico della giornata)
  for (const it of items) {
    if (it.status !== 'done' || !it.doneAt) continue;
    if (dateKey(new Date(it.doneAt)) !== day) continue;
    const end = minOfTs(it.doneAt);
    const dur = it.actual || it.duration || 30;
    blocks.push({ id: it.id, item: it, start: Math.max(0, end - dur), end, type: 'done' });
  }

  // 2. Impegni fissi + attività fissate a un orario + attività in corso
  const fixed = [];
  for (const it of [...items, ...recurringFor(day, recurring)]) {
    if (it.status === 'done') continue;
    if (it.status === 'doing' && it.startedAt && isToday) {
      const s = minOfTs(it.startedAt);
      fixed.push({ id: it.id, item: it, start: s, end: Math.max(s + remaining(it), ceil5(nowMin + 5)), type: 'doing' });
      continue;
    }
    const a = anchors[it.id];
    if (isToday && a && a.day === day && it.kind === 'task' && it.start == null) {
      if (a.start <= nowMin && nowMin < a.end) {
        // iniziata secondo il piano: si presume in corso, resta dov'è
        fixed.push({ id: it.id, item: it, start: a.start, end: a.end, type: 'current' });
        continue;
      }
      if (a.end <= nowMin) missed.push({ item: it, start: a.start, end: a.end });
    }
    if (it.date !== day || it.start == null) continue;
    fixed.push({ id: it.id, item: it, start: it.start, end: it.start + (it.duration || 30), type: it.kind === 'event' ? 'event' : 'pinned' });
  }
  fixed.sort((a, b) => a.start - b.start);
  for (let i = 0; i < fixed.length; i++)
    for (let j = i + 1; j < fixed.length; j++)
      if (fixed[j].start < fixed[i].end) conflicts.push([fixed[i].id, fixed[j].id]);
  // dopo una lunga giornata di lavoro: cena / decompressione prima di ripartire
  const work = fixed.find((b) => b.item.kind === 'event' && b.end - b.start >= 240 && b.end >= 15 * 60 && b.end <= 21 * 60);
  if (P.decompress > 0 && work && !win?.start && work.end + P.decompress + 30 < dayEnd && (!isToday || nowMin < work.end + P.decompress)
    && !fixed.some((b) => b !== work && b.start < work.end + P.decompress && b.end > work.end)) {
    fixed.push({ id: 'rest:' + day, item: { id: 'rest:' + day, title: 'Cena / decompressione', kind: 'rest', energy: 1, priority: 2, duration: P.decompress }, start: work.end, end: work.end + P.decompress, type: 'rest' });
  }
  blocks.push(...fixed);

  // 3. Spazi liberi
  const from = isToday ? Math.max(dayStart, ceil5(nowMin)) : dayStart;
  const busy = fixed.map((b) => (b.type === 'rest' ? [b.start, b.end] : [b.start - P.buffer, b.end + P.buffer]));
  let gaps = from < dayEnd ? subtract([[from, dayEnd]], busy) : [];
  const totalFree = gaps.reduce((s, [a, b]) => s + b - a, 0);
  // se hai detto tu quanto tempo hai, si usa tutto; altrimenti resta un margine per gli imprevisti
  let budget = Math.round(totalFree * (1 - (win ? 0 : P.slack)));
  let reserve = totalFree - budget; // usabile solo da attività ad alta priorità

  // 4. Candidati
  const fixedIds = new Set(fixed.map((b) => b.id));
  for (const id of fixedIds) { const i = pool.findIndex((p) => p.id === id); if (i >= 0) pool.splice(i, 1); }
  const dated = items.filter((t) => t.kind === 'task' && t.status !== 'done' && t.status !== 'doing' && t.start == null && t.date === day && !fixedIds.has(t.id));
  if (day < today) {
    // giornate passate: nessuna pianificazione
    return { day, blocks: blocks.sort((a, b) => a.start - b.start), conflicts, unscheduled: [], deferred: [], missed: [], gaps: [], free: 0, totalFree: 0 };
  }
  const off = (P.offDays || []).includes(weekday(day));
  const fromPool = off ? [] : pool.filter((t) => !t.earliest || t.earliest <= day);
  const cands = [...dated, ...fromPool].sort((a, b) => score(b, day) - score(a, day) || (a.createdAt || 0) - (b.createdAt || 0));

  const placedEnd = new Map(); // id → fine, per le dipendenze
  const placedBefore = (pool.placed ||= new Set()); // attività già messe nei giorni precedenti
  for (const b of blocks) placedEnd.set(b.id, b.end);
  const placedFlex = [];
  const used = new Set();
  // un progetto non si mangia la giornata: una sessione al giorno, due quando la giornata è libera
  const fullDay = !fixed.some((b) => b.item.kind === 'event' && b.end - b.start >= 240) || (P.freeDays || []).includes(weekday(day));
  const projCap = P.projectDayCap || (fullDay ? 2 : 1) * Math.max(60, P.maxBlock || 120);
  const projUsed = {};

  for (const t of cands) {
    let dur = remaining(t);
    // niente sessioni troppo lunghe: il resto continua il giorno dopo
    let left = 0;
    if (P.maxBlock > 0 && dur > P.maxBlock) { left = dur - P.maxBlock; dur = P.maxBlock; }
    const heavy = (t.energy || 2) >= 3;
    if (t.project && !t.date && (projUsed[t.project] || 0) + dur > projCap) continue; // resta nel pool: domani
    // dipendenze
    let minStart = 0;
    let blockedBy = null;
    for (const depId of t.dependsOn || []) {
      const dep = items.find((x) => x.id === depId);
      if (!dep || dep.status === 'done') continue;
      if (placedEnd.has(depId)) minStart = Math.max(minStart, placedEnd.get(depId) + P.buffer);
      else if (!placedBefore.has(depId)) { blockedBy = dep; break; }
    }
    if (blockedBy) { unscheduled.push({ item: t, reason: `dipende da «${blockedBy.title}»` }); continue; }

    const highPrio = (t.priority || 2) >= 3;
    if (dur > budget + (highPrio ? reserve : 0)) {
      unscheduled.push({ item: t, reason: 'non c\'è abbastanza tempo realistico' });
      continue;
    }

    let slot = null;
    for (const [ws, we] of windowOrder(t, P)) {
      for (let gi = 0; gi < gaps.length && !slot; gi++) {
        const [gs, ge] = gaps[gi];
        let s = Math.max(gs, ws, minStart);
        // evita due attività pesanti consecutive
        if (heavy) {
          const prev = placedFlex.find((p) => p.end + P.buffer >= s - 1 && p.end <= s && (p.item.energy || 2) >= 3);
          const prevFixed = fixed.find((p) => p.end + P.buffer >= s - 1 && p.end <= s && (p.item.energy || 2) >= 3);
          if (prev || prevFixed) s += P.heavyRest;
        }
        s = ceil5(s);
        if (s + dur <= Math.min(ge, we)) slot = { gi, s };
      }
      if (slot) break;
    }
    if (!slot) {
      unscheduled.push({ item: t, reason: `nessuno spazio libero da ${dur} min` });
      continue;
    }
    const [gs, ge] = gaps[slot.gi];
    const end = slot.s + dur;
    const rest = [];
    if (slot.s - gs >= 5) rest.push([gs, slot.s]);
    if (ge - (end + P.buffer) >= 5) rest.push([end + P.buffer, ge]);
    gaps.splice(slot.gi, 1, ...rest);
    const consumed = Math.min(ge, end + P.buffer) - slot.s;
    if (consumed <= budget) budget -= consumed;
    else { reserve -= consumed - budget; budget = 0; }
    if (left > 0) {
      const i = pool.indexOf(t);
      const cont = { ...t, spent: (t.spent || 0) + dur, earliest: addDays(day, 1), date: null };
      if (i >= 0) pool.splice(i, 1, cont); else pool.push(cont);
    }
    if (t.project) projUsed[t.project] = (projUsed[t.project] || 0) + dur;
    const b = { id: t.id, item: t, start: slot.s, end, type: 'flex', part: left > 0 ? left : 0, carried: !!(t.date && t.date < day) || (!t.date && day !== today && pool.includes(t)) };
    blocks.push(b);
    placedFlex.push(b);
    placedEnd.set(t.id, end);
    if (!left) placedBefore.add(t.id);
    used.add(t.id);
  }

  // Le attività del pool non collocate passano al giorno dopo
  const overflow = unscheduled.filter((u) => pool.includes(u.item)).map((u) => u.item);
  for (const t of used) {
    const i = pool.findIndex((p) => p.id === t && !(p.earliest > day));
    if (i >= 0) pool.splice(i, 1);
  }
  const unsched = unscheduled.filter((u) => !pool.includes(u.item));

  // segnala attività con deadline a rischio
  for (const u of unscheduled) if (u.item.deadline && u.item.deadline <= day) u.atRisk = true;

  const free = gaps.reduce((s, [a, b]) => s + b - a, 0);
  return {
    day,
    blocks: blocks.sort((a, b) => a.start - b.start),
    conflicts,
    unscheduled: unsched,
    deferred: overflow,
    missed,
    free,
    gaps,
    totalFree,
  };
}

/** Pianifica più giorni a partire da oggi; le attività senza data scorrono in avanti. */
export function planDays(state, now = Date.now(), nDays = 7) {
  const today = dateKey(new Date(now));
  const items = state.items || [];
  const pool = items.filter((t) => t.kind === 'task' && t.status === 'todo' && t.start == null && (!t.date || t.date < today));
  // le attività in ritardo vengono pianificate da oggi
  const days = {};
  // scadenze degli obiettivi per progetto: i progetti vicini al traguardo vengono prima
  const projectDue = {};
  for (const g of state.goals || []) if (g.projectId && g.due && (!projectDue[g.projectId] || g.due < projectDue[g.projectId])) projectDue[g.projectId] = g.due;
  const prefs = { ...state.prefs, projectDue };
  for (let i = 0; i < nDays; i++) {
    const day = addDays(today, i);
    days[day] = planDay(day, items, prefs, now, pool, state.recurring, state.anchors || {});
  }
  // ciò che non entra in nessun giorno
  const lastDay = addDays(today, nDays - 1);
  if (pool.length) days[lastDay].unscheduled.push(...pool.map((item) => ({ item, reason: 'non entra nei prossimi giorni' })));
  return days;
}

/** Posizione (giorno + orario) di ogni attività, per mostrare cosa è cambiato. */
export function positions(plan) {
  const map = new Map();
  for (const [day, p] of Object.entries(plan)) {
    for (const b of p.blocks) if (b.type !== 'done' && !/^(rec|rest):/.test(String(b.id)) && !map.has(b.id)) map.set(b.id, { day, start: b.start });
    for (const u of p.unscheduled) if (!map.has(u.item.id)) map.set(u.item.id, { day: null, start: null });
  }
  return map;
}

/** Elenco leggibile dei blocchi spostati tra due piani. */
export function diffPlans(before, after, itemsBefore, itemsAfter, today) {
  const a = positions(before), b = positions(after);
  const out = [];
  const name = (id) => (itemsAfter.find((x) => x.id === id) || itemsBefore.find((x) => x.id === id) || {}).title || '?';
  const where = (p) => !p || !p.day ? 'non pianificata' : `${dayLabel(p.day, today)} ${fmtMin(p.start)}`;
  for (const [id, pb] of b) {
    const pa = a.get(id);
    if (!itemsBefore.find((x) => x.id === id)) continue; // nuove: già nel log
    if (!pa || pa.day !== pb.day || pa.start !== pb.start) {
      if (pa && pa.day === null && pb.day === null) continue;
      out.push(`${name(id)}: ${where(pa)} → ${where(pb)}`);
    }
  }
  return out;
}

export function dayLabel(day, today) {
  const d = daysBetween(today, day);
  if (d === 0) return 'oggi';
  if (d === 1) return 'domani';
  if (d === -1) return 'ieri';
  const [y, m, dd] = day.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' });
}

/** Memorizza dove sono pianificate le attività future di oggi, così quando inizia il loro orario restano ferme. */
export function updateAnchors(state, plan, now) {
  const today = dateKey(new Date(now));
  const d = new Date(now);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const anchors = {};
  for (const [id, a] of Object.entries(state.anchors || {})) {
    const it = state.items.find((x) => x.id === id);
    if (a.day === today && it && it.status === 'todo' && a.start <= nowMin) anchors[id] = a;
  }
  for (const b of plan[today]?.blocks || []) {
    const old = anchors[b.id];
    if (old && old.end <= nowMin) continue; // in attesa di conferma: resta finché l'utente non risponde
    if (b.type === 'flex' && b.start > nowMin) anchors[b.id] = { day: today, start: b.start, end: b.end };
  }
  state.anchors = anchors;
}
