// Gli obiettivi nel piano: ci stanno prima della scadenza? Da dove si parte?
import { planDays, dateKey, daysBetween, dayLabel, fmtMin } from './scheduler.js';

/** Giorni da pianificare per vedere tutti gli obiettivi (almeno 14, al massimo 120). */
export function horizonFor(state, now) {
  const today = dateKey(new Date(now));
  let far = 14;
  for (const g of state.goals || []) if (g.due) far = Math.max(far, daysBetween(today, g.due) + 1);
  return Math.min(120, far);
}

/**
 * Dove finiscono le sessioni di un obiettivo.
 * { total, placed, late, unplaced, lastDay, first: { day, start, title } | null }
 */
export function goalFit(state, goal, now, plan = null) {
  const today = dateKey(new Date(now));
  const days = goal.due ? Math.min(120, Math.max(14, daysBetween(today, goal.due) + 1)) : 60;
  const p = plan || planDays(state, now, days);
  const open = (state.items || []).filter((x) => x.goalId === goal.id && x.status !== 'done' && x.kind === 'task');
  const lastOf = new Map(), firstOf = new Map();
  let first = null;
  for (const d of Object.keys(p).sort()) {
    for (const b of p[d].blocks) {
      if (b.type === 'done' || b.item.goalId !== goal.id) continue;
      lastOf.set(b.item.id, d);
      if (!firstOf.has(b.item.id)) firstOf.set(b.item.id, d);
      if (!first || d < first.day || (d === first.day && b.start < first.start)) first = { day: d, start: b.start, title: b.item.title };
    }
  }
  let late = 0, unplaced = 0, lastDay = null;
  for (const it of open) {
    const l = lastOf.get(it.id);
    if (!l) { unplaced++; late++; continue; }
    if (goal.due && l > goal.due) late++;
    if (!lastDay || l > lastDay) lastDay = l;
  }
  return { total: open.length, placed: open.length - unplaced, late, unplaced, lastDay, first };
}

/** «Ho messo 22 sessioni per l'EP da qui al 30 novembre. Si parte stasera alle 19:15 con il beat 01.» */
export function planSummary(state, goal, now, plan = null) {
  const today = dateKey(new Date(now));
  const fit = goalFit(state, goal, now, plan);
  const pr = (state.projects || []).find((p) => p.id === goal.projectId);
  const name = pr ? (pr.name === 'EP' ? "l'EP" : `«${pr.name}»`) : `«${goal.title}»`;
  const hab = (state.habits || []).find((h) => h.goalId === goal.id);
  if (hab) return `${hab.title} ${hab.perWeek} volte a settimana: le ho sparse nei prossimi giorni, mai quando stacchi.`;
  if (!fit.total) return null;
  const until = goal.due ? ` da qui al ${new Date(goal.due + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}` : '';
  let s = `Ho messo ${fit.total} ${fit.total === 1 ? 'sessione' : 'sessioni'} per ${name}${until}.`;
  if (fit.first) {
    const when = fit.first.day === today ? (fit.first.start >= 17 * 60 ? 'stasera' : 'oggi') : dayLabel(fit.first.day, today);
    s += ` Si parte ${when} alle ${fmtMin(fit.first.start)} con ${fit.first.title.charAt(0).toLowerCase() + fit.first.title.slice(1)}.`;
  }
  if (fit.late) s += ` ${fit.late} ${fit.late === 1 ? 'sessione non entra' : 'sessioni non entrano'} prima della scadenza: ti propongo come rimediare.`;
  return s;
}
