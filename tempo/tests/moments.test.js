// Fase 4: il companion e i momenti che contano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, TODAY, freshState, epState, say } from './helpers.js';
import { applyOps } from '../js/store.js';
import * as companion from '../js/companion.js';
import * as scheduler from '../js/scheduler.js';
import * as format from '../js/format.js';
import * as vm from '../js/viewmodel.js';

const { planDays, addDays, dateKey } = scheduler;
const DAY = 864e5;
const todayAt = (state, now, extra = {}) => vm.today({ state, plan: planDays(state, now, 7), now, fits: {}, ...extra });
/** Come fa l'app dopo aver disegnato la giornata. */
const render = (state, now, extra) => {
  const v = todayAt(state, now, extra);
  state.seenObs = v.seen;
  companion.markShown(state, v.observations, dateKey(new Date(now)));
  return v;
};

// ---------------------------------------------------------------- 4.1
function learnedState() {
  const s = freshState();
  for (const [i, a] of [70, 65, 75].entries()) {
    applyOps(s, [{ action: 'add', kind: 'task', title: `Beat 0${i + 1}`, duration_min: 45, duration_is_estimate: true }], NOW);
    applyOps(s, [{ action: 'complete', id: s.items.at(-1).id, actual_min: a }], NOW + i * 60000);
  }
  return s;
}

test('4.1 «ho aggiornato le stime» resta visibile (anche 30 secondi dopo) finché non lo chiudi', () => {
  const s = learnedState();
  const v1 = render(s, NOW);
  assert.ok(v1.observations.some((o) => o.id === 'learn-w:beat'), v1.observations.map((o) => o.id).join());
  const v2 = render(s, NOW + 30000);
  const o = v2.observations.find((x) => x.id === 'learn-w:beat');
  assert.ok(o, 'ancora lì dopo 30 secondi');
  assert.ok(o.actions.some((a) => a.act === 'learn-off'), '«Non cambiarle» ancora disponibile');
  assert.ok(!s.learned.durations['w:beat'].announced, 'non ancora segnata come detta');
  // chiusa: sparisce e da allora è «detta»
  companion.closeObservation(s, 'learn-w:beat', NOW + 60000);
  assert.ok(s.learned.durations['w:beat'].announced);
  const v3 = render(s, NOW + 90000);
  assert.ok(!v3.observations.some((x) => x.id === 'learn-w:beat'));
});

test('4.1 un\'osservazione mostrata resta fino a fine giornata anche se non è più tra le candidate', () => {
  const s = learnedState();
  render(s, NOW);
  s.learned.durations['w:beat'].announced = s.learned.durations['w:beat'].ratio; // un altro motivo la toglie dalle candidate
  assert.ok(render(s, NOW + 3600e3).observations.some((x) => x.id === 'learn-w:beat'));
  assert.ok(!render(s, NOW + DAY).observations.some((x) => x.id === 'learn-w:beat'), 'il giorno dopo no');
});

// ---------------------------------------------------------------- 4.2
test('4.2 «è rimasta indietro» ha «Sposta a domani» e «Togli»', () => {
  const s = freshState();
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Relazione', duration_min: 60, date: addDays(TODAY, -2) }], NOW);
  const it = s.items[0];
  const o = companion.briefing(s, planDays(s, NOW, 7), NOW, {}).find((x) => x.id === 'behind-' + it.id);
  assert.ok(o);
  assert.deepEqual(o.actions.map((a) => a.label), ['Sposta a domani', 'Togli']);
  companion.answerObservation(s, o.actions[0].act, o.actions[0].arg, { now: NOW });
  assert.equal(s.items[0].date, addDays(TODAY, 1));
  companion.answerObservation(s, o.actions[1].act, o.actions[1].arg, { now: NOW });
  assert.equal(s.items.length, 0);
});

test('4.2 backup: al massimo una volta ogni 7 giorni, e solo se i dati sono cambiati dall\'ultimo export', () => {
  const s = freshState();
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Spesa', duration_min: 30 }], NOW);
  s.stats.createdAt = NOW - 30 * DAY;
  s.stats.edits = 5;
  assert.equal(companion.backupDue(s, NOW), true);
  companion.markShown(s, [{ id: 'backup' }], TODAY);
  assert.equal(companion.backupDue(s, NOW + 3 * DAY), false, 'mostrato da 3 giorni');
  assert.equal(companion.backupDue(s, NOW + 7 * DAY), true, 'dopo 7 giorni sì');
  // esportato e niente di nuovo: non serve
  s.settings.lastExportAt = NOW - 20 * DAY;
  s.stats.exportedEdits = 5;
  s.stats.backupShownOn = null;
  assert.equal(companion.backupDue(s, NOW), false);
  s.stats.edits = 6;
  assert.equal(companion.backupDue(s, NOW), true);
});

test('4.2 le date di un altro anno hanno l\'anno', () => {
  assert.equal(format.dateLong('2029-07-05', TODAY), '5 luglio 2029');
  assert.equal(format.dateLong('2026-11-30', TODAY), '30 novembre');
  const s = freshState();
  applyOps(s, [{ action: 'set_goal', title: 'Album', deadline: '2027-01-10' }], NOW);
  applyOps(s, [{ action: 'plan_goal', title: 'Album', sessions: Array.from({ length: 30 }, (_, i) => ({ key: 's' + i, title: `Brano ${i + 1}`, duration_min: 240, energy: 3 })) }], NOW);
  applyOps(s, [{ action: 'add_recurring', title: 'Lavoro', start_time: '08:00', end_time: '22:00', weekdays: [0, 1, 2, 3, 4, 5, 6] }], NOW);
  const g = s.goals[0];
  g.lateSince = addDays(TODAY, -2);
  const fits = { [g.id]: { late: 5, lastDay: null } };
  const o = companion.briefing(s, planDays(s, NOW, 7), NOW, { fits }).find((x) => x.id === 'fit-' + g.id);
  assert.match(o.text, /10 gennaio 2027/);
  assert.match(o.actions[0].label, /24 gennaio 2027/);
});

// ---------------------------------------------------------------- 4.3
function awayState() {
  const s = epState();
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Sistemare la camera', duration_min: 60 }], NOW - 100 * DAY);
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Consegna tesina', duration_min: 60, deadline: addDays(TODAY, 3) }], NOW - 100 * DAY);
  applyOps(s, [{ action: 'plan_goal', title: "Far uscire l'EP" }], NOW - 100 * DAY);
  s.goals[0].due = addDays(TODAY, -90);
  s.stats.lastOpenAt = NOW - 99 * DAY;
  s.stats.createdAt = NOW - 200 * DAY;
  return s;
}

test('4.3 dopo 99 giorni: «Bentornato» prima di tutto, allarmi in pausa', () => {
  const s = awayState();
  const w = companion.noteOpen(s, NOW);
  assert.ok(w, 'carta bentornato');
  assert.equal(s.stats.lastOpenAt, NOW);
  const v = render(s, NOW);
  assert.ok(v.welcome);
  assert.match(v.welcome.text, /99 giorni/);
  assert.deepEqual(v.observations, [], 'niente allarmi finché non rispondi');
  // le attività senza scadenza create prima dell'assenza: si archiviano con un tocco
  assert.deepEqual(v.welcome.archive.map((x) => x.title), ['Sistemare la camera']);
  // l'obiettivo scaduto: fatto, nuova data o toglilo
  assert.equal(v.welcome.goals.length, 1);
  assert.deepEqual(v.welcome.goals[0].actions.map((a) => a.label), ['È fatto', 'Nuova data', 'Toglilo']);
  // risposto: tornano le osservazioni
  companion.answerObservation(s, 'welcome-close', '', { now: NOW });
  assert.equal(s.welcome, null);
  assert.ok(render(s, NOW + 60000).observations.length > 0);
});

test('4.3 meno di 7 giorni: niente bentornato', () => {
  const s = awayState();
  s.stats.lastOpenAt = NOW - 6 * DAY;
  assert.equal(companion.noteOpen(s, NOW), null);
  assert.ok(!todayAt(s, NOW).welcome);
});

// ---------------------------------------------------------------- 4.4
test('4.4 una sessione di un obiettivo finita: avanzamento e prossima', () => {
  const s = epState();
  applyOps(s, [{ action: 'plan_goal', title: "Far uscire l'EP" }], NOW);
  const g = s.goals[0];
  const mine = s.items.filter((x) => x.goalId === g.id);
  const at = new Date(2026, 9, 6, 21, 0).getTime();
  applyOps(s, [{ action: 'complete', id: mine[0].id }, { action: 'complete', id: mine[1].id }], at - 3600e3);
  applyOps(s, [{ action: 'complete', id: mine[2].id }], at);
  const note = companion.sessionDoneNote(s, mine[2].id, planDays(s, at, 7), at);
  assert.ok(note);
  assert.match(note.text, new RegExp(`^${mine[2].title} fatto · 3 di ${mine.length} per l'EP · Prossima: .+ alle \\d\\d:\\d\\d$`));
  assert.ok(note.nextId);
  // un'attività fuori da un obiettivo: niente nota
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Spesa', duration_min: 30 }], at);
  assert.equal(companion.sessionDoneNote(s, s.items.at(-1).id, planDays(s, at, 7), at), null);
});

test('4.4 «Sì, archivialo»: l\'obiettivo resta con la sua storia e una frase calma', () => {
  const s = epState();
  applyOps(s, [{ action: 'plan_goal', title: "Far uscire l'EP", sessions: [{ key: 'a', title: 'Beat 01', duration_min: 90 }, { key: 'b', title: 'Beat 02', duration_min: 90 }] }], NOW);
  const g = s.goals[0];
  const [a, b] = s.items.filter((x) => x.goalId === g.id);
  applyOps(s, [{ action: 'complete', id: a.id, actual_min: 100 }], new Date(2026, 9, 12, 21).getTime());
  applyOps(s, [{ action: 'complete', id: b.id, actual_min: 80 }], new Date(2026, 10, 25, 21).getTime());
  const o = companion.briefing(s, planDays(s, NOW, 7), NOW, {}).find((x) => x.id === 'done-' + g.id);
  assert.ok(o);
  const res = companion.answerObservation(s, 'goal-done', g.id, { now: new Date(2026, 10, 25, 22).getTime() });
  assert.equal(res.toast, "L'EP è fatto: 2 sessioni, 3 ore, dal 12 ottobre al 25 novembre.");
  assert.equal(s.goals.length, 0, 'non è più tra gli obiettivi aperti');
  const done = s.goalsDone.find((x) => x.id === g.id);
  assert.ok(done.archivedAt);
  assert.deepEqual(done.history, { sessions: 2, minutes: 180, from: '2026-10-12', to: '2026-11-25' });
  const ctx = vm.context({ state: s, now: NOW, fits: {} });
  assert.equal(ctx.goalsDone.length, 1);
  assert.match(ctx.goalsDone[0].text, /2 sessioni, 3 ore, dal 12 ottobre al 25 novembre/);
});

// ---------------------------------------------------------------- 4.5
test('4.5 il tick aggiorna solo oggi: gli altri giorni restano quelli già calcolati', () => {
  const s = epState();
  applyOps(s, [{ action: 'plan_goal', title: "Far uscire l'EP" }], NOW);
  const plan = planDays(s, NOW, 7);
  const next = scheduler.refreshToday(s, plan, NOW + 30000);
  assert.ok(next);
  for (const d of Object.keys(plan)) if (d !== TODAY) assert.equal(next[d], plan[d], d);
  assert.notEqual(next[TODAY], plan[TODAY]);
});

test('4.5 se oggi cambia cosa entra, si ripianifica tutto', () => {
  const s = freshState();
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Relazione', duration_min: 120 }], NOW);
  const plan = planDays(s, NOW, 7);
  assert.ok(plan[TODAY].blocks.some((b) => b.item.title === 'Relazione'));
  // a fine giornata la relazione non entra più oggi: il resto del piano va rifatto
  const late = new Date(2026, 9, 6, 22, 30).getTime();
  assert.equal(scheduler.refreshToday(s, plan, late), null);
});

// ---------------------------------------------------------------- 4.6
test('4.6 la pausa dopo il lavoro ha un titolo che non va a capo a metà parola', () => {
  const s = freshState();
  applyOps(s, [{ action: 'add_recurring', title: 'Lavoro', start_time: '09:00', end_time: '18:00', weekdays: [1, 2, 3, 4, 5] }], NOW);
  const rest = planDays(s, NOW, 1)[TODAY].blocks.find((b) => b.item.kind === 'rest');
  assert.ok(rest);
  // «decompressione» (14 lettere) a 20 px è più larga della carta stretta (152 px a 430 px): parole corte
  assert.ok(rest.item.title.split(/\s+/).every((w) => w.length <= 8), rest.item.title);
});
