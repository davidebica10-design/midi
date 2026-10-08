// Fase 1: i dati restano al sicuro anche dopo un anno d'uso.
import './fake-storage.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from './fake-storage.js';
import { NOW, freshState } from './helpers.js';
import { emptyState, applyOps, pushUndo, popUndo, save, load, saveStatus, archiveCandidates, applyArchive } from '../js/store.js';
import { addDays, dateKey } from '../js/scheduler.js';
import { updateDurations } from '../js/learn.js';

const DAY = 864e5;
/** Un anno d'uso intenso: ogni giorno 3 attività nuove e 3 completate, con l'annulla a ogni modifica. */
function intenseYear(s, { archive = false } = {}) {
  for (let d = 0; d < 365; d++) {
    const now = NOW + d * DAY;
    const today = dateKey(new Date(now));
    for (let k = 0; k < 3; k++) {
      pushUndo(s, 'nuova');
      applyOps(s, [{ action: 'add', kind: 'task', title: `Beat ${d}-${k}`, duration_min: 45, date: today, note: 'Una nota normale, come ne scrive chiunque.' }], now);
      save(s);
    }
    for (const it of s.items.filter((x) => x.status !== 'done').slice(0, 3)) {
      pushUndo(s, 'fatta');
      applyOps(s, [{ action: 'complete', id: it.id, actual_min: 50 }], now + 3600e3);
      save(s);
    }
    if (archive) { const ids = archiveCandidates(s, now).map((x) => x.id); if (ids.length) applyArchive(s, ids, now); }
  }
}

test('1.1 un anno d\'uso intenso sta sotto 1 milione di caratteri in localStorage', () => {
  globalThis.localStorage = new FakeStorage();
  const s = freshState();
  intenseYear(s, { archive: true }); // come l'app: ogni giorno le voci vecchie vanno in archivio
  const used = localStorage.size();
  assert.ok(used < 1_000_000, `usati ${used} caratteri`);
  assert.ok((localStorage.getItem('tempo.undo.v1') || '').length <= 300_000, 'annulla su disco sotto 300 mila caratteri');
  assert.ok(s.items.length < 500, `voci nello stato: ${s.items.length}`);
  // l'annulla funziona ancora
  const before = s.items.length;
  pushUndo(s, 'ultima');
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Ultima', duration_min: 10 }], NOW);
  popUndo(s);
  assert.equal(s.items.length, before);
});

test('1.1 senza archivio l\'annulla non cresce con lo stato (120 giorni)', () => {
  globalThis.localStorage = new FakeStorage();
  const s = freshState();
  for (let d = 0; d < 120; d++) {
    const now = NOW + d * DAY;
    for (let k = 0; k < 6; k++) { pushUndo(s, 'x'); applyOps(s, [{ action: 'add', kind: 'task', title: `Cosa ${d}-${k}`, duration_min: 30, note: 'Una nota normale.' }], now); }
    save(s);
  }
  const undoDisk = (localStorage.getItem('tempo.undo.v1') || '').length;
  assert.ok(undoDisk <= 300_000, `annulla su disco: ${undoDisk}`);
  assert.ok(localStorage.size() < 1_000_000, `totale: ${localStorage.size()}`);
});

test('1.1 spazio finito: prima si libera l\'annulla e si riprova', () => {
  globalThis.localStorage = new FakeStorage(200_000);
  localStorage.setItem('tempo.undo.v1', 'x'.repeat(150_000)); // annulla vecchio, gonfio
  const s = freshState();
  for (let i = 0; i < 200; i++) applyOps(s, [{ action: 'add', kind: 'task', title: `Attività ${i}`, duration_min: 30 }], NOW);
  assert.ok(JSON.stringify(s).length > 50_000, 'lo stato da solo non entra accanto all\'annulla');
  assert.equal(save(s), true);
  assert.equal(saveStatus(), null);
  assert.equal(localStorage.getItem('tempo.undo.v1') === null, true, 'l\'annulla è stato liberato');
  assert.equal(load().items.length, 200);
});

test('1.1 spazio finito davvero: save() lo segnala e lo stato salvato prima non si perde', () => {
  globalThis.localStorage = new FakeStorage(30_000);
  const s = freshState();
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Prima', duration_min: 30 }], NOW);
  assert.equal(save(s), true);
  const events = [];
  globalThis.addEventListener?.('tempo:save-failed', (e) => events.push(e));
  for (let i = 0; i < 200; i++) applyOps(s, [{ action: 'add', kind: 'task', title: `Attività lunga numero ${i}`, duration_min: 30, note: 'x'.repeat(100) }], NOW);
  assert.equal(save(s), false);
  assert.ok(saveStatus(), 'l\'errore resta segnalato');
  assert.equal(s.items.length, 201, 'lo stato in memoria è intatto');
  assert.equal(load().items.length, 1, 'il salvataggio di prima è ancora lì');
});

test('1.1 all\'avvio un annulla troppo grande viene ridotto', async () => {
  const big = JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ id: 'u' + i, label: 'x', at: 0, snap: JSON.stringify({ items: [], pad: 'y'.repeat(30_000) }) })));
  globalThis.localStorage = new FakeStorage();
  localStorage.setItem('tempo.undo.v1', big);
  const { trimUndoStorage } = await import('../js/store.js');
  trimUndoStorage();
  const now = localStorage.getItem('tempo.undo.v1');
  assert.ok(!now || now.length < 300_000, `annulla su disco: ${now?.length}`);
});

test('1.2 archivio: fatte e impegni passati da più di 60 giorni escono dallo stato, le stime imparate restano uguali', () => {
  globalThis.localStorage = new FakeStorage();
  const s = freshState();
  const old = NOW - 90 * DAY;
  // 5 «Beat» fatti 90 giorni fa con durate vere più lunghe delle stime
  for (let i = 0; i < 5; i++) {
    applyOps(s, [{ action: 'add', kind: 'task', title: `Beat 0${i}`, duration_min: 45, duration_is_estimate: true }], old);
    const it = s.items.at(-1);
    applyOps(s, [{ action: 'complete', id: it.id, actual_min: 70 + i }], old + i * 3600e3);
  }
  applyOps(s, [{ action: 'add', kind: 'event', title: 'Dentista', date: dateKey(new Date(old)), start_time: '10:00' }], old);
  applyOps(s, [{ action: 'add', kind: 'task', title: 'Beat nuovo', duration_min: 45, duration_is_estimate: true }], NOW);
  updateDurations(s);
  const before = JSON.stringify(s.learned.durations);
  const estBefore = s.items.find((x) => x.title === 'Beat nuovo').duration;
  const cands = archiveCandidates(s, NOW);
  assert.equal(cands.length, 6);
  applyArchive(s, cands.map((x) => x.id), NOW);
  assert.equal(s.items.length, 1);
  updateDurations(s);
  assert.equal(JSON.stringify(s.learned.durations), before);
  assert.equal(s.items[0].duration, estBefore);
  assert.ok(estBefore > 45, 'la stima era stata corretta');
});

test('1.2 le sessioni di un obiettivo ancora aperto non si archiviano', () => {
  const s = freshState();
  const old = NOW - 90 * DAY;
  applyOps(s, [{ action: 'set_goal', title: 'EP', deadline: addDays(dateKey(new Date(NOW)), 30), project: 'EP' }, { action: 'add', kind: 'task', title: 'Beat 01', project: 'EP', duration_min: 60 }], old);
  applyOps(s, [{ action: 'complete', id: s.items[0].id, actual_min: 60 }], old);
  assert.equal(archiveCandidates(s, NOW).length, 0);
});

test('1.3 emptyState: le preferenze di due stati non sono condivise', () => {
  const a = emptyState(), b = emptyState();
  applyOps(a, [{ action: 'set_availability', date: '2026-10-07', start_time: '15:00', end_time: '19:00' }], NOW);
  assert.deepEqual(b.prefs.availability, {});
  assert.deepEqual(emptyState().prefs.availability, {});
  a.prefs.offDays.push(0);
  assert.deepEqual(b.prefs.offDays, []);
});
