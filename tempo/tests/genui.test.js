import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneFor, domainOf, pipelineOf, sanitizeSkin, moodOf, countdownOf, weekOf, luminance, widgetLabel, skinPrompt } from '../js/genui.js';
import { emptyState, migrate } from '../js/store.js';
import { planDays, dateKey } from '../js/scheduler.js';
import * as vm from '../js/viewmodel.js';

/** Uno stato come quello del backup reale: un EP con 4 brani × 4 fasi, poi master, copertina, distributore. */
function epState(now) {
  const s = emptyState();
  s.onboarded = true;
  s.projects = [{ id: 'p_ep', name: 'EP', color: '#E0457B', due: null, aliases: [] }];
  s.goals = [{ id: 'g_ep', title: 'Far uscire un ep con midi', due: '2026-11-30', projectId: 'p_ep', note: '', at: now, planned: true }];
  let k = 0;
  const add = (title, deps = [], extra = {}) => {
    const id = 'i' + (k++);
    s.items.push({ id, title, kind: 'task', date: null, start: null, duration: 90, baseDuration: 90, priority: 2, energy: 3, status: 'todo', dependsOn: deps, project: 'p_ep', goalId: 'g_ep', spent: 0, createdAt: now + k, updatedAt: now, ...extra });
    return id;
  };
  const mixes = [];
  for (const n of ['01', '02', '03', '04']) {
    const b = add(`Beat ${n}`);
    const a = add(`Arrangiamento ${n}`, [b]);
    const v = add(`Registrazione voce ${n}`, [a]);
    mixes.push(add(`Mix ${n}`, [v]));
  }
  const master = add('Master', mixes);
  const cover = add('Copertina');
  add('Carica sul distributore', [master, cover]);
  s.recurring = [{ id: 'rlav', title: 'Lavoro', start: 540, end: 780, weekdays: [1, 2, 3, 4, 5], skip: [] }];
  s.prefs.focusWindow = 'sera';
  return migrate(s, now);
}

const viewOf = (state, now) => {
  const plan = planDays(state, now, 14);
  return { plan, view: vm.today({ state, plan, now, fits: {}, env: {} }) };
};

test('dominio: l\'EP è un\'uscita musicale, gli altri obiettivi hanno il loro', () => {
  assert.equal(domainOf({ title: 'Far uscire un ep con midi' }), 'release');
  assert.equal(domainOf({ title: 'Passare l\'esame di diritto privato' }), 'study');
  assert.equal(domainOf({ title: 'Correre la mezza maratona di Roma' }), 'fitness');
  assert.equal(domainOf({ title: 'Viaggio in Giappone ad aprile' }), 'trip');
  assert.equal(domainOf({ title: 'Trasloco a Milano' }), 'move');
  assert.equal(domainOf({ title: 'Lancio della beta dell\'app' }), 'launch');
  assert.equal(domainOf({ title: 'Organizzare il matrimonio' }), 'event');
  assert.equal(domainOf({ title: 'Mettere in ordine le idee' }), 'generic');
});

test('pipeline: brani × fasi, con master e copertina in fondo', () => {
  const now = Date.parse('2026-10-12T10:00');
  const s = epState(now);
  s.items.find((x) => x.title === 'Beat 01').status = 'done';
  s.items.find((x) => x.title === 'Beat 02').spent = 30;
  const p = pipelineOf(s.goals[0], s.items);
  assert.deepEqual(p.matrix.cols.map((c) => c.label), ['Beat', 'Arrangiamento', 'Registrazione voce', 'Mix']);
  assert.deepEqual(p.matrix.rows.map((r) => r.label), ['01', '02', '03', '04']);
  assert.equal(p.matrix.rows[0].cells[0].state, 'done');
  assert.equal(p.matrix.rows[1].cells[0].state, 'doing');
  assert.deepEqual(p.tail.map((t) => t.label), ['Master', 'Copertina', 'Carica sul distributore']);
  assert.equal(p.done, 1);
  assert.equal(p.total, 19);
  assert.match(widgetLabel(p), /Beat 1 di 4/);
});

test('sera libera con l\'EP: sfondo dell\'uscita musicale, al crepuscolo, due widget', () => {
  const now = Date.parse('2026-10-11T20:30'); // domenica sera
  const s = epState(now);
  const { plan, view } = viewOf(s, now);
  // la sera senza sessioni da fare (alle 20:30 il piano vero avrebbe un beat in corso)
  const sc = sceneFor({ state: s, plan, now, view: { ...view, now: null, cards: [], status: 'normal' } });
  assert.equal(sc.domain, 'release');
  assert.equal(sc.mood, 'evening');
  assert.equal(sc.layout, 'calm');
  assert.equal(sc.widgets.length, 2);
  assert.equal(sc.widgets[0].type, 'pipeline');
  assert.equal(sc.widgets[1].type, 'countdown');
  assert.match(sc.widgets[1].label, /all'uscita/);
  assert.equal(sc.palette.length, 3);
  assert.equal(sc.motif, 'waves');
  assert.equal(sc.accent, '#E0457B');
});

test('durante un\'attività la scena lascia spazio solo all\'attività', () => {
  const now = Date.parse('2026-10-12T10:00');
  const s = epState(now);
  const { plan, view } = viewOf(s, now);
  const sc = sceneFor({ state: s, plan, now, view: { ...view, now: { block: { kind: 'event', title: 'Lavoro' } } } });
  assert.equal(sc.mood, 'doing');
  assert.equal(sc.layout, 'focus');
  assert.equal(sc.widgets.length, 0);
});

test('adattamento spento: nessuna scena; palette e layout bloccati restano', () => {
  const now = Date.parse('2026-10-11T20:30');
  const s = epState(now);
  const { plan, view } = viewOf(s, now);
  s.prefs.ui = { adaptive: false };
  assert.equal(sceneFor({ state: s, plan, now, view }), null);
  s.prefs.ui = { adaptive: true, lockPalette: ['#ffffff', '#eeeeee', '#dddddd'], lockLayout: 'standard' };
  const sc = sceneFor({ state: s, plan, now, view });
  assert.deepEqual(sc.palette, ['#ffffff', '#eeeeee', '#dddddd']);
  assert.equal(sc.layout, 'standard');
});

test('la pelle proposta dall\'AI passa solo con valori ammessi', () => {
  const sk = sanitizeSkin({ domain: 'hack', pal: ['#000000', '#111111', '#222222'], motif: 'lasers', widgets: ['pipeline', 'evil', 'pipeline', 'week'], line: 'Chiudi il ritornello stasera!!! <script>' });
  assert.equal(sk.domain, undefined);
  assert.equal(sk.motif, undefined);
  assert.deepEqual(sk.widgets, ['pipeline', 'week']);
  assert.ok(sk.pal.every((h) => luminance(h) > 0.1), 'i colori scuri si schiariscono');
  assert.ok(!sk.line.includes('!') && !sk.line.includes('<'));
  assert.equal(sanitizeSkin({ nothing: 1 }), null);
  assert.equal(sanitizeSkin('x'), null);
});

test('la pelle vale solo per l\'obiettivo con lo stesso titolo', () => {
  const now = Date.parse('2026-10-11T20:30');
  const s = epState(now);
  const { plan, view } = viewOf(s, now);
  s.skins = { g_ep: { title: 'Far uscire un ep con midi', domain: 'launch', motif: 'rings', widgets: ['deadline'], line: 'Un brano alla volta.' } };
  let sc = sceneFor({ state: s, plan, now, view });
  assert.equal(sc.domain, 'launch');
  assert.equal(sc.line, 'Un brano alla volta.');
  assert.equal(sc.source, 'ai');
  s.goals[0].title = 'Altro titolo';
  sc = sceneFor({ state: s, plan, now, view });
  assert.equal(sc.source, 'rules');
});

test('umore: focus, prima di un impegno, giornata piena', () => {
  const now = Date.parse('2026-10-12T15:30');
  const s = emptyState();
  const view = { isToday: true, status: 'normal', cards: [{ type: 'event', start: '16:00' }] };
  assert.equal(moodOf({ state: s, view, now }), 'before');
  assert.equal(moodOf({ state: s, view: { ...view, cards: [], status: 'full' }, now }), 'full');
  s.focus = { phase: 'work' };
  assert.equal(moodOf({ state: s, view, now }), 'focus');
});

test('conto alla rovescia e settimana delle abitudini', () => {
  assert.equal(countdownOf({ due: '2026-10-20' }, '2026-10-12', 'study').label, 'Mancano 8 giorni all\'esame');
  assert.equal(countdownOf({ due: '2027-10-20' }, '2026-10-12', 'study'), null);
  const s = emptyState();
  s.habits = [{ id: 'h1', title: 'Corsa', perWeek: 3, goalId: 'g1' }];
  s.items = [{ id: 'x', habitId: 'h1', status: 'done', doneAt: Date.parse('2026-10-13T08:00'), kind: 'task' }];
  const w = weekOf({ id: 'g1' }, s, '2026-10-14');
  assert.equal(w.done, 1);
  assert.equal(w.target, 3);
  assert.equal(w.days[1].done, true); // martedì 13
});

test('il prompt della pelle elenca solo valori ammessi', () => {
  const m = skinPrompt({ title: 'EP', due: '2026-11-30' }, 'EP');
  assert.match(m[0].content, /"release"/);
  assert.match(m[1].content, /Scadenza: 2026-11-30/);
});
