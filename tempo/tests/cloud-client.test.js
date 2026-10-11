import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeById, mergeStates, cloudPayload, syncNow, signIn } from '../js/cloud.js';
import { createApp, memoryStore } from '../../cloud/src/app.js';
import { emptyState } from '../js/store.js';

const T = 1_800_000_000_000;

test('unione voce per voce: modifica più recente, nuove tenute, cancellate tolte', () => {
  const sync = T;
  const local = [
    { id: 'a', title: 'A locale', updatedAt: T + 10, createdAt: T - 100 },
    { id: 'b', title: 'B', updatedAt: T - 50, createdAt: T - 100 },        // cancellata sull'altro dispositivo
    { id: 'n', title: 'Nuova qui', createdAt: T + 5, updatedAt: T + 5 },
  ];
  const remote = [
    { id: 'a', title: 'A remota', updatedAt: T + 20, createdAt: T - 100 },
    { id: 'c', title: 'C', updatedAt: T - 40, createdAt: T - 100 },        // cancellata qui
    { id: 'r', title: 'Nuova là', createdAt: T + 7, updatedAt: T + 7 },
    { id: 'p', name: 'Progetto senza date' },
  ];
  const m = mergeById(local, remote, sync);
  const byId = Object.fromEntries(m.map((x) => [x.id, x]));
  assert.equal(byId.a.title, 'A remota');
  assert.ok(!byId.b && !byId.c);
  assert.ok(byId.n && byId.r && byId.p);
});

test('il payload non contiene mai chiavi AI né impostazioni del dispositivo', () => {
  const s = emptyState();
  s.settings = { apiKey: 'sk-ant-x', openKey: 'AIza', cloudToken: 'tmp_x', decider: { key: 'nvapi' }, name: 'D' };
  const p = JSON.stringify(cloudPayload(s));
  for (const bad of ['sk-ant', 'AIza', 'tmp_x', 'nvapi']) assert.ok(!p.includes(bad), bad);
});

test('mergeStates: registro e chat uniti senza doppioni, preferenze dal lato con modifiche', () => {
  const a = emptyState(), b = emptyState();
  a.log = [{ type: 'done', id: 'x', at: 1 }, { type: 'skip', id: 'y', at: 3 }];
  b.log = [{ type: 'done', id: 'x', at: 1 }, { type: 'done', id: 'z', at: 2 }];
  a.prefs.maxBlock = 90; b.prefs.maxBlock = 150;
  const m = mergeStates(a, b, { lastSync: 0, localDirty: true });
  assert.deepEqual(m.log.map((e) => e.id), ['x', 'z', 'y']);
  assert.equal(m.prefs.maxBlock, 90);
  assert.equal(mergeStates(a, b, { localDirty: false }).prefs.maxBlock, 150);
});

test('due dispositivi contro il server vero: niente si perde', async () => {
  const app = createApp({ store: memoryStore(), secret: 'z'.repeat(40) });
  const fetchImpl = (url, init) => app.fetch(new Request(url, init));
  const opts = { fetchImpl };
  const phone = emptyState(), mac = emptyState();
  phone.settings.cloudUrl = mac.settings.cloudUrl = 'https://cloud.test';
  await signIn(phone.settings, { email: 'd@x.it', password: 'password-lunga', create: true }, opts);
  await signIn(mac.settings, { email: 'd@x.it', password: 'password-lunga' }, opts);
  const apply = (s) => (ns) => { for (const k of Object.keys(ns)) if (k !== 'settings') s[k] = ns[k]; };

  phone.items.push({ id: 'i1', title: 'Beat 01', kind: 'task', status: 'todo', createdAt: Date.now(), updatedAt: Date.now() });
  phone.stats.edits = 1;
  assert.equal(await syncNow(phone, apply(phone), opts), 'pushed');
  assert.equal(await syncNow(mac, apply(mac), opts), 'pulled');
  assert.equal(mac.items[0].title, 'Beat 01');

  // tutti e due modificano senza sincronizzare
  mac.items.push({ id: 'i2', title: 'Mix 01', kind: 'task', status: 'todo', createdAt: Date.now() + 1, updatedAt: Date.now() + 1 });
  mac.stats.edits = 2;
  phone.items[0].status = 'done'; phone.items[0].updatedAt = Date.now() + 2;
  phone.stats.edits = 2;
  assert.equal(await syncNow(mac, apply(mac), opts), 'pushed');
  assert.equal(await syncNow(phone, apply(phone), opts), 'merged');
  assert.deepEqual(phone.items.map((x) => x.id).sort(), ['i1', 'i2']);
  assert.equal(phone.items.find((x) => x.id === 'i1').status, 'done');
  assert.equal(await syncNow(mac, apply(mac), opts), 'pulled');
  assert.equal(mac.items.find((x) => x.id === 'i1').status, 'done');
  assert.equal(await syncNow(mac, apply(mac), opts), 'same');
  assert.equal(phone.settings.cloudToken.startsWith('tmp_'), true);
});
