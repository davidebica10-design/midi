import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, TODAY, freshState, say } from './helpers.js';
import { applyOps } from '../js/store.js';
import { contextOps } from '../js/companion.js';
import { planDays, weekday } from '../js/scheduler.js';
import { goalFit } from '../js/goals.js';

const ANSWERS = {
  goals: "Far uscire l'EP con MIDI entro fine novembre",
  constraints: 'Lavoro 9-18:30 dal lunedì al venerdì. La domenica stacco.',
  projects: 'EP, portfolio, palestra',
  prefs: 'La sera produco meglio. Max 2h di fila.',
};

function onboarded() {
  const s = freshState({ onboarded: false });
  applyOps(s, contextOps(ANSWERS, TODAY), NOW);
  return s;
}

test('un obiettivo diventa un piano di sessioni collegate a progetto e obiettivo', () => {
  const s = onboarded();
  const g = s.goals[0];
  assert.equal(g.due, '2026-11-30');
  const sessions = s.items.filter((x) => x.goalId === g.id);
  assert.ok(sessions.length >= 10 && sessions.length <= 30, `${sessions.length} sessioni`);
  assert.ok(sessions.every((x) => s.projects.find((p) => p.id === x.project)?.name === 'EP'));
  assert.ok(sessions.some((x) => x.dependsOn?.length), 'ci sono dipendenze');
});

test('scenario finale: sere dei feriali e sabato, mai la domenica, blocchi ≤ 2 h, tutto prima del 30/11', () => {
  const s = onboarded();
  assert.deepEqual(s.prefs.offDays, [0]);
  assert.equal(s.prefs.maxBlock, 120);
  assert.equal(s.prefs.focusWindow, 'sera');
  const plan = planDays(s, NOW, 56);
  const ep = s.projects.find((p) => p.name === 'EP').id;
  const blocks = Object.entries(plan).flatMap(([d, p]) => p.blocks.filter((b) => b.item.project === ep).map((b) => ({ d, ...b })));
  assert.ok(blocks.length > 0);
  for (const b of blocks) {
    const wd = weekday(b.d);
    assert.notEqual(wd, 0, `domenica ${b.d}`);
    assert.ok(b.end - b.start <= 120, `${b.item.title} ${b.end - b.start} min`);
    if (wd >= 1 && wd <= 5 && (b.item.energy || 2) >= 3) assert.ok(b.start >= 18 * 60 + 30, `${b.d} ${b.item.title} alle ${b.start}`);
  }
  assert.ok(blocks.some((b) => weekday(b.d) === 6), 'lavora anche il sabato');
  const fit = goalFit(s, s.goals[0], NOW);
  assert.equal(fit.late, 0, JSON.stringify(fit));
});

test('obiettivo senza scadenza: piano comunque, scadenza chiesta una volta', () => {
  const s = freshState();
  say(s, 'Voglio finire il portfolio');
  assert.equal(s.goals.length, 1);
  assert.equal(s.goals[0].due, null);
  assert.ok(s.items.some((x) => x.goalId === s.goals[0].id));
});

test('le sessioni non entrano prima della scadenza: lo segnala', () => {
  const s = freshState();
  applyOps(s, [{ action: 'add_recurring', title: 'Lavoro', start_time: '08:00', end_time: '22:00', weekdays: [0, 1, 2, 3, 4, 5, 6] }], NOW);
  say(s, "Voglio far uscire l'EP entro il 20/10");
  const fit = goalFit(s, s.goals[0], NOW);
  assert.ok(fit.late > 0);
});
