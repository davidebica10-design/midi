// Un utente finto usa Tempo per molti giorni: apre l'app, fa una parte delle sessioni,
// risponde al companion. Deterministico: stesso seme, stessi risultati.
process.env.TZ = 'Europe/Rome';
import { applyOps, archiveCandidates, applyArchive } from '../js/store.js';
import { planDays, updateAnchors, addDays, weekday } from '../js/scheduler.js';
import * as goals from '../js/goals.js'; // goals.trackLate, goals.goalFit, goals.horizonFor
import { briefing, pickObservations, answerObservation } from '../js/companion.js';
import { learnedObservations } from '../js/learn.js';

/** Numeri pseudo-casuali ripetibili. */
export function rng(seed = 1) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
export const at = (day, min) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, Math.floor(min / 60), min % 60).getTime(); };

/** Come fa l'app: dove finiscono le sessioni di ogni obiettivo aperto. */
export function fitsOf(state, now) {
  const open = (state.goals || []).filter((g) => !g.archivedAt && state.items.some((x) => x.goalId === g.id && x.status !== 'done'));
  const long = open.length ? planDays(state, now, goals.horizonFor(state, now)) : {};
  return Object.fromEntries(open.map((g) => [g.id, goals.goalFit(state, g, now, long)]));
}

/** Le osservazioni che l'app mostrerebbe adesso (massimo 2 al giorno, come nell'app). */
export function observe(state, plan, now, today) {
  const fits = fitsOf(state, now);
  goals.trackLate(state, fits, now, plan);
  const cands = briefing(state, plan, now, { fits, learned: learnedObservations(state, now) });
  const pick = pickObservations(cands, state.seenObs, today);
  state.seenObs = pick.seen;
  return pick.shown;
}

// risposte che non accettano niente: «Non cambiarle», «No, lascia così», …
const NEGATIVE = new Set(['learn-off', 'slot-keep', 'goal-more', 'backup']);

/**
 * opts: {
 *   start: 'YYYY-MM-DD', days, seed,
 *   doRate: 0–1 oppure (weekday, item) → 0–1   probabilità di fare una sessione
 *   opens: minuti delle aperture fisse (più una a metà della prima sessione fatta, se peek)
 *   accept: true → accetta ogni proposta del companion
 *   onOpen({ state, plan, shown, now, day, doing }), onDay({ state, day, i })
 * }
 */
export function simulate(state, opts) {
  const { start, days = 365, seed = 1, opens = [8 * 60, 13 * 60, 22 * 60], accept = true, peek = true, onOpen, onDay } = opts;
  const rand = rng(seed);
  const rate = typeof opts.doRate === 'function' ? opts.doRate : () => opts.doRate ?? 0.6;
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    const wd = weekday(day);
    const decided = new Map(); // id → la fa oggi o no (deciso una volta al giorno)
    const answered = new Set();
    let peeked = false;
    const look = (now, doing = null) => {
      const plan = planDays(state, now, 7);
      updateAnchors(state, plan, now);
      const shown = observe(state, plan, now, day);
      onOpen?.({ state, plan, shown, now, day, doing });
      if (accept) {
        for (const o of shown) {
          const a = (o.actions || []).find((x) => !NEGATIVE.has(x.act));
          if (!a || answered.has(o.id)) continue;
          answered.add(o.id);
          answerObservation(state, a.act, a.arg, { now, plan });
        }
      }
      return plan;
    };
    for (const [k, o] of opens.entries()) {
      const now = at(day, o);
      const until = opens[k + 1] ?? 24 * 60;
      const plan = look(now);
      // le sessioni di oggi tra questa apertura e la prossima: fatte o saltate
      const todo = (plan[day]?.blocks || []).filter((b) => b.type === 'flex' && b.start >= o && b.start < until && b.item.kind === 'task');
      for (const b of todo) {
        const it = state.items.find((x) => x.id === b.id);
        if (!it || it.status === 'done') continue;
        if (!decided.has(it.id)) decided.set(it.id, rand() < rate(wd, it) ? 'do' : 'skip');
        const d = decided.get(it.id);
        if (d === 'skipped') continue;
        if (d === 'skip') { applyOps(state, [{ action: 'skip', id: it.id }], at(day, b.start)); decided.set(it.id, 'skipped'); continue; }
        applyOps(state, [{ action: 'start', id: it.id }], at(day, b.start));
        if (peek && !peeked && it.goalId) { peeked = true; look(at(day, b.start + Math.min(20, b.end - b.start - 5)), it); }
        const mins = b.end - b.start;
        if (b.part > 0) applyOps(state, [{ action: 'progress', id: it.id, actual_min: mins }], at(day, b.end));
        else applyOps(state, [{ action: 'complete', id: it.id, actual_min: mins }], at(day, b.end));
      }
    }
    // ogni giorno le voci vecchie vanno in archivio, come nell'app
    const ids = archiveCandidates(state, at(day, 23 * 60)).map((x) => x.id);
    if (ids.length) applyArchive(state, ids, at(day, 23 * 60));
    onDay?.({ state, day, i });
  }
  return state;
}

/** Giorni della settimana in cui il motore può mettere sessioni di progetto (oggi). */
export function projectDays(state, day) {
  let n = 0;
  for (let k = 0; k < 7; k++) {
    const d = addDays(day, k);
    const wd = weekday(d);
    const off = (state.prefs.offDays || []).includes(wd) || (state.prefs.restDays || []).some((r) => r.wd === wd && d <= r.until);
    if (!off) n++;
  }
  return n;
}
