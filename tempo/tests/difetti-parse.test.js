// Difetti noti del parser senza AI (docs/quality/REPORT.md, «Cosa non è stato corretto»).
// I test «DIFETTO» sono ROSSI di proposito finché parse.js non è corretto; quelli «guardia» devono restare verdi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, TODAY, TOMORROW, freshState, say, openTasks } from './helpers.js';
import { localParse } from '../js/parse.js';

const parse = (t, s = freshState()) => localParse(t, s, NOW);
const opsOf = (r) => r.ops || [];
const creates = (r) => opsOf(r).filter((o) => ['add', 'set_goal', 'plan_goal', 'add_recurring'].includes(o.action));

// ---- B1 domande ----
for (const q of ['Mi sento indietro con tutto, cosa mi consigli?', 'Quanto tempo ho domani?', 'Come sto andando?']) {
  test(`DIFETTO: la domanda «${q}» non crea attività né obiettivi`, () => {
    const r = parse(q);
    assert.deepEqual(creates(r).map((o) => `${o.action}:${o.title}`), [], 'nessuna operazione di creazione');
    assert.equal(typeof r.reply, 'string', 'risponde con un testo');
    assert.ok(r.reply.length > 0);
  });
  test(`DIFETTO: la domanda «${q}» lascia lo stato senza attività`, () => {
    const s = freshState();
    say(s, q);
    assert.equal(openTasks(s).length, 0);
  });
}

// ---- B2 testo senza senso ----
for (const g of ['asdf qwerty zzz', '…', 'ok', '😀']) {
  test(`DIFETTO: «${g}» non crea un'attività`, () => {
    const s = freshState();
    const r = say(s, g);
    assert.deepEqual(creates(r).map((o) => o.title), []);
    assert.equal(openTasks(s).length, 0);
  });
}

// ---- B3 «obiettivo: …» ----
test('DIFETTO: «obiettivo: finire il portfolio entro dicembre» crea un solo obiettivo preso dal testo dopo i due punti', () => {
  const r = parse('obiettivo: finire il portfolio entro dicembre');
  const goals = opsOf(r).filter((o) => o.action === 'set_goal');
  assert.deepEqual(goals.map((g) => g.title), ['Finire il portfolio']);
  assert.equal(goals[0].deadline, '2026-12-31');
});
test('DIFETTO: nessun obiettivo si chiama «Obiettivo»', () => {
  const r = parse('obiettivo: finire il portfolio entro dicembre');
  assert.ok(!opsOf(r).some((o) => /^obiettivo$/i.test(o.title || '')), opsOf(r).map((o) => o.action + ':' + o.title).join(' | '));
});

// ---- B4 guardia: frasi normali che devono restare identiche ----
test('guardia: «domani alle 10 dentista» è un impegno domani alle 10', () => {
  const [o] = opsOf(parse('domani alle 10 dentista'));
  assert.deepEqual([o.action, o.title, o.date, o.start_time, o.duration_min], ['add', 'Dentista', TOMORROW, '10:00', 60]);
});
test('guardia: «scrivere la relazione 1 ora» è un\'attività di 60 minuti senza data', () => {
  const [o] = opsOf(parse('scrivere la relazione 1 ora'));
  assert.deepEqual([o.action, o.title, o.duration_min, o.date ?? null], ['add', 'Scrivere la relazione', 60, null]);
});
test('guardia: «palestra lunedì e giovedì alle 19» è una ricorrenza lunedì e giovedì alle 19', () => {
  const [o] = opsOf(parse('palestra lunedì e giovedì alle 19'));
  assert.equal(o.action, 'add_recurring');
  assert.equal(o.title, 'Palestra');
  assert.equal(o.start_time, '19:00');
  assert.deepEqual([...o.weekdays].sort(), [1, 4]);
});
test('guardia: «sposta la spesa a domani» sposta l\'attività esistente', () => {
  const s = freshState();
  say(s, 'la spesa');
  const id = openTasks(s)[0].id;
  const r = say(s, 'sposta la spesa a domani');
  assert.deepEqual(opsOf(r).map((o) => [o.action, o.id, o.date]), [['move', id, TOMORROW]]);
  assert.equal(openTasks(s).length, 1);
  assert.equal(openTasks(s)[0].date, TOMORROW);
});
test('guardia: «Telefonare a Marta alle 15» è un impegno di oggi alle 15', () => {
  const [o] = opsOf(parse('Telefonare a Marta alle 15'));
  assert.deepEqual([o.action, o.title, o.date, o.start_time], ['add', 'Telefonare a Marta', TODAY, '15:00']);
});
test('guardia: «Entro venerdì consegnare il preventivo 2 ore» ha scadenza venerdì e 120 minuti', () => {
  const [o] = opsOf(parse('Entro venerdì consegnare il preventivo 2 ore'));
  assert.deepEqual([o.action, o.title, o.duration_min, o.deadline], ['add', 'Consegnare il preventivo', 120, '2026-10-09']);
});
test('guardia: «Chiama il medico domani mattina» è un\'attività di domani in mattinata', () => {
  const [o] = opsOf(parse('Chiama il medico domani mattina'));
  assert.deepEqual([o.action, o.title, o.date, o.window], ['add', 'Chiama il medico', TOMORROW, 'mattina']);
});
test('guardia: un obiettivo con scadenza («Far uscire l\'EP entro il 30 novembre») crea progetto, obiettivo e piano', () => {
  const r = parse("Far uscire l'EP entro il 30 novembre");
  assert.deepEqual(opsOf(r).map((o) => o.action), ['add_project', 'set_goal', 'plan_goal']);
  const g = opsOf(r).find((o) => o.action === 'set_goal');
  assert.deepEqual([g.title, g.deadline], ["Far uscire l'EP", '2026-11-30']);
  assert.equal(r.confirm, true);
});
test('guardia: «La domenica stacco» è una preferenza, non un\'attività', () => {
  const r = parse('La domenica stacco');
  assert.deepEqual(opsOf(r).map((o) => o.action), ['set_pref', 'remember']);
});
test('guardia: «Ho fatto 30 minuti del beat» senza attività non crea niente', () => {
  assert.deepEqual(creates(parse('Ho fatto 30 minuti del beat')), []);
});
