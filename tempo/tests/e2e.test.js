// Inviti diretti cifrati: primitive (e2e.js) e flusso del client (direct.js) contro il server vero in memoria.
// Orari fissi, nessuna rete, nessuna attesa: il tempo è una variabile che si sposta a mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDevice, fingerprint, safetyCode, makeContactCode, findContactCode, sealMessage, openMessage,
  cleanPub, cleanEnvelope, cleanName, b64u, unb64u, sameString, E2EError, MAX_AGE, MAX_SKEW, MAX_BODY, MAX_ENV,
} from '../js/e2e.js';
import { createDirect } from '../js/direct.js';
import { createApp, memoryStore } from '../../cloud/src/app.js';

const T = Date.parse('2026-11-27T12:00:00Z');
const DAY = 24 * 3600e3;
const enc = new TextEncoder();
const rejectsWith = (p, code) => assert.rejects(p, (e) => e instanceof E2EError && e.code === code, `atteso ${code}`);
const flip = (s, i = 7) => { const b = unb64u(s); b[i % b.length] ^= 1; return b64u(b); };
const INV = 'tempo:inv1:' + 'abcDEF123_-'.repeat(8);

// ---------------------------------------------------------------- primitive

async function trio() {
  const [A, B, C] = await Promise.all([createDevice(), createDevice(), createDevice()]);
  const me = (d, uid) => ({ uid, device: d });
  return { A: me(A, 'u_anna01'), B: me(B, 'u_bruno1'), C: me(C, 'u_carla1') };
}
const trustA = (A) => (uid, dev) => (uid === A.uid && dev === A.device.id ? A.device.pub : null);
const openAs = (me, env, extra = {}) => openMessage(me, env, { now: T, ...extra });
const sealAB = (A, B, msg = {}) => sealMessage(A, { uid: B.uid, pub: B.device.pub }, { kind: 'invito', at: T, body: { t: INV }, ...msg });

test('una busta sigillata si apre dal destinatario e restituisce corpo, mittente e chiave', async () => {
  const { A, B } = await trio();
  const env = await sealAB(A, B);
  const out = await openAs(B, env, { trusted: trustA(A) });
  assert.deepEqual(out.body, { t: INV });
  assert.equal(out.kind, 'invito');
  assert.equal(out.at, T);
  assert.deepEqual(out.from, { uid: A.uid, dev: A.device.id });
  assert.deepEqual(out.pub, A.device.pub);
  assert.match(out.id, /^[A-Za-z0-9_-]{6,40}$/);
});

test('la busta non contiene il testo in chiaro', async () => {
  const { A, B } = await trio();
  const env = await sealAB(A, B, { body: { t: 'tempo:inv1:SEGRETISSIMO_SEGRETISSIMO' } });
  assert.ok(!JSON.stringify(env).includes('SEGRETISSIMO'));
  assert.deepEqual(Object.keys(env).sort(), ['ct', 'epk', 'from', 'iv', 'to', 'v']);
});

test('due buste con lo stesso contenuto sono diverse (chiave e iv nuovi ogni volta)', async () => {
  const { A, B } = await trio();
  const [x, y] = [await sealAB(A, B, { id: 'msg_fisso_01' }), await sealAB(A, B, { id: 'msg_fisso_01' })];
  assert.notEqual(x.epk, y.epk);
  assert.notEqual(x.iv, y.iv);
  assert.notEqual(x.ct, y.ct);
});

test('testo con HTML, emoji e caratteri strani torna identico (nessuna pulizia in mezzo)', async () => {
  const { A, B } = await trio();
  const body = { t: '<img src=x onerror=alert(1)> è già così 😀 "\\ ‮' };
  const out = await openAs(B, await sealAB(A, B, { body }), { trusted: trustA(A) });
  assert.deepEqual(out.body, body);
});

// ogni campo dell'intestazione e del testo cifrato è autenticato

test('manomissione: mittente (uid o dispositivo) cambiato → non si apre', async () => {
  const { A, B } = await trio();
  const env = await sealAB(A, B);
  for (const bad of [{ ...env, from: { ...env.from, uid: 'u_altro01' } }, { ...env, from: { ...env.from, dev: 'dev_altro01' } }]) {
    await rejectsWith(openAs(B, bad, { trusted: () => A.device.pub }), 'manomessa');
  }
});

test('manomissione: destinatario cambiato → non è per me', async () => {
  const { A, B } = await trio();
  const env = await sealAB(A, B);
  for (const bad of [{ ...env, to: { ...env.to, uid: 'u_altro01' } }, { ...env, to: { ...env.to, dev: 'dev_altro01' } }]) {
    await rejectsWith(openAs(B, bad, { trusted: trustA(A) }), 'non-per-me');
  }
});

test('manomissione: chiave usa-e-getta, iv o un bit del testo cifrato → non si apre', async () => {
  const { A, B } = await trio();
  const env = await sealAB(A, B);
  const other = await sealAB(A, B);
  const cases = {
    epk: { ...env, epk: other.epk },
    iv: { ...env, iv: flip(env.iv) },
    'ct (primo bit)': { ...env, ct: flip(env.ct, 0) },
    'ct (a metà)': { ...env, ct: flip(env.ct, 40) },
    'ct (tag finale)': { ...env, ct: flip(env.ct, unb64u(env.ct).length - 1) },
  };
  for (const [name, bad] of Object.entries(cases)) {
    await assert.rejects(openAs(B, bad, { trusted: trustA(A) }), (e) => e instanceof E2EError && ['manomessa', 'formato'].includes(e.code), name);
  }
});

test('manomissione: testo cifrato accorciato o allungato → non si apre', async () => {
  const { A, B } = await trio();
  const env = await sealAB(A, B);
  const ct = unb64u(env.ct);
  for (const bad of [b64u(ct.subarray(0, ct.length - 1)), b64u(new Uint8Array([...ct, 0]))]) {
    await assert.rejects(openAs(B, { ...env, ct: bad }, { trusted: trustA(A) }), (e) => e instanceof E2EError);
  }
});

test('un punto fuori curva come chiave usa-e-getta non si apre e non rompe niente', async () => {
  const { A, B } = await trio();
  const env = await sealAB(A, B);
  const pt = new Uint8Array(65); pt[0] = 4; pt.fill(1, 1); // (x, y) non sta sulla curva
  await rejectsWith(openAs(B, { ...env, epk: b64u(pt) }, { trusted: trustA(A) }), 'manomessa');
  const zero = new Uint8Array(65); zero[0] = 4; // punto all'infinito mascherato
  await rejectsWith(openAs(B, { ...env, epk: b64u(zero) }, { trusted: trustA(A) }), 'manomessa');
  const wrongPrefix = new Uint8Array(65); wrongPrefix[0] = 2;
  await rejectsWith(openAs(B, { ...env, epk: b64u(wrongPrefix) }, { trusted: trustA(A) }), 'formato');
});

test('firma di un\'altra chiave con lo stesso id dispositivo → firma', async () => {
  const { A, B } = await trio();
  const finto = { uid: A.uid, device: await createDevice(A.device.id) };
  const env = await sealAB(finto, B);
  await rejectsWith(openAs(B, env, { trusted: trustA(A) }), 'firma');
});

test('mittente sconosciuto: senza chiave di cui fidarsi → sconosciuto', async () => {
  const { A, B } = await trio();
  const env = await sealAB(A, B);
  await rejectsWith(openAs(B, env, { trusted: () => null }), 'sconosciuto');
  await rejectsWith(openAs(B, env, {}), 'sconosciuto');
  // la chiave di fiducia è di un altro dispositivo: non vale
  await rejectsWith(openAs(B, env, { trusted: () => B.device.pub }), 'sconosciuto');
});

test('introduce vale solo per il tipo contatto, e solo se la chiave coincide con il dispositivo', async () => {
  const { A, B } = await trio();
  const inv = await sealAB(A, B);
  await rejectsWith(openAs(B, inv, { introduce: () => A.device.pub }), 'sconosciuto');
  const intro = await sealAB(A, B, { kind: 'contatto', body: { k: 'x' } });
  const out = await openAs(B, intro, { introduce: () => A.device.pub });
  assert.equal(out.kind, 'contatto');
  await rejectsWith(openAs(B, intro, { introduce: () => B.device.pub }), 'sconosciuto');
  await rejectsWith(openAs(B, intro, { introduce: () => null }), 'sconosciuto');
  await rejectsWith(openAs(B, intro, { introduce: () => ({ junk: 1 }) }), 'sconosciuto');
});

test('busta per un altro dispositivo (anche dello stesso account) → non è per me', async () => {
  const { A, B, C } = await trio();
  const env = await sealAB(A, B);
  await rejectsWith(openAs(C, env, { trusted: trustA(A) }), 'non-per-me');
  const B2 = { uid: B.uid, device: await createDevice() };
  await rejectsWith(openAs(B2, env, { trusted: trustA(A) }), 'non-per-me');
});

test('inoltro: una busta di A per B non si apre per C nemmeno se il server riscrive l\'intestazione', async () => {
  const { A, B, C } = await trio();
  const env = await sealAB(A, B);
  const riscritta = { ...env, to: { uid: C.uid, dev: C.device.id } };
  await rejectsWith(openAs(C, riscritta, { trusted: trustA(A) }), 'manomessa');
  // e se riscrive anche la chiave usa-e-getta con una sua: non ha la chiave di C per cifrare qualcosa di valido
  const sua = await sealAB(A, C);
  await rejectsWith(openAs(C, { ...env, to: sua.to, epk: sua.epk }, { trusted: trustA(A) }), 'manomessa');
});

test('un\'intestazione che dice altro dal contenuto firmato → manomessa', async () => {
  // A firma e cifra per B un contenuto che dice «da A»; il server lo reimbusta con intestazione di C
  // non si può costruire senza la chiave: qui lo simuliamo cifrando davvero un contenuto incoerente con l'intestazione
  const { A, B } = await trio();
  const env = await sealAB(A, B);
  const incoerente = { ...env, from: { uid: 'u_carla1', dev: A.device.id } };
  await rejectsWith(openAs(B, incoerente, { trusted: () => A.device.pub }), 'manomessa');
});

test('ora: busta di 30 giorni fa è ancora buona, di 30 giorni e un millisecondo è scaduta', async () => {
  const { A, B } = await trio();
  await openAs(B, await sealAB(A, B, { at: T - MAX_AGE }), { trusted: trustA(A) });
  await rejectsWith(openAs(B, await sealAB(A, B, { at: T - MAX_AGE - 1 }), { trusted: trustA(A) }), 'scaduta');
});

test('ora: troppo nel futuro è «futura» (orologio sfasato), entro la tolleranza no', async () => {
  const { A, B } = await trio();
  await openAs(B, await sealAB(A, B, { at: T + MAX_SKEW }), { trusted: trustA(A) });
  await rejectsWith(openAs(B, await sealAB(A, B, { at: T + MAX_SKEW + 1 }), { trusted: trustA(A) }), 'futura');
  await rejectsWith(openAs(B, await sealAB(A, B, { at: T + 365 * DAY }), { trusted: trustA(A) }), 'futura');
});

test('ripetizione: seen(id) vero → ripetuta; l\'id passato a seen è quello firmato', async () => {
  const { A, B } = await trio();
  const env = await sealAB(A, B, { id: 'msg_unico_01' });
  const visti = new Set();
  const opts = { trusted: trustA(A), seen: (id) => visti.has(id) };
  const out = await openAs(B, env, opts);
  assert.equal(out.id, 'msg_unico_01');
  visti.add(out.id);
  await rejectsWith(openAs(B, env, opts), 'ripetuta');
});

test('openMessage senza orario, con busta vuota o malformata → errori chiari, mai eccezioni strane', async () => {
  const { A, B } = await trio();
  const env = await sealAB(A, B);
  await rejectsWith(openMessage(B, env, { trusted: trustA(A) }), 'ora');
  for (const bad of [null, undefined, 'x', 42, [], {}, { ...env, v: 2 }, { ...env, ct: 'ab' }, { ...env, iv: env.iv + 'A' }, { ...env, ct: env.ct + '=' }, { ...env, from: null }]) {
    await rejectsWith(openAs(B, bad, { trusted: trustA(A) }), 'formato');
  }
});

test('sealMessage rifiuta tipo sconosciuto, ora non valida, destinatario non valido e corpo troppo grande', async () => {
  const { A, B } = await trio();
  const to = { uid: B.uid, pub: B.device.pub };
  await assert.rejects(sealMessage(A, to, { kind: 'altro', at: T, body: {} }), { code: 'tipo' });
  await assert.rejects(sealMessage(A, to, { kind: 'invito', at: NaN, body: {} }), { code: 'ora' });
  await assert.rejects(sealMessage(A, { uid: B.uid, pub: { ...B.device.pub, enc: B.device.pub.sig } }, { kind: 'invito', at: T, body: {} }), { code: 'destinatario' });
  await assert.rejects(sealMessage(A, { uid: 'x', pub: B.device.pub }, { kind: 'invito', at: T, body: {} }), { code: 'destinatario' });
  await assert.rejects(sealMessage(A, to, { kind: 'invito', at: T, body: { t: 'x'.repeat(MAX_BODY) } }), { code: 'troppo' });
});

test('corpo al limite (8192 byte) si sigilla e si apre', async () => {
  const { A, B } = await trio();
  const body = 'x'.repeat(MAX_BODY - 2); // + 2 virgolette = 8192
  const env = await sealAB(A, B, { body });
  assert.ok(cleanEnvelope(env));
  assert.equal((await openAs(B, env, { trusted: trustA(A) })).body, body);
});

test('ciò che sealMessage accetta, il server e il destinatario lo accettano: anche con molte virgolette', async () => {
  // Atteso: una busta sigillata senza errore passa cleanEnvelope (altrimenti il mittente crede di aver mandato e non arriva).
  const { A, B } = await trio();
  const body = '"'.repeat(4000); // JSON = 8002 byte, ma il contenuto viene cifrato con le virgolette protette due volte
  let env = null;
  try { env = await sealAB(A, B, { body }); } catch (e) { assert.ok(e instanceof E2EError); return; }
  assert.ok(cleanEnvelope(env), `busta di ${JSON.stringify(env).length} caratteri oltre il limite ${MAX_ENV} ma sigillata senza errore`);
});

// ---------------------------------------------------------------- forma delle buste e delle chiavi

test('cleanEnvelope toglie i campi in più e rifiuta buste troppo grandi o con base64 non canonico', async () => {
  const { A, B } = await trio();
  const env = await sealAB(A, B);
  const ok = cleanEnvelope({ ...env, extra: 'x', from: { ...env.from, nome: 'y' } });
  assert.deepEqual(Object.keys(ok).sort(), ['ct', 'epk', 'from', 'iv', 'to', 'v']);
  assert.deepEqual(Object.keys(ok.from).sort(), ['dev', 'uid']);
  assert.equal(cleanEnvelope({ ...env, ct: b64u(new Uint8Array(20000)) }), null);
  assert.equal(cleanEnvelope({ ...env, ct: env.ct + '=' }), null);
  assert.equal(cleanEnvelope({ ...env, ct: env.ct.replace(/.$/, '!') }), null);
  assert.equal(cleanEnvelope({ ...env, ct: b64u(new Uint8Array(16)) }), null); // meno del tag
  assert.equal(cleanEnvelope({ ...env, from: { uid: '<b>', dev: env.from.dev } }), null);
  assert.equal(cleanEnvelope({ ...env, from: { uid: 'u'.repeat(41), dev: env.from.dev } }), null);
});

test('cleanPub: chiave valida passa pulita; tutto il resto è null', async () => {
  const d = await createDevice();
  assert.deepEqual(cleanPub({ ...d.pub, x: 1 }), d.pub);
  const bad = [
    null, undefined, 'x', [], {}, { ...d.pub, v: 2 }, { ...d.pub, dev: 'a b' }, { ...d.pub, dev: 'x' },
    { ...d.pub, enc: d.pub.sig }, { ...d.pub, enc: d.pub.enc.slice(1) }, { ...d.pub, sig: d.pub.sig + 'A' },
    { ...d.pub, enc: b64u(new Uint8Array(65).fill(2)) }, { ...d.pub, sig: 5 }, { ...d.pub, enc: '<script>' },
  ];
  for (const b of bad) assert.equal(cleanPub(b), null, JSON.stringify(b)?.slice(0, 60));
});

test('unb64u e sameString: rifiutano il non canonico e i tipi sbagliati', () => {
  assert.throws(() => unb64u('AB=='), { code: 'formato' });
  assert.throws(() => unb64u('AB'), { code: 'formato' }); // bit residui non zero: non canonico
  assert.throws(() => unb64u('A'), { code: 'formato' });
  assert.throws(() => unb64u('a+b/'), { code: 'formato' });
  assert.throws(() => unb64u(5), { code: 'formato' });
  assert.throws(() => unb64u(b64u(new Uint8Array(3)), 4), { code: 'formato' });
  assert.deepEqual([...unb64u('')], []);
  assert.ok(sameString('abc', 'abc'));
  assert.ok(!sameString('abc', 'abd') && !sameString('abc', 'ab') && !sameString('1', 1) && !sameString(null, null));
});

// ---------------------------------------------------------------- impronta e codice di sicurezza

test('impronta: stabile, di 32 byte, diversa per chiavi diverse; rifiuta chiavi rotte', async () => {
  const [a, b] = [await createDevice(), await createDevice()];
  const fa = await fingerprint(a.pub);
  assert.equal(fa, await fingerprint({ ...a.pub }));
  assert.equal(unb64u(fa, 32).length, 32);
  assert.notEqual(fa, await fingerprint(b.pub));
  await assert.rejects(fingerprint({ ...a.pub, enc: 'x' }), { code: 'chiave' });
  await assert.rejects(fingerprint(null), { code: 'chiave' });
});

test('codice di sicurezza: 30 cifre in 6 gruppi, uguale in qualunque ordine, diverso se cambia una chiave', async () => {
  const [a, b, c] = [await createDevice(), await createDevice(), await createDevice()];
  const [fa, fb, fc] = [await fingerprint(a.pub), await fingerprint(b.pub), await fingerprint(c.pub)];
  const s = await safetyCode(fa, fb);
  assert.match(s, /^\d{5}( \d{5}){5}$/);
  assert.equal(s, await safetyCode(fb, fa));
  assert.notEqual(s, await safetyCode(fa, fc));
  await assert.rejects(safetyCode(fa, null), { code: 'chiave' });
});

// ---------------------------------------------------------------- codice contatto

async function codeFor(extra = {}) {
  const d = await createDevice();
  const fp = await fingerprint(d.pub);
  const c = makeContactCode({ fp, name: 'Anna', exp: T + 7 * DAY, ...extra });
  return { ...c, fp };
}
const rawCode = (obj) => 'tempo:ct1:' + b64u(enc.encode(JSON.stringify(obj)));
const base = async () => { const { lookup, secret, fp } = await codeFor(); return { v: 1, l: lookup, k: secret, f: fp, n: 'Anna', x: T + DAY }; };

test('findContactCode: legge il codice nudo, dentro un messaggio e dentro un link (#, ? e &)', async () => {
  const c = await codeFor();
  const body = c.code.slice('tempo:ct1:'.length);
  for (const text of [c.code, `Ciao! Aggiungimi: ${c.code} grazie`, `https://x.test/tempo/#contatto=${body}`, `https://x.test/?a=1&contatto=${body}`, `Guarda\nhttps://x.test/tempo/?contatto=${body}\nCiao`]) {
    const r = findContactCode(text, T);
    assert.deepEqual(r, { lookup: c.lookup, secret: c.secret, fp: c.fp, name: 'Anna', exp: c.exp }, text.slice(0, 40));
  }
});

test('findContactCode: vuoto, non stringa o senza codice → null', () => {
  for (const x of [undefined, null, '', 42, {}, [], 'tempo:ct1:', 'https://x.test/#contatto=', 'nessun codice qui']) assert.equal(findContactCode(x, T), null);
});

test('findContactCode: codice rovinato (troncato, caratteri sbagliati, base64 non canonico) → null', async () => {
  const c = await codeFor();
  assert.equal(findContactCode(c.code.slice(0, c.code.length / 2 + 5), T), null);
  assert.equal(findContactCode(c.code.slice(0, 30), T), null);
  assert.equal(findContactCode('tempo:ct1:' + '*'.repeat(80), T), null);
  assert.equal(findContactCode('tempo:ct1:' + 'A'.repeat(80), T), null);
  assert.equal(findContactCode(c.code + 'A', T), null); // lunghezza che non torna / non canonico
  assert.equal(findContactCode('tempo:ct1:' + 'a'.repeat(700), T), null);
});

test('findContactCode: JSON con campi sbagliati → null', async () => {
  const b = await base();
  assert.ok(findContactCode(rawCode(b), T), 'il modello base è valido');
  const bad = {
    versione: { ...b, v: 2 }, 'l corto': { ...b, l: b.l.slice(1) }, 'l mancante': { ...b, l: undefined }, 'k corto': { ...b, k: b.k.slice(2) },
    'k numero': { ...b, k: 12 }, 'f corto': { ...b, f: b.f.slice(1) }, 'f mancante': { ...b, f: undefined },
    'x stringa': { ...b, x: String(b.x) }, 'x nullo': { ...b, x: null }, 'x mancante': { ...b, x: undefined },
    array: [b], stringa: 'ciao', numero: 7, nullo: null,
  };
  for (const [name, o] of Object.entries(bad)) assert.equal(findContactCode(rawCode(o), T), null, name);
  assert.equal(findContactCode('tempo:ct1:' + b64u(enc.encode('{non json'.repeat(10))), T), null);
  assert.equal(findContactCode('tempo:ct1:' + b64u(new Uint8Array(60).fill(0xff)), T), null); // UTF-8 non valido
});

test('findContactCode: scaduto → null (al millisecondo), senza orario non controlla la scadenza', async () => {
  const b = await base();
  assert.ok(findContactCode(rawCode(b), b.x));
  assert.equal(findContactCode(rawCode(b), b.x + 1), null);
  assert.ok(findContactCode(rawCode(b)));
});

test('findContactCode e makeContactCode: il nome è ripulito (controlli, bidi, lunghezza); l\'HTML resta testo', async () => {
  const d = await createDevice();
  const fp = await fingerprint(d.pub);
  const sporco = '  <b>Ann\u0000a</b>‮\n\tRossi  ' + 'z'.repeat(500);
  const c = makeContactCode({ fp, name: sporco, exp: T + DAY });
  const r = findContactCode(c.code, T);
  assert.ok(r.name.length <= 40 && r.name.length > 0);
  assert.ok(!/[\u0000-\u001f‮]/.test(r.name));
  assert.ok(r.name.startsWith('<b>Ann a</b>'));
  assert.equal(cleanName(undefined), '');
  assert.equal(cleanName(12), '12');
});

test('findContactCode: un testo lunghissimo con il codice oltre i primi 4000 caratteri non lo trova (e non si blocca)', async () => {
  const c = await codeFor();
  assert.equal(findContactCode('a '.repeat(3000) + c.code, T), null);
  assert.ok(findContactCode(c.code + ' ' + 'z'.repeat(1e6), T));
});

test('makeContactCode: impronta non valida o scadenza assente → errore; ogni codice ha id e segreto nuovi', async () => {
  const d = await createDevice();
  const fp = await fingerprint(d.pub);
  assert.throws(() => makeContactCode({ fp: 'x', name: 'a', exp: T }), { code: 'formato' });
  assert.throws(() => makeContactCode({ fp, name: 'a', exp: NaN }), { code: 'scadenza' });
  assert.throws(() => makeContactCode({ fp, name: 'a' }), { code: 'scadenza' });
  const [x, y] = [makeContactCode({ fp, name: 'a', exp: T }), makeContactCode({ fp, name: 'a', exp: T })];
  assert.notEqual(x.lookup, y.lookup);
  assert.notEqual(x.secret, y.secret);
  assert.notEqual(x.lookup, x.secret);
});

// ---------------------------------------------------------------- flusso del client contro il server in memoria

const BASE = 'https://cloud.test';
const JSONH = { 'content-type': 'application/json' };

function world() {
  const store = memoryStore();
  const clock = { t: T };
  const app = createApp({ store, secret: 'x'.repeat(40), now: () => clock.t });
  const raw = (u, i) => app.fetch(new Request(u, i));
  let n = 0;
  async function client(name) {
    const r = await (await raw(BASE + '/v1/signup', { method: 'POST', headers: { ...JSONH, 'x-forwarded-for': '10.0.0.' + ++n }, body: JSON.stringify({ email: `${name}@x.it`, password: 'passwordlunga' }) })).json();
    const c = { name, S: { cloudUrl: BASE, cloudToken: r.token }, uid: r.uid, tamper: null, skew: 0, mem: new Map(), ks: new Map() };
    const fetchImpl = async (u, i) => {
      const res = await raw(u, i);
      if (!c.tamper) return res;
      const j = await res.clone().json().catch(() => null);
      const out = c.tamper(i.method, new URL(u).pathname, j);
      return out === undefined ? res : new Response(JSON.stringify(out), { status: res.status, headers: JSONH });
    };
    c.make = (ks = c.ks) => createDirect({
      S: c.S, fetchImpl, now: () => clock.t + c.skew,
      storage: { get: (k) => structuredClone(c.mem.get(k) ?? null), set: (k, v) => c.mem.set(k, structuredClone(v)) },
      keystore: { load: async (u) => ks.get(u) || null, save: async (u, d) => { ks.set(u, d); } },
    });
    c.d = c.make();
    return c;
  }
  const api = async (c, method, path, body) => {
    const r = await raw(BASE + path, { method, headers: { ...JSONH, authorization: 'Bearer ' + c.S.cloudToken }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const inbox = async (c) => (await api(c, 'GET', '/v1/inbox')).body.messages;
  /** a e b diventano contatti sul serio (link + introduzione) e la casella di a è pulita */
  async function befriend(a, b) {
    const code = await a.d.createCode(a.name);
    await b.d.useCode(code, b.name);
    await a.d.receive();
    return code;
  }
  return { store, app, clock, client, api, inbox, befriend, raw };
}

test('giro completo: A crea il link, B lo usa, A riceve il contatto, A manda una proposta, B la riceve in coda', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  const code = await A.d.createCode('Anna');
  assert.match(code, /^tempo:ct1:/);
  assert.equal(await A.d.status(), 'qui');

  const contattoB = await B.d.useCode(`Aggiungimi su Tempo: https://x.test/#contatto=${code.slice(10)}`, 'Bruno');
  assert.deepEqual({ uid: contattoB.uid, name: contattoB.name }, { uid: A.uid, name: 'Anna' });

  const ev = await A.d.receive();
  assert.deepEqual(ev, [{ type: 'contatto', uid: B.uid, name: 'Bruno' }]);
  assert.deepEqual(A.d.contacts(), [{ uid: B.uid, name: 'Bruno', verified: false, changed: false, off: false }]);
  assert.equal((await w.inbox(A)).length, 0, 'la casella si svuota dopo la lettura');

  // stesso codice di sicurezza sui due lati
  const [sa, sb] = [await A.d.safety(B.uid), await B.d.safety(A.uid)];
  assert.equal(sa, sb);
  assert.match(sa, /^\d{5}( \d{5}){5}$/);

  await A.d.send(B.uid, 'invito', { t: INV });
  const ricevuti = await B.d.receive();
  assert.equal(ricevuti.length, 1);
  assert.deepEqual({ type: ricevuti[0].type, from: ricevuti[0].from, name: ricevuti[0].name }, { type: 'invito', from: A.uid, name: 'Anna' });
  const coda = B.d.queue();
  assert.equal(coda.length, 1);
  assert.deepEqual({ t: coda[0].t, from: coda[0].from, at: coda[0].at }, { t: INV, from: A.uid, at: T });
  assert.equal((await w.inbox(B)).length, 0);

  B.d.dropQueued(coda[0].id);
  assert.equal(B.d.queue().length, 0);
});

test('il server non vede mai il testo della proposta', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  await A.d.send(B.uid, 'invito', { t: 'tempo:inv1:SEGRETISSIMO_DA_NON_VEDERE' });
  const dump = JSON.stringify([...w.store._map.entries()]);
  assert.ok(!dump.includes('SEGRETISSIMO'));
  assert.ok(!dump.includes(A.S.cloudToken));
});

test('il link vale una volta sola: un terzo che lo riusa non diventa contatto', async () => {
  const w = world();
  const [A, B, C] = [await w.client('anna'), await w.client('bruno'), await w.client('carla')];
  const code = await w.befriend(A, B);
  await assert.rejects(C.d.useCode(code, 'Carla'), (e) => e.status === 404);
  assert.deepEqual(C.d.contacts(), []);
  assert.deepEqual(await A.d.receive(), []);
  assert.equal(A.d.contacts().length, 1);
});

test('il proprio link e i testi senza link non aggiungono nessuno', async () => {
  const w = world();
  const A = await w.client('anna');
  const code = await A.d.createCode('Anna');
  await assert.rejects(A.d.useCode(code, 'Anna'), { code: 'mio' });
  await assert.rejects(A.d.useCode('ciao a tutti', 'Anna'), { code: 'codice' });
  await assert.rejects(A.d.useCode('', 'Anna'), { code: 'codice' });
  assert.deepEqual(A.d.contacts(), []);
});

test('link scaduto: dopo 8 giorni non si usa più e non aggiunge nessuno', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  const code = await A.d.createCode('Anna');
  w.clock.t += 8 * DAY;
  await assert.rejects(B.d.useCode(code, 'Bruno'), { code: 'codice' });
  assert.deepEqual(B.d.contacts(), []);
});

test('senza account il client lo dice in italiano e non chiama la rete', async () => {
  const w = world();
  const A = await w.client('anna');
  A.S.cloudToken = '';
  await assert.rejects(A.d.createCode('Anna'), { code: 'account' });
  await assert.rejects(A.d.receive(), { code: 'account' });
});

test('rete assente: createCode, send e receive falliscono con un errore e non lasciano contatti a metà', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  const offline = A.make(); // stesso archivio e stesse chiavi, ma senza rete
  const off = createDirect({ S: A.S, fetchImpl: async () => { throw new TypeError('fetch failed'); }, now: () => w.clock.t, storage: { get: (k) => structuredClone(A.mem.get(k) ?? null), set: (k, v) => A.mem.set(k, structuredClone(v)) }, keystore: { load: async (u) => A.ks.get(u) || null, save: async () => {} } });
  await assert.rejects(off.send(B.uid, 'invito', { t: INV }), (e) => e.status === 0);
  await assert.rejects(off.receive(), (e) => e.status === 0);
  assert.equal(offline.contacts().length, 1);
});

test('send rifiuta tipi e testi che non sono proposte di Tempo, e contatti che non esistono', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  for (const [kind, body] of [['contatto', { t: INV }], ['invito', { t: 'ciao' }], ['invito', { t: '<script>' }], ['invito', {}], ['invito', null], ['invito', { t: 'tempo:inv1:' + 'a'.repeat(7000) }]]) {
    await assert.rejects(A.d.send(B.uid, kind, body), { code: 'tipo' });
  }
  await assert.rejects(A.d.send('u_nessuno', 'invito', { t: INV }), { code: 'contatto' });
  assert.equal((await w.inbox(B)).length, 0);
});

// ripetizione

test('ripetizione: la stessa busta rimandata due volte finisce una volta sola in coda, anche se si ritira a più riprese', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  await A.d.send(B.uid, 'invito', { t: INV });
  const env = (await w.inbox(B))[0].env;
  await w.api(A, 'POST', `/v1/inbox/${B.uid}`, { env });
  await w.api(A, 'POST', `/v1/inbox/${B.uid}`, { env });
  assert.equal((await w.inbox(B)).length, 3);
  const ev = await B.d.receive();
  assert.equal(ev.length, 1);
  assert.equal(B.d.queue().length, 1);
  assert.equal((await w.inbox(B)).length, 0, 'le copie scartate si tolgono dalla casella');
  // dopo, un altro rinvio della stessa busta viene scartato lo stesso
  await w.api(A, 'POST', `/v1/inbox/${B.uid}`, { env });
  assert.deepEqual(await B.d.receive(), []);
  assert.equal(B.d.queue().length, 1);
  assert.equal((await w.inbox(B)).length, 0);
});

test('ripetizione: la memoria degli id sopravvive a una nuova istanza del client (stesso archivio)', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  await A.d.send(B.uid, 'invito', { t: INV });
  const env = (await w.inbox(B))[0].env;
  await B.d.receive();
  await w.api(A, 'POST', `/v1/inbox/${B.uid}`, { env });
  const B2 = B.make();
  assert.deepEqual(await B2.receive(), []);
  assert.equal(B2.queue().length, 1);
});

test('busta più vecchia di 30 giorni: tolta dalla casella; troppo nel futuro: resta (orologio sfasato), niente in coda', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  for (const skew of [-31 * DAY, 2 * 3600e3]) {
    A.skew = skew; // l'orologio di A è sbagliato: la busta porta un'ora implausibile
    await A.d.send(B.uid, 'invito', { t: INV });
    A.skew = 0;
  }
  assert.equal((await w.inbox(B)).length, 2);
  assert.deepEqual(await B.d.receive(), []);
  assert.equal(B.d.queue().length, 0);
  assert.equal((await w.inbox(B)).length, 1, 'quella «futura» si riprova più tardi');
});

test('un invito da chi non è nei tuoi contatti locali non finisce in coda', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  B.mem.clear(); // B ha perso i contatti locali (ma il server li conosce ancora)
  const B2 = B.make();
  await A.d.send(B.uid, 'invito', { t: INV });
  assert.deepEqual(await B2.receive(), []);
  assert.equal(B2.queue().length, 0);
  assert.equal((await w.inbox(B)).length, 0);
});

// introduzioni false

async function forgedIntro(w, from, toUid, body, { id } = {}) {
  const me = await from.d.me();
  const to = (await w.api(from, 'GET', `/v1/keys/${toUid}`)).body.pub;
  const env = await sealMessage(me, { uid: toUid, pub: to }, { kind: 'contatto', at: w.clock.t, body, id });
  return (await w.api(from, 'POST', `/v1/inbox/${toUid}`, { env })).status;
}
/** X è collegato ad A sul server (ha usato un link) ma l'introduzione vera è tolta dalla casella di A */
async function linkedButUnintroduced(w, A, X) {
  const code = await A.d.createCode(A.name);
  await X.d.useCode(code, X.name);
  for (const m of await w.inbox(A)) await w.api(A, 'DELETE', `/v1/inbox/${m.id}`);
  return code;
}

test('introduzione con un segreto sbagliato o assente: nessun contatto aggiunto, busta tolta', async () => {
  const w = world();
  const [A, X] = [await w.client('anna'), await w.client('xavier')];
  await linkedButUnintroduced(w, A, X);
  const me = await X.d.me();
  const falsi = [{ k: 'x'.repeat(22), name: 'Xavier', pub: me.device.pub }, { name: 'Xavier', pub: me.device.pub }, { k: 5, pub: me.device.pub }, { k: null, pub: null }, null, 'testo'];
  for (const b of falsi) assert.equal(await forgedIntro(w, X, A.uid, b), 201);
  assert.equal((await w.inbox(A)).length, falsi.length);
  assert.deepEqual(await A.d.receive(), []);
  assert.deepEqual(A.d.contacts(), []);
  assert.equal((await w.inbox(A)).length, 0);
});

test('introduzione con il segreto di un link già usato: nessun contatto aggiunto', async () => {
  const w = world();
  const [A, B, X] = [await w.client('anna'), await w.client('bruno'), await w.client('xavier')];
  const usato = await findCode(await w.befriend(A, B)); // link consumato da B
  await linkedButUnintroduced(w, A, X);
  const me = await X.d.me();
  await forgedIntro(w, X, A.uid, { k: usato.secret, name: 'Xavier', pub: me.device.pub });
  assert.deepEqual(await A.d.receive(), []);
  assert.deepEqual(A.d.contacts().map((c) => c.uid), [B.uid]);
});
const findCode = (t) => findContactCode(t, T);

test('introduzione con il segreto di un link scaduto: nessun contatto aggiunto', async () => {
  const w = world();
  const [A, X] = [await w.client('anna'), await w.client('xavier')];
  const code = await A.d.createCode('Anna');
  const link = findCode(code);
  await X.d.useCode(code, 'Xavier');
  for (const m of await w.inbox(A)) await w.api(A, 'DELETE', `/v1/inbox/${m.id}`);
  const me = await X.d.me();
  w.clock.t += 8 * DAY; // il link di A vale 7 giorni
  await forgedIntro(w, X, A.uid, { k: link.secret, name: 'Xavier', pub: me.device.pub });
  assert.deepEqual(await A.d.receive(), []);
  assert.deepEqual(A.d.contacts(), []);
});

test('introduzione con il segreto giusto ma con la chiave di un altro dispositivo: scartata', async () => {
  const w = world();
  const [A, X] = [await w.client('anna'), await w.client('xavier')];
  const code = await A.d.createCode('Anna');
  const link = findCode(code);
  await X.d.useCode(code, 'Xavier');
  for (const m of await w.inbox(A)) await w.api(A, 'DELETE', `/v1/inbox/${m.id}`);
  const altro = await createDevice();
  await forgedIntro(w, X, A.uid, { k: link.secret, name: 'Xavier', pub: altro.pub });
  assert.deepEqual(await A.d.receive(), []);
  assert.deepEqual(A.d.contacts(), []);
});

// server malevolo

test('server malevolo: la chiave restituita per un link non corrisponde all\'impronta → useCode rifiuta e non aggiunge il contatto', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  const code = await A.d.createCode('Anna');
  const mitm = await createDevice();
  B.tamper = (method, path, j) => (/\/use$/.test(path) ? { ...j, pub: mitm.pub } : undefined);
  await assert.rejects(B.d.useCode(code, 'Bruno'), { code: 'impronta' });
  assert.deepEqual(B.d.contacts(), []);
  assert.equal((await w.inbox(A)).length, 0, 'nessuna introduzione è partita');
  assert.deepEqual((await w.api(B, 'GET', '/v1/contacts')).body.contacts, [], 'il collegamento sul server è annullato');
});

test('server malevolo: risposta senza chiave o con chiave rotta → useCode rifiuta', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  const code = await A.d.createCode('Anna');
  B.tamper = (method, path, j) => (/\/use$/.test(path) ? { uid: j.uid, pub: { v: 1, dev: 'x' } } : undefined);
  await assert.rejects(B.d.useCode(code, 'Bruno'), { code: 'impronta' });
  assert.deepEqual(B.d.contacts(), []);
});

test('server malevolo: cambia la chiave di un contatto → «cambiato», send rifiuta, i messaggi con la chiave nuova restano finché non confermi', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  const prima = await A.d.safety(B.uid);
  // B passa a un dispositivo nuovo (o il server mette una chiave sua): stesso account, chiave diversa
  const B2 = B.make(new Map());
  await B2.activate();
  const nuova = (await B2.me()).device;
  assert.equal(await B2.status(), 'qui');

  const contatti = await A.d.refresh();
  assert.equal(contatti[0].changed, true);
  await assert.rejects(A.d.send(B.uid, 'invito', { t: INV }), { code: 'cambiata' });
  assert.equal((await w.inbox(B)).length, 0, 'niente è partito verso la chiave nuova');
  assert.equal(await A.d.safety(B.uid) === prima, false, 'il codice di sicurezza mostrato è quello della chiave nuova');

  // B2 manda un invito ad A, firmato con la chiave nuova: A non lo apre ma non lo butta
  await B2.send(A.uid, 'invito', { t: INV });
  assert.deepEqual(await A.d.receive(), []);
  assert.equal(A.d.queue().length, 0);
  assert.equal((await w.inbox(A)).length, 1, 'la busta aspetta in casella');
  assert.deepEqual(await A.d.receive(), []);
  assert.equal((await w.inbox(A)).length, 1);

  // confermare con l'impronta di un'altra chiave non vale (il server ha cambiato chiave mentre guardavi il codice)
  assert.equal(A.d.trustChange(B.uid, (await A.d.safetyInfo(B.uid)).fp.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))), false);
  assert.equal(A.d.trustChange(B.uid), false);
  // A controlla il codice e conferma
  const info = await A.d.safetyInfo(B.uid);
  assert.equal(info.changed, true);
  assert.equal(A.d.trustChange(B.uid, info.fp), true);
  assert.equal(A.d.contacts()[0].verified, false);
  assert.equal((await A.d.receive()).length, 1);
  assert.equal(A.d.queue().length, 1);
  assert.equal((await w.inbox(A)).length, 0);
  await A.d.send(B.uid, 'invito', { t: INV }); // ora si può
  assert.equal(nuova.pub.dev, (await w.api(A, 'GET', `/v1/keys/${B.uid}`)).body.pub.dev);
});

test('chiave cambiata scoperta all\'invio (409 con la chiave nuova): il contatto passa a «cambiato» e non parte niente', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  await w.api(B, 'PUT', '/v1/keys', { pub: (await createDevice()).pub });
  await assert.rejects(A.d.send(B.uid, 'invito', { t: INV }), { code: 'cambiata' });
  assert.equal(A.d.contacts()[0].changed, true);
  assert.equal((await w.inbox(B)).length, 0);
  await assert.rejects(A.d.send(B.uid, 'invito', { t: INV }), { code: 'cambiata' });
});

test('chiave cambiata e poi tornata com\'era: il contatto non resta «cambiato»', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  const vecchia = (await B.d.me()).device.pub;
  await w.api(B, 'PUT', '/v1/keys', { pub: (await createDevice()).pub });
  assert.equal((await A.d.refresh())[0].changed, true);
  await w.api(B, 'PUT', '/v1/keys', { pub: vecchia });
  assert.equal((await A.d.refresh())[0].changed, false);
  await A.d.send(B.uid, 'invito', { t: INV });
});

test('il server inventa un contatto in più o ne toglie uno: refresh non aggiunge e non cancella, segna soltanto', async () => {
  const w = world();
  const [A, B, C] = [await w.client('anna'), await w.client('bruno'), await w.client('carla')];
  await w.befriend(A, B);
  await w.befriend(A, C);
  const finto = await createDevice();
  A.tamper = (method, path, j) => (method === 'GET' && path === '/v1/contacts' ? { contacts: [...j.contacts, { uid: 'u_inventato', pub: finto.pub }, { uid: 5 }, null] } : undefined);
  const lista = await A.d.refresh();
  assert.deepEqual(lista.map((c) => c.uid).sort(), [B.uid, C.uid].sort());
  A.tamper = null;
  await w.api(B, 'DELETE', `/v1/contacts/${A.uid}`); // B toglie A (o un server ostile lo fa sparire)
  const dopo = await A.d.refresh();
  assert.deepEqual(dopo.map((c) => c.uid).sort(), [B.uid, C.uid].sort(), 'niente si cancella da solo');
  assert.equal(dopo.find((c) => c.uid === B.uid).off, true);
  assert.equal(dopo.find((c) => c.uid === C.uid).off, false);
  A.tamper = (method, path) => (method === 'GET' && path === '/v1/contacts' ? { contacts: [] } : undefined);
  assert.equal((await A.d.refresh()).length, 2, 'un elenco vuoto dal server non azzera i contatti');
});

test('busta con un id di messaggio strano dal server viene ignorata, non apre niente e non fa danni', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  await A.d.send(B.uid, 'invito', { t: INV });
  B.tamper = (method, path, j) => (method === 'GET' && path === '/v1/inbox' ? { messages: [{ id: '../../x', env: j.messages[0].env }, { id: 5 }, null, ...j.messages] } : undefined);
  const ev = await B.d.receive();
  assert.equal(ev.length, 1);
  assert.equal(B.d.queue().length, 1);
});

test('contatto rimosso: sparisce da qui e dal server, e le sue buste in coda si tolgono', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  await A.d.send(B.uid, 'invito', { t: INV });
  await B.d.receive();
  assert.equal(B.d.queue().length, 1);
  await B.d.removeContact(A.uid);
  assert.deepEqual(B.d.contacts(), []);
  assert.equal(B.d.queue().length, 0);
  assert.deepEqual((await w.api(A, 'GET', '/v1/contacts')).body.contacts, []);
  await assert.rejects(A.d.send(B.uid, 'invito', { t: INV }), (e) => e.status === 403);
  await B.d.removeContact(A.uid); // ripetere non rompe
  await B.d.removeContact('<script>');
});

test('altro dispositivo: se gli inviti arrivano altrove, send e receive non li prendono; activate li riporta qui', async () => {
  const w = world();
  const [A, B] = [await w.client('anna'), await w.client('bruno')];
  await w.befriend(A, B);
  const B2 = B.make(new Map());
  await B2.activate();
  assert.equal(await B.d.status(), 'altrove');
  await assert.rejects(B.d.send(A.uid, 'invito', { t: INV }), { code: 'altrove' });
  assert.deepEqual(await B.d.receive(), []);
  await B.d.activate();
  assert.equal(await B.d.status(), 'qui');
});

test('cambio di account sullo stesso dispositivo: i contatti dell\'account di prima non valgono', async () => {
  const w = world();
  const [A, B, C] = [await w.client('anna'), await w.client('bruno'), await w.client('carla')];
  await w.befriend(A, B);
  assert.equal(A.d.contacts().length, 1);
  A.S.cloudToken = C.S.cloudToken; // sullo stesso telefono entra Carla
  A.d.forget();
  await A.d.me();
  assert.deepEqual(A.d.contacts(), []);
});

// ---- link della proposta con il codice contatto (chi non è ancora nei tuoi contatti)
import { withContactCode } from '../js/direct.js';
import { findInvite as _findInvite, makeInvite as _makeInvite, inviteText as _inviteText } from '../js/invite.js';

test('withContactCode: il link porta proposta e codice contatto, e si leggono tutti e due', () => {
  const inv = _makeInvite({ title: 'Cena', date: '2026-12-03', start: 1200, end: 1260, tz: 'Europe/Rome', from: 'Anna' }, { id: 'inv_link_0001', now: T });
  const fp = 'A'.repeat(43);
  const code = makeContactCode({ fp, name: 'Anna', exp: T + DAY }).code;
  const text = withContactCode(_inviteText(inv, { baseUrl: 'https://x.test/tempo/' }), code);
  const url = text.split('\n').find((l) => l.startsWith('https://'));
  assert.match(url, /#invito=[A-Za-z0-9_-]+&contatto=[A-Za-z0-9_-]+$/);
  assert.equal(_findInvite(url, T).id, 'inv_link_0001');
  const c = findContactCode(url, T);
  assert.equal(c.fp, fp);
  assert.equal(c.name, 'Anna');
  assert.match(text, /arrivano direttamente/);
  // un codice strano non entra nel link
  assert.equal(withContactCode('riga\nhttps://x.test/#invito=abc', 'tempo:ct1:a"b'), 'riga\nhttps://x.test/#invito=abc');
  assert.equal(withContactCode('senza link', code), 'senza link');
});
