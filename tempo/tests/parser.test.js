import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, TODAY, TOMORROW, freshState, epState, say, openTasks, projectName } from './helpers.js';
import { parseDuration } from '../js/parse.js';
import { planDays, weekday } from '../js/scheduler.js';

test('una frase con la durata in una clausola separata crea una sola attività', () => {
  const s = epState();
  say(s, "Stasera devo finire il beat 02 per l'EP, mi servono 2 ore");
  const t = openTasks(s);
  assert.equal(t.length, 1, t.map((x) => x.title).join(' | '));
  assert.equal(t[0].title, 'Finire il beat 02');
  assert.equal(projectName(s, t[0].project), 'EP');
  assert.equal(t[0].duration, 120);
  assert.equal(t[0].window, 'sera');
  assert.equal(t[0].date, TODAY);
  assert.equal(t[0].goalId, s.goals[0].id);
});

test('«Stasera 2 ore sul beat 02» aggiorna l\'attività esistente invece di duplicarla', () => {
  const s = epState();
  say(s, "Finire il beat 02 per l'EP");
  say(s, 'Stasera 2 ore sul beat 02');
  const t = openTasks(s);
  assert.equal(t.length, 1, t.map((x) => x.title).join(' | '));
  assert.equal(t[0].duration, 120);
  assert.equal(t[0].window, 'sera');
  assert.equal(t[0].date, TODAY);
  assert.equal(projectName(s, t[0].project), 'EP');
});

test('«Stasera 2 ore sul beat 02» senza attività esistente crea «Beat 02»', () => {
  const s = freshState();
  say(s, 'Stasera 2 ore sul beat 02');
  const t = openTasks(s);
  assert.equal(t.length, 1);
  assert.equal(t[0].title, 'Beat 02');
  assert.equal(t[0].duration, 120);
  assert.equal(t[0].window, 'sera');
});

test('obiettivo «entro fine novembre»', () => {
  const s = freshState();
  say(s, "Far uscire l'EP con MIDI entro fine novembre");
  const g = s.goals.find((x) => /EP con MIDI/.test(x.title));
  assert.ok(g, JSON.stringify(s.goals));
  assert.equal(g.due, '2026-11-30');
  assert.equal(projectName(s, g.projectId), 'EP');
});

test('obiettivo «tra 6 settimane» = oggi + 42 giorni', () => {
  const s = freshState();
  say(s, 'Voglio far uscire il mio EP tra 6 settimane');
  assert.equal(s.goals.length, 1);
  assert.equal(s.goals[0].due, '2026-11-17');
});

test('obiettivo «entro un mese» = oggi + 1 mese', () => {
  const s = freshState();
  say(s, 'Finire il portfolio entro un mese');
  assert.equal(s.goals.length, 1);
  assert.equal(s.goals[0].due, '2026-11-06');
});

test('abitudine «3 volte a settimana»: 3 sessioni a settimana, mai nei giorni di stacco', () => {
  const s = freshState();
  say(s, 'La domenica stacco');
  say(s, 'Andare in palestra 3 volte a settimana');
  assert.equal(s.habits.length, 1);
  assert.equal(s.habits[0].perWeek, 3);
  const plan = planDays(s, NOW, 14);
  // settimana completa da lunedì 12 a domenica 18 ottobre
  const week = Object.entries(plan).filter(([d]) => d >= '2026-10-12' && d <= '2026-10-18');
  const sessions = week.flatMap(([d, p]) => p.blocks.filter((b) => /palestra/i.test(b.item.title)).map(() => d));
  assert.equal(sessions.length, 3, sessions.join(','));
  assert.ok(sessions.every((d) => weekday(d) !== 0));
  assert.equal(new Set(sessions).size, 3, 'al massimo una al giorno');
});

test('lavoro lun–ven e domenica di stacco nella stessa frase', () => {
  const s = freshState();
  say(s, 'Lavoro 9-18:30 dal lunedì al venerdì. La domenica stacco.');
  assert.equal(s.recurring.length, 1);
  const r = s.recurring[0];
  assert.deepEqual([r.start, r.end, [...r.weekdays].sort()], [540, 1110, [1, 2, 3, 4, 5]]);
  assert.ok(s.prefs.offDays.includes(0));
});

test('«La domenica stacco» (chip dell\'onboarding) attiva davvero la domenica di stacco', () => {
  const s = freshState();
  say(s, 'La domenica stacco');
  assert.deepEqual(s.prefs.offDays, [0]);
  say(s, 'Sistemare la libreria');
  const plan = planDays(s, NOW, 7);
  assert.ok(!plan['2026-10-11'].blocks.some((b) => b.item.kind === 'task'));
});

test('«Il weekend non lavoro sui progetti» → sabato e domenica di stacco', () => {
  const s = freshState();
  say(s, 'Il weekend non lavoro sui progetti');
  assert.deepEqual([...s.prefs.offDays].sort(), [0, 6]);
});

test('impegno fisso «Domani alle 16 call con il cliente»', () => {
  const s = freshState();
  say(s, 'Domani alle 16 call con il cliente');
  assert.equal(s.items.length, 1);
  const e = s.items[0];
  assert.equal(e.kind, 'event');
  assert.equal(e.date, TOMORROW);
  assert.equal(e.start, 960);
  assert.equal(e.title, 'Call con il cliente');
});

test('«Ho fatto 30 minuti del beat» aggiunge 30 minuti fatti', () => {
  const s = epState();
  say(s, "Finire il beat 02 per l'EP, 2 ore");
  say(s, 'Ho fatto 30 minuti del beat');
  assert.equal(openTasks(s)[0].spent, 30);
});

test('durate a parole', () => {
  assert.equal(parseDuration("ci metto un'oretta"), 60);
  assert.equal(parseDuration('mi servono 2 ore'), 120);
  assert.equal(parseDuration('circa 30 min'), 30);
  assert.equal(parseDuration("un'ora e mezza"), 90);
  assert.equal(parseDuration('mezz\'ora'), 30);
});

test('scadenze in tutte le forme', async () => {
  const { parseDue } = await import('../js/parse.js');
  const due = (t) => parseDue(t, TODAY)?.due;
  assert.equal(due('entro fine novembre'), '2026-11-30');
  assert.equal(due('tra 6 settimane'), '2026-11-17');
  assert.equal(due('entro un mese'), '2026-11-06');
  assert.equal(due('entro il 15/12'), '2026-12-15');
  assert.equal(due('entro venerdì'), '2026-10-09');
  assert.equal(due('a fine mese'), '2026-10-31');
  assert.equal(due('per Natale'), '2026-12-25');
  assert.equal(due('entro il 3 marzo'), '2027-03-03');
});

test('un\'attività con scadenza breve resta un\'attività, non un obiettivo', () => {
  const s = freshState();
  say(s, 'Consegnare la relazione entro venerdì');
  assert.equal(s.goals.length, 0);
  assert.equal(s.items[0].title, 'Consegnare la relazione');
  assert.equal(s.items[0].deadline, '2026-10-09');
});

test('migrazione v1 → v2: le note strutturabili diventano preferenze, niente si perde', async () => {
  const { migrate } = await import('../js/store.js');
  const v1 = { items: [{ id: 'a', title: 'X', kind: 'task', status: 'todo', duration: 30 }], prefs: { offDays: [] }, memory: [{ id: 'm', text: 'La domenica voglio staccare', category: 'preferenza' }], chat: [], recurring: [] };
  const s = migrate(v1, NOW);
  assert.equal(s.schema, 2);
  assert.deepEqual(s.prefs.offDays, [0]);
  assert.equal(s.items.length, 1);
  assert.equal(s.memory.length, 1);
  assert.deepEqual(s.habits, []);
});

test('il punto dopo un orario chiude la frase («18:30. Sabato…»)', () => {
  const s = freshState();
  say(s, 'Lavoro 9–18:30. Sabato sono libero. Non voglio lavorare sulla musica ogni sera.');
  assert.deepEqual(s.recurring[0].weekdays, [1, 2, 3, 4, 5]);
  assert.ok(!s.prefs.offDays.includes(6));
  assert.equal(s.memory.length, 3);
});
