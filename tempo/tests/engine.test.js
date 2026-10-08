// Fase 2: il motore dice la verità (sessioni in corso, obiettivi lontani, allarmi, giorni liberi, fasce, ritmo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, TODAY, freshState, say } from './helpers.js';
import { applyOps } from '../js/store.js';
import { contextOps } from '../js/companion.js';
import * as companion from '../js/companion.js';
import * as scheduler from '../js/scheduler.js';
import * as goals from '../js/goals.js';
import * as learn from '../js/learn.js';
import * as vm from '../js/viewmodel.js';
import { simulate, projectDays, at } from './sim.js';

const { planDays, addDays, weekday, dateKey } = scheduler;
const DAY = 864e5;

function onboarded() {
  const s = freshState({ onboarded: false });
  applyOps(s, contextOps({
    goals: "Far uscire l'EP con MIDI entro fine novembre",
    constraints: 'Lavoro 9-18:30 dal lunedì al venerdì. La domenica stacco.',
    projects: 'EP, portfolio, palestra',
    prefs: 'La sera produco meglio. Max 2h di fila.',
  }, TODAY), NOW);
  return s;
}
/** Le sessioni di un obiettivo che si possono iniziare subito (senza dipendenze aperte). */
const firstSession = (s, g) => s.items.find((x) => x.goalId === g.id && x.status === 'todo' && !(x.dependsOn || []).length);
const fitIds = (obs) => obs.filter((o) => o.id.startsWith('fit-')).map((o) => o.id);
const sessions = (n, mins = 90, title = 'Sessione') => Array.from({ length: n }, (_, i) => ({ key: 's' + i, title: `${title} ${i + 1}`, duration_min: mins, energy: 3 }));

// ---------------------------------------------------------------- 2.1
test('2.1 una sessione in corso (avviata col timer) non manda fuori le sessioni che dipendono da lei', () => {
  const s = onboarded();
  const g = s.goals[0];
  const at2030 = new Date(2026, 9, 6, 20, 30).getTime();
  const before = goals.goalFit(s, g, at2030);
  const it = firstSession(s, g);
  applyOps(s, [{ action: 'start', id: it.id }], new Date(2026, 9, 6, 20, 0).getTime());
  const during = goals.goalFit(s, g, at2030);
  assert.equal(during.late, before.late, `prima ${before.late}, in corso ${during.late}`);
  assert.equal(during.unplaced, before.unplaced);
});

test('2.1 una sessione ancorata nella sua fascia (in corso secondo il piano) non manda fuori le altre', () => {
  const s = onboarded();
  const g = s.goals[0];
  const at2030 = new Date(2026, 9, 6, 20, 30).getTime();
  const before = goals.goalFit(s, g, at2030);
  const it = firstSession(s, g);
  s.anchors = { [it.id]: { day: TODAY, start: 20 * 60, end: 21 * 60 } };
  const during = goals.goalFit(s, g, at2030);
  assert.equal(during.late, before.late, `prima ${before.late}, in corso ${during.late}`);
});

// ---------------------------------------------------------------- 2.2
/** Poco tempo libero (solo il sabato, una sessione) e un album lontano 200 giorni con 30 sessioni. */
function farAlbum() {
  const s = freshState();
  applyOps(s, [
    { action: 'add_recurring', title: 'Lavoro', start_time: '08:00', end_time: '22:00', weekdays: [1, 2, 3, 4, 5] },
    { action: 'set_pref', pref_key: 'off_days', pref_value: '0' },
    { action: 'add_project', title: 'Album' },
    { action: 'set_goal', title: "Finire l'album", deadline: addDays(TODAY, 200), project: 'Album' },
  ], NOW);
  s.prefs.projectDayCap = 120;
  applyOps(s, [{ action: 'plan_goal', title: "Finire l'album", sessions: sessions(30, 120, 'Brano') }], NOW);
  return s;
}

test('2.2 un obiettivo a 200 giorni con 30 sessioni non è «in ritardo»', () => {
  const s = farAlbum();
  const g = s.goals[0];
  assert.equal(s.items.filter((x) => x.goalId === g.id).length, 30);
  const fit = goals.goalFit(s, g, NOW, planDays(s, NOW, goals.horizonFor(s, NOW)));
  assert.equal(fit.late, 0, JSON.stringify(fit));
  // anche se il ritardo fosse comparso ieri, nessuna osservazione fit-
  g.lateSince = addDays(TODAY, -1);
  const plan = planDays(s, NOW, 7);
  const obs = companion.briefing(s, plan, NOW, { fits: { [g.id]: fit } });
  assert.deepEqual(fitIds(obs), []);
});

// ---------------------------------------------------------------- 2.3
/** Un obiettivo che davvero non ci sta: lavoro dalle 8 alle 22 tutti i giorni, EP entro il 20 ottobre. */
function tight(due = '2026-10-20') {
  const s = freshState();
  applyOps(s, [{ action: 'add_recurring', title: 'Lavoro', start_time: '08:00', end_time: '22:00', weekdays: [0, 1, 2, 3, 4, 5, 6] }], NOW);
  say(s, `Voglio far uscire l'EP entro il ${due.slice(8)}/${due.slice(5, 7)}`);
  return s;
}
const fitsAt = (s, now) => Object.fromEntries(s.goals.map((g) => [g.id, goals.goalFit(s, g, now)]));

test('2.3 «non entra» compare solo se il ritardo dura da due giorni', () => {
  const s = tight();
  const g = s.goals[0];
  let fits = fitsAt(s, NOW);
  assert.ok(fits[g.id].late > 0);
  goals.trackLate(s, fits, NOW, planDays(s, NOW, 7));
  assert.equal(g.lateSince, TODAY);
  assert.deepEqual(fitIds(companion.briefing(s, planDays(s, NOW, 7), NOW, { fits })), [], 'il primo giorno no');
  const tomorrow = NOW + DAY;
  fits = fitsAt(s, tomorrow);
  goals.trackLate(s, fits, tomorrow, planDays(s, tomorrow, 7));
  assert.equal(g.lateSince, TODAY, 'resta il primo giorno');
  assert.deepEqual(fitIds(companion.briefing(s, planDays(s, tomorrow, 7), tomorrow, { fits })), ['fit-' + g.id], 'il secondo giorno sì');
  // se il ritardo sparisce, si riparte da capo
  goals.trackLate(s, { [g.id]: { ...fits[g.id], late: 0 } }, tomorrow, planDays(s, tomorrow, 7));
  assert.equal(g.lateSince, null);
});

test('2.3 niente «non entra» mentre una sessione dello stesso obiettivo è in corso', () => {
  const s = tight();
  const g = s.goals[0];
  g.lateSince = addDays(TODAY, -3);
  const it = firstSession(s, g);
  applyOps(s, [{ action: 'start', id: it.id }], NOW);
  const now = NOW + 20 * 60000;
  const fits = fitsAt(s, now);
  assert.ok(fits[g.id].late > 0);
  assert.deepEqual(fitIds(companion.briefing(s, planDays(s, now, 7), now, { fits })), []);
});

test('2.3 «Sposta al…» non propone mai una data passata né una data a meno di 7 giorni', () => {
  // scadenza oggi, sessioni che finiscono dopodomani: prima proponeva «Sposta a dopodomani»
  const s = freshState();
  applyOps(s, [{ action: 'add_project', title: 'EP' }, { action: 'set_goal', title: "Far uscire l'EP", deadline: TODAY, project: 'EP' }], NOW);
  applyOps(s, [{ action: 'plan_goal', title: "Far uscire l'EP", sessions: sessions(5, 120, 'Beat') }], NOW);
  const g = s.goals[0];
  g.lateSince = addDays(TODAY, -2);
  const fits = fitsAt(s, NOW);
  assert.ok(fits[g.id].late > 0 && fits[g.id].lastDay < addDays(TODAY, 7), JSON.stringify(fits[g.id]));
  const obs = companion.briefing(s, planDays(s, NOW, 7), NOW, { fits }).find((o) => o.id === 'fit-' + g.id);
  assert.ok(obs, 'osservazione presente');
  const to = obs.actions.find((a) => a.act === 'extend').arg.split('|')[1];
  assert.ok(to >= addDays(TODAY, 7), `proposto ${to}`);
});

test('2.3 scadenza già passata: «Lo chiudiamo o scegliamo una nuova data?»', () => {
  const s = freshState();
  applyOps(s, [{ action: 'add_project', title: 'EP' }, { action: 'set_goal', title: "Far uscire l'EP", deadline: '2026-09-30', project: 'EP' }], NOW - 30 * DAY);
  applyOps(s, [{ action: 'plan_goal', title: "Far uscire l'EP", sessions: sessions(5, 60, 'Beat') }], NOW - 30 * DAY);
  const g = s.goals[0];
  g.lateSince = addDays(TODAY, -5);
  const fits = fitsAt(s, NOW);
  const obs = companion.briefing(s, planDays(s, NOW, 7), NOW, { fits });
  assert.deepEqual(fitIds(obs), []);
  const past = obs.find((o) => o.id === 'past-' + g.id);
  assert.ok(past, JSON.stringify(obs.map((o) => o.id)));
  assert.equal(past.text, "L'EP doveva uscire il 30 settembre. Lo chiudiamo o scegliamo una nuova data?");
  assert.deepEqual(past.actions.map((a) => a.label), ['È fatto', 'Nuova data', 'Toglilo']);
  // «Toglilo»: via l'obiettivo e le sue sessioni aperte
  const res = companion.answerObservation(s, 'goal-remove', g.id, { now: NOW });
  assert.ok(res);
  assert.equal(s.goals.length, 0);
  assert.equal(s.items.filter((x) => x.goalId === g.id && x.status !== 'done').length, 0);
});

// ---------------------------------------------------------------- 2.4
/** Registro di sessioni: n per ogni lunedì delle ultime 4 settimane (alla sera), quasi tutte saltate. */
function mondayLog(n, { habit = false, weeks = 4 } = {}) {
  const log = [];
  for (let w = 1; w <= weeks; w++) {
    const monday = NOW - (w * 7 - 6) * DAY; // NOW è martedì
    for (let k = 0; k < n; k++) log.push({ type: k === 0 && w === 1 ? 'done' : 'skip', at: monday + (8 + k) * 3600e3, start: 20 * 60, ...(habit ? { habit: 'h1' } : {}) });
  }
  // gli altri giorni va bene (così la sera nel complesso non è «da spostare»)
  for (let d = 2; d < 28; d++) if (weekday(dateKey(new Date(NOW - d * DAY))) !== 1) log.push({ type: 'done', at: NOW - d * DAY, start: 20 * 60 });
  return log;
}
const dayObs = (s) => learn.learnedObservations(s, NOW).filter((o) => o.id.startsWith('day-'));

test('2.4 servono almeno 8 sessioni in quel giorno nelle ultime 4 settimane', () => {
  const s = freshState();
  s.log = mondayLog(3, { weeks: 2 }); // 6 sessioni, 5 saltate: prima bastavano per proporre
  assert.deepEqual(dayObs(s), []);
  s.log = mondayLog(2); // 8 sessioni
  assert.deepEqual(dayObs(s).map((o) => o.id), ['day-1']);
});

test('2.4 mai un giorno libero in più se ne restano 3 o meno per i progetti', () => {
  const s = freshState();
  s.log = mondayLog(3);
  s.prefs.offDays = [0, 6, 5];
  s.prefs.restDays = [{ wd: 4, until: addDays(TODAY, 20) }];
  assert.deepEqual(dayObs(s), []);
});

test('2.4 il giorno liberato dal companion scade dopo 4 settimane e si vede nel contesto', () => {
  const s = freshState();
  s.log = mondayLog(3);
  const obs = dayObs(s)[0];
  const act = obs.actions.find((a) => a.act === 'day-off');
  companion.answerObservation(s, act.act, act.arg, { now: NOW });
  assert.deepEqual(s.prefs.offDays, [], 'non diventa un giorno di stacco per sempre');
  assert.deepEqual(s.prefs.restDays, [{ wd: 1, until: addDays(TODAY, 28) }]);
  assert.equal(scheduler.isOffDay(s.prefs, '2026-10-12'), true, 'lunedì prossimo libero');
  assert.equal(scheduler.isOffDay(s.prefs, '2026-11-09'), false, 'dopo 4 settimane si torna a guardare i dati');
  // un progetto non va di lunedì finché dura
  applyOps(s, [{ action: 'add_project', title: 'EP' }, { action: 'add', kind: 'task', title: 'Beat 01', duration_min: 60, project: 'EP', earliest_date: '2026-10-12' }], NOW);
  const plan = planDays(s, NOW, 7);
  assert.equal(plan['2026-10-12'].blocks.filter((b) => b.type === 'flex').length, 0);
  // nel contesto si vede e si toglie con un tocco
  const ctx = vm.context({ state: s, now: NOW, fits: {} });
  assert.equal(ctx.constraints.restDays.length, 1);
  assert.match(ctx.constraints.restDays[0].text, /Lunedì libero dai progetti fino al 3 novembre/);
  learn.dropRestDay(s, 1);
  assert.deepEqual(s.prefs.restDays, []);
});

test('2.4 migrazione: i giorni liberati dal companion (per sempre, nelle versioni prima) diventano a tempo', async () => {
  const { migrate, SCHEMA } = await import('../js/store.js');
  const v3 = {
    schema: 3, onboarded: true, items: [], chat: [], recurring: [],
    memory: [{ id: 'm1', text: 'La domenica stacco', category: 'vincolo' }],
    prefs: { offDays: [0, 1, 3] },                       // domenica detta da te, lunedì e mercoledì dal companion
    learned: { durations: {}, slots: { d1: NOW - 40 * DAY, d3: NOW - 10 * DAY, d0: NOW - 90 * DAY } },
  };
  const s = migrate(v3, NOW);
  assert.equal(s.schema, SCHEMA);
  assert.deepEqual(s.prefs.offDays, [0], 'la domenica detta da te resta');
  assert.deepEqual(s.prefs.restDays, [{ wd: 1, until: addDays(TODAY, 28) }, { wd: 3, until: addDays(TODAY, 28) }]);
  // una seconda migrazione non cambia niente
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(s)), NOW).prefs, s.prefs);
});

test('2.4 le sessioni delle abitudini saltate ad app chiusa non contano', () => {
  const s = freshState();
  s.log = mondayLog(3, { habit: true });
  assert.deepEqual(dayObs(s), []);
  const st = learn.slotStats(s, NOW);
  assert.ok(!st.day[1], JSON.stringify(st.day));
});

test('2.4 un anno accettando ogni proposta e facendo il 60%: restano almeno 3 giorni per i progetti', () => {
  const s = freshState();
  const start = TODAY;
  applyOps(s, [
    { action: 'add_recurring', title: 'Lavoro', start_time: '09:00', end_time: '18:00', weekdays: [1, 2, 3, 4, 5] },
    { action: 'set_pref', pref_key: 'off_days', pref_value: '0' },
    { action: 'add_project', title: 'EP' }, { action: 'add_project', title: 'Portfolio' },
  ], NOW);
  const newGoal = (name, day, weeks) => {
    const title = `${name} ${day}`;
    applyOps(s, [{ action: 'set_goal', title, deadline: addDays(day, weeks * 7), project: name },
      { action: 'plan_goal', title, sessions: sessions(14, 90, name) }], at(day, 7 * 60));
  };
  newGoal('EP', start, 7);
  newGoal('Portfolio', start, 10);
  let minDays = 7;
  // il lunedì e il martedì l'utente fa poco, gli altri giorni di più: in media il 60%
  const rates = [0.6, 0.3, 0.45, 0.7, 0.7, 0.7, 0.75];
  simulate(s, {
    start, days: 365, seed: 7, doRate: (wd) => rates[wd],
    onDay: ({ state, day }) => {
      minDays = Math.min(minDays, projectDays(state, day));
      for (const name of ['EP', 'Portfolio']) {
        const pid = state.projects.find((p) => p.name === name).id;
        if (!state.items.some((x) => x.project === pid && x.status !== 'done')) newGoal(name, addDays(day, 1), name === 'EP' ? 7 : 10);
      }
    },
  });
  assert.ok(minDays >= 3, `giorni per i progetti scesi a ${minDays}`);
  assert.ok(projectDays(s, addDays(start, 365)) >= 3);
});

// ---------------------------------------------------------------- 2.5
function slotLog(bad, n, { goodWin = null, goodN = 0 } = {}) {
  const log = [];
  const min = { mattina: 9 * 60, pomeriggio: 15 * 60, sera: 20 * 60 };
  for (let i = 0; i < n; i++) log.push({ type: i === 0 ? 'done' : 'skip', at: NOW - (13 - (i % 13)) * DAY, start: min[bad] });
  if (goodWin) for (let i = 0; i < goodN; i++) log.push({ type: 'done', at: NOW - (12 - (i % 12)) * DAY, start: min[goodWin] });
  return log;
}
const slotObs = (s) => learn.learnedObservations(s, NOW).filter((o) => o.id.startsWith('slot-'));

test('2.5 servono almeno 8 sessioni nella fascia', () => {
  const s = freshState();
  s.log = slotLog('mattina', 7, { goodWin: 'sera', goodN: 6 });
  assert.deepEqual(slotObs(s), []);
  s.log = slotLog('mattina', 9, { goodWin: 'sera', goodN: 6 });
  assert.equal(slotObs(s).length, 1);
  assert.match(slotObs(s)[0].text, /mattino.*1 su 9.*sera/);
});

test('2.5 mai proporre una fascia senza dati', () => {
  const s = freshState();
  s.log = slotLog('sera', 10);
  assert.deepEqual(slotObs(s), []);
});

test('2.5 a chi lavora 8:30–17:30 non propone la mattina né il pomeriggio', () => {
  const s = freshState();
  applyOps(s, [{ action: 'add_recurring', title: 'Lavoro', start_time: '08:30', end_time: '17:30', weekdays: [1, 2, 3, 4, 5] }], NOW);
  // la sera va male; qualche sessione nel weekend è andata bene la mattina e il pomeriggio
  s.log = [...slotLog('sera', 10, { goodWin: 'mattina', goodN: 6 }), ...slotLog('sera', 0, { goodWin: 'pomeriggio', goodN: 6 })];
  assert.deepEqual(slotObs(s), []);
});

test('2.5 una fascia diversa da quella che hai detto tu: lo dice chiaramente', () => {
  const s = freshState();
  s.prefs.focusWindow = 'sera';
  s.log = slotLog('sera', 10, { goodWin: 'pomeriggio', goodN: 8 });
  const o = slotObs(s)[0];
  assert.ok(o);
  assert.match(o.text, /Mi avevi detto che rendi meglio la sera/);
});

// ---------------------------------------------------------------- 2.6
test('2.6 esame fra 100 giorni, 16 sessioni: al massimo 3 nella prima settimana, tutte prima della scadenza', () => {
  const s = freshState();
  const due = addDays(TODAY, 100);
  applyOps(s, [{ action: 'set_goal', title: "Preparare l'esame di diritto privato", deadline: due }], NOW);
  applyOps(s, [{ action: 'plan_goal', title: "Preparare l'esame di diritto privato", sessions: sessions(16, 90, 'Studio capitolo') }], NOW);
  const g = s.goals[0];
  assert.equal(g.projectId, null, 'non è legato a un progetto');
  const plan = planDays(s, NOW, 100);
  const placed = Object.entries(plan).flatMap(([d, p]) => p.blocks.filter((b) => b.type === 'flex' && b.item.goalId === g.id).map((b) => ({ d, id: b.id })));
  const week1 = placed.filter((b) => b.d < addDays(TODAY, 7)).length;
  assert.ok(week1 <= 3, `prima settimana: ${week1} sessioni`);
  const ids = new Set(placed.map((b) => b.id));
  assert.equal(ids.size, 16, `collocate ${ids.size} su 16`);
  assert.ok(placed.every((b) => b.d <= due), 'tutte prima della scadenza');
  // mai due sessioni dello stesso obiettivo nello stesso giorno, se la giornata non è libera
  const perDay = {};
  for (const b of placed) perDay[b.d] = (perDay[b.d] || 0) + 1;
  assert.ok(Object.values(perDay).every((n) => n <= 2));
});

test('2.6 il tetto giornaliero vale anche per gli obiettivi senza progetto', () => {
  const s = freshState();
  applyOps(s, [{ action: 'add_recurring', title: 'Lavoro', start_time: '09:00', end_time: '18:00', weekdays: [1, 2, 3, 4, 5] }], NOW);
  applyOps(s, [{ action: 'set_goal', title: 'Esame', deadline: addDays(TODAY, 12) }], NOW);
  applyOps(s, [{ action: 'plan_goal', title: 'Esame', sessions: sessions(8, 90, 'Ripasso') }], NOW);
  const g = s.goals[0];
  const plan = planDays(s, NOW, 12);
  for (const [d, p] of Object.entries(plan)) {
    const n = p.blocks.filter((b) => b.type === 'flex' && b.item.goalId === g.id).length;
    const work = [1, 2, 3, 4, 5].includes(weekday(d));
    assert.ok(n <= (work ? 1 : 2), `${d}: ${n} sessioni`);
  }
});
