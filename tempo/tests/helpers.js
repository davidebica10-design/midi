// Ambiente di prova comune: fuso orario fisso, ora fissa, stato vuoto.
process.env.TZ = 'Europe/Rome';
import { emptyState, applyOps } from '../js/store.js';
import { localParse } from '../js/ai.js';

// martedì 6 ottobre 2026, ore 10:00
export const NOW = new Date(2026, 9, 6, 10, 0).getTime();
export const TODAY = '2026-10-06';
export const TOMORROW = '2026-10-07';

export function freshState(extra = {}) {
  const s = emptyState();
  s.onboarded = true;
  return Object.assign(s, extra);
}

/** Stato con il progetto EP e il suo obiettivo. */
export function epState() {
  const s = freshState();
  applyOps(s, [{ action: 'add_project', title: 'EP' }, { action: 'add_project', title: 'Portfolio' }], NOW);
  applyOps(s, [{ action: 'set_goal', title: "Far uscire l'EP", deadline: '2026-11-30', project: 'EP' }], NOW);
  return s;
}

/** Frase scritta nella barra senza AI → stato aggiornato. */
export function say(state, text, now = NOW) {
  const r = localParse(text, state, now);
  const res = r.ops ? applyOps(state, r.ops, now) : { log: [], errors: [] };
  return { ...r, ...res, state };
}

export const openTasks = (s) => s.items.filter((x) => x.kind === 'task' && x.status !== 'done');
export const projectName = (s, id) => (s.projects.find((p) => p.id === id) || {}).name;
