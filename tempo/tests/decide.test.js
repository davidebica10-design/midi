import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, decideByRules, blend, routeRequest, sceneGoalOptions, cleanOptions, cosine } from '../js/decide.js';
import { localParse } from '../js/parse.js';
import { emptyState } from '../js/store.js';

const opts = [{ id: 'a', text: 'A', prior: 1 }, { id: 'b', text: 'B', prior: 3 }, { id: 'c', text: 'C', prior: 0 }];
const json = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => body });

test('le regole scelgono il punteggio più alto, con probabilità che sommano a 1', () => {
  const r = decideByRules(opts);
  assert.equal(r.id, 'b');
  assert.equal(r.source, 'rules');
  assert.ok(Math.abs(Object.values(r.scores).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('opzioni sporche: id duplicati o non stringa vengono scartati', () => {
  assert.deepEqual(cleanOptions([{ id: 'x' }, { id: 'x' }, { id: 3 }, null]).map((o) => o.id), ['x']);
  assert.equal(decideByRules([]), null);
});

test('CLM: il punteggio del modello può ribaltare le regole', async () => {
  const r = await decide({ options: opts, decider: { kind: 'clm', url: 'https://clm.test/score' }, fetchImpl: json({ scores: [0.9, 0.1, 0.0] }) });
  assert.equal(r.id, 'a');
  assert.equal(r.source, 'clm');
});

test('CLM con risposta malformata: decidono le regole e l\'errore è riportato', async () => {
  const r = await decide({ options: opts, decider: { kind: 'clm', url: 'https://clm.test/score' }, fetchImpl: json({ scores: [1] }) });
  assert.equal(r.id, 'b');
  assert.equal(r.source, 'rules');
  assert.match(r.error, /non valida/);
});

test('LLM: una scelta fuori dalle opzioni viene ignorata', async () => {
  const fetchImpl = json({ choices: [{ message: { content: '{"choice":"zzz","confidence":0.99}' } }] });
  const r = await decide({ options: opts, decider: { kind: 'llm', url: 'https://x.test/v1', model: 'm' }, fetchImpl });
  assert.equal(r.id, 'b');
  assert.equal(r.source, 'rules');
});

test('LLM: una scelta valida e sicura vince', async () => {
  const fetchImpl = json({ choices: [{ message: { content: '{"choice":"c","confidence":0.95}' } }] });
  const r = await decide({ options: opts, decider: { kind: 'llm', url: 'https://x.test/v1', model: 'm', weight: 0.8 }, fetchImpl });
  assert.equal(r.id, 'c');
});

test('embeddings: vince l\'azione più simile allo stato', async () => {
  const fetchImpl = json({ data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0, 1] }, { index: 2, embedding: [0.2, 1] }, { index: 3, embedding: [1, 0.05] }] });
  const r = await decide({ options: opts, decider: { kind: 'embed', url: 'https://x.test/v1', model: 'e', weight: 0.9 }, fetchImpl });
  assert.equal(r.id, 'c');
  assert.ok(cosine([1, 0], [1, 0]) > 0.99);
});

test('servizio lento: dopo il tempo massimo decidono le regole', async () => {
  const slow = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  const r = await decide({ options: opts, decider: { kind: 'clm', url: 'https://x' }, fetchImpl: slow, timeoutMs: 30 });
  assert.equal(r.id, 'b');
  assert.equal(r.error, 'timeout');
});

test('blend: peso zero = solo regole', () => {
  assert.equal(blend(opts, { a: 10, b: 0, c: 0 }, 0).id, 'b');
});

test('router: comando semplice al codice, richiesta aperta al modello grande', () => {
  const s = emptyState();
  const now = Date.parse('2026-10-12T10:00');
  const q = (t) => localParse(t, s, now);
  assert.equal(routeRequest('ho finito la spesa', q('ho finito la spesa')), 'fast'); // senza attività non è un comando applicabile
  s.items.push({ id: 'sp1', title: 'Spesa', kind: 'task', status: 'todo', duration: 30, priority: 2, energy: 1, dependsOn: [] });
  assert.equal(routeRequest('ho finito la spesa', q('ho finito la spesa')), 'base');
  assert.equal(routeRequest('organizzami la settimana prossima tenendo conto delle prove', q('organizzami la settimana prossima tenendo conto delle prove')), 'heavy');
  assert.equal(routeRequest('fammi il riassunto del mese'), 'heavy');
});

test('obiettivo della scena: vince quello con una sessione adesso', () => {
  const s = emptyState();
  const now = Date.parse('2026-10-12T19:00');
  s.goals = [{ id: 'g1', title: 'EP', due: '2026-11-30', at: now }, { id: 'g2', title: 'Esame', due: '2026-10-20', at: now }];
  s.items = [
    { id: 'i1', title: 'Beat 01', kind: 'task', status: 'todo', goalId: 'g1' },
    { id: 'i2', title: 'Capitolo 1', kind: 'task', status: 'todo', goalId: 'g2' },
  ];
  const plan = { '2026-10-12': { free: 60, blocks: [{ item: s.items[0], start: 18 * 60 + 30, end: 20 * 60, type: 'task' }] } };
  const r = decideByRules(sceneGoalOptions({ state: s, plan, now, today: '2026-10-12' }));
  assert.equal(r.id, 'g1');
  // senza sessioni oggi vince la scadenza più vicina
  const r2 = decideByRules(sceneGoalOptions({ state: s, plan: { '2026-10-12': { free: 60, blocks: [] } }, now, today: '2026-10-12' }));
  assert.equal(r2.id, 'g2');
});
