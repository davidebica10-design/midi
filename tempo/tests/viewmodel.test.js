import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, TODAY, freshState } from './helpers.js';
import { applyOps } from '../js/store.js';
import { contextOps } from '../js/companion.js';
import { planDays, planDay } from '../js/scheduler.js';
import * as vm from '../js/viewmodel.js';

const ANSWERS = { goals: "Far uscire l'EP con MIDI entro fine novembre", constraints: 'Lavoro 9-18:30 dal lunedì al venerdì. La domenica stacco.', projects: 'EP, portfolio, palestra', prefs: 'La sera produco meglio. Max 2h di fila.' };
const setup = (now = NOW) => {
  const s = freshState({ onboarded: false });
  applyOps(s, contextOps(ANSWERS, TODAY), now);
  return { s, plan: planDays(s, now, 14), long: planDays(s, now, 60) };
};
const pf = (s) => (k) => planDay(k, s.items, s.prefs, NOW, [], s.recurring, {});

test('today(): un solo "adesso" anche durante un impegno fisso', () => {
  const at = new Date(2026, 9, 6, 18, 20).getTime();
  const { s, plan } = setup(at);
  const v = vm.today({ state: s, plan, planFor: pf(s), now: at });
  assert.ok(v.now);
  assert.equal(v.now.block.title, 'Lavoro');
  assert.ok(!v.cards.some((c) => c.type === 'event' && c.title === 'Lavoro'), 'il blocco in corso non è anche una carta');
  assert.ok(v.observations.length <= 2);
  assert.equal(v.header.greeting, 'Buonasera');
});

test('today(): stati vuoto, primo giorno, stacco', () => {
  const s = freshState();
  let v = vm.today({ state: s, plan: planDays(s, NOW, 7), now: NOW });
  assert.equal(v.status, 'first');
  applyOps(s, [{ action: 'set_pref', pref_key: 'off_days', pref_value: '0' }, { action: 'add', kind: 'task', title: 'Spesa', date: '2026-10-08' }], NOW);
  const plan = planDays(s, NOW, 7);
  assert.equal(vm.today({ state: s, plan, now: NOW, day: '2026-10-11' }).status, 'off');
  assert.equal(vm.today({ state: s, plan, now: NOW, day: '2026-10-09' }).status, 'empty');
});

test('month(): scadenze e densità delle sessioni, non il lavoro ricorrente', () => {
  const { s, plan, long } = setup();
  const months = vm.month({ state: s, longPlan: { ...long, ...plan }, planFor: pf(s), now: NOW, months: 2 });
  const nov30 = months[1].cells.find((c) => c.day === '2026-11-30');
  assert.equal(nov30.deadlines.length, 1);
  assert.match(nov30.pick.title, /EP con MIDI/);
  const all = months.flatMap((m) => m.cells);
  assert.ok(!all.some((c) => c.pick && /Lavoro/.test(c.pick.title)));
  assert.ok(all.some((c) => c.sessions > 0));
  assert.ok(all.filter((c) => c.off).every((c) => c.sessions === 0), 'domeniche vuote');
});

test('days() e context(): plurali giusti e scadenze leggibili', () => {
  const { s, plan } = setup();
  const d = vm.days({ state: s, plan, now: NOW });
  assert.ok(d.every((x) => !/\b1 impegni\b/.test(x.sub)));
  const c = vm.context({ state: s, now: NOW });
  assert.equal(c.goals[0].dueDate, '30 novembre');
  assert.equal(c.preferences.focusLabel, 'la sera');
  assert.equal(vm.onboarding().length, 5);
});

test('week(): una carta per progetto, scala dei 7 giorni, domenica di stacco', () => {
  const { s, plan, long } = setup();
  const w = vm.week({ state: s, plan, longPlan: long, now: NOW });
  assert.equal(w.monday, '2026-10-05');
  assert.equal(w.range, '5 – 11 ottobre');
  const ep = w.cards.find((c) => c.tag === 'EP');
  assert.ok(ep && +ep.value >= 4, JSON.stringify(ep));
  assert.equal(ep.ticks.length, 7);
  assert.ok(ep.ticks.find((x) => x.letter === 'D').off);
  assert.equal(ep.ticks.find((x) => x.letter === 'D').planned, 0);
  assert.match(ep.note, /^Prossima: Beat 01, oggi alle 19:15\. Scadenza 30 novembre\.$/);
  const next = vm.week({ state: s, plan, longPlan: long, now: NOW, offset: 1 });
  assert.equal(next.title, 'Settimana prossima');
  assert.equal(next.range, '12 – 18 ottobre');
});
