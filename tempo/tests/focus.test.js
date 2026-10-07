import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusSetup, focusStart, focusPause, focusResume, focusView, focusNext, workedMin, clock, sanitizeFocus, pctAt, gaugeSvg, dotRingSvg } from '../js/focus.js';
import { themeOf } from '../js/themes.js';

const M = 60000, T0 = 1_000_000_000;

test('temi: icona e strumento dalle parole del titolo', () => {
  assert.equal(themeOf({ title: 'Yoga' }).icon, 'person-simple-tai-chi');
  assert.equal(themeOf({ title: 'Studiare diritto privato' }).tool, 'pomodoro');
  assert.equal(themeOf({ title: 'Beat 02' }).key, 'music');
  assert.equal(themeOf({ title: 'Sessione 3' }, 'Mix e Master EP').key, 'music');
  assert.equal(themeOf({ title: 'Qualcosa', theme: 'sport' }).key, 'sport');
  assert.equal(themeOf({ title: 'Cena / decompressione', kind: 'rest' }).key, 'rest');
});

test('pomodoro: 25 minuti, pausa, giro dopo; i minuti lavorati si contano', () => {
  let f = focusSetup({ id: 'a', title: 'Studio', duration: 120 }, { theme: themeOf({ title: 'Studiare' }), now: T0 });
  assert.equal(f.mode, 'pomodoro');
  assert.equal(f.minutes, 25);
  f = focusStart(f, T0);
  assert.equal(focusView(f, T0 + 10 * M).left, 15 * M);
  f = focusPause(f, T0 + 10 * M);
  assert.equal(focusView(f, T0 + 20 * M).elapsed, 10 * M, 'in pausa il tempo si ferma');
  f = focusResume(f, T0 + 20 * M);
  assert.ok(focusView(f, T0 + 35 * M).over);
  f = focusNext(f, T0 + 35 * M);
  assert.equal(f.phase, 'break');
  assert.equal(workedMin(f, T0 + 36 * M), 25);
  f = focusNext(f, T0 + 41 * M);
  assert.deepEqual([f.phase, f.round], ['ready', 2]);
});

test('timer semplice: dura quanto l\'attività, poi aspetta una scelta', () => {
  let f = focusStart(focusSetup({ id: 'y', title: 'Yoga', duration: 60 }, { theme: themeOf({ title: 'Yoga' }), now: T0 }), T0);
  assert.equal(f.minutes, 60);
  f = focusNext(f, T0 + 61 * M);
  assert.equal(f.phase, 'done');
  assert.equal(workedMin(f, T0 + 70 * M), 60);
});

test('orologio, validazione e disegni', () => {
  assert.equal(clock(25 * M), '25:00');
  assert.equal(clock(65 * M), '1:05:00');
  assert.equal(sanitizeFocus({ itemId: 'x', phase: 'boh', minutes: 9999 }).minutes, 240);
  assert.equal(sanitizeFocus({ itemId: 5 }), null);
  assert.equal(pctAt(0, 188, { left: 0, top: 0, width: 334, height: 207 }), 0);
  assert.equal(pctAt(334, 188, { left: 0, top: 0, width: 334, height: 207 }), 1);
  assert.match(gaugeSvg({ pct: 0.25, running: true }), /animateMotion/);
  assert.equal((dotRingSvg({ pct: 0.5 }).match(/class="d on"/g) || []).length, 56);
});
