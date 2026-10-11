import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthRecap, sanitizeRecapAi, recapPrompt, recapObservation, prevMonthKey, recapHash, timeChatSystem } from '../js/recap.js';
import { emptyState } from '../js/store.js';

function monthState() {
  const s = emptyState();
  s.projects = [{ id: 'p_ep', name: 'EP', color: '#E0457B' }, { id: 'p_pf', name: 'Portfolio', color: '#7A55C8' }];
  s.goals = [{ id: 'g1', title: 'Far uscire l\'EP', due: '2026-11-30', projectId: 'p_ep' }];
  s.prefs.focusWindow = 'mattina';
  let k = 0;
  const done = (title, project, iso, actual, base = actual) => {
    const id = 'd' + (k++);
    const at = Date.parse(iso);
    s.items.push({ id, title, kind: 'task', status: 'done', doneAt: at, actual, duration: base, baseDuration: base, project, goalId: project === 'p_ep' ? 'g1' : null });
    s.log.push({ type: 'done', id, project, at, start: new Date(at).getHours() * 60 - actual });
  };
  done('Beat 01', 'p_ep', '2026-10-01T21:00', 120, 90);
  done('Beat 02', 'p_ep', '2026-10-02T21:30', 100, 90);
  done('Arrangiamento 01', 'p_ep', '2026-10-08T22:00', 110, 90);
  done('Caso studio', 'p_pf', '2026-10-09T12:00', 60, 45);
  done('Mix 01', 'p_ep', '2026-10-15T21:00', 95, 90);
  done('Fuori mese', 'p_ep', '2026-09-28T21:00', 60);
  s.items.push({ id: 'open1', title: 'Master', kind: 'task', status: 'todo', project: 'p_ep', goalId: 'g1', duration: 120 });
  s.log.push({ type: 'skip', id: 'x', project: 'p_ep', at: Date.parse('2026-10-05T19:00') }, { type: 'skip', id: 'y', project: 'p_ep', at: Date.parse('2026-10-12T19:00') });
  s.log.push({ type: 'skip', id: 'z', at: Date.parse('2026-10-13T21:00'), auto: true }); // segnata dall'app: non conta
  s.learned.samples.push({ keys: ['w:beat', 'p:p_ep'], base: 90, actual: 80, doneAt: Date.parse('2026-10-20T21:00') });
  return s;
}

test('i numeri del mese: sessioni, ore, progetti, ritmo, saltate, stime', () => {
  const s = monthState();
  const r = monthRecap(s, '2026-10', Date.parse('2026-10-31T23:00'));
  assert.equal(r.sessions, 6); // 5 fatte + 1 archiviata, non quella di settembre
  assert.equal(r.minutes, 120 + 100 + 110 + 60 + 95 + 80);
  assert.equal(r.skipped, 2);
  assert.equal(r.rate, 75);
  assert.equal(r.projects[0].name, 'EP');
  assert.equal(r.projects[0].sessions, 5);
  assert.equal(r.best.window, 'sera');
  assert.equal(r.best.skipDay, 'lunedì');
  assert.ok(r.ratio > 1.15);
  assert.equal(r.goals[0].done, 5);
  assert.equal(r.goals[0].total, 6);
  const text = r.chapters.map((c) => `${c.head} ${c.text}`).join(' ');
  assert.match(text, /Rendi di più la sera/);
  assert.match(text, /soprattutto il lunedì/);
  assert.ok(!text.includes('!'), 'niente punti esclamativi');
  // la fascia dichiarata (mattina) non coincide con quella vera (sera): il consiglio lo dice, ma servono 4 sessioni
  assert.match(r.chapters.at(-1).text, /sera/);
});

test('mese vuoto: una sola frase onesta', () => {
  const r = monthRecap(emptyState(), '2026-10', Date.parse('2026-10-02T10:00'));
  assert.equal(r.empty, true);
  assert.equal(r.chapters.length, 1);
  assert.match(r.chapters[0].text, /appena iniziato/);
});

test('il racconto dell\'AI passa solo se ben formato', () => {
  assert.equal(sanitizeRecapAi({ lines: ['una'] }), null);
  const ok = sanitizeRecapAi('```json\n{"title":"Un mese di musica!","lines":["Hai chiuso 5 sessioni!!","La sera è tua.","<b>x</b>"],"next":"Prova la mattina."}\n```');
  assert.equal(ok.title, 'Un mese di musica.');
  assert.ok(ok.lines.every((l) => !l.includes('!') && !l.includes('<')));
  assert.equal(ok.next, 'Prova la mattina.');
});

test('il prompt contiene solo numeri aggregati e le regole di tono', () => {
  const s = monthState();
  const r = monthRecap(s, '2026-10', Date.parse('2026-10-31T23:00'));
  const m = recapPrompt(r, s);
  const facts = JSON.parse(m[1].content);
  assert.equal(facts.sessioni, 6);
  assert.equal(facts.saltate, 2);
  assert.match(m[0].content, /niente punti esclamativi/);
  assert.match(timeChatSystem(r, s, 'BASE'), /^BASE/);
  assert.notEqual(recapHash(r), recapHash({ ...r, sessions: 7 }));
});

test('osservazione del nuovo mese: nei primi 5 giorni, una volta', () => {
  const s = monthState();
  assert.equal(prevMonthKey('2026-01'), '2025-12');
  const o = recapObservation(s, Date.parse('2026-11-02T09:00'));
  assert.equal(o.id, 'recap-2026-10');
  assert.match(o.text, /Il tuo ottobre è pronto/);
  assert.equal(recapObservation(s, Date.parse('2026-11-09T09:00')), null);
  s.recaps = { '2026-10': { seen: true } };
  assert.equal(recapObservation(s, Date.parse('2026-11-02T09:00')), null);
});

test('grammatica dei giorni e niente ritmo con meno di 4 sessioni', () => {
  const s = emptyState();
  const at = Date.parse('2026-10-11T21:00'); // domenica
  s.items.push({ id: 'a1', title: 'Beat 01', kind: 'task', status: 'done', doneAt: at, actual: 120, duration: 120 });
  let r = monthRecap(s, '2026-10', at);
  assert.ok(!r.chapters.some((c) => c.kind === 'rhythm'));
  for (let i = 2; i <= 4; i++) s.items.push({ id: 'a' + i, title: 'Beat 0' + i, kind: 'task', status: 'done', doneAt: at + i * 60000, actual: 60, duration: 60 });
  r = monthRecap(s, '2026-10', at);
  const rh = r.chapters.find((c) => c.kind === 'rhythm');
  assert.match(rh.text, /La domenica è stata il tuo giorno più pieno/);
  assert.ok(!/Il domenica/.test(rh.text));
});
