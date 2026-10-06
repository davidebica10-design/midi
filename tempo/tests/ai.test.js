import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, TODAY, TOMORROW, freshState, epState, openTasks, projectName } from './helpers.js';
import { applyOps } from '../js/store.js';
import { runOpenTurn } from '../js/ai-open.js';
import { withTimeout } from '../js/ai.js';
import { planDays } from '../js/scheduler.js';

/** Un servizio "Gemini" simulato che risponde con le operazioni date. */
function mockAi(reply) {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'models/gemini-2.5-flash' }] }), { status: 200 });
    const content = typeof reply === 'string' ? reply : JSON.stringify(reply);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
}
const online = (s) => Object.assign(s.settings, { provider: 'online', openPreset: 'gemini', openBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', openKey: 'AIzaTEST' });

async function viaAi(state, text, ops) {
  online(state);
  mockAi({ reply: 'Fatto.', ops, requires_confirmation: false });
  const out = await runOpenTurn({ state, plan: planDays(state, NOW, 2), now: NOW, userText: text, chat: [] });
  applyOps(state, out.ops, NOW);
  return out;
}

// la tabella di regressione, con le risposte che darebbe un buon modello
test('AI: «Stasera devo finire il beat 02 per l\'EP, mi servono 2 ore»', async () => {
  const s = epState();
  await viaAi(s, "Stasera devo finire il beat 02 per l'EP, mi servono 2 ore", [
    { action: 'add', kind: 'task', title: 'Finire il beat 02', project: 'EP', duration_min: 120, window: 'sera', date: TODAY },
  ]);
  const t = openTasks(s);
  assert.equal(t.length, 1);
  assert.equal(projectName(s, t[0].project), 'EP');
  assert.equal(t[0].goalId, s.goals[0].id);
});

test('AI: obiettivo con piano proposto dal modello (validato)', async () => {
  const s = freshState();
  await viaAi(s, "Far uscire l'EP con MIDI entro fine novembre", [
    { action: 'add_project', title: 'EP' },
    { action: 'set_goal', title: "Far uscire l'EP con MIDI", deadline: '2026-11-30', project: 'EP' },
    { action: 'plan_goal', title: "Far uscire l'EP con MIDI", sessions: [
      { key: 'a', title: 'Beat 01', duration_min: 120, energy: 3, after: [] },
      { key: 'b', title: 'Mix 01', duration_min: 90, energy: 3, after: ['a'] },
      { key: 'c', title: 'Sessione infinita', duration_min: 900, energy: 3, after: [] },
    ] },
  ]);
  assert.equal(s.goals[0].due, '2026-11-30');
  const ses = s.items.filter((x) => x.goalId === s.goals[0].id);
  assert.deepEqual(ses.map((x) => x.title), ['Beat 01', 'Mix 01']);
  assert.deepEqual(ses[1].dependsOn, [ses[0].id]);
});

test('AI: impegno fisso e progresso', async () => {
  const s = epState();
  await viaAi(s, 'Domani alle 16 call con il cliente', [{ action: 'add', kind: 'event', title: 'Call con il cliente', date: TOMORROW, start_time: '16:00', end_time: '17:00' }]);
  assert.equal(s.items[0].start, 960);
});

test('AI: operazioni non valide vengono scartate prima di toccare lo stato', async () => {
  const s = freshState();
  const out = await viaAi(s, 'Spesa', [{ action: 'drop_database' }, { action: 'add', kind: 'task', title: 'Spesa', date: 'ieri', duration_min: 'tanti' }]);
  assert.equal(out.ops.length, 1);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].date, null);
});

test('AI: risposta non JSON → nessuna modifica', async () => {
  const s = freshState();
  online(s);
  mockAi('Certo! Ecco il tuo piano…');
  const out = await runOpenTurn({ state: s, plan: planDays(s, NOW, 2), now: NOW, userText: 'Organizzami la settimana', chat: [] });
  assert.equal(out.ops.length, 0);
});

test('AI: le frasi semplici non passano dal modello', async () => {
  const s = freshState();
  online(s);
  globalThis.fetch = async () => { throw new Error('non dovrebbe chiamare il servizio'); };
  const out = await runOpenTurn({ state: s, plan: planDays(s, NOW, 2), now: NOW, userText: 'La domenica stacco', chat: [] });
  applyOps(s, out.ops, NOW);
  assert.deepEqual(s.prefs.offDays, [0]);
});

test('timeout: oltre il tempo massimo la richiesta viene annullata', async () => {
  let aborted = false;
  await assert.rejects(
    withTimeout((signal) => new Promise((resolve) => { signal.addEventListener('abort', () => { aborted = true; }); }), 30),
    (e) => e.code === 'timeout',
  );
  assert.ok(aborted);
});
