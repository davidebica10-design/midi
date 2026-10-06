import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, freshState, epState } from './helpers.js';
import { applyOps } from '../js/store.js';
import { learnedObservations, learnedList, forgetLearned } from '../js/learn.js';

function doneBeats(s, actuals) {
  for (const [i, a] of actuals.entries()) {
    applyOps(s, [{ action: 'add', kind: 'task', title: `Beat 0${i + 1}`, duration_min: 45, duration_is_estimate: true }], NOW);
    const it = s.items.at(-1);
    applyOps(s, [{ action: 'complete', id: it.id, actual_min: a }], NOW + i * 60000);
  }
}

test('durate: con 3 campioni la mediana corregge le stime, e lo dice una volta', () => {
  const s = freshState();
  doneBeats(s, [70, 65, 75]);
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Beat 04', duration_min: 45, duration_is_estimate: true }], NOW);
  assert.equal(s.items.at(-1).duration, 70);
  const obs = learnedObservations(s, NOW);
  assert.match(obs[0].text, /«Beat» lo chiudi in circa 70 minuti, non 45/);
  // una durata detta dall'utente non viene toccata
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Beat 05', duration_min: 45 }], NOW);
  assert.equal(s.items.at(-1).duration, 45);
});

test('durate: con 2 campioni non cambia niente', () => {
  const s = freshState();
  doneBeats(s, [90, 90]);
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Beat 03', duration_min: 45, duration_is_estimate: true }], NOW);
  assert.equal(s.items.at(-1).duration, 45);
  assert.equal(learnedObservations(s, NOW).length, 0);
});

test('durate: "Non cambiarle" e "Dimentica" riportano le stime come prima', () => {
  const s = freshState();
  doneBeats(s, [70, 65, 75]);
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Beat 04', duration_min: 45, duration_is_estimate: true }], NOW);
  forgetLearned(s, 'w:beat', NOW + 1);
  assert.equal(s.items.at(-1).duration, 45);
  assert.ok(learnedList(s, NOW).every((r) => !r.active));
});

test('fasce orarie: due settimane di sessioni saltate la mattina → una domanda, non un cambio', () => {
  const s = freshState();
  const day = 864e5;
  s.log = [];
  for (let i = 0; i < 6; i++) s.log.push({ type: 'skip', at: NOW - (13 - i * 2) * day, start: 8 * 60 });
  s.log.push({ type: 'done', at: NOW - 3 * day, start: 8 * 60 });
  for (let i = 0; i < 4; i++) s.log.push({ type: 'done', at: NOW - (12 - i * 3) * day, start: 20 * 60 });
  const before = JSON.stringify(s.prefs);
  const obs = learnedObservations(s, NOW);
  const slot = obs.find((o) => o.id === 'slot-mattina');
  assert.ok(slot, JSON.stringify(obs));
  assert.match(slot.text, /mattino.*1 su 7.*sera/);
  assert.equal(JSON.stringify(s.prefs), before);
});

test('fasce orarie: meno di 10 giorni di dati, nessuna proposta', () => {
  const s = freshState();
  s.log = Array.from({ length: 6 }, (_, i) => ({ type: 'skip', at: NOW - i * 864e5, start: 8 * 60 }));
  assert.equal(learnedObservations(s, NOW).length, 0);
});
