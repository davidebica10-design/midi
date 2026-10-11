import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, memoryStore } from '../src/app.js';
import { tzOffset, clockFor, nowFor, tell } from '../src/tempo.js';
import { seal, unseal, hashPassword, verifyPassword } from '../src/crypto.js';
import { emptyState } from '../../tempo/js/store.js';

const SECRET = 'x'.repeat(40);
// lunedì 12 ottobre 2026, 19:00 a Roma (17:00 UTC)
const T0 = Date.parse('2026-10-12T17:00:00Z');

function setup(extra = {}) {
  const store = memoryStore();
  let t = T0;
  const app = createApp({ store, secret: SECRET, now: () => t, ...extra });
  const call = async (method, path, { token, body, headers = {} } = {}) => {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    if (body !== undefined && typeof body !== 'string') h['content-type'] = 'application/json';
    const r = await app.fetch(new Request('https://cloud.test' + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }));
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  return { store, app, call, advance: (ms) => { t += ms; } };
}

function epState() {
  const s = emptyState();
  s.onboarded = true;
  s.projects = [{ id: 'p_ep', name: 'EP', color: '#E0457B' }];
  s.goals = [{ id: 'g_ep', title: 'Far uscire l\'EP', due: '2026-11-30', projectId: 'p_ep' }];
  s.items = [
    { id: 'b1', title: 'Beat 01', kind: 'task', status: 'todo', duration: 90, priority: 2, energy: 3, dependsOn: [], project: 'p_ep', goalId: 'g_ep' },
    { id: 'sp', title: 'Spesa', kind: 'task', status: 'todo', duration: 30, priority: 2, energy: 1, dependsOn: [] },
  ];
  s.settings = { apiKey: 'sk-ant-SEGRETA', openKey: 'AIza-SEGRETA', name: 'Davide' };
  return s;
}

test('crittografia: password e dati cifrati per utente', async () => {
  const h = await hashPassword('una password lunga');
  assert.ok(await verifyPassword('una password lunga', h));
  assert.ok(!(await verifyPassword('sbagliata', h)));
  const s = await seal(SECRET, 'u1', { a: 1 });
  assert.deepEqual(await unseal(SECRET, 'u1', s), { a: 1 });
  await assert.rejects(() => unseal(SECRET, 'u2', s)); // la chiave di un altro utente non apre
});

test('fuso orario: le 17 UTC sono le 19 a Roma', () => {
  assert.equal(tzOffset('Europe/Rome', T0), 2 * 3600e3);
  const { localNow } = clockFor('Europe/Rome', T0);
  const d = new Date(localNow);
  assert.equal(d.getHours(), 19);
  assert.equal(tzOffset('Nowhere/Invalid', T0), 0);
});

test('account: registrazione, accesso, errori chiari', async () => {
  const { call } = setup();
  assert.equal((await call('POST', '/v1/signup', { body: { email: 'non-email', password: 'abcdefghijk' } })).status, 400);
  assert.equal((await call('POST', '/v1/signup', { body: { email: 'd@x.it', password: 'corta' } })).status, 400);
  const r = await call('POST', '/v1/signup', { body: { email: 'D@x.it', password: 'password-lunga', tz: 'Europe/Rome' } });
  assert.equal(r.status, 201);
  assert.match(r.body.token, /^tmp_/);
  assert.equal((await call('POST', '/v1/signup', { body: { email: 'd@x.it', password: 'password-lunga' } })).status, 409);
  assert.equal((await call('POST', '/v1/login', { body: { email: 'd@x.it', password: 'sbagliata!!' } })).status, 401);
  const l = await call('POST', '/v1/login', { body: { email: 'd@x.it', password: 'password-lunga' } });
  assert.equal(l.status, 200);
  assert.equal((await call('GET', '/v1/state')).status, 401);
});

test('troppi tentativi di accesso: 429', async () => {
  const { call } = setup();
  await call('POST', '/v1/signup', { body: { email: 'a@x.it', password: 'password-lunga' } });
  let last;
  for (let i = 0; i < 11; i++) last = await call('POST', '/v1/login', { body: { email: 'a@x.it', password: 'sbagliata!!' } });
  assert.equal(last.status, 429);
  assert.ok(+last.headers.get('retry-after') > 0);
});

test('sincronizzazione: revisioni, conflitto, niente chiavi API sul server, dati cifrati', async () => {
  const { call, store } = setup();
  const { token } = (await call('POST', '/v1/signup', { body: { email: 'd@x.it', password: 'password-lunga' } })).body;
  assert.deepEqual((await call('GET', '/v1/state', { token })).body, { rev: 0, updatedAt: null, state: null });
  const put = await call('PUT', '/v1/state', { token, body: { rev: 0, state: epState() } });
  assert.equal(put.status, 200);
  assert.equal(put.body.rev, 1);
  const got = (await call('GET', '/v1/state', { token })).body;
  assert.equal(got.state.items.length, 2);
  assert.equal(got.state.settings.apiKey, undefined);
  assert.equal(got.state.settings.openKey, undefined);
  // nel database niente in chiaro
  const raw = JSON.stringify([...store._map.entries()]);
  assert.ok(!raw.includes('Beat 01') && !raw.includes('SEGRETA'));
  // un altro dispositivo con la revisione vecchia: conflitto con lo stato attuale
  const c = await call('PUT', '/v1/state', { token, body: { rev: 0, state: epState() } });
  assert.equal(c.status, 409);
  assert.equal(c.body.rev, 1);
  assert.equal(c.body.state.items.length, 2);
  assert.equal((await call('PUT', '/v1/state', { token, body: { rev: 1, state: { nope: 1 } } })).status, 400);
});

test('da fuori: adesso, giornata, «Dì a Tempo» con il fuso giusto', async () => {
  const { call } = setup();
  const { token } = (await call('POST', '/v1/signup', { body: { email: 'd@x.it', password: 'password-lunga', tz: 'Europe/Rome' } })).body;
  await call('PUT', '/v1/state', { token, body: { rev: 0, state: epState() } });
  const ext = (await call('POST', '/v1/tokens', { token, body: { name: 'Mac' } })).body;
  assert.match(ext.token, /^tmx_/);
  // un token esterno non legge lo stato completo
  assert.equal((await call('GET', '/v1/state', { token: ext.token })).status, 403);
  const now = await call('GET', '/v1/now', { token: ext.token });
  assert.equal(now.status, 200);
  assert.equal(now.body.time, '19:00');
  assert.ok(now.body.text.length > 5);
  const txt = await call('GET', '/v1/now?format=text', { token: ext.token });
  assert.match(txt.headers.get('content-type'), /text\/plain/);
  // una frase semplice: applicata dal parser dell'app, sul giorno giusto (domani = 13 ottobre a Roma)
  const r = await call('POST', '/v1/tell', { token: ext.token, body: { text: 'domani alle 16 call con Marco' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.applied, true);
  assert.equal(r.body.rev, 2);
  const st = (await call('GET', '/v1/state', { token })).body.state;
  const callItem = st.items.find((x) => /call/i.test(x.title));
  assert.equal(callItem.date, '2026-10-13');
  assert.equal(callItem.start, 16 * 60);
  assert.equal(callItem.createdAt, T0, 'i timestamp salvati sono istanti reali');
  // anche come testo semplice (Comandi rapidi)
  const r2 = await call('POST', '/v1/tell?format=text', { token: ext.token, body: 'ho finito la spesa', headers: { 'content-type': 'text/plain' } });
  assert.match(r2.body, /Spesa/i);
  // revoca del collegamento
  assert.equal((await call('DELETE', `/v1/tokens/${ext.id}`, { token })).status, 200);
  assert.equal((await call('GET', '/v1/now', { token: ext.token })).status, 401);
});

test('le modifiche grandi non si applicano da fuori', async () => {
  const r = await tell(epState(), 'Europe/Rome', 'oggi sono stanco', { at: T0 });
  if (r.understood.length) { assert.equal(r.applied, false); assert.equal(r.confirm, true); assert.match(r.reply, /telefono/); }
  else assert.equal(r.applied, false);
});

test('con la chiave AI scelta dall\'utente le frasi lunghe vanno al modello (risposta validata)', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'models/gemini-flash-latest' }] }), { status: 200 });
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gemini-flash-latest');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: 'Ho messo le prove giovedì sera.', ops: [{ action: 'add', kind: 'task', title: 'Prove', duration_min: 120, date: '2026-10-15', window: 'sera' }, { action: 'hack' }], requires_confirmation: false }) } }] }), { status: 200 });
  };
  const r = await tell(epState(), 'Europe/Rome', 'organizzami la settimana: giovedì sera vorrei fare due ore di prove con la band, poi il resto lo decidi tu', { ai: { key: 'AIza-test-key-123', preset: 'gemini' }, at: T0, fetchImpl });
  assert.ok(calls.some((u) => u.includes('generativelanguage')));
  assert.equal(r.applied, true);
  assert.ok(r.state.items.some((x) => x.title === 'Prove' && x.date === '2026-10-15'));
});

test('MCP: initialize, elenco strumenti, chiamate, notifiche', async () => {
  const { call } = setup();
  const { token } = (await call('POST', '/v1/signup', { body: { email: 'd@x.it', password: 'password-lunga', tz: 'Europe/Rome' } })).body;
  await call('PUT', '/v1/state', { token, body: { rev: 0, state: epState() } });
  const ext = (await call('POST', '/v1/tokens', { token, body: { name: 'Claude' } })).body;
  const rpc = (m, params, id = 1, path = '/mcp', tk = ext.token) => call('POST', path, { token: path === '/mcp' ? tk : undefined, body: { jsonrpc: '2.0', id, method: m, params } });
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal(init.body.result.serverInfo.name, 'tempo');
  const note = await call('POST', '/mcp', { token: ext.token, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(note.status, 202);
  const list = await rpc('tools/list', {});
  assert.deepEqual(list.body.result.tools.map((t) => t.name), ['tempo_adesso', 'tempo_giornata', 'tempo_mese', 'tempo_dimmi']);
  const now = await rpc('tools/call', { name: 'tempo_adesso', arguments: {} });
  assert.equal(now.body.result.content[0].type, 'text');
  const dimmi = await rpc('tools/call', { name: 'tempo_dimmi', arguments: { testo: 'venerdì alle 11 dentista' } });
  assert.match(dimmi.body.result.content[0].text, /Dentista/i);
  // token nel percorso: solo quelli esterni
  const viaPath = await call('POST', `/mcp/t/${ext.token}`, { body: { jsonrpc: '2.0', id: 9, method: 'ping' } });
  assert.deepEqual(viaPath.body.result, {});
  assert.equal((await call('POST', `/mcp/t/${token}`, { body: { jsonrpc: '2.0', id: 9, method: 'ping' } })).status, 403);
  assert.equal((await rpc('nope', {})).body.error.code, -32601);
});

test('cancellazione dell\'account: password richiesta, poi non resta niente', async () => {
  const { call, store } = setup();
  const { token } = (await call('POST', '/v1/signup', { body: { email: 'd@x.it', password: 'password-lunga' } })).body;
  await call('PUT', '/v1/state', { token, body: { rev: 0, state: epState() } });
  await call('POST', '/v1/tokens', { token, body: { name: 'Mac' } });
  await call('PATCH', '/v1/settings', { token, body: { ai: { key: 'AIza-chiave-lunga', preset: 'gemini' } } });
  assert.equal((await call('DELETE', '/v1/account', { token, body: { password: 'no' } })).status, 401);
  assert.equal((await call('DELETE', '/v1/account', { token, body: { password: 'password-lunga' } })).status, 200);
  const left = [...store._map.keys()].filter((k) => !k.startsWith('rl:'));
  assert.deepEqual(left, []);
  assert.equal((await call('GET', '/v1/now', { token })).status, 401);
});

test('CORS solo per le origini dell\'app', async () => {
  const { app } = setup();
  const ok = await app.fetch(new Request('https://cloud.test/v1/health', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }));
  assert.equal(ok.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  const no = await app.fetch(new Request('https://cloud.test/v1/health', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});

test('nowFor senza stato non esplode', () => {
  const r = nowFor({}, 'Europe/Rome', T0);
  assert.equal(typeof r.text, 'string');
});
