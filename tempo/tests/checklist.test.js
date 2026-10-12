import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localParse, splitList, checklistOps, understoodOf } from '../js/parse.js';
import { migrate, applyOps, sanitizeOps, cleanChecklist, checklistOwner } from '../js/store.js';
import { planDays, fmtMin } from '../js/scheduler.js';
import * as vm from '../js/viewmodel.js';
import { mergeStates } from '../js/cloud.js';
import { stateForModel } from '../js/ai.js';

const NOW = Date.parse('2026-10-12T10:00:00'); // lunedì
const TODAY = '2026-10-12';

function workState() {
  return migrate({
    onboarded: true, items: [],
    recurring: [
      { id: 'rmat', title: 'Lavoro', start: 540, end: 780, weekdays: [1, 2, 3, 4, 5], skip: [] },
      { id: 'rpom', title: 'Lavoro', start: 870, end: 1110, weekdays: [1, 2, 3, 4, 5], skip: [] },
    ],
  }, NOW);
}
const blocksOf = (s, day = TODAY) => planDays(s, NOW, 3)[day].blocks.map((b) => `${fmtMin(b.start)} ${b.item.title}`);

test('il caso reale: «metti dentro la card di lavoro le task che ho da fare: …» non crea attività sparse', () => {
  const s = workState();
  const frase = 'metti dentro la card di lavoro le task che ho da fare: preparare la relazione, rispondere alle mail, chiamare Marco';
  const r = localParse(frase, s, NOW);
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].action, 'add_checklist');
  assert.deepEqual(r.ops[0].checklist, ['Preparare la relazione', 'Rispondere alle mail', 'Chiamare Marco']);
  assert.equal(r.simple, true, 'la gestisce il codice, senza bisogno di AI');
  const before = blocksOf(s);
  applyOps(s, r.ops, NOW);
  assert.deepEqual(blocksOf(s), before, 'il piano non cambia: niente carte esterne');
  assert.equal(s.items.length, 0);
  // vince il Lavoro che c'è oggi, il primo della giornata
  assert.equal(s.recurring.find((x) => x.id === 'rmat').checklist.length, 3);
  assert.equal(s.recurring.find((x) => x.id === 'rpom').checklist, undefined);
});

test('altre forme di dirlo', () => {
  const s = workState();
  for (const f of [
    'dentro lavoro devo fare: relazione, mail, chiamare Marco',
    'aggiungi alla card lavoro le cose da fare: relazione; mail; chiamare Marco',
    'nel blocco lavoro ho da fare relazione, mail e chiamare Marco',
    'metti dentro lavoro preparare la relazione e rispondere alle mail',
  ]) {
    const r = localParse(f, s, NOW);
    assert.equal(r.ops?.[0]?.action, 'add_checklist', f);
    assert.ok(r.ops[0].checklist.length >= 2, f + ' → ' + JSON.stringify(r.ops[0].checklist));
  }
});

test('«e» divide solo davanti a un verbo', () => {
  assert.deepEqual(splitList('comprare pane e latte, chiamare Anna e rispondere a Luca'), ['Comprare pane e latte', 'Chiamare Anna', 'Rispondere a Luca']);
  assert.deepEqual(splitList('- relazione\n- mail.\n- relazione'), ['Relazione', 'Mail']);
  assert.deepEqual(splitList(' , ; '), []);
});

test('so dove ma non cosa: lo dice, non inventa attività', () => {
  const s = workState();
  const r = localParse('metti dentro la card di lavoro le task', s, NOW);
  assert.equal(r.ops, undefined);
  assert.match(r.reply, /Lavoro/);
  assert.match(r.reply, /due punti/);
});

test('le frasi normali non vengono toccate', () => {
  const s = workState();
  assert.equal(checklistOps('domani alle 16 call con Marco', s, TODAY), null);
  assert.equal(checklistOps('oggi lavoro fino alle 18', s, TODAY), null);
  assert.equal(checklistOps('metti dentro la card di cena le patate', s, TODAY), null, 'nessun impegno che si chiama cena');
  const r = localParse('domani devo preparare la relazione e rispondere alle mail', s, NOW);
  assert.ok(r.ops.every((o) => o.action !== 'add_checklist'));
});

test('anche gli impegni con orario possono avere una lista', () => {
  const s = workState();
  applyOps(s, [{ action: 'add', kind: 'event', title: 'Riunione', date: '2026-10-13', start_time: '15:00', end_time: '16:00' }], NOW);
  const r = localParse('metti dentro la riunione di domani: slide, budget', s, NOW);
  assert.equal(r.ops[0].action, 'add_checklist');
  applyOps(s, r.ops, NOW);
  const ev = s.items.find((x) => x.title === 'Riunione');
  assert.deepEqual(ev.checklist.map((c) => c.text), ['Slide', 'Budget']);
});

test('spuntare, togliere, non duplicare, annullare le doppie', () => {
  const s = workState();
  applyOps(s, [{ action: 'add_checklist', id: 'rmat', checklist: ['Relazione', 'Mail'] }], NOW);
  applyOps(s, [{ action: 'add_checklist', id: 'Lavoro', checklist: ['relazione', 'Chiamare Marco'] }], NOW);
  const r = s.recurring.find((x) => x.id === 'rmat');
  assert.deepEqual(r.checklist.map((c) => c.text), ['Relazione', 'Mail', 'Chiamare Marco']);
  const first = r.checklist[0].id;
  applyOps(s, [{ action: 'check_item', id: 'rmat', item_id: first }], NOW + 1);
  assert.equal(r.checklist[0].done, true);
  assert.equal(r.updatedAt, NOW + 1);
  applyOps(s, [{ action: 'check_item', id: 'rec:rmat:2026-10-12', item_id: first }], NOW + 2); // anche con l'id della carta
  assert.equal(r.checklist[0].done, false);
  applyOps(s, [{ action: 'remove_check', id: 'rmat', item_id: 'Mail' }], NOW + 3);
  assert.deepEqual(r.checklist.map((c) => c.text), ['Relazione', 'Chiamare Marco']);
  const res = applyOps(s, [{ action: 'add_checklist', id: 'Non esiste', checklist: ['x1'] }], NOW);
  assert.match(res.errors[0], /Non trovo/);
});

test('input ostile dall\'AI: solo testo, lunghezze e quantità limitate', () => {
  const evil = sanitizeOps([
    { action: 'add_checklist', id: 'rmat', checklist: ['<img src=x onerror=alert(1)>', 'a'.repeat(500), 5, null, ...Array.from({ length: 60 }, (_, i) => 'voce ' + i)] },
    { action: 'add_checklist', checklist: ['senza bersaglio'] },
    { action: 'add_checklist', id: 'rmat', checklist: [] },
    { action: 'check_item', id: 'rmat' },
  ]);
  assert.equal(evil.ops.length, 1);
  assert.equal(evil.dropped, 3);
  const items = cleanChecklist(evil.ops[0].checklist);
  assert.ok(items.length <= 30);
  assert.ok(items.every((c) => c.text.length <= 80));
  // il testo resta testo: è la schermata a farne l'escape (verificato nel browser)
  assert.equal(cleanChecklist([{ id: '"><x', text: 'ok', done: 1 }])[0].done, true);
  assert.match(cleanChecklist([{ id: '"><x', text: 'ok' }])[0].id, /^[A-Za-z0-9_:-]+$/);
});

test('un backup con liste sporche viene ripulito', () => {
  const s = migrate({ onboarded: true, items: [], recurring: [{ id: 'r1', title: 'Lavoro', start: 540, end: 780, weekdays: [1], checklist: [{ id: 'a b', text: '  ciao  ', done: 'sì' }, 'x', { text: 'ok' }, 42] }] }, NOW);
  assert.deepEqual(s.recurring[0].checklist.map((c) => c.text), ['ciao', 'ok']);
  assert.ok(s.recurring[0].checklist.every((c) => /^[A-Za-z0-9_:-]{1,64}$/.test(c.id)));
});

test('la carta del giorno porta la lista; durante il lavoro la porta il riquadro «Adesso»', () => {
  const s = workState();
  applyOps(s, [{ action: 'add_checklist', id: 'rmat', checklist: ['Relazione', 'Mail'] }], NOW);
  // alle 8, prima del lavoro: una carta sola con la lista
  const early = Date.parse('2026-10-12T08:00:00');
  const plan = planDays(s, early, 3);
  const v = vm.today({ state: s, plan, now: early, fits: {}, env: {} });
  const withList = v.cards.filter((c) => c.type === 'event' && c.title === 'Lavoro' && c.checklist);
  assert.equal(withList.length, 1, 'la lista sta su una carta sola, non su entrambe');
  assert.equal(withList[0].start, '09:00');
  assert.equal(withList[0].ownerId, 'rmat');
  assert.deepEqual(withList[0].checklist.map((c) => c.text), ['Relazione', 'Mail']);
  // alle 10 il blocco di lavoro è in corso: non è tra le carte, e la lista deve vedersi nel riquadro «Adesso»
  const plan2 = planDays(s, NOW, 3);
  const v2 = vm.today({ state: s, plan: plan2, now: NOW, fits: {}, env: {} });
  assert.ok(!v2.cards.some((c) => c.title === 'Lavoro' && c.start === '09:00'));
  assert.equal(v2.now.block.title, 'Lavoro');
  assert.deepEqual(v2.now.block.checklist.map((c) => c.text), ['Relazione', 'Mail']);
  assert.equal(v2.now.block.ownerId, 'rmat');
  // il giorno dopo la lista c'è ancora
  const domani = vm.today({ state: s, plan: plan2, now: NOW, fits: {}, env: {}, day: '2026-10-13' });
  assert.ok(domani.cards.some((c) => c.checklist));
});

test('elenco con «;» o con un punto elenco per riga: resta una lista sola', () => {
  const s = workState();
  const r1 = localParse('aggiungi alla card lavoro le cose da fare: relazione; mail; chiamare Marco', s, NOW);
  assert.equal(r1.ops.length, 1);
  assert.deepEqual(r1.ops[0].checklist, ['Relazione', 'Mail', 'Chiamare Marco']);
  const r2 = localParse('metti dentro lavoro le cose da fare:\n- relazione\n- mail\n- chiamare Marco', s, NOW);
  assert.equal(r2.ops.length, 1);
  assert.deepEqual(r2.ops[0].checklist, ['Relazione', 'Mail', 'Chiamare Marco']);
  // due frasi diverse nello stesso messaggio: la seconda resta una frase a sé
  const r3 = localParse('metti dentro lavoro le cose da fare: relazione, mail. domani alle 16 call con Marco', s, NOW);
  assert.equal(r3.ops[0].action, 'add_checklist');
  assert.ok(r3.ops.some((o) => o.action === 'add' && /call/i.test(o.title)));
});

test('lo dice a parole, e l\'AI vede la lista', () => {
  const s = workState();
  const r = localParse('dentro lavoro devo fare: relazione, mail', s, NOW);
  assert.deepEqual(understoodOf(r.ops, s, TODAY), ['Lista · Lavoro · Relazione, Mail']);
  applyOps(s, r.ops, NOW);
  const m = stateForModel(s, planDays(s, NOW, 2), NOW);
  assert.match(JSON.stringify(m.impegni_ricorrenti), /lista: ○ Relazione/);
});

test('sincronizzazione: la lista spuntata qui non si perde se l\'altro dispositivo ha lo stesso impegno', () => {
  const a = workState(), b = workState();
  applyOps(a, [{ action: 'add_checklist', id: 'rmat', checklist: ['Relazione'] }], NOW);
  b.recurring = structuredClone(a.recurring);
  applyOps(a, [{ action: 'check_item', id: 'rmat', item_id: 'Relazione' }], NOW + 5000);
  const m = mergeStates(a, b, { lastSync: NOW, localDirty: true });
  assert.equal(m.recurring.find((x) => x.id === 'rmat').checklist[0].done, true);
  assert.equal(checklistOwner(a, 'Lavoro', TODAY).id, 'rmat');
});
