import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unshift } from '../src/tempo.js';

test('i timestamp scritti con l\'ora spostata tornano reali: anche ricorrenti e voci delle liste', () => {
  const localNow = 1_000_000, now = 400_000;
  const state = {
    items: [{ id: 'e1', kind: 'event', createdAt: localNow, updatedAt: localNow, checklist: [{ id: 'c1', text: 'x', at: localNow }, { id: 'c2', text: 'y', at: 5 }] }],
    recurring: [{ id: 'r1', createdAt: localNow, updatedAt: localNow, checklist: [{ id: 'c3', text: 'z', at: localNow, done: true }] }],
    goals: [], memory: [], log: [], habits: [], projects: [], chat: [], stats: { createdAt: 5 },
  };
  unshift(state, localNow, now);
  assert.deepEqual([state.items[0].createdAt, state.items[0].updatedAt, state.items[0].checklist[0].at, state.items[0].checklist[1].at], [now, now, now, 5]);
  assert.deepEqual([state.recurring[0].createdAt, state.recurring[0].updatedAt, state.recurring[0].checklist[0].at], [now, now, now]);
});
