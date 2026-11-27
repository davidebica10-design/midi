import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOODS, STATES, STATES_IN_SYNC, stateSpec, sceneFor } from '../js/genui.js';
import { emptyState, migrate } from '../js/store.js';
import { planDays } from '../js/scheduler.js';
import * as vm from '../js/viewmodel.js';

const card = (id, extra = {}) => ({ type: 'task', id, title: `Carta ${id}`, ...extra });
const cards = (n) => Array.from({ length: n }, (_, i) => card('c' + i, { start: `1${i}:00` }));
const sc = (mood) => ({ mood });
const ctx = (c, extra = {}) => ({ cards: c, isToday: true, ...extra });
const ids = (l) => l.map((c) => c.id);

test('ogni umore ha il suo stato e ogni stato un umore', () => {
  assert.deepEqual(Object.keys(STATES).sort(), Object.keys(MOODS).sort());
  assert.equal(STATES_IN_SYNC, true);
});

test('limiti di carte per stato', () => {
  const lim = { empty: 0, before: 2, doing: 2, focus: 1, full: 3, evening: 0, normal: null, first: null, off: null };
  for (const [k, v] of Object.entries(lim)) assert.equal(STATES[k].cards, v, k);
});

test('con 6 carte ogni stato mostra quante ne ammette', () => {
  const c = cards(6);
  for (const [k, v] of Object.entries({ before: 2, doing: 2, focus: 1, full: 3, empty: 0, evening: 0 })) {
    const r = stateSpec(sc(k), ctx(c));
    assert.equal(r.state, k);
    assert.equal(r.visible.length, v, k);
    assert.equal(r.hidden.length, 6 - v, k);
  }
  for (const k of ['normal', 'first', 'off']) {
    const r = stateSpec(sc(k), ctx(c));
    assert.equal(r.visible.length, 6, k);
    assert.equal(r.more, null, k);
  }
});

test('le carte «missed» restano sempre in vista e non contano nel limite', () => {
  const c = [card('m1', { type: 'missed' }), card('a'), card('b'), card('c'), card('m2', { type: 'missed' }), card('d'), card('e')];
  const r = stateSpec(sc('focus'), ctx(c));
  assert.deepEqual(ids(r.visible), ['m1', 'a', 'm2']);
  assert.deepEqual(ids(r.hidden), ['b', 'c', 'd', 'e']);
  const r0 = stateSpec(sc('evening'), ctx(c));
  assert.deepEqual(ids(r0.visible), ['m1', 'm2']);
});

test('l\'ordine delle carte è conservato', () => {
  const r = stateSpec(sc('full'), ctx(cards(8)));
  assert.deepEqual(ids(r.visible), ['c0', 'c1', 'c2']);
  assert.deepEqual(ids(r.hidden), ['c3', 'c4', 'c5', 'c6', 'c7']);
});

test('una sola carta nascosta viene mostrata invece di fare un appiglio', () => {
  const r = stateSpec(sc('full'), ctx(cards(4)));
  assert.equal(r.visible.length, 4);
  assert.equal(r.hidden.length, 0);
  assert.equal(r.more, null);
  const e = stateSpec(sc('focus'), ctx(cards(2)));
  assert.equal(e.visible.length, 2);
  assert.equal(e.more, null);
});

test('l\'etichetta «Altre» ha conteggio e orario della prima carta nascosta, senza punti esclamativi', () => {
  const r = stateSpec(sc('before'), ctx(cards(5)));
  assert.equal(r.more.count, 3);
  assert.equal(r.more.from, '12:00');
  assert.equal(r.more.label, 'Altre 3 · dalle 12:00');
  assert.ok(!r.more.label.includes('!'));
});

test('senza orario sulle carte nascoste l\'etichetta è solo il conteggio', () => {
  const c = [card('a'), card('b'), card('c'), card('d')];
  const r = stateSpec(sc('before'), ctx(c));
  assert.equal(r.more.from, null);
  assert.equal(r.more.label, 'Altre 2');
  assert.ok(!r.more.label.includes('!'));
});

test('«from» salta le carte nascoste senza orario e prende la prima con orario', () => {
  const c = [card('a'), card('b'), card('c'), card('d', { start: '' }), card('e', { start: '17:30' })];
  const r = stateSpec(sc('before'), ctx(c));
  assert.equal(r.more.from, '17:30');
});

test('con expanded: true si vede tutto e non c\'è l\'appiglio', () => {
  const r = stateSpec(sc('focus'), ctx(cards(7)), { expanded: true });
  assert.equal(r.visible.length, 7);
  assert.deepEqual(r.hidden, []);
  assert.equal(r.more, null);
});

test('scena nulla o giorno non di oggi si comportano come «normal»', () => {
  const c = cards(6);
  for (const r of [stateSpec(null, ctx(c)), stateSpec(sc('focus'), ctx(c, { isToday: false })), stateSpec(sc('focus'), { cards: c }), stateSpec(sc('inventato'), ctx(c))]) {
    assert.equal(r.state, 'normal');
    assert.equal(r.visible.length, 6);
    assert.equal(r.more, null);
  }
});

test('azione primaria: «Aggiungi» nel giorno libero, anche senza now', () => {
  assert.deepEqual(stateSpec(sc('empty'), ctx([])).primary, { type: 'add', label: 'Aggiungi' });
  assert.equal(stateSpec(sc('empty'), ctx([], { now: { action: { type: 'start', label: 'Inizia' } } })).primary.type, 'add');
});

test('azione primaria: passa now.action solo se il tipo è ammesso nello stato', () => {
  const start = { type: 'start', label: 'Inizia' };
  const complete = { type: 'complete', label: 'Fatto' };
  assert.equal(stateSpec(sc('doing'), ctx([], { now: { action: start } })).primary, null);
  assert.equal(stateSpec(sc('focus'), ctx([], { now: { action: start } })).primary, null);
  assert.equal(stateSpec(sc('doing'), ctx([], { now: { action: complete } })).primary, complete);
  assert.equal(stateSpec(sc('normal'), ctx([], { now: { action: start } })).primary, start);
  assert.equal(stateSpec(sc('full'), ctx([], { now: { action: complete } })).primary, complete);
  assert.equal(stateSpec(sc('before'), ctx([], { now: { action: { type: 'sposta' } } })).primary, null);
});

test('azione primaria: mai inventata e sempre nulla di sera', () => {
  assert.equal(stateSpec(sc('normal'), ctx(cards(3))).primary, null);
  assert.equal(stateSpec(sc('normal'), ctx([], { now: {} })).primary, null);
  assert.equal(stateSpec(sc('normal'), ctx([], { now: { action: null } })).primary, null);
  for (const t of ['start', 'complete', 'add']) assert.equal(stateSpec(sc('evening'), ctx([], { now: { action: { type: t } } })).primary, null);
});

test('input nulli, strani o ostili non fanno lanciare', () => {
  const bad = [undefined, 0, '', 'x', 5, [], {}, { cards: null }, { cards: 'abc' }, { cards: { length: 3 } }, { cards: [null, undefined, 3, 'x', card('a')], isToday: true, now: 'x' }, { isToday: true, now: { action: 5 } }];
  for (const b of bad) {
    for (const s of [undefined, null, 0, 'x', {}, sc('focus'), sc('__proto__'), sc('toString'), sc(null)]) {
      assert.doesNotThrow(() => stateSpec(s, b), JSON.stringify(b));
      const r = stateSpec(s, b);
      assert.ok(Array.isArray(r.visible) && Array.isArray(r.hidden));
    }
  }
  assert.doesNotThrow(() => stateSpec());
});

// DIFETTO NOTO: i parametri predefiniti coprono solo undefined; null fa lanciare la destrutturazione.
// Atteso: stateSpec(scena, null) e stateSpec(scena, ctx, null) non lanciano mai (contratto «non lancia mai»).
test('contesto o opzioni null non fanno lanciare', () => {
  assert.doesNotThrow(() => stateSpec(sc('focus'), null));
  assert.doesNotThrow(() => stateSpec(null, null));
  assert.doesNotThrow(() => stateSpec(sc('focus'), ctx(cards(4)), null));
  assert.equal(stateSpec(sc('focus'), null).state, 'normal');
});

test('carte con testi ostili passano intatte (l\'escape è del disegno, non della scelta)', () => {
  const c = [card('<img src=x onerror=alert(1)>', { title: '<b>' + 'x'.repeat(5000) }), card('a'), card('b'), card('c')];
  const r = stateSpec(sc('before'), ctx(c));
  assert.equal(r.visible[0].title, c[0].title);
});

test('è pura: non cambia gli ingressi e dà lo stesso risultato due volte', () => {
  const c = [card('m', { type: 'missed' }), ...cards(5)];
  const scene = sc('before');
  const now = { action: { type: 'start', label: 'Inizia' } };
  const input = { now, cards: c, isToday: true };
  const snap = JSON.stringify([scene, input]);
  const a = stateSpec(scene, input);
  const b = stateSpec(scene, input);
  assert.equal(JSON.stringify([scene, input]), snap);
  assert.deepEqual(a, b);
  a.visible.push(1);
  assert.equal(c.length, 6);
});

// ---------------------------------------------------------------- integrazione con la pipeline vera
const NOW = Date.parse('2026-10-12T10:00:00');

function dayState(nTasks) {
  const s = emptyState();
  s.onboarded = true;
  s.goals = [{ id: 'g1', title: 'Studiare analisi', due: '2026-11-30', projectId: null, note: '', at: NOW, planned: true }];
  for (let k = 0; k < nTasks; k++) {
    s.items.push({ id: 'i' + k, title: `Compito ${k}`, kind: 'task', date: '2026-10-12', start: null, duration: 45, baseDuration: 45, priority: 2, energy: 3, status: 'todo', dependsOn: [], project: null, goalId: 'g1', spent: 0, createdAt: NOW + k, updatedAt: NOW });
  }
  return migrate(s, NOW);
}

function pipeline(state, adaptive = true) {
  if (!adaptive) state.prefs.ui = { ...(state.prefs.ui || {}), adaptive: false };
  const plan = planDays(state, NOW, 14);
  const view = vm.today({ state, plan, now: NOW, fits: {}, env: {} });
  const scene = sceneFor({ state, plan, now: NOW, view });
  return { view, scene, spec: stateSpec(scene, { now: view.now, cards: view.cards, isToday: view.isToday }) };
}

test('pipeline: giornata piena, lo stato segue la scena e nessuna carta si perde', () => {
  const { view, scene, spec } = pipeline(dayState(12));
  assert.ok(view.cards.length > 3, 'servono più carte del limite');
  assert.equal(spec.state, scene.mood);
  assert.equal(spec.visible.length + spec.hidden.length, view.cards.length);
  assert.deepEqual([...spec.visible, ...spec.hidden].map((c) => c.id).sort(), view.cards.map((c) => c.id).sort());
  const lim = STATES[spec.state].cards;
  if (lim !== null) assert.ok(spec.visible.filter((c) => c.type !== 'missed').length <= Math.max(lim, view.cards.length - lim === 1 ? lim + 1 : lim));
  if (spec.more) assert.equal(spec.more.count, spec.hidden.length);
  const prima = pipeline(dayState(12)).spec;
  assert.deepEqual(prima, spec, 'ripetibile');
});

test('pipeline: giornata libera, nessuna carta e azione primaria «Aggiungi»', () => {
  const s = dayState(1);
  s.items = [];
  const { view, scene, spec } = pipeline(s);
  assert.equal(view.cards.length, 0);
  assert.equal(scene.mood, 'empty');
  assert.equal(spec.state, 'empty');
  assert.equal(spec.primary.type, 'add');
  assert.deepEqual(spec.visible, []);
  assert.equal(spec.more, null);
});

test('pipeline: adattamento spento, scena nulla e tutto in vista', () => {
  const { view, scene, spec } = pipeline(dayState(12), false);
  assert.equal(scene, null);
  assert.equal(spec.state, 'normal');
  assert.equal(spec.visible.length, view.cards.length);
});
