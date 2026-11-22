// Studio v0.2: migrazione, definitiva, uscita, calendario, collaboratori, link di stato.
// Orari fissi, nessuna rete: passa identico in qualsiasi fuso.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, SCHEMA, migrate, sanitizeState, addTrack, addVersion, deleteVersion, setFinal, finalVersion, setRelease,
  releasesIn, duesIn, collaborators, variantName, renameVersion, snapshot, undo, canUndo, snapshotOf, demoState, logOf,
} from '../js/store.js';
import { encodeSnap, decodeSnap } from '../js/share.js';

const H = (c) => c.repeat(64).slice(0, 64);
const NOW = new Date(2026, 10, 13, 10).getTime();

function setup() {
  const s = emptyState();
  s.me.name = 'davide';
  const t = addTrack(s, { title: 'notte a ortigia', artist: 'midi' }, NOW);
  const v1 = addVersion(s, t.id, { hash: H('a'), fileName: 'mix1.wav' }, NOW).version;
  const v2 = addVersion(s, t.id, { hash: H('b'), fileName: 'mix2.wav' }, NOW).version;
  const t2 = addTrack(s, { title: 'vetro', artist: 'sara' }, NOW);
  const w1 = addVersion(s, t2.id, { hash: H('c'), fileName: 'vetro.wav' }, NOW).version;
  return { s, t, v1, v2, t2, w1 };
}
const kinds = (s, tid, kind) => logOf(s, tid).filter((l) => l.kind === kind);

// ---- migrazione
const v1State = () => ({
  schema: 1,
  me: { name: 'davide', phone: '' },
  tracks: [{ id: 'a', title: 'uno', artist: 'x', stage: 1, createdAt: NOW, sharedAt: null }, { id: 'b', title: 'due', artist: '', stage: 0, createdAt: NOW, sharedAt: null }],
  versions: [{ id: 'va', trackId: 'a', n: 1, fileName: 'f.wav', size: 1, duration: 1, hash: H('a'), peaks: [], blobId: null, addedAt: NOW }],
  approvals: [], tasks: [], log: [],
});

test('migrate: stato schema 1 → schema attuale, senza perdere i brani', () => {
  const m = migrate(v1State());
  assert.equal(m.schema, SCHEMA);
  assert.equal(m.tracks.length, 2);
  assert.equal(m.tracks[0].release, null);
  assert.equal(m.tracks[0].finalId, null);
  assert.equal(m.versions[0].label, '');
});

test('sanitizeState da schema 1: campi nuovi con valore di default', () => {
  const s = sanitizeState(v1State());
  assert.equal(s.schema, SCHEMA);
  assert.equal(s.tracks[0].release, null);
  assert.equal(s.tracks[0].finalId, null);
  assert.equal(s.versions[0].label, '');
  assert.equal(s.ai.consent, '');
});

test('sanitizeState: senza campo schema è trattato come schema 1', () => {
  const raw = v1State();
  delete raw.schema;
  assert.equal(sanitizeState(raw).tracks.length, 2);
});

test('sanitizeState: input vuoto o non oggetto dà uno stato vuoto valido', () => {
  for (const x of [null, undefined, 'ciao', 5, [], {}]) {
    const s = sanitizeState(x);
    assert.equal(s.schema, SCHEMA);
    assert.deepEqual(s.tracks, []);
  }
});

test('sanitizeState: finalId che punta a una versione di un altro brano → null', () => {
  const raw = v1State();
  raw.tracks[1].finalId = 'va'; // va è del brano a
  raw.tracks[0].finalId = 'va';
  const s = sanitizeState(raw);
  assert.equal(s.tracks[1].finalId, null);
  assert.equal(s.tracks[0].finalId, 'va');
});

test('sanitizeState: finalId inesistente o con id strano → null', () => {
  const raw = v1State();
  raw.tracks[0].finalId = 'non-esiste';
  raw.tracks[1].finalId = '<img onerror=x>';
  const s = sanitizeState(raw);
  assert.equal(s.tracks[0].finalId, null);
  assert.equal(s.tracks[1].finalId, null);
});

test('sanitizeState: finalId di una versione scartata (impronta non valida) → null', () => {
  const raw = v1State();
  raw.versions[0].hash = 'zz';
  raw.tracks[0].finalId = 'va';
  assert.equal(sanitizeState(raw).tracks[0].finalId, null);
});

test('sanitizeState: label troppo lunga tagliata a 40 e ripulita', () => {
  const raw = v1State();
  raw.versions[0].label = '  ' + 'x'.repeat(500);
  const s = sanitizeState(raw);
  assert.ok(s.versions[0].label.length <= 40);
  assert.equal(s.versions[0].label, s.versions[0].label.trim());
  raw.versions[0].label = { a: 1 };
  assert.equal(typeof sanitizeState(raw).versions[0].label, 'string');
});

test('sanitizeState: release fuori formato → null, valida resta', () => {
  const raw = v1State();
  raw.tracks[0].release = '2026-12-25';
  raw.tracks[1].release = '25/12/2026';
  const s = sanitizeState(raw);
  assert.equal(s.tracks[0].release, '2026-12-25');
  assert.equal(s.tracks[1].release, null);
  raw.tracks[0].release = 20261225;
  assert.equal(sanitizeState(raw).tracks[0].release, null);
});

test('sanitizeState: consenso AI lungo viene tagliato', () => {
  const s = sanitizeState({ ai: { consent: 'h'.repeat(1000) } });
  assert.ok(s.ai.consent.length <= 200);
});

// ---- setFinal
test('setFinal: fissa la definitiva e scrive nel registro', () => {
  const { s, t, v2 } = setup();
  const r = setFinal(s, t.id, v2.id);
  assert.equal(r.id, v2.id);
  assert.equal(t.finalId, v2.id);
  assert.equal(finalVersion(s, t.id).id, v2.id);
  assert.equal(kinds(s, t.id, 'definitiva').length, 1);
  assert.match(kinds(s, t.id, 'definitiva')[0].text, /v2/);
});

test('setFinal: ritoccare la stessa versione toglie la definitiva', () => {
  const { s, t, v2 } = setup();
  setFinal(s, t.id, v2.id);
  assert.equal(setFinal(s, t.id, v2.id), null);
  assert.equal(t.finalId, null);
  assert.equal(finalVersion(s, t.id), null);
  assert.equal(kinds(s, t.id, 'definitiva').length, 2);
});

test('setFinal: con vid null toglie; se non c\'era nulla non scrive', () => {
  const { s, t, v1 } = setup();
  assert.equal(setFinal(s, t.id, null), null);
  assert.equal(kinds(s, t.id, 'definitiva').length, 0);
  setFinal(s, t.id, v1.id);
  setFinal(s, t.id, null);
  assert.equal(t.finalId, null);
});

test('setFinal: scegliere un\'altra versione sposta la definitiva', () => {
  const { s, t, v1, v2 } = setup();
  setFinal(s, t.id, v1.id);
  setFinal(s, t.id, v2.id);
  assert.equal(t.finalId, v2.id);
});

test('setFinal: versione di un altro brano rifiutata, nessun log', () => {
  const { s, t, w1 } = setup();
  const before = s.log.length;
  assert.equal(setFinal(s, t.id, w1.id), null);
  assert.equal(t.finalId, null);
  assert.equal(s.log.length, before);
});

test('setFinal: brano o versione inesistenti non fanno danni', () => {
  const { s, t } = setup();
  const before = s.log.length;
  assert.equal(setFinal(s, 'nope', 'x'), null);
  assert.equal(setFinal(s, t.id, 'nope'), null);
  assert.equal(s.log.length, before);
});

test('deleteVersion della definitiva azzera finalId', () => {
  const { s, t, v1, v2 } = setup();
  setFinal(s, t.id, v2.id);
  deleteVersion(s, v2.id);
  assert.equal(t.finalId, null);
  assert.equal(finalVersion(s, t.id), null);
  // eliminare un'altra versione non tocca la definitiva
  setFinal(s, t.id, v1.id);
  deleteVersion(s, 'inesistente');
  assert.equal(t.finalId, v1.id);
});

test('snapshot + undo ripristina finalId e release', () => {
  const { s, t, v2 } = setup();
  while (canUndo()) undo(s);
  snapshot(s, 'definitiva');
  setFinal(s, t.id, v2.id);
  setRelease(s, t.id, '2026-12-01');
  assert.equal(undo(s), 'definitiva');
  assert.equal(s.tracks.find((x) => x.id === t.id).finalId, null);
  assert.equal(s.tracks.find((x) => x.id === t.id).release, null);
});

test('undo dopo eliminazione della definitiva la rimette com\'era', () => {
  const { s, t, v2 } = setup();
  while (canUndo()) undo(s);
  setFinal(s, t.id, v2.id);
  snapshot(s, 'elimina');
  deleteVersion(s, v2.id);
  undo(s);
  assert.equal(s.tracks.find((x) => x.id === t.id).finalId, v2.id);
  assert.ok(s.versions.some((v) => v.id === v2.id));
});

// ---- setRelease
test('setRelease: data valida fissata e scritta nel registro', () => {
  const { s, t } = setup();
  setRelease(s, t.id, '2026-12-25');
  assert.equal(t.release, '2026-12-25');
  assert.match(kinds(s, t.id, 'uscita')[0].text, /25\.12\.2026/);
});

test('setRelease: data non valida diventa null', () => {
  const { s, t } = setup();
  setRelease(s, t.id, '2026-12-25');
  for (const bad of ['domani', '2026-1-1', '', 20261225, {}, '<b>2026-12-25</b>']) {
    setRelease(s, t.id, bad);
    assert.equal(t.release, null);
    setRelease(s, t.id, '2026-12-25');
  }
});

test('setRelease: togliere la data scrive nel registro', () => {
  const { s, t } = setup();
  setRelease(s, t.id, '2026-12-25');
  setRelease(s, t.id, null);
  assert.equal(t.release, null);
  assert.equal(kinds(s, t.id, 'uscita').length, 2);
});

test('setRelease: stessa data (o nessuna data due volte) non scrive il registro', () => {
  const { s, t } = setup();
  setRelease(s, t.id, null);
  assert.equal(kinds(s, t.id, 'uscita').length, 0);
  setRelease(s, t.id, '2026-12-25');
  setRelease(s, t.id, '2026-12-25');
  assert.equal(kinds(s, t.id, 'uscita').length, 1);
});

test('setRelease: brano inesistente ignorato', () => {
  const { s } = setup();
  const n = s.log.length;
  setRelease(s, 'nope', '2026-12-25');
  assert.equal(s.log.length, n);
});

// ---- calendario
test('releasesIn: solo il mese chiesto, ordinate per giorno', () => {
  const { s, t, t2 } = setup();
  const t3 = addTrack(s, { title: 'terzo', artist: '' }, NOW);
  const t4 = addTrack(s, { title: 'quarto', artist: '' }, NOW);
  setRelease(s, t.id, '2026-12-20');
  setRelease(s, t2.id, '2026-12-03');
  setRelease(s, t3.id, '2027-12-10');
  setRelease(s, t4.id, '2026-11-30');
  assert.deepEqual(releasesIn(s, 2026, 11).map((x) => x.id), [t2.id, t.id]); // mese 11 = dicembre
  assert.deepEqual(releasesIn(s, 2026, 10).map((x) => x.id), [t4.id]);
  assert.deepEqual(releasesIn(s, 2026, 0), []);
  assert.deepEqual(releasesIn(s, 2027, 11).map((x) => x.id), [t3.id]);
});

test('releasesIn: mesi di una cifra con lo zero (gennaio)', () => {
  const { s, t } = setup();
  setRelease(s, t.id, '2027-01-05');
  assert.equal(releasesIn(s, 2027, 0).length, 1);
  assert.equal(releasesIn(s, 2027, 9).length, 0); // ottobre non confonde con 1x
});

test('duesIn: solo scadenze aperte del mese', () => {
  const s = emptyState();
  const mk = (id, due, done = false) => ({ id, trackId: 'a', who: '', what: id, due, done, at: NOW, source: 'chat' });
  s.tasks = [mk('t1', '2026-11-05'), mk('t2', '2026-11-30', true), mk('t3', '2026-12-01'), mk('t4', null), mk('t5', '2026-11-20')];
  assert.deepEqual(duesIn(s, 2026, 10).map((k) => k.id), ['t1', 't5']);
  assert.deepEqual(duesIn(s, 2026, 11).map((k) => k.id), ['t3']);
  assert.deepEqual(duesIn(s, 2026, 5), []);
});

// ---- collaboratori
test('collaborators: stesso nome con maiuscole diverse conta insieme', () => {
  const s = emptyState();
  addTrack(s, { title: 'a', artist: 'Midi' });
  addTrack(s, { title: 'b', artist: 'midi' });
  addTrack(s, { title: 'c', artist: ' MIDI ' });
  addTrack(s, { title: 'd', artist: 'sara' });
  const c = collaborators(s);
  assert.equal(c.length, 2);
  assert.equal(c[0].tracks, 3);
  assert.equal(c[0].name.toLowerCase(), 'midi');
  assert.deepEqual(c[1], { name: 'sara', tracks: 1 });
});

test('collaborators: nomi vuoti o di soli spazi esclusi; senza brani lista vuota', () => {
  const s = emptyState();
  assert.deepEqual(collaborators(s), []);
  addTrack(s, { title: 'a', artist: '' });
  addTrack(s, { title: 'b', artist: '   ' });
  assert.deepEqual(collaborators(s), []);
});

test('collaborators: a pari brani ordinati per nome', () => {
  const s = emptyState();
  addTrack(s, { title: 'a', artist: 'zeta' });
  addTrack(s, { title: 'b', artist: 'alfa' });
  assert.deepEqual(collaborators(s).map((c) => c.name), ['alfa', 'zeta']);
});

// ---- nome della variante
test('variantName: prima la label, poi il file senza estensione, poi «versione n»', () => {
  assert.equal(variantName({ n: 2, label: 'rec 2', fileName: 'mix.wav' }), 'rec 2');
  assert.equal(variantName({ n: 2, label: '', fileName: 'ortigia_mix2.wav' }), 'ortigia_mix2');
  assert.equal(variantName({ n: 2, fileName: 'a.b.mp3' }), 'a.b');
  assert.equal(variantName({ n: 4, label: '', fileName: '' }), 'versione 4');
  assert.equal(variantName({ n: 5 }), 'versione 5');
});

test('renameVersion: ripulisce e taglia; vuota torna al nome del file', () => {
  const { s, v1 } = setup();
  renameVersion(s, v1.id, '  ' + 'y'.repeat(100));
  assert.ok(v1.label.length <= 40 && v1.label === v1.label.trim());
  renameVersion(s, v1.id, '   ');
  assert.equal(variantName(v1), 'mix1');
  renameVersion(s, 'nope', 'x'); // non esplode
});

// ---- link di stato
test('snapshotOf → encodeSnap → decodeSnap conserva definitiva e uscita', async () => {
  const { s, t, v2 } = setup();
  setFinal(s, t.id, v2.id);
  setRelease(s, t.id, '2026-12-25');
  const snap = snapshotOf(s, t.id, { now: NOW });
  assert.equal(snap.fi, 2);
  assert.equal(snap.re, '2026-12-25');
  const d = await decodeSnap(await encodeSnap(snap));
  assert.equal(d.final, 2);
  assert.equal(d.release, '2026-12-25');
  assert.equal(d.title, 'notte a ortigia');
  assert.ok(d.log.some((l) => l.kind === 'definitiva'));
  assert.ok(d.log.some((l) => l.kind === 'uscita'));
});

test('snapshotOf: senza definitiva né uscita i campi non ci sono e decodeSnap dà null', async () => {
  const { s, t } = setup();
  const snap = snapshotOf(s, t.id, { now: NOW });
  assert.equal(snap.fi, undefined);
  assert.equal(snap.re, undefined);
  const d = await decodeSnap(await encodeSnap(snap));
  assert.equal(d.final, null);
  assert.equal(d.release, null);
});

test('decodeSnap: definitiva e uscita fuori formato scartate', async () => {
  const base = { v: 1, t: 'x', st: 0, at: NOW, vs: [], ts: [], lg: [] };
  for (const [fi, re] of [[0, 'ieri'], [1000, '2026-1-1'], ['2', '<script>'], [1.5, 20261225], [-1, null], [null, { a: 1 }]]) {
    const d = await decodeSnap(await encodeSnap({ ...base, fi, re }));
    assert.equal(d.final, null, `fi=${fi}`);
    assert.equal(d.release, null, `re=${JSON.stringify(re)}`);
  }
  const ok = await decodeSnap(await encodeSnap({ ...base, fi: 999, re: '2026-02-28' }));
  assert.equal(ok.final, 999);
  assert.equal(ok.release, '2026-02-28');
});

test('decodeSnap: voci di registro con tipo sconosciuto diventano «nota»', async () => {
  const snap = { v: 1, t: 'x', at: NOW, lg: [[NOW, 'a', 'definitiva', 'ok'], [NOW, 'a', 'hack', 'x']] };
  const d = await decodeSnap(await encodeSnap(snap));
  assert.deepEqual(d.log.map((l) => l.kind), ['definitiva', 'nota']);
});

test('decodeSnap: formato in chiaro «j» e stringhe sporche', async () => {
  const j = 'j' + Buffer.from(JSON.stringify({ v: 1, t: 'x', fi: 3, re: '2026-05-05' })).toString('base64url');
  const d = await decodeSnap(j);
  assert.equal(d.final, 3);
  assert.equal(d.release, '2026-05-05');
  for (const bad of ['', 'z', 'zzzz', 'q123', null, 42, 'j' + Buffer.from('{"v":2,"t":"x"}').toString('base64url')]) {
    assert.equal(await decodeSnap(bad), null);
  }
});

// ---- demo
test('demoState passa sanitizeState senza perdere definitiva e uscita', () => {
  const d = demoState(NOW);
  const s = sanitizeState(JSON.parse(JSON.stringify(d)));
  assert.equal(s.schema, SCHEMA);
  assert.equal(s.tracks.length, d.tracks.length);
  assert.equal(s.versions.length, d.versions.length);
  for (const t of d.tracks) {
    const u = s.tracks.find((x) => x.id === t.id);
    assert.equal(u.finalId, t.finalId, `finalId di ${t.id}`);
    assert.equal(u.release, t.release, `release di ${t.id}`);
  }
  assert.ok(s.tracks.some((t) => t.finalId) && s.tracks.some((t) => t.release));
  assert.equal(s.versions.find((v) => v.id === 'd1v1').label, 'rec 1');
});

test('demoState: la definitiva sta nel proprio brano e le date sono nel formato giusto', () => {
  const d = demoState(NOW);
  for (const t of d.tracks) {
    if (t.finalId) assert.equal(d.versions.find((v) => v.id === t.finalId).trackId, t.id);
    if (t.release) assert.match(t.release, /^\d{4}-\d{2}-\d{2}$/);
  }
});

// ---- correzioni dopo la rilettura
import { fromBackup } from '../js/store.js';

test('backup importato: il consenso ai non arriva dal file, nome e chiave restano i tuoi', () => {
  const cur = emptyState();
  cur.me = { name: 'davide', phone: '393331234567' };
  cur.ai = { base: 'https://mio.example/v1', key: 'segreta', model: 'm', consent: '' };
  const raw = { schema: 2, me: { name: 'altro', phone: '1' }, ai: { base: 'https://estraneo.example/v1', key: '', model: 'x', consent: 'estraneo.example' }, tracks: [{ id: 't1', title: 'brano' }] };
  const out = fromBackup(cur, raw);
  assert.equal(out.ai.consent, '');
  assert.equal(out.ai.base, 'https://mio.example/v1');
  assert.equal(out.ai.key, 'segreta');
  assert.equal(out.me.name, 'davide');
  assert.equal(out.tracks.length, 1);
  assert.notEqual(out.ai, cur.ai); // copia, non lo stesso oggetto
});

test('backup importato su un dispositivo senza nome: prende nome e numero dal file', () => {
  const out = fromBackup(emptyState(), { me: { name: 'sara', phone: '39333' } });
  assert.equal(out.me.name, 'sara');
});

test('dati di una versione più nuova: si leggono ma non si sovrascrivono', async () => {
  const mem = new Map([['tempo.studio.v1', JSON.stringify({ schema: 99, tracks: [{ id: 't1', title: 'futuro' }] })]]);
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const m = await import('../js/store.js?nuovo');
  const st = m.load();
  assert.equal(st.tracks[0].title, 'futuro');
  assert.equal(m.dataTooNew(), true);
  assert.equal(m.save(st), false);
  assert.match(mem.get('tempo.studio.v1'), /"schema":99/);
  delete globalThis.localStorage;
});
