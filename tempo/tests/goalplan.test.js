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

// ---------------------------------------------------------------- 3.3 l'onboarding non perde i vincoli
import { contextReview } from '../js/companion.js';

const STUDENT = {
  goals: "Passare l'esame di diritto privato entro il 20 dicembre",
  constraints: 'Lezioni dal lunedì al giovedì dalle 9 alle 13. Lavoro da casa quando posso.',
  projects: '',
  prefs: 'Studio meglio il pomeriggio.',
};

test('3.3 «Lezioni dal lunedì al giovedì dalle 9 alle 13» diventa un impegno di ogni settimana', () => {
  const ops = contextOps(STUDENT, TODAY);
  const rec = ops.find((o) => o.action === 'add_recurring');
  assert.ok(rec, JSON.stringify(ops.map((o) => o.action)));
  assert.deepEqual([rec.title, rec.weekdays, rec.start_time, rec.end_time], ['Lezioni', [1, 2, 3, 4], '09:00', '13:00']);
  // il primo piano non mette lo studio durante le lezioni
  const s = freshState({ onboarded: false });
  applyOps(s, ops, NOW);
  const plan = planDays(s, NOW, 7);
  for (const [d, p] of Object.entries(plan)) {
    if (![1, 2, 3, 4].includes(weekday(d))) continue;
    for (const b of p.blocks.filter((x) => x.type === 'flex')) assert.ok(b.end <= 9 * 60 || b.start >= 13 * 60, `${d} ${b.item.title} ${b.start}`);
  }
});

test('3.3 prima di applicare: cosa ho capito, cosa no, e i primi 7 giorni', () => {
  const r = contextReview(STUDENT, TODAY, freshState({ onboarded: false }), NOW);
  assert.ok(r.understood.includes('Ogni settimana · Lezioni · lun–gio 9:00–13:00'), r.understood.join(' | '));
  assert.ok(r.understood.some((l) => /^Obiettivo · .*diritto privato.* · entro il 20 dicembre$/.test(l)), r.understood.join(' | '));
  assert.ok(r.understood.includes('Rendi di più · il pomeriggio'), r.understood.join(' | '));
  assert.deepEqual(r.missed, [{ key: 'constraints', text: 'Lavoro da casa quando posso' }]);
  assert.equal(r.week.length, 7);
  assert.ok(r.week.every((d) => d.day && Array.isArray(d.items)));
  assert.ok(r.week.some((d) => d.items.some((x) => x.title === 'Lezioni')), 'le lezioni si vedono nella settimana');
  // niente è stato applicato
  const s = freshState({ onboarded: false });
  contextReview(STUDENT, TODAY, s, NOW);
  assert.equal(s.recurring.length, 0);
});
