// Un anno in un test: un utente simulato per 365 giorni (seme fisso).
// Lavora 9–18, un obiettivo musicale a 7 settimane e uno a 5 mesi, corre 3 volte a settimana,
// fa il 65% delle sessioni, accetta tutte le proposte del companion, apre l'app 4 volte al giorno
// (più una durante la prima sessione di un obiettivo) e ogni tanto scrive nella barra.
import './fake-storage.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from './fake-storage.js';
import { NOW, TODAY, freshState } from './helpers.js';
import { applyOps, pushUndo, save } from '../js/store.js';
import { contextOps } from '../js/companion.js';
import { addDays } from '../js/scheduler.js';
import { simulate, projectDays } from './sim.js';

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
// date presentate come future: «entro il 30 novembre», «Sposta al 5 luglio 2029», «fino al 3 novembre»
const FUTURE = new RegExp(`\\b(?:entro il|Sposta al|fino al)\\s+(\\d{1,2})\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4}))?`, 'g');
const pad = (n) => String(n).padStart(2, '0');

// frasi scritte di fretta nella barra, pulite e sporche
const PHRASES = ['giovedi dentista 17.00', 'spesa fatta', 'stasera ho solo 2 ore', 'domani non lavoro', 'lavatrice stesa', 'solo stasera', 'non so',
  'al solito posto', 'comprare il latte', 'fatti 30 min di beat', 'report urgentissimo', 'weekend al mare', 'lunedi h 13 dentista', 'Spesa',
  'Lavatrice 20 minuti', 'pagare la bolletta entro venerdì', 'Report 1 ora', 'libero domani', 'h boh', 'chiamare la nonna'];

test('un anno d\'uso: spazio, giorni per i progetti, date, allarmi e titoli', (t) => {
  const t0 = Date.now();
  globalThis.localStorage = new FakeStorage();
  const s = freshState({ onboarded: false });
  applyOps(s, contextOps({
    goals: "Far uscire l'EP tra 7 settimane. Finire l'album tra 5 mesi. Correre 3 volte a settimana.",
    constraints: 'Lavoro 9-18 dal lunedì al venerdì.',
    projects: 'EP, Album',
    prefs: 'La sera produco meglio. Max 2h di fila.',
  }, TODAY), NOW);
  s.onboarded = true;
  assert.equal(s.goals.length, 2, s.goals.map((g) => g.title).join(' | '));
  assert.equal(s.habits.length, 1);
  assert.equal(s.recurring.length, 1);

  const problems = { pastAsFuture: [], fitDuringSession: [], badTitles: new Set(), fewProjectDays: [] };
  let opens = 0, peeks = 0, fitShown = 0, maxDays = 0, minDays = 7;
  simulate(s, {
    start: TODAY, days: 365, seed: 2026, doRate: 0.65,
    opens: [8 * 60, 13 * 60, 19 * 60, 22 * 60 + 30],
    say: (day, rand) => (rand() < 0.4 ? PHRASES[Math.floor(rand() * PHRASES.length)] : null),
    track: { change: (label) => pushUndo(s, label), save: (st) => save(st) },
    onOpen: ({ state, shown, welcome, day, doing }) => {
      opens++;
      const texts = [...shown.map((o) => [o.text, ...(o.actions || []).map((a) => a.label)].join(' ')), welcome ? [welcome.text, ...welcome.goals.map((g) => g.text)].join(' ') : ''];
      for (const txt of texts) {
        for (const m of txt.matchAll(FUTURE)) {
          const y = m[3] ? +m[3] : +day.slice(0, 4);
          const d = `${y}-${pad(MONTHS.indexOf(m[2]) + 1)}-${pad(+m[1])}`;
          if (d < day) problems.pastAsFuture.push(`${day}: ${txt}`);
        }
      }
      fitShown += shown.filter((o) => o.id.startsWith('fit-')).length;
      // nessun «non entra» mentre una sessione di quell'obiettivo è in corso
      const busy = new Set(state.items.filter((x) => x.status === 'doing' && x.goalId).map((x) => x.goalId));
      if (doing) peeks++;
      for (const o of shown) if (o.id.startsWith('fit-') && busy.has(o.id.slice(4))) problems.fitDuringSession.push(`${day}: ${o.text}`);
    },
    onDay: ({ state, day }) => {
      const n = projectDays(state, day);
      minDays = Math.min(minDays, n); maxDays = Math.max(maxDays, n);
      if (n < 3) problems.fewProjectDays.push(`${day}: ${n}`);
      for (const x of state.items) if (/^(?:Al |Non |Solo)/.test(x.title)) problems.badTitles.add(x.title);
    },
  });
  const used = localStorage.size();
  const secs = (Date.now() - t0) / 1000;
  const done = s.log.filter((e) => e.type === 'done').length, skipped = s.log.filter((e) => e.type === 'skip' && !e.auto).length;
  t.diagnostic(`obiettivi raggiunti ${(s.goalsDone || []).length} · aperti ${s.goals.length} · ultime 400 voci del registro: ${done} fatte, ${skipped} saltate`);
  t.diagnostic(`aperture ${opens} (di cui ${peeks} durante una sessione) · «non entra» mostrati ${fitShown} · giorni per i progetti ${minDays}–${maxDays} · localStorage ${used} caratteri · ${secs.toFixed(1)} s`);

  assert.ok(used < 1_000_000, `localStorage: ${used} caratteri`);
  assert.deepEqual(problems.fewProjectDays.slice(0, 3), [], 'almeno 3 giorni a settimana per i progetti');
  assert.deepEqual(problems.pastAsFuture.slice(0, 3), [], 'nessuna data passata presentata come futura');
  assert.ok(peeks > 30, `sessioni in corso controllate: ${peeks}`);
  assert.deepEqual(problems.fitDuringSession.slice(0, 3), [], 'nessun «non entra» durante una sessione');
  assert.deepEqual([...problems.badTitles], [], 'nessun titolo che inizia con «Al », «Non », «Solo»');
  assert.ok(addDays(TODAY, 365) > TODAY);
});
