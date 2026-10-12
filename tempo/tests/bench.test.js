import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_CASES, ROUTE_CASES, SCENE_CASES, build } from './bench/cases.mjs';
import { runBench, report, quantile, retrying } from './bench/run.mjs';

const LLM = { kind: 'llm', url: 'https://llm.test/v1', model: 'm' };
const resp = (status, body, headers = {}) => ({ ok: status < 400, status, headers: new Headers(headers), json: async () => body });
const chat = (choice, confidence = 0.9) => resp(200, { choices: [{ message: { content: JSON.stringify({ choice, confidence }) } }] });

// un «modello perfetto»: riconosce il caso dal testo che riceve e risponde con l'etichetta giusta
const goldByState = new Map();
for (const c of ALL_CASES) { const b = build(c); if (!b.code) goldByState.set(b.state, c.gold); }
const oracle = async (_url, init) => {
  const user = JSON.parse(init.body).messages.at(-1).content;
  const state = user.slice(user.indexOf('STATO:\n') + 7, user.indexOf('\nOPZIONI:'));
  return chat(goldByState.get(state));
};

test('i casi sono ben formati: id unici, etichetta tra le opzioni, classi bilanciate', () => {
  assert.equal(new Set(ALL_CASES.map((c) => c.id)).size, ALL_CASES.length);
  assert.equal(new Set(ROUTE_CASES.map((c) => c.text)).size, ROUTE_CASES.length);
  const asked = ALL_CASES.map((c) => ({ c, b: build(c) })).filter((x) => !x.b.code);
  for (const { c, b } of asked) assert.ok(b.options.some((o) => o.id === c.gold), `${c.id}: etichetta ${c.gold} non tra ${b.options.map((o) => o.id)}`);
  const route = asked.filter((x) => x.c.task === 'route');
  assert.ok(route.filter((x) => x.c.gold === 'heavy').length >= 10 && route.filter((x) => x.c.gold === 'fast').length >= 8);
  assert.ok(ALL_CASES.some((c) => build(c).code), 'alcune frasi le fa il codice da solo e non entrano nella misura');
  assert.equal(SCENE_CASES.filter((c) => c.hard).length, 2);
});

test('solo regole: numeri deterministici e nessuna chiamata di rete', async () => {
  const f = async () => { throw new Error('non deve chiamare la rete'); };
  const a = await runBench({ decider: null, fetchImpl: f });
  const b = await runBench({ decider: { kind: 'rules' }, fetchImpl: f });
  assert.deepEqual(a.summary.tasks.route.rules, b.summary.tasks.route.rules);
  assert.equal(a.summary.tasks.route.asked + a.summary.tasks.route.byCode, 40);
  assert.ok(a.summary.tasks.route.rules.pct > 0 && a.summary.tasks.route.rules.pct <= 100);
});

test('un modello perfetto prende il 100%, uno sempre sbagliato lo 0%', async () => {
  const good = await runBench({ decider: LLM, fetchImpl: oracle });
  for (const t of ['route', 'scene']) {
    assert.equal(good.summary.tasks[t].model.pct, 100, t);
    assert.equal(good.summary.tasks[t].errors, 0);
    assert.ok(good.summary.tasks[t].latencyMs.p50 >= 0);
  }
  const wrong = async (url, init) => {
    const user = JSON.parse(init.body).messages.at(-1).content;
    const ids = [...user.slice(user.indexOf('OPZIONI:')).matchAll(/^- ([\w-]+):/gm)].map((m) => m[1]);
    const gold = goldByState.get(user.slice(user.indexOf('STATO:\n') + 7, user.indexOf('\nOPZIONI:')));
    return chat(ids.find((x) => x !== gold));
  };
  const bad = await runBench({ decider: LLM, fetchImpl: wrong, tasks: ['route'] });
  assert.equal(bad.summary.tasks.route.model.pct, 0);
  assert.ok(bad.summary.tasks.route.modelWrong.length > 0);
});

test('errori del servizio: contati, mai scambiati per risposte; le regole restano misurate', async () => {
  const r = await runBench({ decider: LLM, fetchImpl: async () => resp(500, { error: { message: 'boom' } }), tasks: ['route'] });
  const t = r.summary.tasks.route;
  assert.equal(t.answered, 0);
  assert.equal(t.errors, t.asked);
  assert.match(t.errorList[0], /boom/);
  assert.ok(t.rules.of > 0);
  assert.equal(t.model.of, 0);
});

test('limiti del piano gratuito (429): nuovi tentativi contati, latenza dell\'ultimo tentativo', async () => {
  let n = 0;
  const waits = [];
  const f = async (url, init) => (n++ % 3 < 2 ? resp(429, {}, { 'retry-after': '1' }) : oracle(url, init));
  const r = await runBench({ decider: LLM, fetchImpl: f, tasks: ['route'], limit: 3, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(r.summary.tasks.route.errors, 0);
  assert.equal(r.summary.tasks.route.retries, 6);
  assert.deepEqual(waits.slice(0, 2), [1000, 2000], 'attesa crescente, rispettando Retry-After');
});

test('tempo scaduto: errore «timeout»', async () => {
  const slow = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  const r = await runBench({ decider: LLM, fetchImpl: slow, tasks: ['scene'], limit: 2, timeoutMs: 20 });
  assert.deepEqual(r.summary.tasks.scene.errorList, ['timeout']);
});

test('il rapporto è in italiano e dice cosa conta', async () => {
  const r = await runBench({ decider: LLM, fetchImpl: oracle });
  const text = report(r.summary);
  assert.match(text, /regole da sole/);
  assert.match(text, /modello da solo/);
  assert.match(text, /latenza: p50/);
  assert.equal(quantile([5, 1, 3], 0.5), 3);
  assert.equal(quantile([], 0.5), null);
  const f = retrying(async () => resp(200, {}));
  await f('x', {});
  assert.equal(f.retries, 0);
});
