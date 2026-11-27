// Inviti diretti cifrati, lato server: chiavi pubbliche, link monouso, contatti, casella.
// Il server non apre mai le buste: qui si controlla che faccia rispettare le regole e non perda niente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, memoryStore } from '../src/app.js';
import { createDevice, sealMessage, fingerprint, makeContactCode, b64u, unb64u } from '../../tempo/js/e2e.js';

const SECRET = 'x'.repeat(40);
const T0 = Date.parse('2026-11-27T12:00:00Z');
const DAY = 24 * 3600e3;
const INV = 'tempo:inv1:' + 'abcDEF123_-'.repeat(8);

function setup(storeOverride) {
  const store = storeOverride || memoryStore();
  let t = T0;
  const app = createApp({ store, secret: SECRET, now: () => t });
  let n = 0;
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    if (body !== undefined && typeof body !== 'string') h['content-type'] = 'application/json';
    const r = await app.fetch(new Request('https://cloud.test' + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }));
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  /** un utente con account, dispositivo e chiave attiva */
  async function user(name, { activate = true } = {}) {
    const r = await call('POST', '/v1/signup', { body: { email: `${name}@x.it`, password: 'passwordlunga' }, headers: { 'x-forwarded-for': '10.1.0.' + ++n } });
    assert.equal(r.status, 201);
    const u = { name, uid: r.body.uid, token: r.body.token, device: await createDevice() };
    u.me = { uid: u.uid, device: u.device };
    if (activate) assert.equal((await call('PUT', '/v1/keys', { token: u.token, body: { pub: u.device.pub } })).status, 200);
    return u;
  }
  const as = (u) => (method, path, body) => call(method, path, { token: u.token, body });
  /** a crea un link, b lo usa */
  async function link(a, b) {
    const c = makeContactCode({ fp: await fingerprint(a.device.pub), name: a.name, exp: t + 3 * DAY });
    assert.equal((await as(a)('POST', '/v1/contact-codes', { lookup: c.lookup, exp: c.exp })).status, 201);
    const r = await as(b)('POST', `/v1/contact-codes/${c.lookup}/use`);
    assert.equal(r.status, 200);
    return c;
  }
  const env = (from, to, extra = {}) => sealMessage(from.me, { uid: to.uid, pub: to.device.pub }, { kind: 'invito', at: t, body: { t: INV }, ...extra });
  const send = async (from, to, e) => as(from)('POST', `/v1/inbox/${to.uid}`, { env: e || await env(from, to) });
  return { store, app, call, as, user, link, env, send, advance: (ms) => { t += ms; }, now: () => t };
}

async function amici(w, na = 'anna', nb = 'bruno') {
  const [a, b] = [await w.user(na), await w.user(nb)];
  await w.link(a, b);
  return [a, b];
}
const keysOf = (w, k) => w.store._map.get(k);
const msgKeys = (w, prefix) => [...w.store._map.keys()].filter((k) => k.startsWith(prefix));

// ---------------------------------------------------------------- chiavi

test('chiavi: si registra la propria chiave pubblica e si rilegge', async () => {
  const w = setup();
  const a = await w.user('anna', { activate: false });
  assert.deepEqual((await w.as(a)('GET', `/v1/keys/${a.uid}`)).body, { uid: a.uid, pub: null });
  const r = await w.as(a)('PUT', '/v1/keys', { pub: { ...a.device.pub, extra: 'x' } });
  assert.deepEqual(r.body.pub, a.device.pub, 'i campi in più si tolgono');
  assert.deepEqual((await w.as(a)('GET', `/v1/keys/${a.uid}`)).body.pub, a.device.pub);
});

test('chiavi: formato sbagliato → 400 e niente salvato', async () => {
  const w = setup();
  const a = await w.user('anna', { activate: false });
  const d = a.device.pub;
  for (const pub of [null, 'x', {}, { ...d, v: 2 }, { ...d, enc: d.sig }, { ...d, dev: '<b>' }, { ...d, sig: d.sig.slice(1) }]) {
    assert.equal((await w.as(a)('PUT', '/v1/keys', { pub })).status, 400, JSON.stringify(pub)?.slice(0, 50));
  }
  assert.equal((await w.as(a)('PUT', '/v1/keys', {})).status, 400);
  assert.equal((await w.call('PUT', '/v1/keys', { token: a.token, body: '{non json' })).status, 400);
  assert.equal(keysOf(w, 'keys:' + a.uid), undefined);
});

test('chiavi: aggiornarle più di 20 volte al giorno → 429, e il giorno dopo si può', async () => {
  const w = setup();
  const a = await w.user('anna', { activate: false });
  for (let i = 0; i < 20; i++) assert.equal((await w.as(a)('PUT', '/v1/keys', { pub: a.device.pub })).status, 200);
  const r = await w.as(a)('PUT', '/v1/keys', { pub: a.device.pub });
  assert.equal(r.status, 429);
  w.advance(DAY + 1000);
  assert.equal((await w.as(a)('PUT', '/v1/keys', { pub: a.device.pub })).status, 200);
});

test('chiavi: leggere quelle di chi non è un tuo contatto → 404 (non si scopre nemmeno se esiste)', async () => {
  const w = setup();
  const [a, b, c] = [await w.user('anna'), await w.user('bruno'), await w.user('carla')];
  await w.link(a, b);
  assert.equal((await w.as(a)('GET', `/v1/keys/${b.uid}`)).status, 200);
  assert.equal((await w.as(b)('GET', `/v1/keys/${a.uid}`)).status, 200);
  const x = await w.as(a)('GET', `/v1/keys/${c.uid}`);
  const y = await w.as(a)('GET', '/v1/keys/u_nonesiste1');
  assert.equal(x.status, 404);
  assert.equal(y.status, 404);
  assert.deepEqual(x.body, y.body);
  assert.equal((await w.as(a)('GET', '/v1/keys/a')).status, 404);
});

// ---------------------------------------------------------------- link monouso

test('link: il secondo uso (anche dallo stesso utente) → 404', async () => {
  const w = setup();
  const [a, b, c] = [await w.user('anna'), await w.user('bruno'), await w.user('carla')];
  const code = await w.link(a, b);
  assert.equal((await w.as(c)('POST', `/v1/contact-codes/${code.lookup}/use`)).status, 404);
  assert.equal((await w.as(b)('POST', `/v1/contact-codes/${code.lookup}/use`)).status, 404);
  assert.deepEqual((await w.as(c)('GET', '/v1/contacts')).body.contacts, []);
});

test('link: scaduto → 404; la scadenza non supera 7 giorni anche se il client chiede di più', async () => {
  const w = setup();
  const [a, b] = [await w.user('anna'), await w.user('bruno')];
  const corto = makeContactCode({ fp: await fingerprint(a.device.pub), name: 'a', exp: w.now() + 3600e3 });
  assert.equal((await w.as(a)('POST', '/v1/contact-codes', { lookup: corto.lookup, exp: corto.exp })).status, 201);
  w.advance(2 * 3600e3);
  assert.equal((await w.as(b)('POST', `/v1/contact-codes/${corto.lookup}/use`)).status, 404);

  const lungo = makeContactCode({ fp: await fingerprint(a.device.pub), name: 'a', exp: w.now() + 400 * DAY });
  const r = await w.as(a)('POST', '/v1/contact-codes', { lookup: lungo.lookup, exp: lungo.exp });
  assert.equal(r.body.exp, w.now() + 7 * DAY);
  w.advance(7 * DAY + 1000);
  assert.equal((await w.as(b)('POST', `/v1/contact-codes/${lungo.lookup}/use`)).status, 404);
  assert.deepEqual((await w.as(b)('GET', '/v1/contacts')).body.contacts, []);
});

test('link: il proprio → 400 e il link resta valido per un altro', async () => {
  const w = setup();
  const [a, b] = [await w.user('anna'), await w.user('bruno')];
  const c = makeContactCode({ fp: await fingerprint(a.device.pub), name: 'a', exp: w.now() + DAY });
  await w.as(a)('POST', '/v1/contact-codes', { lookup: c.lookup, exp: c.exp });
  assert.equal((await w.as(a)('POST', `/v1/contact-codes/${c.lookup}/use`)).status, 400);
  assert.equal((await w.as(b)('POST', `/v1/contact-codes/${c.lookup}/use`)).status, 200);
});

test('link: usarlo ti fa contatto dei due lati e restituisce uid e chiave di chi l\'ha creato', async () => {
  const w = setup();
  const [a, b] = [await w.user('anna'), await w.user('bruno')];
  const c = makeContactCode({ fp: await fingerprint(a.device.pub), name: 'a', exp: w.now() + DAY });
  await w.as(a)('POST', '/v1/contact-codes', { lookup: c.lookup, exp: c.exp });
  const r = await w.as(b)('POST', `/v1/contact-codes/${c.lookup}/use`);
  assert.deepEqual(r.body, { uid: a.uid, pub: a.device.pub });
  assert.deepEqual((await w.as(a)('GET', '/v1/contacts')).body.contacts, [{ uid: b.uid, pub: b.device.pub }]);
  assert.deepEqual((await w.as(b)('GET', '/v1/contacts')).body.contacts, [{ uid: a.uid, pub: a.device.pub }]);
});

test('link: identificativi non validi o già presenti, e account senza chiave', async () => {
  const w = setup();
  const [a, b] = [await w.user('anna'), await w.user('bruno')];
  for (const lookup of [undefined, null, 5, '', 'corto', 'x'.repeat(17), '<script>aaaaaaaa', 'a/b'.padEnd(16, 'a')]) {
    assert.equal((await w.as(a)('POST', '/v1/contact-codes', { lookup, exp: w.now() + DAY })).status, 400, String(lookup));
  }
  const ok = 'AAAAAAAAAAAAAAAA';
  assert.equal((await w.as(a)('POST', '/v1/contact-codes', { lookup: ok, exp: w.now() + DAY })).status, 201);
  assert.equal((await w.as(b)('POST', '/v1/contact-codes', { lookup: ok, exp: w.now() + DAY })).status, 409, 'non si ruba un id già preso');
  assert.equal((await w.as(a)('POST', '/v1/contact-codes', { lookup: 'BBBBBBBBBBBBBBBB', exp: w.now() - 1 })).status, 400);
  const senza = await w.user('carla', { activate: false });
  assert.equal((await w.as(senza)('POST', '/v1/contact-codes', { lookup: 'CCCCCCCCCCCCCCCC', exp: w.now() + DAY })).status, 409);
  assert.equal((await w.as(senza)('POST', `/v1/contact-codes/${ok}/use`)).status, 409);
  // l'id non esistente e il link di un altro non si distinguono
  assert.equal((await w.as(b)('POST', '/v1/contact-codes/ZZZZZZZZZZZZZZZZ/use')).status, 404);
});

test('link: se chi l\'ha creato ha cancellato l\'account, usarlo → 404 e non resta niente', async () => {
  const w = setup();
  const [a, b] = [await w.user('anna'), await w.user('bruno')];
  const c = makeContactCode({ fp: await fingerprint(a.device.pub), name: 'a', exp: w.now() + DAY });
  await w.as(a)('POST', '/v1/contact-codes', { lookup: c.lookup, exp: c.exp });
  assert.equal((await w.as(a)('DELETE', '/v1/account', { password: 'passwordlunga' })).status, 200);
  assert.equal((await w.as(b)('POST', `/v1/contact-codes/${c.lookup}/use`)).status, 404);
  assert.deepEqual((await w.as(b)('GET', '/v1/contacts')).body.contacts, []);
  assert.equal(keysOf(w, 'cc:' + c.lookup), undefined);
});

test('link: più di 20 al giorno → 429; più di 30 usi all\'ora → 429', async () => {
  const w = setup();
  const [a, b] = [await w.user('anna'), await w.user('bruno')];
  for (let i = 0; i < 20; i++) {
    const lookup = ('L' + i).padEnd(16, 'x');
    assert.equal((await w.as(a)('POST', '/v1/contact-codes', { lookup, exp: w.now() + DAY })).status, 201);
  }
  assert.equal((await w.as(a)('POST', '/v1/contact-codes', { lookup: 'Zlimite'.padEnd(16, 'x'), exp: w.now() + DAY })).status, 429);
  for (let i = 0; i < 30; i++) assert.equal((await w.as(b)('POST', `/v1/contact-codes/${('U' + i).padEnd(16, 'x')}/use`)).status, 404);
  assert.equal((await w.as(b)('POST', '/v1/contact-codes/Utroppiiiiiiiiii/use')).status, 429);
});

// ---------------------------------------------------------------- invio e casella

test('invio: arriva in casella, il server tiene la busta com\'è e dà un id di 21 caratteri', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const e = await w.env(a, b);
  const r = await w.send(a, b, e);
  assert.equal(r.status, 201);
  assert.match(r.body.id, /^[0-9a-z]{9}[A-Za-z0-9_-]{12}$/);
  const inbox = (await w.as(b)('GET', '/v1/inbox')).body.messages;
  assert.equal(inbox.length, 1);
  assert.deepEqual(inbox[0], { id: r.body.id, from: a.uid, env: e, at: w.now() });
  assert.deepEqual((await w.as(a)('GET', '/v1/inbox')).body.messages, [], 'la casella è solo del destinatario');
  assert.ok(!JSON.stringify([...w.store._map.values()]).includes('abcDEF123'), 'il testo non compare in chiaro');
});

test('casella: i messaggi escono in ordine di arrivo, anche a ore diverse', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const ids = [];
  for (let i = 0; i < 4; i++) { ids.push((await w.send(a, b)).body.id); w.advance(1000 * (i + 1)); }
  assert.deepEqual((await w.as(b)('GET', '/v1/inbox')).body.messages.map((m) => m.id), ids);
});

test('invio a chi non è un tuo contatto → 403 e niente in casella', async () => {
  const w = setup();
  const [a, c] = [await w.user('anna'), await w.user('carla')];
  assert.equal((await w.send(a, c)).status, 403);
  assert.deepEqual(msgKeys(w, 'msg:'), []);
});

test('invio dopo che l\'altro ti ha tolto dai contatti → 403', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  await w.as(b)('DELETE', `/v1/contacts/${a.uid}`);
  assert.equal((await w.send(a, b)).status, 403);
  assert.deepEqual((await w.as(a)('GET', '/v1/contacts')).body.contacts, [], 'toglierne uno toglie da entrambi i lati');
});

test('mittente falso nella busta → 400: uid di un altro, dispositivo che non è quello registrato, destinatario diverso dall\'indirizzo', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const c = await w.user('carla');
  const e = await w.env(a, b);
  const casi = {
    'from.uid altrui': { ...e, from: { ...e.from, uid: c.uid } },
    'from.dev non registrato': { ...e, from: { ...e.from, dev: 'dev_falso01' } },
    'to.uid diverso': { ...e, to: { ...e.to, uid: c.uid } },
  };
  for (const [nome, env] of Object.entries(casi)) assert.equal((await w.send(a, b, env)).status, 400, nome);
  // un amico che manda a nome di un altro
  assert.equal((await w.send(b, a, { ...(await w.env(b, a)), from: { uid: a.uid, dev: a.device.id } })).status, 400);
  assert.deepEqual(msgKeys(w, 'msg:'), []);
});

test('invio senza aver attivato gli inviti → 409', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const e = await w.env(a, b);
  await w.store.delete('keys:' + a.uid);
  assert.equal((await w.send(a, b, e)).status, 409);
});

test('chiave del destinatario cambiata → 409 con la chiave nuova; senza chiave → 409 con pub nullo', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const e = await w.env(a, b);
  const nuovo = await createDevice();
  await w.as(b)('PUT', '/v1/keys', { pub: nuovo.pub });
  const r = await w.send(a, b, e);
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.pub, nuovo.pub);
  assert.deepEqual(msgKeys(w, 'msg:'), []);
  await w.store.delete('keys:' + b.uid);
  const r2 = await w.send(a, b, e);
  assert.equal(r2.status, 409);
  assert.ok('pub' in r2.body && r2.body.pub === null);
});

test('buste malformate → 400: campi mancanti, base64 sporco, chiave del tipo sbagliato, id con simboli', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const e = await w.env(a, b);
  const casi = [
    undefined, null, 'x', 5, [], {}, { ...e, v: 2 }, { ...e, epk: undefined }, { ...e, iv: e.iv.slice(1) }, { ...e, ct: '' }, { ...e, ct: 'ab' },
    { ...e, ct: e.ct + '=' }, { ...e, epk: 'x'.repeat(87) }, { ...e, from: null }, { ...e, from: { uid: '<b>', dev: e.from.dev } },
    { ...e, to: { uid: b.uid, dev: 'x' } },
  ];
  for (const env of casi) assert.equal((await w.as(a)('POST', `/v1/inbox/${b.uid}`, { env })).status, 400, JSON.stringify(env)?.slice(0, 50));
  assert.equal((await w.as(a)('POST', `/v1/inbox/${b.uid}`, {})).status, 400);
  assert.equal((await w.call('POST', `/v1/inbox/${b.uid}`, { token: a.token, body: '{rotto' })).status, 400);
  assert.deepEqual(msgKeys(w, 'msg:'), []);
});

test('busta troppo grande → 400 (e un corpo enorme → 413), niente in casella', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const e = await w.env(a, b);
  assert.equal((await w.as(a)('POST', `/v1/inbox/${b.uid}`, { env: { ...e, ct: b64u(new Uint8Array(20000)) } })).status, 400);
  const enorme = await w.call('POST', `/v1/inbox/${b.uid}`, { token: a.token, body: JSON.stringify({ env: e, x: 'y'.repeat(5 * 1024 * 1024) }) });
  assert.equal(enorme.status, 413);
  assert.deepEqual(msgKeys(w, 'msg:'), []);
});

test('un campo in più nella busta non entra in casella', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const e = await w.env(a, b);
  await w.as(a)('POST', `/v1/inbox/${b.uid}`, { env: { ...e, nota: 'dato in più', from: { ...e.from, nome: 'Anna' } } });
  const m = (await w.as(b)('GET', '/v1/inbox')).body.messages[0];
  assert.deepEqual(m.env, e);
});

test('casella piena (500) → 429 al mittente, e si libera cancellando', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const e = await w.env(a, b);
  for (let i = 0; i < 500; i++) await w.store.put(`msg:${b.uid}:${String(i).padStart(21, '0')}`, JSON.stringify({ id: String(i).padStart(21, '0'), from: a.uid, env: e, at: w.now() }));
  assert.equal((await w.send(a, b, e)).status, 429);
  assert.equal(msgKeys(w, `msg:${b.uid}:`).length, 500);
  const letti = (await w.as(b)('GET', '/v1/inbox')).body.messages;
  assert.equal(letti.length, 50, 'si leggono 50 alla volta');
  assert.equal((await w.as(b)('DELETE', `/v1/inbox/${letti[0].id}`)).status, 200);
  assert.equal((await w.send(a, b, e)).status, 201);
});

test('limite di frequenza: 120 invii all\'ora, il 121° → 429 con Retry-After, poi si riparte', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  for (let i = 0; i < 120; i++) assert.equal((await w.as(a)('POST', `/v1/inbox/${b.uid}`, { env: {} })).status, 400);
  const r = await w.as(a)('POST', `/v1/inbox/${b.uid}`, { env: {} });
  assert.equal(r.status, 429);
  assert.ok(+r.headers.get('retry-after') > 0);
  w.advance(3600e3 + 1000);
  assert.equal((await w.as(a)('POST', `/v1/inbox/${b.uid}`, { env: {} })).status, 400);
});

test('cancellare un messaggio: solo dalla propria casella; ripetere non dà errore; id strani → 404/400', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const id = (await w.send(a, b)).body.id;
  assert.equal((await w.as(a)('DELETE', `/v1/inbox/${id}`)).status, 200, 'il mittente non può cancellare dalla casella dell\'altro');
  assert.equal((await w.as(b)('GET', '/v1/inbox')).body.messages.length, 1);
  assert.equal((await w.as(b)('DELETE', `/v1/inbox/${id}`)).status, 200);
  assert.equal((await w.as(b)('DELETE', `/v1/inbox/${id}`)).status, 200);
  assert.equal((await w.as(b)('GET', '/v1/inbox')).body.messages.length, 0);
  assert.equal((await w.as(b)('DELETE', '/v1/inbox/Ab-_Ab-_Ab-_Ab-_Ab-_X')).status, 400);
  assert.equal((await w.as(b)('DELETE', '/v1/inbox/..%2f..%2fkeys')).status, 404);
  assert.equal(keysOf(w, 'keys:' + b.uid) !== undefined, true);
});

test('casella: busta vecchia di 30 giorni o per una chiave che non c\'è più viene tolta in lettura, non restituita', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  await w.send(a, b);
  w.advance(31 * DAY);
  assert.deepEqual((await w.as(b)('GET', '/v1/inbox')).body.messages, []);
  assert.deepEqual(msgKeys(w, `msg:${b.uid}:`), []);
  await w.send(a, b);
  await w.as(b)('PUT', '/v1/keys', { pub: (await createDevice()).pub });
  assert.deepEqual((await w.as(b)('GET', '/v1/inbox')).body.messages, []);
  assert.deepEqual(msgKeys(w, `msg:${b.uid}:`), []);
});

test('casella: voci rotte nell\'archivio non fanno cadere la lettura', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  await w.send(a, b);
  await w.store.put(`msg:${b.uid}:rotta`, '{non json');
  const r = await w.as(b)('GET', '/v1/inbox');
  assert.equal(r.status === 200 && r.body.messages.length === 1, true, `stato ${r.status}`);
});

// ---------------------------------------------------------------- contatti

test('contatti: cancellare è idempotente, non crea nulla e non toglie gli altri', async () => {
  const w = setup();
  const [a, b, c] = [await w.user('anna'), await w.user('bruno'), await w.user('carla')];
  await w.link(a, b); await w.link(a, c);
  assert.equal((await w.as(a)('DELETE', `/v1/contacts/${b.uid}`)).status, 200);
  assert.equal((await w.as(a)('DELETE', `/v1/contacts/${b.uid}`)).status, 200);
  assert.equal((await w.as(a)('DELETE', '/v1/contacts/u_nessuno1')).status, 200);
  assert.deepEqual((await w.as(a)('GET', '/v1/contacts')).body.contacts.map((x) => x.uid), [c.uid]);
  assert.deepEqual((await w.as(b)('GET', '/v1/contacts')).body.contacts, []);
});

test('contatti: chi ha cambiato chiave si vede nell\'elenco, chi non ha chiave ha pub nullo', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const nuovo = await createDevice();
  await w.as(b)('PUT', '/v1/keys', { pub: nuovo.pub });
  assert.deepEqual((await w.as(a)('GET', '/v1/contacts')).body.contacts, [{ uid: b.uid, pub: nuovo.pub }]);
  await w.store.delete('keys:' + b.uid);
  assert.deepEqual((await w.as(a)('GET', '/v1/contacts')).body.contacts, [{ uid: b.uid, pub: null }]);
});

// ---------------------------------------------------------------- cancellazione dell'account

test('cancellare l\'account toglie chiavi, contatti e casella, anche dall\'altra parte', async () => {
  const w = setup();
  const [a, b, c] = [await w.user('anna'), await w.user('bruno'), await w.user('carla')];
  await w.link(a, b); await w.link(c, a); await w.link(b, c);
  await w.send(b, a); await w.send(c, a);
  assert.equal(msgKeys(w, `msg:${a.uid}:`).length, 2);
  assert.equal((await w.as(a)('DELETE', '/v1/account', { password: 'passwordlunga' })).status, 200);
  for (const k of [`keys:${a.uid}`, `contacts:${a.uid}`]) assert.equal(keysOf(w, k), undefined, k);
  assert.deepEqual(msgKeys(w, `msg:${a.uid}:`), []);
  assert.deepEqual((await w.as(b)('GET', '/v1/contacts')).body.contacts.map((x) => x.uid), [c.uid]);
  assert.deepEqual((await w.as(c)('GET', '/v1/contacts')).body.contacts.map((x) => x.uid), [b.uid]);
  assert.equal((await w.as(b)('GET', `/v1/keys/${a.uid}`)).status, 404);
  assert.equal((await w.send(b, a)).status, 403);
  // il token di prima non vale più
  assert.equal((await w.as(a)('GET', '/v1/inbox')).status, 401);
  // nessuna traccia dell'uid cancellato nell'archivio
  const resto = [...w.store._map.entries()].filter(([k, v]) => !k.startsWith('rl:') && (k.includes(a.uid) || (typeof v === 'string' && v.includes(`"${a.uid}"`) && !k.startsWith('msg:'))));
  assert.deepEqual(resto.map(([k]) => k), []);
});

test('cancellare l\'account con password sbagliata non toglie niente', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  await w.send(b, a);
  assert.equal((await w.as(a)('DELETE', '/v1/account', { password: 'sbagliata123' })).status, 401);
  assert.equal((await w.as(a)('GET', '/v1/inbox')).body.messages.length, 1);
  assert.equal((await w.as(b)('GET', '/v1/contacts')).body.contacts.length, 1);
});

// ---------------------------------------------------------------- accessi

test('un token esterno (tmx_) è rifiutato su tutti gli endpoint degli inviti', async () => {
  const w = setup();
  const [a, b] = await amici(w);
  const ext = (await w.as(a)('POST', '/v1/tokens', { name: 'mac' })).body.token;
  assert.match(ext, /^tmx_/);
  const id = (await w.send(b, a)).body.id;
  const e = await w.env(a, b);
  const richieste = [
    ['PUT', '/v1/keys', { pub: a.device.pub }], ['GET', `/v1/keys/${a.uid}`], ['POST', '/v1/contact-codes', { lookup: 'DDDDDDDDDDDDDDDD', exp: w.now() + DAY }],
    ['POST', '/v1/contact-codes/DDDDDDDDDDDDDDDD/use'], ['GET', '/v1/contacts'], ['DELETE', `/v1/contacts/${b.uid}`],
    ['POST', `/v1/inbox/${b.uid}`, { env: e }], ['GET', '/v1/inbox'], ['DELETE', `/v1/inbox/${id}`],
  ];
  for (const [m, p, body] of richieste) assert.equal((await w.call(m, p, { token: ext, body })).status, 403, `${m} ${p}`);
  assert.equal((await w.as(a)('GET', '/v1/inbox')).body.messages.length, 1, 'la casella è intatta');
  assert.equal((await w.as(a)('GET', '/v1/contacts')).body.contacts.length, 1);
});

test('senza accesso o con token falso → 401 su tutti gli endpoint degli inviti', async () => {
  const w = setup();
  for (const [m, p] of [['PUT', '/v1/keys'], ['GET', '/v1/keys/u_qualcuno1'], ['POST', '/v1/contact-codes'], ['POST', '/v1/contact-codes/DDDDDDDDDDDDDDDD/use'], ['GET', '/v1/contacts'], ['DELETE', '/v1/contacts/u_qualcuno1'], ['POST', '/v1/inbox/u_qualcuno1'], ['GET', '/v1/inbox'], ['DELETE', '/v1/inbox/Ab-_Ab-_Ab-_Ab-_Ab-_X']]) {
    assert.equal((await w.call(m, p)).status, 401, `${m} ${p}`);
    assert.equal((await w.call(m, p, { token: 'tmp_finto' })).status, 401, `${m} ${p} (token finto)`);
  }
  assert.equal((await w.call('GET', '/v1/inbox/..')).status, 401);
});

test('percorsi con simboli ostili non toccano l\'archivio', async () => {
  const w = setup();
  const a = await w.user('anna');
  const prima = JSON.stringify([...w.store._map.entries()]);
  for (const p of ['/v1/keys/<script>', '/v1/keys/..%2F..%2Fx', '/v1/contacts/%00', '/v1/inbox/%20', '/v1/inbox/' + 'a'.repeat(300)]) {
    const r = await w.as(a)(p.includes('inbox') ? 'POST' : 'GET', p, p.includes('inbox') ? { env: {} } : undefined);
    assert.ok(r.status >= 400 && r.status < 500, `${p} → ${r.status}`);
  }
  assert.equal(JSON.stringify([...w.store._map.entries()]).replace(/"rl:[^]*?}"/g, ''), prima.replace(/"rl:[^]*?}"/g, ''));
});

test('archivio senza list: la casella dice che non è supportata (501) invece di perdere messaggi', async () => {
  const base = memoryStore();
  const { list, ...senzaList } = base;
  const w = setup({ ...senzaList, _map: base._map });
  const [a, b] = [await w.user('anna'), await w.user('bruno')];
  await w.link(a, b);
  assert.equal((await w.as(b)('GET', '/v1/inbox')).status, 501);
  assert.equal((await w.send(a, b)).status, 501);
  assert.deepEqual(msgKeys(w, 'msg:'), []);
});
