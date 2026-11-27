// Difetti noti della validazione in store.js (docs/quality/GUASTI.md guasto 6, CONTRATTO.md righe «Annulla»).
// I test «DIFETTO» sono ROSSI di proposito finché store.js non è corretto. Quelli «caratterizzazione» fotografano
// il comportamento di oggi (devono passare): cambiarli è una scelta, non una svista.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './fake-storage.js';
import { FakeStorage } from './fake-storage.js';
import { NOW, TODAY, freshState } from './helpers.js';
import { sanitizeOps, applyOps, pushUndo, popUndo, canUndo, hasUndo, lastUndo, trimUndoStorage } from '../js/store.js';

/** AI → sanitizeOps → applyOps, come fa l'app. */
function fromAI(raw, state = freshState()) {
  const san = sanitizeOps(raw);
  const res = applyOps(state, san.ops, NOW);
  return { state, san, res };
}
const realDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};

// ---- A1 date inesistenti ----
for (const bad of ['9999-99-99', '2026-02-30', '2026-13-01', '2026-00-10']) {
  test(`DIFETTO: la data inesistente ${bad} non viene salvata e l'operazione è respinta con un motivo`, () => {
    const { state, san, res } = fromAI([{ action: 'add', title: 'Prova', date: bad }]);
    assert.ok(state.items.every((i) => i.date == null || realDate(i.date)), 'date salvate: ' + JSON.stringify(state.items.map((i) => i.date)));
    assert.ok(state.items.length === 0 || san.dropped > 0 || res.errors.length > 0, 'né scartata né segnalata');
  });
}
test('DIFETTO: una scadenza inesistente (deadline 2026-02-30) non viene salvata', () => {
  const { state } = fromAI([{ action: 'add', title: 'Prova', deadline: '2026-02-30' }]);
  assert.ok(state.items.every((i) => i.deadline == null || realDate(i.deadline)), JSON.stringify(state.items.map((i) => i.deadline)));
});
test('DIFETTO: spostare un\'attività a 2026-02-30 non cambia la sua data', () => {
  const s = freshState();
  applyOps(s, [{ action: 'add', title: 'Prova', date: '2026-10-08' }], NOW);
  const id = s.items[0].id;
  fromAI([{ action: 'move', id, date: '2026-02-30' }], s);
  assert.equal(s.items[0].date, '2026-10-08');
});
test('caratterizzazione: una data vera passa invariata', () => {
  const { state } = fromAI([{ action: 'add', title: 'Prova', date: '2026-10-08' }]);
  assert.equal(state.items[0].date, '2026-10-08');
});

// ---- A2 date lontane: il codice non dichiara alcun limite ----
test('caratterizzazione: una data vera ma lontana (2099-01-01) è trattata come una data qualsiasi (nessun limite nel codice)', () => {
  const { san, state } = fromAI([{ action: 'add', title: 'Prova', date: '2099-01-01' }]);
  assert.equal(san.ops[0].date, '2099-01-01');
  assert.equal(state.items[0].date, '2099-01-01');
});

// ---- A3 impegno oltre la mezzanotte ----
test('DIFETTO: un impegno 23:50 di 5 ore non finisce oltre le 24:00', () => {
  const { state, res } = fromAI([{ action: 'add', kind: 'event', title: 'Notte', date: '2026-10-07', start_time: '23:50', duration_min: 300 }]);
  for (const i of state.items) assert.ok(i.start + i.duration <= 1440, `fine ${i.start + i.duration} minuti`);
  assert.ok(state.items.length || res.errors.length, 'o è tagliato o è respinto con un errore');
});
test('DIFETTO: con end_time prima di start_time l\'impegno non ha fine prima dell\'inizio né durata non valida', () => {
  const { state } = fromAI([{ action: 'add', kind: 'event', title: 'Strano', date: '2026-10-07', start_time: '18:00', end_time: '09:00', duration_min: 600 }]);
  for (const i of state.items) assert.ok(i.duration > 0 && i.start + i.duration <= 1440, `${i.start} + ${i.duration}`);
});
test('DIFETTO: un impegno che inizia alle 24:00 non viene salvato oltre la fine del giorno', () => {
  const { state } = fromAI([{ action: 'add', kind: 'event', title: 'Mezzanotte', date: '2026-10-07', start_time: '24:00', duration_min: 60 }]);
  for (const i of state.items) assert.ok(i.start + i.duration <= 1440, `inizio ${i.start}, durata ${i.duration}`);
});

// ---- A4 durate e orari ----
for (const d of [0, -30, 100000, '60', 'abc', NaN, Infinity]) {
  test(`durata ${String(d)}: salvata solo un numero intero tra 5 minuti e 16 ore`, () => {
    const { state } = fromAI([{ action: 'add', title: 'Prova', duration_min: d }]);
    const x = state.items[0].duration;
    assert.ok(Number.isInteger(x) && x >= 5 && x <= 960, 'durata salvata: ' + x);
  });
}
test('caratterizzazione: la durata «60» (testo) vale 60', () => {
  assert.equal(fromAI([{ action: 'add', title: 'Prova', duration_min: '60' }]).state.items[0].duration, 60);
});
for (const t of [-5, 1500, 'x', '25:00', '', null]) {
  test(`orario ${JSON.stringify(t)}: un impegno con questo orario non viene salvato con un inizio non valido`, () => {
    const { state } = fromAI([{ action: 'add', kind: 'event', title: 'Prova', date: '2026-10-07', start_time: t }]);
    for (const i of state.items) assert.ok(Number.isInteger(i.start) && i.start >= 0 && i.start < 1440, 'inizio: ' + i.start);
  });
}
test('nessun NaN nei numeri salvati, con valori ostili in tutti i campi numerici', () => {
  const { state } = fromAI([{ action: 'add', title: 'Prova', duration_min: NaN, priority: 'alta', energy: {}, actual_min: 'x' }]);
  for (const i of state.items) for (const k of ['duration', 'priority', 'energy']) assert.ok(Number.isFinite(i[k]), `${k}=${i[k]}`);
});

// ---- A5 conteggio degli scarti ----
test('caratterizzazione: sanitizeOps restituisce { ops, dropped } con il numero delle operazioni scartate', () => {
  const r = sanitizeOps([{ action: 'add', title: 'ok' }, { action: 'boom' }, null, { action: 'update' }, 'x']);
  assert.deepEqual(Object.keys(r).sort(), ['dropped', 'ops']);
  assert.equal(r.ops.length, 1);
  assert.equal(r.dropped, 4);
});
test('caratterizzazione: sanitizeOps non dà i motivi degli scarti (solo il numero)', () => {
  assert.equal(sanitizeOps([{ action: 'boom' }]).reasons, undefined);
});
test('DIFETTO: un\'operazione con data inesistente conta tra gli scarti oppure produce un errore', () => {
  const { san, res } = fromAI([{ action: 'add', title: 'Prova', date: '9999-99-99' }]);
  assert.ok(san.dropped >= 1 || res.errors.length >= 1);
});

// ---- A6 oltre 40 operazioni ----
test('caratterizzazione: sanitizeOps tiene al massimo 40 operazioni', () => {
  const r = sanitizeOps(Array.from({ length: 45 }, (_, i) => ({ action: 'add', title: 'a' + i })));
  assert.equal(r.ops.length, 40);
});
test('DIFETTO: le operazioni oltre la quarantesima sono contate come scartate, non perse in silenzio', () => {
  const r = sanitizeOps(Array.from({ length: 45 }, (_, i) => ({ action: 'add', title: 'a' + i })));
  assert.equal(r.dropped, 5, 'dropped = ' + r.dropped);
});

// ---- A7 caratterizzazione dell'annulla ----
const fresh = () => { globalThis.localStorage = new FakeStorage(); trimUndoStorage(); };
const snapTitles = (s) => s.items.map((i) => i.title);
function addAndPush(s, title) {
  const id = pushUndo(s, 'Aggiungi ' + title);
  applyOps(s, [{ action: 'add', title }], NOW);
  return id;
}

test('caratterizzazione annulla: in memoria restano le ultime 20 modifiche', () => {
  fresh();
  const s = freshState();
  const ids = [];
  for (let i = 0; i < 25; i++) ids.push(addAndPush(s, 'a' + i));
  assert.equal(ids.filter(hasUndo).length, 20);
  assert.ok(!hasUndo(ids[4]) && hasUndo(ids[5]));
  assert.equal(lastUndo().id, ids[24]);
});
test('caratterizzazione annulla: annullare l\'ultima modifica toglie solo quella', () => {
  fresh();
  const s = freshState();
  addAndPush(s, 'uno'); addAndPush(s, 'due');
  const e = popUndo(s);
  assert.equal(e.label, 'Aggiungi due');
  assert.deepEqual(snapTitles(s), ['uno']);
  assert.ok(canUndo());
});
test('caratterizzazione annulla: annullare una voce più vecchia scarta anche tutte le successive', () => {
  fresh();
  const s = freshState();
  const a = addAndPush(s, 'uno'); const b = addAndPush(s, 'due'); const c = addAndPush(s, 'tre');
  popUndo(s, b);
  assert.deepEqual(snapTitles(s), ['uno']);
  assert.ok(hasUndo(a));
  assert.ok(!hasUndo(b) && !hasUndo(c), 'la voce annullata e le successive spariscono');
});
test('caratterizzazione annulla: un id sconosciuto non cambia nulla', () => {
  fresh();
  const s = freshState();
  addAndPush(s, 'uno');
  assert.equal(popUndo(s, 'inesistente'), null);
  assert.deepEqual(snapTitles(s), ['uno']);
});
test('caratterizzazione annulla: dopo un riavvio (rilettura da disco) restano solo le ultime 3', () => {
  fresh();
  const s = freshState();
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(addAndPush(s, 'a' + i));
  trimUndoStorage();
  assert.deepEqual(ids.map(hasUndo), [false, false, false, true, true, true]);
});
test('caratterizzazione annulla: dopo il riavvio l\'ultima voce si può ancora annullare', () => {
  fresh();
  const s = freshState();
  addAndPush(s, 'uno'); addAndPush(s, 'due');
  trimUndoStorage();
  popUndo(s);
  assert.deepEqual(snapTitles(s), ['uno']);
});
test('caratterizzazione annulla: se il disco è illeggibile l\'annulla riparte vuoto, senza errori', () => {
  fresh();
  const s = freshState();
  addAndPush(s, 'uno');
  localStorage.setItem('tempo.undo.v1', '{non json');
  trimUndoStorage();
  assert.equal(canUndo(), false);
});
test('caratterizzazione annulla: un\'istantanea troppo grande (≥ 300 mila caratteri) non sopravvive al riavvio', () => {
  fresh();
  const s = freshState();
  s.memory = [{ id: 'm', text: 'x'.repeat(310_000) }];
  const id = pushUndo(s, 'grande');
  assert.ok(hasUndo(id), 'in memoria c\'è');
  trimUndoStorage();
  assert.ok(!hasUndo(id), 'dopo il riavvio no');
});
