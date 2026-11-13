process.env.TZ = 'Europe/Rome';
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, addTrack, addVersion, applyOps, statusOf, findByHash, sanitizeState, resolveVersion, demoState, snapshot, undo, openTasks, deleteTrack } from '../js/store.js';
import { sha256, matches } from '../js/hash.js';
import { encodeAsk, decodeAsk, replyText, waLink, safeUrl } from '../js/share.js';
import { parseChat, extract } from '../js/chat.js';

const H = (c) => c.repeat(64).slice(0, 64);
const NOW = new Date(2026, 10, 13, 10).getTime();

function track() {
  const s = emptyState();
  s.me.name = 'davide';
  const t = addTrack(s, { title: 'notte a ortigia', artist: 'midi' }, NOW - 5e6);
  addVersion(s, t.id, { hash: H('a'), fileName: 'mix1.wav', size: 1000 }, NOW - 4e6);
  addVersion(s, t.id, { hash: H('b'), fileName: 'mix2.wav', size: 1000 }, NOW - 3e6);
  return { s, t };
}

test('versioni numerate e duplicati riconosciuti dall’impronta', () => {
  const { s, t } = track();
  const r = addVersion(s, t.id, { hash: H('a'), fileName: 'mix1-copia.wav' });
  assert.equal(r.dup, true);
  assert.equal(r.version.n, 1);
  assert.equal(addVersion(s, t.id, { hash: H('c'), fileName: 'mix3.wav' }).version.n, 3);
  assert.throws(() => addVersion(s, t.id, { hash: 'zz' }), /impronta/);
});

test('ok via codice (prefisso impronta) → versione giusta', () => {
  const { s, t } = track();
  const res = applyOps(s, t.id, [{ action: 'approve', version: 'aaaaaaaaaaaa', by: 'midi', source: 'link', at: NOW }]);
  assert.deepEqual(res.errors, []);
  const st = statusOf(s, t.id);
  assert.equal(st.kind, 'attesa'); // v1 approvata, v2 più nuova
  assert.equal(st.ok.version.n, 1);
  applyOps(s, t.id, [{ action: 'approve', version: 'v2', by: 'midi', at: NOW }]);
  assert.equal(statusOf(s, t.id).kind, 'ok');
});

test('ok doppio della stessa persona sulla stessa versione: saltato', () => {
  const { s, t } = track();
  applyOps(s, t.id, [{ action: 'approve', version: 'v2', by: 'midi' }]);
  const r = applyOps(s, t.id, [{ action: 'approve', version: 'v2', by: 'Midi' }]);
  assert.equal(r.done.length, 0);
  assert.match(r.errors[0], /già registrato/);
});

test('ok senza versione → ultima caricata prima del messaggio', () => {
  const { s, t } = track();
  assert.equal(resolveVersion(s, t.id, null, NOW - 3.5e6).n, 1);
  assert.equal(resolveVersion(s, t.id, null, NOW).n, 2);
  assert.equal(resolveVersion(s, t.id, 'v9'), null);
  assert.equal(resolveVersion(s, t.id, 'abc'), null);
});

test('richiesta di modifiche → cosa da fare per me', () => {
  const { s, t } = track();
  applyOps(s, t.id, [{ action: 'request', version: 'v2', by: 'midi', text: 'voce più alta' }]);
  const k = openTasks(s, t.id)[0];
  assert.equal(k.who, 'davide');
  assert.equal(k.what, 'modifiche v2: voce più alta');
});

test('operazioni malformate scartate', () => {
  const { s, t } = track();
  const r = applyOps(s, t.id, [{ action: 'rm -rf' }, { action: 'task', what: '' }, { action: 'stage', stage: 99 }, null, { action: 'task', who: 'midi', what: 'x', due: 'domani' }]);
  assert.equal(r.done.length, 1);
  assert.equal(openTasks(s, t.id)[0].due, null);
});

test('verifica: trova la versione dall’impronta in qualsiasi brano', () => {
  const { s, t } = track();
  applyOps(s, t.id, [{ action: 'approve', version: 'v2', by: 'midi' }]);
  const hit = findByHash(s, H('b'));
  assert.equal(hit.version.n, 2);
  assert.equal(hit.approval.by, 'midi');
  assert.equal(findByHash(s, H('f')), null);
});

test('chat → proposte → applicate', () => {
  const { s, t } = track();
  const msgs = parseChat('[13/11/26, 09:00:00] midi: la v2 spacca, per me è ok\n[13/11/26, 09:01:00] midi: mi mandi la strumentale entro domani?');
  const ops = extract(msgs, { me: 'davide', versions: [{ n: 1 }, { n: 2 }] }).map((p) => p.op);
  const r = applyOps(s, t.id, ops);
  assert.equal(r.done.length, 2);
  assert.equal(statusOf(s, t.id).kind, 'ok');
});

test('backup ostile: id, impronte e testi ripuliti', () => {
  const s = sanitizeState({
    tracks: [{ id: '<img onerror=x>', title: 'a' }, { id: 'ok1', title: 'x'.repeat(500), stage: 42 }],
    versions: [{ id: 'v1', trackId: 'ok1', hash: 'nope' }, { id: 'v2', trackId: 'ok1', hash: H('d'), n: 1 }],
    approvals: [{ id: 'a1', versionId: 'ghost' }],
  });
  assert.equal(s.tracks.length, 1);
  assert.equal(s.tracks[0].title.length, 80);
  assert.equal(s.tracks[0].stage, 5);
  assert.equal(s.versions.length, 1);
  assert.equal(s.approvals.length, 0);
});

test('annulla ripristina lo stato prima della modifica', () => {
  const { s, t } = track();
  snapshot(s, 'ok');
  applyOps(s, t.id, [{ action: 'approve', version: 'v2', by: 'midi' }]);
  assert.equal(s.approvals.length, 1);
  assert.equal(undo(s), 'ok');
  assert.equal(s.approvals.length, 0);
});

test('elimina brano restituisce gli audio da cancellare', () => {
  const s = emptyState();
  const t = addTrack(s, { title: 'x' });
  addVersion(s, t.id, { hash: H('e'), blobId: 'blob1' });
  assert.deepEqual(deleteTrack(s, t.id), ['blob1']);
  assert.equal(s.versions.length, 0);
});

test('demo coerente', () => {
  const s = sanitizeState(demoState(NOW));
  assert.equal(s.tracks.length, 3);
  assert.equal(s.versions.length, 5);
  assert.equal(statusOf(s, 'demo1').kind, 'attesa');
  assert.equal(statusOf(s, 'demo3').kind, 'ok');
});

test('impronta sha-256 e confronto per prefisso', async () => {
  const h = await sha256(new TextEncoder().encode('abc'));
  assert.equal(h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.ok(matches(h, 'ba7816bf'));
  assert.ok(!matches(h, 'ba78'));
  assert.ok(!matches(h, 'zzzzzzzz'));
});

test('link di ok: andata e ritorno, e niente roba strana', () => {
  const p = encodeAsk({ title: 'notte a ortigia', artist: 'midi', n: 3, fileName: 'mix3.wav', hash: 'a1b2c3d4e5f60718', audio: 'https://dropbox.com/x', phone: '+39 333 123 4567', by: 'davide' });
  const a = decodeAsk(p);
  assert.equal(a.title, 'notte a ortigia');
  assert.equal(a.n, 3);
  assert.equal(a.phone, '393331234567');
  assert.equal(a.audio, 'https://dropbox.com/x');
  assert.equal(decodeAsk('garbage'), null);
  assert.equal(decodeAsk(encodeAsk({ title: 'x', n: 1, hash: 'nothex!!' })), null);
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('http://insicuro.it'), null);
  const msg = replyText('ok', a);
  assert.match(msg, /^tempo ✓ v3 #a1b2c3d4e5f6/);
  // il codice generato viene riconosciuto dal parser
  const back = extract(parseChat(`[13/11/26, 09:00:00] midi: ${msg}`), {});
  assert.equal(back[0].op.action, 'approve');
  assert.equal(back[0].op.version, 'a1b2c3d4e5f6');
  assert.match(waLink('393331234567', 'ciao'), /^https:\/\/wa\.me\/393331234567\?text=ciao$/);
});
