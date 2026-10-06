import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TODAY } from './helpers.js';
import { pickObservations } from '../js/companion.js';
import { validatePlan } from '../js/templates.js';
import { sanitizeOps } from '../js/store.js';

test('massimo 2 osservazioni al giorno, stabili durante la giornata', () => {
  const c = (id) => ({ id, text: id });
  let r = pickObservations([c('a'), c('b'), c('c')], null, TODAY);
  assert.deepEqual(r.shown.map((x) => x.id), ['a', 'b']);
  // "a" risolta: il posto non si libera per una nuova osservazione oggi
  r = pickObservations([c('b'), c('c'), c('d')], r.seen, TODAY);
  assert.deepEqual(r.shown.map((x) => x.id), ['b']);
  // domani si riparte
  r = pickObservations([c('c'), c('d')], r.seen, '2026-10-07');
  assert.deepEqual(r.shown.map((x) => x.id), ['c', 'd']);
});

test('piano dall\'AI: validato, tetto di 30 sessioni, niente dipendenze circolari', () => {
  const raw = { sessions: [
    { key: 'a', title: 'Beat 01', duration_min: 120, energy: 3, after: ['b'] },
    { key: 'b', title: 'Mix 01', duration_min: 90, energy: 3, after: ['a'] },
    { key: 'c', title: '', duration_min: 60 },
    { key: 'd', title: 'Troppo lunga', duration_min: 900 },
    ...Array.from({ length: 40 }, (_, i) => ({ key: 'x' + i, title: 'S' + i, duration_min: 30, energy: 9 })),
  ] };
  const v = validatePlan(raw);
  assert.ok(v.length <= 30);
  assert.deepEqual(v[0].after, []);
  assert.deepEqual(v[1].after, ['a']);
  assert.ok(v.every((s) => s.title && s.duration >= 10 && s.duration <= 240 && [1, 2, 3].includes(s.energy)));
  assert.equal(validatePlan({ sessions: 'nope' }), null);
});

test('operazioni dall\'AI: azioni e campi non validi vengono scartati', () => {
  const { ops, dropped } = sanitizeOps([
    { action: 'add', title: 'Spesa', duration_min: '30', date: 'domani', start_time: '25:99', hack: 1 },
    { action: 'rm -rf' },
    { action: 'complete' },
    null,
  ]);
  assert.equal(ops.length, 1);
  assert.equal(dropped, 3);
  assert.deepEqual(ops[0], { action: 'add', title: 'Spesa', duration_min: 30 });
});
