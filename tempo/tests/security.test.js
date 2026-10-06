import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW } from './helpers.js';
import { migrate, safeColor } from '../js/store.js';

const evil = '"><img src=x onerror=alert(1)>';

test('backup importato: identificativi, colori e campi strani non arrivano alla pagina', () => {
  const s = migrate({
    schema: 2,
    items: [
      { id: evil, title: 'Cattiva', kind: 'task', status: 'todo', duration: 30 },
      { id: 'ok1', title: 'Buona', kind: 'task', status: 'todo', duration: '45', date: evil, project: evil, dependsOn: [evil, 'ok2'], image: evil },
    ],
    projects: [{ id: 'p1', name: 'EP', color: `red;background:url(javascript:alert(1))` }, { id: evil, name: 'X', color: '#fff' }],
    goals: [{ id: 'g1', title: 'Obiettivo', due: evil, projectId: 'p1' }],
    memory: [{ id: 'm1', text: 'ok', category: evil }],
    recurring: [{ id: 'r1', title: 'Lavoro', start: 540, end: 1110, weekdays: [1, 9, evil] }],
    prefs: { offDays: [0, evil], buffer: evil, focusWindow: evil, availability: { [evil]: {} } },
    chat: [{ id: evil, text: 'x' }],
    anchors: { [evil]: {} },
  }, NOW);
  assert.deepEqual(s.items.map((x) => x.id), ['ok1']);
  const it = s.items[0];
  assert.equal(it.date, null);
  assert.equal(it.project, null);
  assert.equal(it.image, null);
  assert.deepEqual(it.dependsOn, ['ok2']);
  assert.equal(it.duration, 45);
  assert.deepEqual(s.projects.map((p) => p.id), ['p1']);
  assert.match(s.projects[0].color, /^#[0-9A-F]{6}$/i);
  assert.equal(s.goals[0].due, null);
  assert.equal(s.memory[0].category, 'nota');
  assert.deepEqual(s.recurring[0].weekdays, [1]);
  assert.deepEqual(s.prefs.offDays, [0]);
  assert.equal(s.prefs.buffer, 15);
  assert.equal(s.prefs.focusWindow, null);
  assert.deepEqual(Object.keys(s.prefs.availability), []);
  assert.equal(s.chat.length, 0);
  assert.deepEqual(Object.keys(s.anchors), []);
  const json = JSON.stringify(s);
  assert.ok(!json.includes('onerror') || !/"(id|project|image|color|date|due)":"[^"]*onerror/.test(json));
});

test('colori: solo esadecimali', () => {
  assert.equal(safeColor('#E0457B'), '#E0457B');
  assert.equal(safeColor('red'), null);
  assert.equal(safeColor('#fff;x'), null);
});
