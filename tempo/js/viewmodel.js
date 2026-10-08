// Dati delle schermate: funzioni pure (stato + piano + ora → quello che si vede).
// app.js si limita a disegnarli. I campi e gli stati sono descritti in DESIGN-API.md.
import { fmtMin, dateKey, addDays, daysBetween, weekday, WINDOWS, isOffDay } from './scheduler.js';
import { nowAdvice, briefing, pickObservations, observationAlive, welcomeView, goalDoneText } from './companion.js';
import { projectOf } from './store.js';
import { learnedObservations, learnedList } from './learn.js';
import { plural, durLabel, windowLabel, cap, dateLong, weekdayName } from './format.js';

const minOf = (now) => { const d = new Date(now); return d.getHours() * 60 + d.getMinutes(); };
const isRecOrRest = (id) => /^(rec|rest):/.test(String(id));
const projInfo = (state, id) => { const p = id ? projectOf(state, id) : null; return p ? { id: p.id, name: p.name, color: p.color } : null; };

export function greetingFor(day, today, now) {
  if (day === today) { const h = new Date(now).getHours(); return h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera'; }
  if (day === addDays(today, 1)) return 'Domani';
  return cap(weekdayName(day));
}

/** Riepilogo numerico di un giorno del piano. */
function summaryOf(p) {
  const tasks = p.blocks.filter((b) => b.item.kind === 'task' && !isRecOrRest(b.id));
  const done = tasks.filter((b) => b.type === 'done').length;
  const total = tasks.length + p.unscheduled.length;
  const caption = [total ? `${done} di ${total} fatte` : 'Nessuna attività', p.free > 0 ? `${durLabel(p.free)} libere` : null].filter(Boolean).join(' · ');
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, freeMin: p.free, caption };
}

/** Una carta attività/impegno/pausa-cena dal blocco del piano. */
function cardOf(state, b) {
  const it = b.item;
  const id = String(b.id);
  const time = `${fmtMin(b.start)}`;
  if (it.kind === 'rest') return { type: 'rest', id, title: it.title, start: fmtMin(b.start), end: fmtMin(b.end), note: 'Stacca dal lavoro' };
  if (it.kind === 'event') return { type: 'event', id, itemId: id.startsWith('rec:') ? null : it.id, title: it.title, start: fmtMin(b.start), end: fmtMin(b.end), recurring: !!it.recurring, image: it.image || null, color: it.color || null, project: projInfo(state, it.project) };
  const done = b.type === 'done';
  return {
    type: 'task', id, itemId: it.id, title: it.title, start: time, end: fmtMin(b.end), minutes: b.end - b.start,
    done, doneAt: done ? fmtMin(b.end) : null, pinned: b.type === 'pinned', important: it.priority === 3 && !done,
    project: projInfo(state, it.project), goalId: it.goalId || null, habit: !!it.habitId,
    energy: it.energy || 2, estimated: !!it.durationEstimated && !done, resumed: it.spent > 0 && !done, part: !!b.part,
    image: it.image || null, color: it.color || null,
  };
}

/**
 * Schermata del giorno.
 * ctx: { state, plan (14 giorni da oggi), planFor(day) per i giorni fuori dal piano, now, day,
 *        fits (goalId → goalFit), backupDue, env: { online, ai } }
 */
export function today(ctx) {
  const { state, now } = ctx;
  const t = dateKey(new Date(now));
  const day = ctx.day || t;
  const p = ctx.plan[day] || ctx.planFor?.(day);
  const isToday = day === t;
  const n = minOf(now);
  const out = {
    day, isToday, past: day < t,
    header: { time: isToday ? fmtMin(n) : dateLong(day, t), greeting: greetingFor(day, t, now), weekday: cap(weekdayName(day)), date: dateLong(day, t) },
    now: null, observations: [], seen: state.seenObs, summary: summaryOf(p), cards: [], status: 'normal', env: ctx.env || {},
  };

  // "adesso": una sola cosa (consiglio + blocco in corso, se c'è)
  const cur = isToday ? p.blocks.find((b) => b.type !== 'done' && b.start <= n && n < b.end) || null : null;
  if (isToday) {
    const adv = nowAdvice(state, ctx.plan, now);
    if (adv) {
      out.now = { ...adv, block: null };
      if (cur) {
        const isTask = cur.item.kind === 'task' && !isRecOrRest(cur.id);
        out.now.block = {
          id: String(cur.id), itemId: isTask ? cur.item.id : null, kind: isTask ? 'task' : cur.item.kind, title: cur.item.title,
          until: fmtMin(cur.end), left: durLabel(Math.max(1, cur.end - n)), pct: Math.round(Math.max(0, Math.min(1, (n - cur.start) / Math.max(1, cur.end - cur.start))) * 100),
          doing: cur.item.status === 'doing',
        };
      }
    }
    // bentornato: prima di tutto, e finché non rispondi niente allarmi
    out.welcome = welcomeView(state, now);
    const cands = out.welcome ? [] : briefing(state, ctx.plan, now, { fits: ctx.fits, backupDue: ctx.backupDue, learned: learnedObservations(state, now) });
    const pick = out.welcome ? { shown: [], seen: state.seenObs } : pickObservations(cands, state.seenObs, t, 2, observationAlive(state));
    out.observations = pick.shown;
    out.seen = pick.seen;
  }

  // da confermare
  for (const m of isToday ? p.missed || [] : []) out.cards.push({ type: 'missed', id: m.item.id, title: m.item.title, start: fmtMin(m.start), minutes: m.end - m.start });

  // la giornata, con pause e stop
  const live = p.blocks.filter((b) => b.type !== 'done');
  const lastTask = [...live].reverse().find((b) => b.item.kind === 'task' && !isRecOrRest(b.id));
  let prev = null;
  for (const b of p.blocks) {
    if (prev && b.type !== 'done' && prev.type !== 'done' && b !== cur) {
      const gap = b.start - prev.end;
      if (gap >= 5 && gap <= 45 && prev.item.kind !== 'rest' && b.item.kind !== 'rest') out.cards.push({ type: 'pause', at: fmtMin(prev.end), minutes: gap });
    }
    prev = b;
    if (b === cur) continue;
    out.cards.push(cardOf(state, b));
  }
  for (const u of p.unscheduled) out.cards.push({ type: 'unscheduled', id: u.item.id, title: u.item.title, minutes: u.item.duration, reason: u.reason, moveTo: isToday ? 'domani' : 'giorno dopo' });
  const name = (id) => (state.items.find((x) => x.id === id) || {}).title || 'ricorrente';
  for (const [a, b] of p.conflicts) out.cards.push({ type: 'conflict', id: `c${a}${b}`, a: name(a), b: name(b) });

  // stato della schermata
  const off = isOffDay(state.prefs, day);
  const nothing = !p.blocks.length && !p.unscheduled.length;
  out.status = out.past ? 'past'
    : !state.items.length && !(state.goals || []).length ? 'first'
    : off && !p.blocks.some((b) => b.item.kind === 'task') ? 'off'
    : nothing ? 'empty'
    : (state.goals || []).some((g) => ctx.fits?.[g.id]?.late && g.lateSince && g.lateSince < day) && isToday ? 'goal-late'
    : p.unscheduled.length || (p.free < 30 && out.summary.total) ? 'full'
    : 'normal';
  const texts = {
    first: 'Raccontami cosa vuoi ottenere e costruisco io le giornate.',
    off: isToday ? 'Oggi stacchi: niente progetti.' : 'Giorno di stacco: niente progetti.',
    empty: `${isToday ? 'Giornata libera.' : 'Niente in programma.'} Scrivi qui sotto cosa vuoi fare, oppure tocca + per aggiungere un'attività.`,
    past: 'Niente in programma.',
  };
  out.emptyText = nothing || out.status === 'off' ? texts[out.status] || texts.empty : null;
  return out;
}

/** Elenco dei giorni (vista "tutti i giorni"). */
export function days({ state, plan, now, selected }) {
  const t = dateKey(new Date(now));
  return Object.keys(plan).sort().map((k) => {
    const p = plan[k];
    const tasks = p.blocks.filter((b) => b.item.kind === 'task').length + p.unscheduled.length;
    const evs = p.blocks.filter((b) => b.item.kind === 'event').length;
    const off = isOffDay(state.prefs, k);
    return {
      day: k, selected: k === selected, weekday: weekday(k),
      name: k === t ? 'Oggi' : k === addDays(t, 1) ? 'Domani' : cap(weekdayName(k)), date: dateLong(k, t),
      sub: [tasks ? plural(tasks, 'attività', 'attività') : null, evs ? plural(evs, 'impegno', 'impegni') : null, `${durLabel(p.free)} libere`].filter(Boolean).join(' · '),
      off,
      minis: p.blocks.filter((b) => b.type !== 'done').slice(0, 3).map((b) => ({ time: fmtMin(b.start), title: b.item.title, image: b.item.image || null, kind: b.item.kind })),
      emptyText: off ? 'Giorno di stacco' : 'Giornata libera',
    };
  });
}

/**
 * Vista mese: scadenze degli obiettivi e densità delle sessioni (non gli impegni fissi ricorrenti).
 * longPlan: piano su un orizzonte lungo (fino all'ultima scadenza); oltre, si vedono solo le attività con una data.
 */
export function month({ state, longPlan, planFor, now, months = 6, selected }) {
  const t = dateKey(new Date(now));
  const [y0, m0] = t.split('-').map(Number);
  const deadlines = {};
  for (const g of state.goals || []) if (g.due) (deadlines[g.due] ||= []).push({ goalId: g.id, title: g.title, project: projInfo(state, g.projectId) });
  const out = [];
  for (let mi = 0; mi < months; mi++) {
    const first = new Date(y0, m0 - 1 + mi, 1);
    const y = first.getFullYear(), m = first.getMonth();
    const len = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let dd = 1; dd <= len; dd++) {
      const k = dateKey(new Date(y, m, dd));
      let sessions = [];
      if (k < t) sessions = state.items.filter((x) => (x.kind === 'task' && x.status === 'done' && x.doneAt && dateKey(new Date(x.doneAt)) === k) || (x.kind === 'event' && x.date === k));
      else {
        const p = longPlan?.[k] || planFor?.(k);
        sessions = p ? p.blocks.filter((b) => (b.item.kind === 'task' || b.item.kind === 'event') && !isRecOrRest(b.id)).map((b) => b.item) : [];
      }
      const dl = deadlines[k] || [];
      const pickItem = sessions.find((x) => x.image) || sessions[0] || null;
      cells.push({
        day: k, n: dd, past: k < t, today: k === t, selected: k === selected, off: isOffDay(state.prefs, k),
        sessions: sessions.length, density: Math.min(3, sessions.length), deadlines: dl,
        allDone: k < t && sessions.length > 0,
        pick: dl.length ? { title: `◎ ${dl[0].title}`, image: null, deadline: true, color: null, project: dl[0].project }
          : pickItem ? { title: sessions.length > 1 ? `${pickItem.title} +${sessions.length - 1}` : pickItem.title, image: pickItem.image || null, color: pickItem.color || null, project: projInfo(state, pickItem.project), event: pickItem.kind === 'event' } : null,
        label: [`${dd}`, dl.length ? `scadenza: ${dl.map((x) => x.title).join(', ')}` : null, sessions.length ? sessions.map((x) => x.title).slice(0, 3).join(', ') : 'libero'].filter(Boolean).join(', '),
      });
    }
    out.push({ index: mi, title: cap(first.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })), short: cap(first.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '')), lead: (first.getDay() + 6) % 7, cells });
  }
  return out;
}

/** "Il tuo contesto": tutto ciò che il companion usa per decidere. */
export function context({ state, now, fits }) {
  const t = dateKey(new Date(now));
  const P = state.prefs;
  const goals = (state.goals || []).map((g) => {
    const mine = state.items.filter((x) => x.goalId === g.id && x.kind === 'task' && !x.habitId);
    const done = mine.filter((x) => x.status === 'done').length;
    const dd = g.due ? daysBetween(t, g.due) : null;
    return {
      id: g.id, title: g.title, project: projInfo(state, g.projectId), due: g.due, dueDate: g.due ? dateLong(g.due, t) : null,
      dueText: g.due == null ? 'senza scadenza' : dd < 0 ? 'scaduto' : dd === 0 ? 'oggi' : dd < 14 ? `tra ${dd} giorni` : `tra ${Math.round(dd / 7)} settimane`,
      sessions: { done, total: mine.length }, late: fits?.[g.id]?.late || 0,
      habit: (state.habits || []).find((h) => h.goalId === g.id) || null,
    };
  });
  return {
    goals,
    projects: (state.projects || []).map((p) => ({ ...projInfo(state, p.id), due: p.due || null })),
    habits: (state.habits || []).map((h) => ({ id: h.id, title: h.title, perWeek: h.perWeek, duration: h.duration, text: `${h.title}: ${h.perWeek === 7 ? 'ogni giorno' : `${h.perWeek} volte a settimana`} · ${durLabel(h.duration)}` })),
    constraints: {
      recurring: state.recurring.map((r) => ({ id: r.id, title: r.title, start: fmtMin(r.start), end: fmtMin(r.end), weekdays: r.weekdays })),
      offDays: P.offDays || [], freeDays: P.freeDays || [],
      // i giorni liberati dal companion: a tempo, si tolgono con un tocco
      restDays: (P.restDays || []).filter((r) => r.until >= t).map((r) => ({ wd: r.wd, until: r.until, text: `${cap(['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'][r.wd])} libero dai progetti fino al ${dateLong(r.until, t)}` })),
      notes: state.memory.filter((m) => m.category === 'vincolo'),
    },
    preferences: {
      focusWindow: P.focusWindow, focusLabel: P.focusWindow ? windowLabel(P.focusWindow) : 'indifferente',
      maxBlock: P.maxBlock, buffer: P.buffer, decompress: P.decompress ?? 45, dayStart: fmtMin(P.dayStart), dayEnd: fmtMin(Math.min(P.dayEnd, 1439)), slack: Math.round(P.slack * 100),
      windows: Object.keys(WINDOWS).map((w) => ({ value: w, label: windowLabel(w) })),
      notes: state.memory.filter((m) => m.category !== 'vincolo'),
    },
    learned: learnedList(state, now),
    // obiettivi raggiunti, con la loro storia
    goalsDone: (state.goalsDone || []).slice().sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0)).map((g) => ({ id: g.id, title: g.title, project: projInfo(state, g.projectId), text: goalDoneText(state, g, t) })),
  };
}

/** La presentazione: quattro domande. */
export function onboarding() {
  return [
    { key: null, kick: 'Tempo', q: 'Non sono un\'agenda.', sub: 'Dimmi cosa stai cercando di ottenere e costruisco io le tue giornate: cosa fare, quando, e quando fermarti. Quattro domande, un minuto.' },
    { key: 'goals', kick: 'Obiettivi', q: 'Cosa vuoi ottenere?', sub: 'Anche in grande. Ci penso io a farlo diventare sessioni concrete.', placeholder: 'Voglio far uscire il mio EP tra 6 settimane.', examples: ['Finire il portfolio entro un mese', 'Andare in palestra 3 volte a settimana'] },
    { key: 'constraints', kick: 'Vincoli', q: 'Cosa non si sposta?', sub: 'Lavoro, orari, giorni liberi, giorni in cui stacchi.', placeholder: 'Lavoro 9–18:30 dal lunedì al venerdì. Il sabato sono libero. La domenica stacco.', examples: ['Lavoro 9–18', 'Il sabato sono libero', 'La domenica stacco'] },
    { key: 'projects', kick: 'Progetti', q: 'Su cosa stai lavorando?', sub: 'Separali con una virgola.', placeholder: 'EP, portfolio, palestra, Spazio Desk', examples: ['EP', 'Portfolio', 'Palestra'] },
    { key: 'prefs', kick: 'Preferenze', q: 'Come lavori meglio?', sub: 'Quando rendi, quanto reggi di fila.', placeholder: 'La sera produco meglio. Non voglio più di 2h consecutive.', examples: ['La sera produco meglio', 'Max 2h di fila', 'Pause di 15 minuti'] },
  ];
}

/**
 * Settimana (lunedì–domenica): una carta per progetto con le sessioni della settimana.
 * ctx: { state, plan, longPlan?, planFor?, now, offset (settimane da quella di `anchor`), anchor? }
 */
export function week(ctx) {
  const { state, now } = ctx;
  const t = dateKey(new Date(now));
  const base = ctx.anchor || t;
  const monday = addDays(base, -((weekday(base) + 6) % 7) + 7 * (ctx.offset || 0));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const LETTER = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];
  const sessionsOf = (k) => {
    if (k < t) return state.items.filter((x) => x.kind === 'task' && x.status === 'done' && x.doneAt && dateKey(new Date(x.doneAt)) === k).map((x) => ({ item: x, done: true, start: null }));
    const p = ctx.plan?.[k] || ctx.longPlan?.[k] || ctx.planFor?.(k);
    return p ? p.blocks.filter((b) => b.item.kind === 'task' && !isRecOrRest(b.id)).map((b) => ({ item: b.item, done: b.type === 'done', start: b.start })) : [];
  };
  const byDay = days.map(sessionsOf);
  const groups = new Map();
  byDay.forEach((list, i) => {
    for (const s of list) {
      const key = s.item.project || 'other';
      if (!groups.has(key)) groups.set(key, { key, perDay: days.map(() => ({ done: 0, planned: 0 })), minutes: 0, next: null, done: 0, total: 0 });
      const g = groups.get(key);
      g.perDay[i][s.done ? 'done' : 'planned']++;
      g.total++;
      if (s.done) g.done++;
      g.minutes += s.done ? s.item.actual || s.item.duration || 0 : s.item.duration || 0;
      const nowMin = minOf(now);
      if (!s.done && !g.next && (days[i] > t || (days[i] === t && s.start != null && s.start >= nowMin))) g.next = { day: days[i], start: s.start, title: s.item.title };
    }
  });
  // anche i progetti con un obiettivo e nessuna sessione questa settimana: vanno visti
  for (const g of state.goals || []) if (g.projectId && !groups.has(g.projectId) && (!g.due || g.due >= monday)) groups.set(g.projectId, { key: g.projectId, perDay: days.map(() => ({ done: 0, planned: 0 })), minutes: 0, next: null, done: 0, total: 0 });

  const todayIndex = days.indexOf(t);
  const cards = [...groups.values()].map((g) => {
    const pr = g.key === 'other' ? null : projInfo(state, g.key);
    const goal = pr ? (state.goals || []).find((x) => x.projectId === pr.id) : null;
    const nextText = g.next ? `Prossima: ${g.next.title}, ${g.next.day === t ? 'oggi' : g.next.day === addDays(t, 1) ? 'domani' : weekdayName(g.next.day)}${g.next.start != null ? ` alle ${fmtMin(g.next.start)}` : ''}.` : g.total ? (g.done === g.total ? 'Settimana chiusa.' : '') : 'Nessuna sessione questa settimana.';
    const goalText = goal?.due ? ` Scadenza ${dateLong(goal.due, t)}.` : '';
    return {
      key: g.key, kind: pr ? 'project' : 'other',
      tag: pr ? pr.name : 'Altro', color: pr?.color || null,
      label: g.total ? `${g.done} di ${g.total} fatte · ${durLabel(g.minutes)}` : 'Questa settimana',
      value: String(g.total), unit: g.total === 1 ? 'sessione' : 'sessioni',
      ticks: days.map((d, i) => ({ day: d, letter: LETTER[weekday(d)], off: isOffDay(state.prefs, d), done: g.perDay[i].done, planned: g.perDay[i].planned, today: d === t, past: d < t })),
      todayIndex, note: (nextText + goalText).trim(), openDay: g.next?.day || days.find((d, i) => g.perDay[i].planned || g.perDay[i].done) || (todayIndex >= 0 ? t : monday),
      total: g.total,
    };
  }).sort((a, b) => (a.kind === 'other') - (b.kind === 'other') || b.total - a.total);

  const d0 = new Date(monday + 'T12:00'), d6 = new Date(days[6] + 'T12:00');
  const sameMonth = d0.getMonth() === d6.getMonth();
  return {
    monday, sunday: days[6], offset: ctx.offset || 0, isCurrent: todayIndex >= 0,
    title: todayIndex >= 0 ? 'Questa settimana' : (ctx.offset || 0) === 1 ? 'Settimana prossima' : 'Settimana',
    range: sameMonth ? `${d0.getDate()} – ${d6.getDate()} ${d6.toLocaleDateString('it-IT', { month: 'long' })}` : `${d0.getDate()} ${d0.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '')} – ${d6.getDate()} ${d6.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '')}`,
    days: days.map((d) => ({ day: d, letter: LETTER[weekday(d)], n: +d.slice(8), today: d === t, off: isOffDay(state.prefs, d) })),
    cards,
    sessions: cards.reduce((s, c) => s + c.total, 0),
    emptyText: cards.length ? null : 'Niente in programma questa settimana. Dimmi cosa vuoi ottenere e preparo le sessioni.',
  };
}

/**
 * Riepilogo (chat): i punti chiave su come sta andando, i prossimi 7 giorni e i progetti.
 * ctx: { state, plan, longPlan, planFor, now, fits }
 */
export function summary(ctx) {
  const { state, now } = ctx;
  const t = dateKey(new Date(now));
  const fits = ctx.fits || {};
  const w = week({ ...ctx, offset: 0, anchor: t });
  const points = [];

  // questa settimana
  const done = w.cards.reduce((s, c) => s + c.ticks.reduce((a, x) => a + x.done, 0), 0);
  points.push(w.sessions ? `Questa settimana: ${done} di ${w.sessions} ${w.sessions === 1 ? 'sessione fatta' : 'sessioni fatte'}${done === w.sessions ? '. Settimana chiusa.' : '.'}` : 'Questa settimana non hai sessioni in programma.');
  // obiettivi
  for (const g of state.goals || []) {
    const mine = state.items.filter((x) => x.goalId === g.id && x.kind === 'task' && !x.habitId);
    const ok = mine.filter((x) => x.status === 'done').length;
    const f = fits[g.id];
    const pr = g.projectId ? projectOf(state, g.projectId) : null;
    const name = pr?.name || g.title;
    let line = `${name}: ${ok} di ${plural(mine.length, 'sessione', 'sessioni')}`;
    if (g.due) {
      if (f?.late) line += `, ma ${plural(f.late, 'sessione resta', 'sessioni restano')} oltre il ${dateLong(g.due, t)}`;
      else if (f?.lastDay) { const margin = daysBetween(f.lastDay, g.due); line += `, finisci il ${dateLong(f.lastDay, t)}: ${margin > 0 ? `${plural(margin, 'giorno', 'giorni')} prima della scadenza` : 'proprio alla scadenza'}`; }
      else line += `, scadenza ${dateLong(g.due, t)}`;
    }
    points.push(line + '.');
  }
  // il mese
  const monthEnd = (() => { const [y, m] = t.split('-').map(Number); return dateKey(new Date(y, m, 0)); })();
  let monthSessions = 0, busiest = null;
  for (let k = t; k <= monthEnd; k = addDays(k, 1)) {
    const p = ctx.plan?.[k] || ctx.longPlan?.[k] || ctx.planFor?.(k);
    const n = p ? p.blocks.filter((b) => b.item.kind === 'task' && !isRecOrRest(b.id) && b.type !== 'done').length : 0;
    monthSessions += n;
    if (n && (!busiest || n > busiest.n)) busiest = { k, n };
  }
  if (monthSessions) points.push(`Da qui a fine mese: ${plural(monthSessions, 'sessione', 'sessioni')}${busiest && busiest.n > 1 ? `, il giorno più pieno è ${weekdayName(busiest.k)} ${+busiest.k.slice(8)}` : ''}.`);
  const skips = (state.log || []).filter((e) => e.type === 'skip' && e.at >= now - 7 * 864e5).length;
  if (skips >= 2) points.push(`Negli ultimi 7 giorni hai saltato ${plural(skips, 'sessione', 'sessioni')}.`);

  // prossimi 7 giorni (la lista con le spunte)
  const rows = [];
  for (let i = 0; i < 7 && rows.length < 6; i++) {
    const k = addDays(t, i);
    const p = ctx.plan?.[k] || ctx.longPlan?.[k] || ctx.planFor?.(k);
    for (const b of p?.blocks || []) {
      if (b.item.kind !== 'task' || isRecOrRest(b.id) || rows.length >= 6) continue;
      rows.push({ id: b.item.id, day: k, title: b.item.title, sub: `${k === t ? 'Oggi' : k === addDays(t, 1) ? 'Domani' : cap(weekdayName(k))} ${b.type === 'done' ? '· fatta' : `alle ${fmtMin(b.start)}`} · ${durLabel(b.end - b.start)}`, done: b.type === 'done' });
    }
  }

  // gli impegni fissi dei prossimi 7 giorni (non ricorrenti): contano anche se non sono sessioni
  const events = [];
  for (let i = 0; i < 7; i++) {
    const k = addDays(t, i);
    const p = ctx.plan?.[k] || ctx.longPlan?.[k] || ctx.planFor?.(k);
    for (const b of p?.blocks || []) if (b.item.kind === 'event' && !isRecOrRest(b.id) && b.type !== 'done') events.push(`${b.item.title} ${k === t ? 'oggi' : k === addDays(t, 1) ? 'domani' : weekdayName(k) + ' ' + +k.slice(8)} alle ${fmtMin(b.start)}`);
  }
  if (events.length) points.splice(1, 0, `Impegni: ${events.slice(0, 3).join('; ')}${events.length > 3 ? ` e altri ${events.length - 3}` : ''}.`);
  const cardsByKey = new Map(w.cards.map((c) => [c.key, c]));
  for (const pr of state.projects || []) if (!cardsByKey.has(pr.id)) cardsByKey.set(pr.id, { key: pr.id, kind: 'project', tag: pr.name, color: pr.color, label: 'Questa settimana', note: 'Niente in programma: dimmi il prossimo passo nella barra del giorno.', openDay: t, total: 0 });
  const projects = [...cardsByKey.values()].filter((c) => c.kind === 'project').map((c) => {
    const goal = (state.goals || []).find((g) => g.projectId === c.key);
    return { key: c.key, name: c.tag, color: c.color, text: `${c.label === 'Questa settimana' ? 'Nessuna sessione questa settimana.' : `${c.label} questa settimana.`} ${c.note}`.replace(/\s+/g, ' ').trim(), footer: goal?.due ? `Scadenza ${dateLong(goal.due, t)}` : goal ? goal.title : 'Progetto', day: c.openDay };
  });

  const intro = points.length > 1 ? 'Ecco come stai andando, in breve.' : 'Ecco il punto della situazione.';
  return { date: dateLong(t, t), intro, points, list: { date: dateLong(t, t), title: 'I prossimi 7 giorni', rows }, projects, monthSessions };
}

/**
 * Risposte senza AI alle domande del riepilogo (come va, la settimana, il mese, un progetto per nome).
 * Restituisce un testo oppure null se la domanda non è riconosciuta.
 */
export function answerLocally(question, sum, state) {
  const q = String(question || '').toLowerCase();
  const pr = (state.projects || []).find((p) => q.includes(p.name.toLowerCase()));
  if (pr) { const c = sum.projects.find((x) => x.key === pr.id); return c ? `${c.name}: ${c.text}` : `Su ${pr.name} non c'è niente in programma: dimmi il prossimo passo nella barra del giorno.`; }
  if (/(riassum|riepilog|in generale|punti chiave)/.test(q)) return sum.points.map((p) => `• ${p}`).join('\n');
  // "come sto andando": un giudizio, non la ripetizione dei punti chiave che sono già sopra
  if (/(come (sto andando|va|procede)|com'è andata|a che punto)/.test(q)) {
    const late = sum.points.filter((p) => / oltre il /.test(p));
    const next = sum.list.rows.find((r) => !r.done);
    const goals = (state.goals || []).filter((g) => g.due && g.status !== 'done').length;
    const out = [late.length ? `Sei indietro su ${plural(late.length, 'obiettivo', 'obiettivi')}:` : goals ? 'Sei in linea con le scadenze.' : null, ...late, sum.points[0]];
    if (next) out.push(`La prossima: ${next.title}, ${next.sub.charAt(0).toLowerCase() + next.sub.slice(1)}.`);
    return out.filter(Boolean).join('\n');
  }
  if (/(settiman|prossimi giorni|cosa (faccio|ho)|cosa mi aspetta)/.test(q)) return sum.list.rows.length ? sum.list.rows.map((r) => `${r.done ? '✓' : '•'} ${r.title} — ${r.sub}`).join('\n') : 'Nei prossimi 7 giorni non hai sessioni.';
  if (/(mese|mensile)/.test(q)) return sum.points.find((p) => p.startsWith('Da qui a fine mese')) || 'Da qui a fine mese non ci sono sessioni.';
  if (/(scadenz|quando finisc|ce la faccio|in tempo|in ritardo)/.test(q)) return sum.points.filter((p) => /scadenza|oltre il|finisci il/.test(p)).join('\n') || 'Non hai obiettivi con una scadenza.';
  if (/(saltat|salto|perso)/.test(q)) return sum.points.find((p) => p.startsWith('Negli ultimi 7 giorni')) || 'Negli ultimi 7 giorni non hai saltato sessioni.';
  return null;
}
