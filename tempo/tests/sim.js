// Un utente finto usa Tempo per molti giorni: apre l'app, fa una parte delle sessioni,
// risponde al companion, ogni tanto scrive nella barra. Deterministico: stesso seme, stessi risultati.
// Fa quello che fa l'app: bentornato, osservazioni (massimo 2, chiuse quando rispondi), archivio ogni giorno.
process.env.TZ = 'Europe/Rome';
import { applyOps, archiveCandidates, applyArchive } from '../js/store.js';
import { planDays, updateAnchors, addDays, weekday, isOffDay } from '../js/scheduler.js';
import * as goals from '../js/goals.js'; // goals.trackLate, goals.goalFit, goals.horizonFor
import { answerObservation, markShown, closeObservation, backupDue, noteOpen, welcomeArchive } from '../js/companion.js';
import { localParse } from '../js/parse.js';
import * as vm from '../js/viewmodel.js';

/** Numeri pseudo-casuali ripetibili. */
export function rng(seed = 1) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
export const at = (day, min) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, Math.floor(min / 60), min % 60).getTime(); };

/** Come fa l'app: dove finiscono le sessioni di ogni obiettivo aperto. */
export function fitsOf(state, now) {
  const open = (state.goals || []).filter((g) => state.items.some((x) => x.goalId === g.id && x.status !== 'done'));
  const long = open.length ? planDays(state, now, goals.horizonFor(state, now)) : {};
  return Object.fromEntries(open.map((g) => [g.id, goals.goalFit(state, g, now, long)]));
}

/** Quello che l'app mostrerebbe adesso: { shown (osservazioni), welcome } — come renderDayView. */
export function observe(state, plan, now, today) {
  const fits = fitsOf(state, now);
  goals.trackLate(state, fits, now, plan);
  const v = vm.today({ state, plan, now, fits, backupDue: backupDue(state, now) });
  state.seenObs = v.seen;
  markShown(state, v.observations, today);
  return { shown: v.observations, welcome: v.welcome };
}

// risposte che non accettano niente: «Non cambiarle», «No, lascia così», …
const NEGATIVE = new Set(['learn-off', 'slot-keep', 'goal-more', 'backup', 'goal-date']);

/**
 * opts: {
 *   start: 'YYYY-MM-DD', days, seed,
 *   doRate: 0–1 oppure (weekday, item) → 0–1   probabilità di fare una sessione
 *   opens: minuti delle aperture fisse (più una a metà della prima sessione di un obiettivo, se peek)
 *   accept: true → accetta ogni proposta del companion
 *   say(day, rand) → una frase da scrivere nella barra (o null), alla seconda apertura
 *   track: { change(label), save(state) } → come l'app: annulla prima di ogni modifica, salvataggio a ogni apertura
 *   onOpen({ state, plan, shown, welcome, now, day, doing }), onDay({ state, day, i })
 * }
 */
export function simulate(state, opts) {
  const { start, days = 365, seed = 1, opens = [8 * 60, 13 * 60, 22 * 60], accept = true, peek = true, onOpen, onDay, track, say } = opts;
  const rand = rng(seed);
  const rate = typeof opts.doRate === 'function' ? opts.doRate : () => opts.doRate ?? 0.6;
  const change = (label, fn) => { track?.change?.(label); return fn(); };
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    const wd = weekday(day);
    const decided = new Map(); // id → 'do' | 'skip' | 'skipped' (deciso una volta al giorno)
    const answered = new Set();
    let peeked = false;
    const look = (now, doing = null) => {
      noteOpen(state, now);
      const plan = planDays(state, now, 7);
      updateAnchors(state, plan, now);
      const { shown, welcome } = observe(state, plan, now, day);
      onOpen?.({ state, plan, shown, welcome, now, day, doing });
      if (accept && welcome) {
        // bentornato: archivia le cose vecchie, risponde sugli obiettivi scaduti, poi «Va bene»
        const old = welcomeArchive(state).map((x) => x.id);
        if (old.length) change('Archiviate', () => applyArchive(state, old, now));
        for (const g of welcome.goals) change('Risposta', () => answerObservation(state, g.actions[0].act, g.actions[0].arg, { now, plan }));
        change('Bentornato', () => answerObservation(state, 'welcome-close', '', { now, plan }));
      } else if (accept) {
        for (const o of shown) {
          const a = (o.actions || []).find((x) => !NEGATIVE.has(x.act));
          if (!a || answered.has(o.id)) continue;
          answered.add(o.id);
          change('Risposta al companion', () => answerObservation(state, a.act, a.arg, { now, plan }));
          closeObservation(state, o.id, now);
        }
      }
      track?.save?.(state);
      return plan;
    };
    for (const [k, o] of opens.entries()) {
      const now = at(day, o);
      const until = opens[k + 1] ?? 24 * 60;
      const plan = look(now);
      if (k === 1 && say) {
        const text = say(day, rand);
        if (text) {
          const r = localParse(text, state, now);
          if (r.ops) change('Frase', () => applyOps(state, r.ops, now));
        }
      }
      // le sessioni di oggi tra questa apertura e la prossima: fatte o saltate
      const todo = (plan[day]?.blocks || []).filter((b) => b.type === 'flex' && b.start >= o && b.start < until && b.item.kind === 'task');
      for (const b of todo) {
        const it = state.items.find((x) => x.id === b.id);
        if (!it || it.status === 'done') continue;
        if (!decided.has(it.id)) decided.set(it.id, rand() < rate(wd, it) ? 'do' : 'skip');
        const d = decided.get(it.id);
        if (d === 'skipped') continue;
        if (d === 'skip') { change('Rimandata', () => applyOps(state, [{ action: 'skip', id: it.id }], at(day, b.start))); decided.set(it.id, 'skipped'); continue; }
        change('Iniziata', () => applyOps(state, [{ action: 'start', id: it.id }], at(day, b.start)));
        if (peek && !peeked && it.goalId) { peeked = true; look(at(day, b.start + Math.min(20, b.end - b.start - 5)), it); }
        const mins = b.end - b.start;
        if (b.part > 0) change('In parte', () => applyOps(state, [{ action: 'progress', id: it.id, actual_min: mins }], at(day, b.end)));
        else change('Fatto', () => applyOps(state, [{ action: 'complete', id: it.id, actual_min: mins }], at(day, b.end)));
      }
    }
    // ogni giorno le voci vecchie vanno in archivio, come nell'app
    const ids = archiveCandidates(state, at(day, 23 * 60)).map((x) => x.id);
    if (ids.length) applyArchive(state, ids, at(day, 23 * 60));
    onDay?.({ state, day, i });
  }
  return state;
}

/** Giorni della settimana (da `day`) in cui il motore può mettere sessioni di progetto. */
export function projectDays(state, day) {
  let n = 0;
  for (let k = 0; k < 7; k++) if (!isOffDay(state.prefs, addDays(day, k))) n++;
  return n;
}
