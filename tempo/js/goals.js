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
 * { total, placed, late, unplaced, notYet, lastDay, first: { day, start, title } | null }
 * Una sessione non collocata è in ritardo solo se il piano arriva fino alla scadenza:
 * oltre l'orizzonte è «non ancora pianificata» (notYet), non un allarme.
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
  const end = Object.keys(p).sort().at(-1);
  const covered = !!goal.due && !!end && goal.due <= end;
  let late = 0, unplaced = 0, notYet = 0, lastDay = null;
  for (const it of open) {
    const l = lastOf.get(it.id);
    if (!l) { unplaced++; if (covered) late++; else notYet++; continue; }
    if (goal.due && l > goal.due) late++;
    if (!lastDay || l > lastDay) lastDay = l;
  }
  return { total: open.length, placed: open.length - unplaced, late, unplaced, notYet, lastDay, first };
}

/** Una sessione dell'obiettivo è in corso adesso (avviata, oppure nella sua fascia secondo il piano)? */
export function goalInProgress(state, goal, plan, now) {
  if ((state.items || []).some((x) => x.goalId === goal.id && x.status === 'doing')) return true;
  const t = dateKey(new Date(now));
  return (plan?.[t]?.blocks || []).some((b) => (b.type === 'doing' || b.type === 'current') && b.item.goalId === goal.id);
}

/**
 * Ricorda da quando un obiettivo risulta in ritardo (goal.lateSince): l'allarme si mostra solo
 * se il ritardo c'è da almeno due giorni di fila. Mentre una sua sessione è in corso non si tocca niente.
 */
export function trackLate(state, fits, now, plan) {
  const t = dateKey(new Date(now));
  for (const g of state.goals || []) {
    const fit = fits?.[g.id];
    if (!fit || goalInProgress(state, g, plan, now)) continue;
    if (fit.late > 0 && g.due && g.due >= t) g.lateSince ||= t;
    else g.lateSince = null;
  }
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
