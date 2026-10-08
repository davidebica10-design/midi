// Frasi vere, complesse, come le scriverebbe chi usa l'app senza AI (simulazioni).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, TODAY, TOMORROW, freshState, say, openTasks } from './helpers.js';
import { applyOps } from '../js/store.js';

const base = () => {
  const s = freshState();
  applyOps(s, [{ action: 'add_project', title: 'EP' }, { action: 'add', kind: 'task', title: 'Beat 02', duration_min: 120, project: 'EP' },
    { action: 'add', kind: 'task', title: 'Spesa', duration_min: 30 }, { action: 'add', kind: 'task', title: 'Relazione', duration_min: 240 },
    { action: 'add', kind: 'event', title: 'Call con Luca', date: '2026-10-08', start_time: '16:00', end_time: '17:00' },
    { action: 'add', kind: 'event', title: 'Riunione', date: TOMORROW, start_time: '10:00', end_time: '11:00' },
    { action: 'add', kind: 'task', title: 'Lavatrice', duration_min: 20 }, { action: 'add', kind: 'task', title: 'Report', duration_min: 60 }], NOW);
  return s;
};
const find = (s, t) => s.items.find((x) => x.title === t);

test('«giovedì ho il dentista alle 15:30»: il giovedì giusto e un titolo pulito', () => {
  const s = freshState();
  say(s, 'Giovedì ho il dentista alle 15:30');
  const e = find(s, 'Dentista');
  assert.ok(e, s.items.map((x) => x.title).join('|'));
  assert.equal(e.date, '2026-10-08');
  assert.equal(e.start, 930);
});

test('tre comandi in una frase: fatto, sposta, aggiungi', () => {
  const s = base();
  say(s, 'Ho finito la spesa, sposta il beat a domani e aggiungi la pizza 20 minuti');
  assert.equal(find(s, 'Spesa').status, 'done');
  assert.equal(find(s, 'Beat 02').date, TOMORROW);
  assert.equal(find(s, 'Pizza')?.duration, 20);
});

test('«venerdì devo consegnare la relazione e mi servono ancora 4 ore»: scadenza e durata sull\'attività esistente', () => {
  const s = base();
  say(s, 'Venerdì devo consegnare la relazione e mi servono ancora 4 ore');
  const r = find(s, 'Relazione');
  assert.equal(r.deadline, '2026-10-09');
  assert.equal(r.duration, 240);
  assert.equal(openTasks(s).length, 5);
});

test('«sposta la call di giovedì alle 17» e «la riunione di domani è stata spostata alle 11»', () => {
  const s = base();
  say(s, 'Sposta la call di giovedì alle 17');
  assert.equal(find(s, 'Call con Luca').start, 17 * 60);
  say(s, 'la riunione di domani è stata spostata alle 11');
  assert.equal(find(s, 'Riunione').start, 11 * 60);
});

test('impegni ogni settimana, abitudini, disponibilità e orari della giornata', () => {
  const s = freshState();
  say(s, 'Lavoro dal lunedì al venerdì dalle 9 alle 18 e il martedì e giovedì vado in palestra alle 19');
  assert.deepEqual(s.recurring.map((r) => [r.title, r.weekdays.join(',')]), [['Lavoro', '1,2,3,4,5'], ['Palestra', '2,4']]);
  say(s, 'Il corso di inglese è il martedì sera dalle 20 alle 21:30');
  assert.equal(s.recurring[2].title, 'Corso di inglese');
  say(s, 'Ogni lunedì mercoledì e venerdì corsa di 40 minuti la mattina');
  assert.deepEqual([s.habits[0].title, s.habits[0].perWeek, s.habits[0].duration], ['Corsa', 3, 40]);
  say(s, 'Oggi sono libero solo dalle 15 alle 19');
  assert.deepEqual(s.prefs.availability[TODAY], { start: 900, end: 1140 });
  say(s, 'Mi sveglio alle 7 e vado a dormire a mezzanotte');
  assert.equal(s.prefs.dayStart, 420);
});

test('date: «lunedì prossimo», «il 12 novembre», «sabato … e la sera», «tra un\'ora»', () => {
  const s = freshState();
  say(s, 'Lunedì prossimo colloquio di lavoro alle 11');
  assert.equal(find(s, 'Colloquio di lavoro').date, '2026-10-12');
  say(s, 'Il 12 novembre ho il concerto alle 21');
  assert.equal(find(s, 'Concerto').date, '2026-11-12');
  say(s, 'Sabato pranzo dai nonni a mezzogiorno e la sera festa di Marco alle 21');
  assert.deepEqual([find(s, 'Pranzo dai nonni').date, find(s, 'Pranzo dai nonni').start, find(s, 'Festa di Marco').date], ['2026-10-10', 720, '2026-10-10']);
  say(s, 'tra un\'ora devo uscire per un appuntamento dal medico');
  assert.equal(s.items.at(-1).start, 11 * 60);
});

test('elenchi: «settimana prossima ho 3 colloqui: lunedì alle 10, mercoledì alle 15 e venerdì alle 11»', () => {
  const s = freshState();
  say(s, 'settimana prossima ho 3 colloqui: lunedì alle 10, mercoledì alle 15 e venerdì alle 11');
  assert.deepEqual(s.items.map((x) => [x.title, x.date, x.start]), [['Colloquio', '2026-10-12', 600], ['Colloquio', '2026-10-14', 900], ['Colloquio', '2026-10-16', 660]]);
});

test('fatti con una data: «tra due settimane parto per Londra, devo preparare la valigia»', () => {
  const s = freshState();
  say(s, 'Tra due settimane parto per Londra, devo preparare la valigia e prenotare il taxi');
  assert.equal(s.goals.length, 0);
  assert.deepEqual(openTasks(s).map((x) => [x.title, x.deadline]), [['Preparare la valigia', '2026-10-20'], ['Prenotare il taxi', '2026-10-20']]);
});

test('progressi e priorità: metà, non fatto, più importante, fatto senza programma', () => {
  const s = base();
  say(s, 'Ho fatto metà della relazione');
  assert.equal(find(s, 'Relazione').spent, 120);
  say(s, 'Il report è urgente');
  assert.equal(find(s, 'Report').priority, 3);
  say(s, 'ho finito il report e anche la lavatrice');
  assert.equal(find(s, 'Lavatrice').status, 'done');
  say(s, 'stamattina ho fatto palestra un\'ora');
  assert.equal(find(s, 'Palestra').status, 'done');
});

test('commenti e richieste non diventano attività', () => {
  const s = freshState();
  say(s, 'Allora questa settimana è un casino: lunedì e mercoledì lavoro fino alle 19');
  assert.deepEqual(s.items.map((x) => [x.title, x.date]), [['Lavoro', '2026-10-12'], ['Lavoro', '2026-10-07']]);
  say(s, 'Organizzami la settimana');
  assert.equal(s.items.length, 2);
});

// ---------------------------------------------------------------- Fase 3: frasi da far funzionare (3.2)
// martedì 13 ottobre 2026 alle 10:00
const NOW13 = new Date(2026, 9, 13, 10, 0).getTime();
const base13 = () => {
  const s = freshState();
  applyOps(s, [{ action: 'add_project', title: 'EP' }, { action: 'add', kind: 'task', title: 'Beat 03', duration_min: 120, project: 'EP' },
    { action: 'add', kind: 'task', title: 'Spesa', duration_min: 30 }, { action: 'add', kind: 'task', title: 'Relazione', duration_min: 240 },
    { action: 'add', kind: 'task', title: 'Lavatrice', duration_min: 20 }, { action: 'add', kind: 'task', title: 'Report', duration_min: 60 },
    { action: 'add', kind: 'event', title: 'Call con Luca', date: '2026-10-15', start_time: '16:00', end_time: '17:00' },
    { action: 'add_recurring', title: 'Lavoro', start_time: '09:00', end_time: '18:00', weekdays: [1, 2, 3, 4, 5] }], NOW13);
  return s;
};
/** Una frase sullo stato di partenza: niente attività inventate (i titoli di partenza restano quelli). */
const say13 = (text) => {
  const s = base13();
  const before = s.items.map((x) => x.id);
  const r = say(s, text, NOW13);
  const added = s.items.filter((x) => !before.includes(x.id));
  return { s, r, added, tasks: added.filter((x) => x.kind === 'task'), events: added.filter((x) => x.kind === 'event') };
};
const busyAllDay = (s, day) => s.items.some((x) => x.kind === 'event' && x.date === day && x.start <= s.prefs.dayStart && x.start + x.duration >= s.prefs.dayEnd - 1);

test('3.2 «giovedi dentista 17.00» → impegno Dentista giovedì 15 alle 17:00', () => {
  const { added } = say13('giovedi dentista 17.00');
  assert.deepEqual(added.map((x) => [x.kind, x.title, x.date, x.start]), [['event', 'Dentista', '2026-10-15', 1020]]);
});

test('3.2 «lunedi h 13 dentista» → impegno Dentista lunedì 19 alle 13:00', () => {
  const { added } = say13('lunedi h 13 dentista');
  assert.deepEqual(added.map((x) => [x.kind, x.title, x.date, x.start]), [['event', 'Dentista', '2026-10-19', 780]]);
});

for (const text of ['stasera ho solo 2 ore', 'stasera ho tipo un paio d ore']) {
  test(`3.2 «${text}» → disponibilità di oggi: 2 ore la sera`, () => {
    const { s, added } = say13(text);
    assert.deepEqual(added.map((x) => x.title), []);
    const av = s.prefs.availability['2026-10-13'];
    assert.ok(av, 'disponibilità di oggi');
    assert.equal(av.end - av.start, 120);
    assert.ok(av.start >= 18 * 60, `dalle ${av.start}`);
  });
}

test('3.2 «oggi libero solo 15-19» → disponibilità di oggi 15:00–19:00', () => {
  const { s, added } = say13('oggi libero solo 15-19');
  assert.deepEqual(added.map((x) => x.title), []);
  assert.deepEqual(s.prefs.availability['2026-10-13'], { start: 900, end: 1140 });
});

test('3.2 «domani non lavoro» → Lavoro saltato domani', () => {
  const { s, added } = say13('domani non lavoro');
  assert.deepEqual(added.map((x) => x.title), []);
  assert.deepEqual(s.recurring.find((r) => r.title === 'Lavoro').skip, ['2026-10-14']);
});

test('3.2 «dal 23 al 27 dicembre sono dai miei» → giornate occupate dal 23 al 27 dicembre', () => {
  const { s, tasks } = say13('dal 23 al 27 dicembre sono dai miei');
  assert.deepEqual(tasks.map((x) => x.title), []);
  for (let d = 23; d <= 27; d++) assert.ok(busyAllDay(s, `2026-12-${d}`), `il ${d} occupato`);
  assert.ok(!busyAllDay(s, '2026-12-22') && !busyAllDay(s, '2026-12-28'));
});

test('3.2 «la settimana prossima sono in ferie» → occupato da lunedì 19 a domenica 25', () => {
  const { s, tasks } = say13('la settimana prossima sono in ferie');
  assert.deepEqual(tasks.map((x) => x.title), []);
  for (let d = 19; d <= 25; d++) assert.ok(busyAllDay(s, `2026-10-${d}`), `il ${d} occupato`);
  assert.ok(!busyAllDay(s, '2026-10-18') && !busyAllDay(s, '2026-10-26'));
});

test('3.2 «weekend al mare» → sabato e domenica occupati', () => {
  const { s, tasks } = say13('weekend al mare');
  assert.deepEqual(tasks.map((x) => x.title), []);
  assert.ok(busyAllDay(s, '2026-10-17') && busyAllDay(s, '2026-10-18'));
});

for (const text of ['lezioni dal lunedì al giovedì dalle 9 alle 13', 'lezioni lun-gio 9-13']) {
  test(`3.2 «${text}» → ricorrente lun–gio 9:00–13:00`, () => {
    const { s, added } = say13(text);
    assert.deepEqual(added.map((x) => x.title), []);
    const r = s.recurring.find((x) => x.title === 'Lezioni');
    assert.ok(r, s.recurring.map((x) => x.title).join('|'));
    assert.deepEqual([r.weekdays, r.start, r.end], [[1, 2, 3, 4], 540, 780]);
  });
}

test('3.2 «palestra mar e gio alle 19» → ricorrente martedì e giovedì alle 19:00', () => {
  const { s, added } = say13('palestra mar e gio alle 19');
  assert.deepEqual(added.map((x) => x.title), []);
  const r = s.recurring.find((x) => x.title === 'Palestra');
  assert.ok(r);
  assert.deepEqual([r.weekdays, r.start], [[2, 4], 1140]);
});

test('3.2 «correre 3 volte a sett» → abitudine 3 volte a settimana', () => {
  const { s, tasks } = say13('correre 3 volte a sett');
  assert.ok(tasks.every((x) => x.habitId), tasks.map((x) => x.title).join('|'));
  assert.deepEqual(s.habits.map((h) => [h.title, h.perWeek]), [['Correre', 3]]);
});

test('3.2 «spesa fatta» → Spesa segnata come fatta', () => {
  const { s, added } = say13('spesa fatta');
  assert.deepEqual(added.map((x) => x.title), []);
  assert.equal(s.items.find((x) => x.title === 'Spesa').status, 'done');
});

test('3.2 «fatti 30 min di beat» → 30 minuti su Beat 03', () => {
  const { s, added } = say13('fatti 30 min di beat');
  assert.deepEqual(added.map((x) => x.title), []);
  assert.equal(s.items.find((x) => x.title === 'Beat 03').spent, 30);
});

test('3.2 «la call di giovedi spostala alle 17» → Call con Luca alle 17:00', () => {
  const { s, added } = say13('la call di giovedi spostala alle 17');
  assert.deepEqual(added.map((x) => x.title), []);
  const c = s.items.find((x) => x.title === 'Call con Luca');
  assert.deepEqual([c.date, c.start], ['2026-10-15', 1020]);
});

test('3.2 «report urgentissimo» → Report con priorità alta', () => {
  const { s, added } = say13('report urgentissimo');
  assert.deepEqual(added.map((x) => x.title), []);
  assert.equal(s.items.find((x) => x.title === 'Report').priority, 3);
});

test('3.2 «esame storia il 20/1» → obiettivo «Esame di storia» entro il 20 gennaio 2027', () => {
  const { s } = say13('esame storia il 20/1');
  assert.deepEqual(s.goals.map((g) => [g.title, g.due]), [['Esame di storia', '2027-01-20']]);
});

test('3.2 «vorrei imparare lo spagnolo entro giugno» → obiettivo entro il 30 giugno 2027', () => {
  const { s } = say13('vorrei imparare lo spagnolo entro giugno');
  assert.equal(s.goals.length, 1);
  assert.equal(s.goals[0].due, '2027-06-30');
});

// ---------------------------------------------------------------- 3.1 il parser non inventa
for (const [text, hint] of [
  ['al solito posto', /Non ho capito/],
  ['non so', /Non ho capito/],
  ['solo stasera', /Non ho capito/],
  ['libero domani', /Non ho capito/],
  ['h boh', /Non ho capito/],
  ['tutto fatto ok', /Non ho capito/],
  ['lavatrice stesa', /Lavatrice/],
  ['relazione consegnata', /Relazione/],
]) {
  test(`3.1 «${text}»: niente attività inventate, dice cosa non ha capito`, () => {
    const { r, added } = say13(text);
    assert.deepEqual(added.map((x) => x.title), []);
    assert.match(r.reply, hint);
    assert.match(r.reply, /«/, 'propone una forma da scrivere');
  });
}

test('3.1 la risposta della barra dice cosa ha capito, voce per voce', () => {
  const s = base13();
  const r = say(s, 'giovedi dentista 17.00, spesa fatta e lavatrice domani', NOW13);
  assert.deepEqual(r.understood, [
    'Impegno · Dentista · giovedì 15 alle 17:00',
    'Fatto · Spesa',
    'Spostata · Lavatrice · domani',
  ]);
});
