// Difetti trovati dal QA e dal revisore nelle liste dentro le carte, riprodotti come test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checklistOps } from '../js/parse.js';
import { migrate, applyOps, sanitizeOps, cleanChecklist, checklistOwner } from '../js/store.js';
import { mergeStates } from '../js/cloud.js';

const NOW = Date.parse('2026-10-12T10:00:00'); // lunedì
const TODAY = '2026-10-12';
const DAY = 86400000;

const workState = () => migrate({
  onboarded: true, items: [],
  recurring: [
    { id: 'rmat', title: 'Lavoro', start: 540, end: 780, weekdays: [1, 2, 3, 4, 5], skip: [] },
    { id: 'rpom', title: 'Lavoro', start: 870, end: 1110, weekdays: [1, 2, 3, 4, 5], skip: [] },
  ],
}, NOW);

const ev = (id, title, date, start = 600) => ({ id, title, kind: 'event', status: 'todo', date, start, duration: 60, priority: 2, energy: 1, dependsOn: [] });

// ---- 1. impegni con lo stesso nome
test('due impegni con lo stesso nome: la lista va a quello di oggi, non al primo dell\'elenco', () => {
  const s = migrate({ onboarded: true, items: [ev('e-lontana', 'Prova', '2026-10-20'), ev('e-oggi', 'Prova', TODAY)], recurring: [] }, NOW);
  assert.equal(checklistOwner(s, 'Prova', TODAY).id, 'e-oggi');
  // senza oggi, la più vicina nel futuro
  const t = migrate({ onboarded: true, items: [ev('e-tardi', 'Prova', '2026-11-02'), ev('e-vicina', 'Prova', '2026-10-15')], recurring: [] }, NOW);
  assert.equal(checklistOwner(t, 'Prova', TODAY).id, 'e-vicina');
});

// ---- 2. giorno saltato
test('un Lavoro saltato oggi non riceve la lista: vince quello che c\'è davvero', () => {
  const s = workState();
  s.recurring[0].skip = [TODAY];
  assert.equal(checklistOwner(s, 'Lavoro', TODAY).id, 'rpom');
  const r = checklistOps('metti dentro lavoro: relazione, mail', s, TODAY);
  assert.equal(r.ops[0].id, 'rpom');
  // se sono saltati tutti e due, resta comunque un posto dove metterla
  s.recurring[1].skip = [TODAY];
  assert.ok(checklistOwner(s, 'Lavoro', TODAY));
});

// ---- 3. un ricorrente cancellato non deve tornare con la sincronizzazione
test('un impegno ricorrente cancellato su un dispositivo non risorge dall\'altro', () => {
  const a = migrate({ onboarded: true, items: [], recurring: [] }, NOW);
  applyOps(a, [{ action: 'add_recurring', title: 'Palestra', start_time: '18:00', end_time: '19:00', weekdays: [2, 4] }], NOW - 3 * DAY);
  assert.equal(a.recurring.length, 1);
  const b = structuredClone(a); // l'altro dispositivo, sincronizzato prima della cancellazione
  const lastSync = NOW - DAY;
  applyOps(a, [{ action: 'remove_recurring', id: a.recurring[0].id }], NOW);
  assert.equal(a.recurring.length, 0);
  const m = mergeStates(a, b, { lastSync, localDirty: true });
  assert.equal(m.recurring.length, 0, 'cancellato qui, dopo l\'ultima sincronizzazione');
  // e uno nuovo creato qui dopo la sincronizzazione si tiene
  const c = migrate({ onboarded: true, items: [], recurring: [] }, NOW);
  applyOps(c, [{ action: 'add_recurring', title: 'Yoga', start_time: '07:00', end_time: '08:00', weekdays: [1] }], NOW);
  assert.equal(mergeStates(c, migrate({ onboarded: true }, NOW), { lastSync, localDirty: true }).recurring.length, 1);
});

// ---- 4. due dispositivi spuntano voci diverse della stessa lista
function pairWithList() {
  const a = workState();
  applyOps(a, [{ action: 'add_checklist', id: 'rmat', checklist: ['Relazione', 'Mail', 'Chiamare Marco'] }], NOW - 2 * DAY);
  return [a, structuredClone(a)];
}
test('sincronizzazione: le spunte fatte su due dispositivi si sommano', () => {
  const [a, b] = pairWithList();
  const lastSync = NOW - DAY;
  applyOps(a, [{ action: 'check_item', id: 'rmat', item_id: 'Relazione', done: true }], NOW - 5000);
  applyOps(b, [{ action: 'check_item', id: 'rmat', item_id: 'Mail', done: true }], NOW);
  const list = mergeStates(a, b, { lastSync, localDirty: true }).recurring.find((x) => x.id === 'rmat').checklist;
  assert.deepEqual(list.map((x) => [x.text, x.done]), [['Relazione', true], ['Mail', true], ['Chiamare Marco', false]]);
});
test('sincronizzazione: una spunta tolta dopo vince su una spunta vecchia dell\'altro lato', () => {
  const [a, b] = pairWithList();
  applyOps(a, [{ action: 'check_item', id: 'rmat', item_id: 'Relazione', done: true }], NOW - 4 * DAY + 1000);
  const b2 = structuredClone(a); // anche b la vede spuntata
  const lastSync = NOW - 3 * DAY;
  applyOps(a, [{ action: 'check_item', id: 'rmat', item_id: 'Relazione', done: false }], NOW - 2000);
  applyOps(b2, [{ action: 'check_item', id: 'rmat', item_id: 'Mail', done: true }], NOW);
  const list = mergeStates(a, b2, { lastSync, localDirty: true }).recurring.find((x) => x.id === 'rmat').checklist;
  assert.equal(list.find((x) => x.text === 'Relazione').done, false);
  assert.equal(list.find((x) => x.text === 'Mail').done, true);
});
test('sincronizzazione: una voce aggiunta su un lato dopo l\'ultima sincronizzazione resta, una tolta non risorge', () => {
  const [a, b] = pairWithList();
  const lastSync = NOW - DAY;
  applyOps(a, [{ action: 'add_checklist', id: 'rmat', checklist: ['Fattura'] }], NOW - 1000);
  applyOps(b, [{ action: 'remove_check', id: 'rmat', item_id: 'Mail' }], NOW);
  const list = mergeStates(a, b, { lastSync, localDirty: true }).recurring.find((x) => x.id === 'rmat').checklist.map((x) => x.text);
  assert.ok(list.includes('Fattura'), 'la voce nuova non si perde');
  assert.ok(!list.includes('Mail'), 'la voce tolta non torna');
});

// ---- 5. identificativi unici
test('due voci con lo stesso identificativo non restano con lo stesso identificativo', () => {
  const c = cleanChecklist([{ id: 'x', text: 'uno' }, { id: 'x', text: 'due' }]);
  assert.equal(c.length, 2);
  assert.notEqual(c[0].id, c[1].id);
});

// ---- 6. frasi che non sono una lista
test('«dentro» da solo non è una richiesta: la frase non viene dirottata', () => {
  const s = workState();
  for (const f of ['sto lavorando dentro lavoro', 'dentro lavoro', 'ho tante cose da fare nel blocco lavoro oggi', 'oggi lavoro dalle 9, sono dentro il progetto e ho cose da fare']) {
    assert.equal(checklistOps(f, s, TODAY), null, f);
  }
});
test('voci spazzatura («Dentro lavoro», «Cose da fare dentro») non entrano in lista', () => {
  const s = workState();
  for (const f of ['aggiungi cose da fare dentro lavoro', 'metti nelle task di lavoro le cose da fare dentro', 'nella card lavoro: cose da fare dentro']) {
    const r = checklistOps(f, s, TODAY);
    assert.ok(!r?.ops, f + ' → ' + JSON.stringify(r));
    assert.ok(r?.miss, f + ': chi ha chiesto di aggiungere qualcosa riceve una risposta chiara');
  }
  const ok = checklistOps('metti dentro lavoro: relazione, dentro lavoro, chiamare Marco', s, TODAY);
  assert.deepEqual(ok.ops[0].checklist, ['Relazione', 'Chiamare Marco']);
});

// ---- 7. spuntare dall'AI non deve disfare
test('«ho fatto la relazione» detto due volte (AI, senza done) la lascia fatta; il tocco passa done esplicito', () => {
  const s = workState();
  applyOps(s, [{ action: 'add_checklist', id: 'rmat', checklist: ['Relazione'] }], NOW);
  const { ops } = sanitizeOps([{ action: 'check_item', id: 'rmat', item_id: 'Relazione' }]);
  applyOps(s, ops, NOW);
  applyOps(s, ops, NOW + 1000);
  assert.equal(s.recurring[0].checklist[0].done, true);
  applyOps(s, [{ action: 'check_item', id: 'rmat', item_id: 'Relazione', done: false }], NOW + 2000);
  assert.equal(s.recurring[0].checklist[0].done, false);
  // anche l'AI può togliere la spunta: `done` passa il filtro delle operazioni
  const undo = sanitizeOps([{ action: 'check_item', id: 'rmat', item_id: 'Relazione', done: true }, { action: 'check_item', id: 'rmat', item_id: 'Relazione', done: false }]);
  assert.deepEqual(undo.ops.map((o) => o.done), [true, false]);
  applyOps(s, undo.ops, NOW + 3000);
  assert.equal(s.recurring[0].checklist[0].done, false);
});

// ---- seconda rilettura (revisore indipendente)
import { localParse, understoodOf } from '../js/parse.js';

test('sincronizzazione: la prima lista aggiunta qui non si perde se l\'altro lato cambia la stessa carta più tardi', () => {
  const a = workState();
  const b = structuredClone(a);
  const lastSync = NOW - DAY;
  applyOps(a, [{ action: 'add_checklist', id: 'rmat', checklist: ['Relazione'] }], NOW - 5000);
  applyOps(b, [{ action: 'update_recurring', id: 'rmat', color: 'sage' }], NOW);
  const m = mergeStates(a, b, { lastSync, localDirty: true }).recurring.find((x) => x.id === 'rmat');
  assert.equal(m.color, 'sage');
  assert.deepEqual(m.checklist.map((x) => x.text), ['Relazione']);
});

test('sincronizzazione: una voce tolta qui non torna perché l\'altro lato ha modificato la stessa lista dopo', () => {
  const [a, b] = pairWithList();
  const lastSync = NOW - DAY;
  applyOps(a, [{ action: 'remove_check', id: 'rmat', item_id: 'Mail' }], NOW - 5000);
  applyOps(b, [{ action: 'add_checklist', id: 'rmat', checklist: ['Fattura'] }], NOW);
  for (const [x, y] of [[a, b], [b, a]]) {
    const list = mergeStates(x, y, { lastSync, localDirty: true }).recurring.find((r) => r.id === 'rmat').checklist.map((c) => c.text);
    assert.ok(list.includes('Fattura'), 'la voce nuova resta');
    assert.ok(!list.includes('Mail'), 'la voce tolta non risorge');
  }
});

test('un ricorrente salvato prima delle date non risorge dopo essere stato cancellato', () => {
  const legacy = () => migrate({ onboarded: true, items: [], recurring: [{ id: 'rv', title: 'Yoga', start: 420, end: 480, weekdays: [1], skip: [] }] }, NOW);
  const a = legacy(), b = legacy();
  applyOps(a, [{ action: 'remove_recurring', id: 'rv' }], NOW);
  assert.equal(mergeStates(a, b, { lastSync: NOW - DAY, localDirty: true }).recurring.length, 0);
  // alla prima sincronizzazione (lastSync = 0) tutto si tiene
  assert.equal(mergeStates(legacy(), migrate({ onboarded: true }, NOW), { lastSync: 0, localDirty: true }).recurring.length, 1);
});

test('forme di cortesia («puoi mettere dentro lavoro…») non diventano attività', () => {
  const s = workState();
  for (const f of ['puoi mettere dentro lavoro delle cose da fare?', 'vorrei mettere dentro lavoro delle task', 'ora metti dentro lavoro le task']) {
    const r = checklistOps(f, s, TODAY);
    assert.ok(r?.miss && !r.ops, f + ' → ' + JSON.stringify(r));
    const p = localParse(f, s, NOW);
    assert.ok(!(p.ops || []).length, f + ': nessuna attività creata');
  }
});

test('«Salta ricorrenza» passa da applyOps e aggiorna updatedAt', () => {
  const s = workState();
  applyOps(s, [{ action: 'remove_recurring', id: 'rmat', date: '2026-10-14' }], NOW);
  assert.deepEqual(s.recurring[0].skip, ['2026-10-14']);
  assert.equal(s.recurring[0].updatedAt, NOW);
});

test('la spunta tolta si racconta come tolta', () => {
  const s = workState();
  const out = understoodOf([{ action: 'check_item', id: 'rmat', item_id: 'Relazione', done: false }, { action: 'check_item', id: 'rmat', item_id: 'Mail' }], s, TODAY);
  assert.match(out[0], /^Spunta tolta/);
  assert.match(out[1], /^Fatta/);
});
