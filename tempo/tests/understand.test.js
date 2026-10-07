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
