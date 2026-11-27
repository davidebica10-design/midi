// Inviti senza server (js/invite.js). Ogni token decodificato è input ostile di uno sconosciuto.
// Orari sempre in UTC o con fuso IANA esplicito: la suite dà lo stesso esito con TZ=UTC e TZ=Asia/Tokyo.
// Non si importa helpers.js perché imposta TZ del processo.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeInvite, makeReply, encodeInvite, inviteText, findInvite, sanitizeInvite,
  localSlot, fitInvite, inviteOp, icsOf,
} from '../js/invite.js';
import { emptyState, applyOps, sanitizeOps } from '../js/store.js';

const NOW = Date.UTC(2026, 9, 12, 8, 0); // lunedì 12 ottobre 2026, 08:00 UTC
const ROME = 'Europe/Rome';
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const tokenOf = (o) => 'tempo:inv1:' + b64u(JSON.stringify(o));
const clone = (x) => JSON.parse(JSON.stringify(x));

const base = (extra = {}) => ({
  title: 'Cena da Anna', date: '2026-10-14', start: 18 * 60, end: 19 * 60, tz: ROME, from: 'Marco', note: '', ...extra,
});
const mk = (extra, id = 'inv-1') => makeInvite(base(extra), { id, now: NOW });
const raw = (extra = {}) => ({ v: 1, kind: 'proposta', id: 'x1', t: 'Caffè', d: '2026-10-14', s: 1080, e: 1140, tz: ROME, ts: Date.UTC(2026, 9, 14, 16, 0), from: 'Marco', note: '', ...extra });

// ---------- giro completo

test('proposta: makeInvite → encodeInvite → inviteText → findInvite restituisce la stessa proposta', () => {
  const p = mk({ note: 'Porto il vino' });
  assert.ok(p);
  assert.equal(p.kind, 'proposta');
  assert.equal(p.ts, Date.UTC(2026, 9, 14, 16, 0));
  const back = findInvite(inviteText(p, { baseUrl: 'https://x.example/tempo/' }), NOW);
  assert.deepEqual(back, p);
});

test('proposta: accenti, emoji, virgolette e «<b>» nel titolo sopravvivono al giro (le parentesi angolari no)', () => {
  const p = mk({ title: 'Caffè «da Zoë» 🍕 "ok" <b>grassetto</b>', note: 'Perché sì: è già l\'ora' });
  assert.ok(p);
  assert.ok(!/[<>]/.test(p.t));
  assert.ok(p.t.includes('Caffè «da Zoë» 🍕 "ok"'));
  assert.deepEqual(findInvite(inviteText(p), NOW), p);
  assert.deepEqual(findInvite(encodeInvite(p), NOW), p);
});

test('proposta: titolo, nota e mittente lunghissimi vengono accorciati (80, 140, 40)', () => {
  const p = mk({ title: 'a'.repeat(5000), note: 'n'.repeat(5000), from: 'f'.repeat(5000) });
  assert.equal(p.t.length, 80);
  assert.equal(p.note.length, 140);
  assert.equal(p.from.length, 40);
  assert.deepEqual(findInvite(inviteText(p), NOW), p);
});

test('proposta: dati non validi → null (titolo vuoto, fuso falso, data falsa, orario rovesciato)', () => {
  assert.equal(mk({ title: '   ' }), null);
  assert.equal(mk({ title: '<>' }), null);
  assert.equal(mk({ tz: 'Marte/Olympus' }), null);
  assert.equal(mk({ date: '2026-02-30' }), null);
  assert.equal(mk({ start: 600, end: 600 }), null);
  assert.equal(makeInvite(null, { id: 'a' }), null);
  assert.equal(makeInvite(base(), { id: 'con spazi' }), null);
  assert.equal(makeInvite(base(), {}), null);
});

test('risposta si/no: giro completo e riferimento alla proposta', () => {
  const p = mk();
  for (const answer of ['si', 'no']) {
    const r = makeReply(p, { answer, from: 'Anna' }, { id: 'r-' + answer, now: NOW });
    assert.ok(r);
    assert.equal(r.kind, 'risposta');
    assert.equal(r.re, p.id);
    assert.equal(r.ans, answer);
    assert.deepEqual(r.alt, []);
    assert.deepEqual(findInvite(inviteText(r), NOW), r);
  }
});

test('risposta «altro»: da 1 a 3 alternative nel fuso della proposta, con la durata della proposta', () => {
  const p = mk();
  for (const n of [1, 2, 3]) {
    const alts = Array.from({ length: n }, (_, i) => ({ ts: Date.UTC(2026, 9, 15 + i, 17, 0) }));
    const r = makeReply(p, { answer: 'altro', alternatives: alts }, { id: 'r', now: NOW });
    assert.equal(r.alt.length, n);
    for (const a of r.alt) assert.equal(a.e - a.s, 60);
    assert.deepEqual(r.alt[0], { d: '2026-10-15', s: 19 * 60, e: 20 * 60, ts: Date.UTC(2026, 9, 15, 17, 0) });
    assert.deepEqual(findInvite(inviteText(r), NOW), r);
  }
});

test('risposta «altro»: più di 3 alternative → ne restano 3; alternative senza ts valido scartate', () => {
  const p = mk();
  const alts = Array.from({ length: 7 }, (_, i) => ({ ts: Date.UTC(2026, 9, 15 + (i % 5), 17, 0) }));
  const r = makeReply(p, { answer: 'altro', alternatives: [{ ts: 'x' }, null, {}, ...alts] }, { id: 'r', now: NOW });
  assert.equal(r.alt.length, 3);
  assert.equal(makeReply(p, { answer: 'forse' }, { id: 'r' }), null);
  assert.equal(makeReply({ ...p, kind: 'risposta' }, { answer: 'si' }, { id: 'r' }), null);
  assert.equal(makeReply(null, { answer: 'si' }, { id: 'r' }), null);
});

test('risposta «si» ignora le alternative passate', () => {
  const p = mk();
  const r = makeReply(p, { answer: 'si', alternatives: [{ ts: Date.UTC(2026, 9, 15, 17, 0) }] }, { id: 'r', now: NOW });
  assert.deepEqual(r.alt, []);
});

// ---------- findInvite: tolleranza

test('findInvite: token da solo', () => {
  const p = mk();
  assert.deepEqual(findInvite(encodeInvite(p), NOW), p);
});

test('findInvite: token dentro un messaggio di chat con testo prima e dopo', () => {
  const p = mk();
  const t = encodeInvite(p);
  assert.deepEqual(findInvite(`Ciao! Guarda qui sotto\n[${t}]\ngrazie, a presto`, NOW), p);
  assert.deepEqual(findInvite(`${t} grazie mille`, NOW), p);
});

test('findInvite: token spezzato su più righe', () => {
  const p = mk({ note: 'x'.repeat(100) });
  const t = encodeInvite(p);
  const wrapped = t.replace(/(.{30})/g, '$1\n');
  assert.deepEqual(findInvite(`Messaggio\n${wrapped}\nfine`, NOW), p);
  assert.deepEqual(findInvite(t.replace(/(.{20})/g, '$1\r\n  '), NOW), p);
});

test('findInvite: punteggiatura finale o parentesi di chiusura mancante', () => {
  const p = mk();
  const t = encodeInvite(p);
  assert.deepEqual(findInvite(`[${t}`, NOW), p);
  assert.deepEqual(findInvite(`(${t}).`, NOW), p);
  assert.deepEqual(findInvite(`${t}!!!`, NOW), p);
  assert.deepEqual(findInvite(`"${t}",`, NOW), p);
});

test('findInvite: indirizzo con #invito= (anche con codifica %XX)', () => {
  const p = mk();
  const short = encodeInvite(p).slice('tempo:inv1:'.length);
  assert.deepEqual(findInvite(`https://x.example/tempo/#invito=${short}`, NOW), p);
  assert.deepEqual(findInvite(`https://x.example/tempo/#invito=${encodeURIComponent('tempo:inv1:' + short)}`, NOW), p);
  assert.deepEqual(findInvite(encodeURIComponent(`https://x.example/#invito=${short}`), NOW), p);
  assert.deepEqual(findInvite(`#invito=tempo:inv1:${short}`, NOW), p);
});

test('findInvite: con due token vince il primo', () => {
  const a = mk({ title: 'Primo' }, 'a1');
  const b = mk({ title: 'Secondo' }, 'b1');
  assert.equal(findInvite(`${encodeInvite(a)}\n\n${encodeInvite(b)}`, NOW).t, 'Primo');
  assert.equal(findInvite(`[${encodeInvite(b)}] e poi [${encodeInvite(a)}]`, NOW).t, 'Secondo');
});

test('findInvite: un primo token rotto non impedisce di trovare il secondo valido', () => {
  const p = mk();
  assert.deepEqual(findInvite(`tempo:inv1:AAAA\n${encodeInvite(p)}`, NOW), p);
});

test('findInvite: nessun token, testo vuoto, tipi sbagliati → null', () => {
  for (const x of ['', 'ciao a tutti', 'tempo:inv1:', '#invito=', 'tempo:inv1:!!!', null, undefined, 42, {}, []]) assert.equal(findInvite(x, NOW), null);
});

test('findInvite: testo enorme senza token resta veloce e dà null', () => {
  assert.equal(findInvite('tempo:inv1:' + 'A'.repeat(200000), NOW), null);
  assert.equal(findInvite('a '.repeat(100000), NOW), null);
});

// ---------- sanitizeInvite: input ostile

test('sanitizeInvite: accetta un oggetto valido e lo restituisce pulito', () => {
  const o = sanitizeInvite(raw(), NOW);
  assert.ok(o);
  assert.deepEqual(Object.keys(o).sort(), ['d', 'e', 'from', 'id', 'kind', 'note', 's', 't', 'ts', 'tz', 'v']);
});

test('sanitizeInvite: versione, genere e id sbagliati', () => {
  for (const v of [0, 2, '1', null, undefined]) assert.equal(sanitizeInvite(raw({ v }), NOW), null);
  for (const kind of ['altro', '', null, 5, ['proposta']]) assert.equal(sanitizeInvite(raw({ kind }), NOW), null);
  for (const id of ['', 'a b', 'a'.repeat(65), '../x', '<x>', 5, null, undefined, 'é']) assert.equal(sanitizeInvite(raw({ id }), NOW), null);
});

test('sanitizeInvite: campi mancanti o di tipo sbagliato', () => {
  for (const k of ['t', 'd', 's', 'e', 'tz', 'id', 'v', 'kind']) {
    const r = raw(); delete r[k];
    assert.equal(sanitizeInvite(r, NOW), null, 'manca ' + k);
  }
  assert.equal(sanitizeInvite(raw({ s: '1080' }), NOW), null);
  assert.equal(sanitizeInvite(raw({ e: 1140.5 }), NOW), null);
  assert.equal(sanitizeInvite(raw({ s: NaN }), NOW), null);
  assert.equal(sanitizeInvite(raw({ e: Infinity }), NOW), null);
  assert.equal(sanitizeInvite(raw({ t: { x: 1 } }), NOW), null);
  assert.equal(sanitizeInvite(raw({ t: ['a'] }), NOW), null);
  assert.equal(sanitizeInvite(raw({ d: 20261014 }), NOW), null);
  assert.equal(sanitizeInvite(raw({ tz: 5 }), NOW), null);
});

test('sanitizeInvite: date che non esistono o fuori misura', () => {
  for (const d of ['2026-02-30', '2026-13-01', '9999-99-99', '2026-00-10', '2026-1-1', '26-10-14', '2026-10-14T10:00', '1969-12-31', '']) {
    assert.equal(sanitizeInvite(raw({ d }), NOW), null, d);
  }
});

test('sanitizeInvite: data troppo lontana o nel passato rispetto a now', () => {
  const at = (y, m, d) => { const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return raw({ d: ds, ts: Date.UTC(y, m - 1, d, 16, 0) - 2 * 3600e3 + 2 * 3600e3 }); };
  assert.equal(sanitizeInvite(at(2026, 10, 14), NOW) !== null, true);
  assert.equal(sanitizeInvite(at(2028, 10, 14), NOW), null, 'oltre 400 giorni');
  assert.equal(sanitizeInvite(at(2026, 9, 1), NOW), null, 'un mese fa');
  assert.ok(sanitizeInvite(at(2026, 9, 1)), 'senza now la data passata è accettata');
  assert.ok(sanitizeInvite(at(2028, 10, 14)), 'senza now la data lontana è accettata');
});

test('sanitizeInvite: s ≥ e, e > 1440, durata < 5, s negativo', () => {
  assert.equal(sanitizeInvite(raw({ s: 600, e: 600 }), NOW), null);
  assert.equal(sanitizeInvite(raw({ s: 700, e: 600 }), NOW), null);
  assert.equal(sanitizeInvite(raw({ s: 1080, e: 1441 }), NOW), null);
  assert.equal(sanitizeInvite(raw({ s: 1080, e: 1084 }), NOW), null);
  assert.ok(sanitizeInvite(raw({ s: 1080, e: 1085 }), NOW));
  assert.equal(sanitizeInvite(raw({ s: -10, e: 60 }), NOW), null);
  assert.ok(sanitizeInvite(raw({ s: 1380, e: 1440, ts: Date.UTC(2026, 9, 14, 21, 0) }), NOW));
});

test('sanitizeInvite: fuso non valido', () => {
  for (const tz of ['Marte/Olympus', '', 'x'.repeat(100), 'Europe/Rome; drop', '<script>', 'Europe/Rome\n', null]) {
    assert.equal(sanitizeInvite(raw({ tz }), NOW), null, String(tz));
  }
});

test('sanitizeInvite: ts incoerente con d/s/tz viene ricalcolato, non creduto', () => {
  const good = Date.UTC(2026, 9, 14, 16, 0);
  for (const ts of [good + 3600e3, good - 24 * 3600e3, 0, -1, 'x', null, undefined, NaN, 1e300]) {
    const o = sanitizeInvite(raw({ ts }), NOW);
    assert.ok(o, String(ts));
    assert.equal(o.ts, good, 'ts ricalcolato da d/s/tz per ' + String(ts));
  }
  assert.equal(sanitizeInvite(raw({ ts: good + 30e3 }), NOW).ts, good + 30e3, 'differenza entro un minuto: tollerata');
});

test('sanitizeInvite: alternative non valide scartate, al massimo 3', () => {
  const r = { ...raw({ kind: 'risposta', re: 'p1', ans: 'altro' }),
    alt: [
      { d: '2026-10-15', s: 1020, e: 1080, ts: Date.UTC(2026, 9, 15, 15, 0) },
      { d: '2026-02-30', s: 1020, e: 1080 },
      { d: '2026-10-16', s: 1100, e: 1000 },
      'x',
      { d: '2026-10-17', s: 1020, e: 1080 },
      { d: '2026-10-18', s: 1020, e: 1080 },
      { d: '2026-10-19', s: 1020, e: 1080 },
    ] };
  const o = sanitizeInvite(r, NOW);
  assert.equal(o.alt.length, 3);
  assert.deepEqual(o.alt.map((a) => a.d), ['2026-10-15', '2026-10-17', '2026-10-18']);
  assert.deepEqual(sanitizeInvite({ ...r, alt: 'x' }, NOW).alt, []);
  assert.deepEqual(sanitizeInvite({ ...r, ans: 'si' }, NOW).alt, [], 'con «si» le alternative non contano');
  assert.equal(sanitizeInvite({ ...r, ans: 'forse' }, NOW), null);
  assert.equal(sanitizeInvite({ ...r, re: '<x>' }, NOW), null);
  assert.equal(sanitizeInvite({ ...r, re: undefined }, NOW), null);
});

test('sanitizeInvite: chiavi sconosciute eliminate', () => {
  const o = sanitizeInvite(raw({ evil: 'x', admin: true, onclick: 'alert(1)', html: '<img>' }), NOW);
  assert.ok(o);
  for (const k of ['evil', 'admin', 'onclick', 'html']) assert.ok(!(k in o));
  assert.ok(!('alt' in o) && !('re' in o) && !('ans' in o), 'una proposta non ha campi di risposta');
});

test('sanitizeInvite: __proto__ e constructor non inquinano Object.prototype', () => {
  const json = '{"v":1,"kind":"proposta","id":"x1","t":"Caffè","d":"2026-10-14","s":1080,"e":1140,"tz":"Europe/Rome",' +
    '"__proto__":{"polluted":"si"},"constructor":{"prototype":{"polluted2":"si"}},"from":"M","note":""}';
  const o = findInvite('tempo:inv1:' + b64u(json), NOW);
  assert.ok(o);
  assert.equal({}.polluted, undefined);
  assert.equal({}.polluted2, undefined);
  assert.equal(Object.getPrototypeOf(o), Object.prototype);
  assert.ok(!Object.hasOwn(o, '__proto__') && !Object.hasOwn(o, 'constructor'));
  const viaObj = sanitizeInvite(JSON.parse(json), NOW);
  assert.ok(viaObj);
  assert.equal({}.polluted, undefined);
  assert.equal(sanitizeInvite(raw({ id: '__proto__' }), NOW)?.id, '__proto__', 'è solo una stringa id valida');
  assert.equal({}.polluted, undefined);
});

test('token oltre 4 kB decodificati → null', () => {
  const big = JSON.stringify({ ...raw(), pad: 'z'.repeat(5000) });
  assert.equal(findInvite('tempo:inv1:' + b64u(big), NOW), null);
  const ok = JSON.stringify({ ...raw(), pad: 'z'.repeat(1000) });
  assert.ok(findInvite('tempo:inv1:' + b64u(ok), NOW), 'sotto il limite passa (la chiave in più cade)');
});

test('base64 non valido, UTF-8 non valido, JSON che non è un oggetto → null', () => {
  assert.equal(findInvite('tempo:inv1:a', NOW), null);
  assert.equal(findInvite('tempo:inv1:abcde', NOW), null, 'lunghezza 1 mod 4');
  assert.equal(findInvite('tempo:inv1:' + '-_-_'.repeat(10), NOW), null);
  const badUtf8 = Buffer.concat([Buffer.from('{"v":1,"t":"'), Buffer.from([0xff, 0xfe, 0xc0, 0x80]), Buffer.from('"}')]).toString('base64url');
  assert.equal(findInvite('tempo:inv1:' + badUtf8, NOW), null);
  const validBytes = Buffer.from(JSON.stringify(raw()));
  const withBad = Buffer.concat([validBytes.subarray(0, validBytes.length - 1), Buffer.from([0xff]), Buffer.from('}')]).toString('base64url');
  assert.equal(findInvite('tempo:inv1:' + withBad, NOW), null);
  for (const j of ['[]', '[1,2]', '42', 'null', '"testo"', 'true', '{', '', '{"v":1}']) assert.equal(findInvite('tempo:inv1:' + b64u(j), NOW), null, j);
  assert.equal(sanitizeInvite([], NOW), null);
  assert.equal(sanitizeInvite(5, NOW), null);
  assert.equal(sanitizeInvite(null, NOW), null);
  assert.equal(sanitizeInvite('x', NOW), null);
  assert.equal(sanitizeInvite(undefined), null);
});

test('caratteri di controllo e parentesi angolari tolti da titolo, nota e mittente', () => {
  const o = sanitizeInvite(raw({
    t: 'A\u0000B\u0007C\nD\tE‮F​G<script>alert(1)</script>',
    note: 'riga1\r\nriga2\u0085<img src=x onerror=1>',
    from: '<b>Mario</b>\u0001',
  }), NOW);
  assert.ok(o);
  for (const s of [o.t, o.note, o.from]) {
    assert.ok(!/[\u0000-\u001f\u007f-\u009f​-‏‪-‮<>]/.test(s), JSON.stringify(s));
    assert.ok(!/\s{2,}/.test(s) && s === s.trim());
  }
  assert.equal(sanitizeInvite(raw({ t: '\u0000\u0001<>' }), NOW), null, 'titolo che si svuota → scartato');
});

test('sanitizeInvite non modifica l\'oggetto in ingresso', () => {
  const r = raw({ extra: { a: 1 }, t: 'A<b>' });
  const snap = clone(r);
  sanitizeInvite(r, NOW);
  assert.deepEqual(r, snap);
});

// ---------- fuzz con seme

function prng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const validShape = (o) => {
  if (o === null) return true;
  const again = sanitizeInvite(o, NOW);
  assert.ok(again, 'il risultato deve essere a sua volta valido');
  assert.deepEqual(again, o, 'sanitizeInvite è idempotente');
  assert.ok(o.t.length >= 1 && o.t.length <= 80 && !/[<>]/.test(o.t));
  assert.ok(Number.isInteger(o.s) && Number.isInteger(o.e) && o.s >= 0 && o.e <= 1440 && o.e - o.s >= 5);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(o.d));
  if (o.kind === 'risposta') assert.ok(o.alt.length <= 3);
  return true;
};

test('fuzz: 500 stringhe casuali (seme fisso) non lanciano mai e danno null o un invito valido', () => {
  const rnd = prng(20261012);
  const alphabet = 'abcXYZ019-_=+/ :#%\n\r\t<>"\'\\{}[]é€🍕invito=tempo:inv1:';
  for (let i = 0; i < 500; i++) {
    const len = Math.floor(rnd() * 200);
    let s = rnd() < 0.5 ? 'tempo:inv1:' : '';
    for (let k = 0; k < len; k++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    let r;
    assert.doesNotThrow(() => { r = findInvite(s, NOW); }, JSON.stringify(s));
    validShape(r);
    assert.doesNotThrow(() => sanitizeInvite(s, NOW));
  }
});

test('fuzz: 500 mutazioni casuali (seme fisso) di un token valido non lanciano mai', () => {
  const rnd = prng(424242);
  const reply = makeReply(mk(), { answer: 'altro', alternatives: [{ ts: Date.UTC(2026, 9, 15, 17, 0) }, { ts: Date.UTC(2026, 9, 16, 17, 0) }] }, { id: 'r1', now: NOW });
  const tokens = [encodeInvite(mk({ note: 'ciao' })), encodeInvite(reply)];
  let validi = 0;
  for (let i = 0; i < 500; i++) {
    let t = tokens[i % 2];
    const n = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const pos = Math.floor(rnd() * t.length), kind = Math.floor(rnd() * 4);
      const ch = 'AZaz09-_=!<\n é'[Math.floor(rnd() * 14)];
      if (kind === 0) t = t.slice(0, pos) + ch + t.slice(pos + 1);
      else if (kind === 1) t = t.slice(0, pos) + t.slice(pos + 1);
      else if (kind === 2) t = t.slice(0, pos) + ch + t.slice(pos);
      else t = t.slice(0, pos);
    }
    let r;
    assert.doesNotThrow(() => { r = findInvite(t, NOW); }, t);
    validShape(r);
    if (r) validi++;
    // anche l'oggetto JSON mutato nei valori
    assert.doesNotThrow(() => sanitizeInvite({ ...raw(), [['t', 's', 'e', 'tz', 'd', 'ts', 'id'][i % 7]]: [null, undefined, NaN, -1, 1e9, {}, [], 'x'.repeat(300), '\u0000'][Math.floor(rnd() * 9)] }, NOW));
  }
  assert.ok(validi >= 0);
});

// ---------- fusi orari

test('Europe/Rome 18:00 letto a Tokyo (estate: 01:00 del giorno dopo; inverno: 02:00) e a Los Angeles', () => {
  const summer = mk();
  assert.deepEqual(localSlot(summer, 'Asia/Tokyo'), { d: '2026-10-15', s: 60, e: 120 });
  assert.deepEqual(localSlot(summer, 'America/Los_Angeles'), { d: '2026-10-14', s: 9 * 60, e: 10 * 60 });
  assert.deepEqual(localSlot(summer, ROME), { d: '2026-10-14', s: 1080, e: 1140 });
  const winter = makeInvite(base({ date: '2026-12-14' }), { id: 'w', now: NOW });
  assert.deepEqual(localSlot(winter, 'Asia/Tokyo'), { d: '2026-12-15', s: 2 * 60, e: 3 * 60 });
  assert.deepEqual(localSlot(winter, 'America/Los_Angeles'), { d: '2026-12-14', s: 9 * 60, e: 10 * 60 });
  assert.equal(winter.ts, Date.UTC(2026, 11, 14, 17, 0));
});

test('fusi con scarto non intero (Kolkata, Kathmandu) e fusi invalidi', () => {
  const p = mk();
  assert.deepEqual(localSlot(p, 'Asia/Kolkata'), { d: '2026-10-14', s: 21 * 60 + 30, e: 22 * 60 + 30 });
  assert.deepEqual(localSlot(p, 'Asia/Kathmandu'), { d: '2026-10-14', s: 21 * 60 + 45, e: 22 * 60 + 45 });
  assert.equal(localSlot(p, 'Marte/Olympus'), null);
  assert.equal(localSlot(p, undefined), null);
  assert.equal(localSlot(null, ROME), null);
});

test('cambio ora legale europeo: 28 marzo e 31 ottobre 2027 (giorni di 23 e 25 ore)', () => {
  const at = (date, start) => makeInvite(base({ date, start, end: start + 60 }), { id: 'd', now: Date.UTC(2027, 0, 1) });
  // 28 marzo 2027: 10:00 locale è già CEST (UTC+2)
  assert.equal(at('2027-03-28', 600).ts, Date.UTC(2027, 2, 28, 8, 0));
  // il giorno prima è ancora CET (UTC+1)
  assert.equal(at('2027-03-27', 600).ts, Date.UTC(2027, 2, 27, 9, 0));
  // 31 ottobre 2027: 10:00 locale è già CET (UTC+1)
  assert.equal(at('2027-10-31', 600).ts, Date.UTC(2027, 9, 31, 9, 0));
  assert.equal(at('2027-10-30', 600).ts, Date.UTC(2027, 9, 30, 8, 0));
  // letto a Tokyo (senza ora legale) lo scarto cambia di un'ora tra un giorno e l'altro
  assert.deepEqual(localSlot(at('2027-03-28', 600), 'Asia/Tokyo'), { d: '2027-03-28', s: 17 * 60, e: 18 * 60 });
  assert.deepEqual(localSlot(at('2027-03-27', 600), 'Asia/Tokyo'), { d: '2027-03-27', s: 18 * 60, e: 19 * 60 });
  assert.deepEqual(localSlot(at('2027-10-31', 600), 'Asia/Tokyo'), { d: '2027-10-31', s: 18 * 60, e: 19 * 60 });
});

test('caratterizzazione: 02:30 del 28 marzo 2027 a Roma non esiste → l\'istante cade alle 03:30 CEST (01:30 UTC)', () => {
  const p = makeInvite(base({ date: '2027-03-28', start: 150, end: 210 }), { id: 'g', now: Date.UTC(2027, 0, 1) });
  assert.ok(p, 'la proposta nel vuoto del cambio ora viene accettata');
  assert.equal(p.s, 150, 'd/s/e restano come scritti da chi propone');
  assert.equal(p.ts, Date.UTC(2027, 2, 28, 1, 30));
  const l = localSlot(p, ROME);
  assert.deepEqual(l, { d: '2027-03-28', s: 210, e: 270 }, 'riletta a Roma risulta 03:30, un\'ora dopo quella scritta');
  assert.ok(l.e > l.s && l.e <= 1440);
  assert.deepEqual(findInvite(inviteText(p), Date.UTC(2027, 0, 1)), p, 'il giro completo non la rovina');
});

test('caratterizzazione: 02:30 del 31 ottobre 2027 a Roma esiste due volte → l\'istante è la seconda occorrenza (CET, 01:30 UTC)', () => {
  const p = makeInvite(base({ date: '2027-10-31', start: 150, end: 210 }), { id: 'g', now: Date.UTC(2027, 0, 1) });
  assert.equal(p.ts, Date.UTC(2027, 9, 31, 1, 30), 'seconda occorrenza: 02:30 CET = 01:30 UTC (la prima sarebbe 00:30 UTC)');
  assert.deepEqual(localSlot(p, ROME), { d: '2027-10-31', s: 150, e: 210 });
});

test('proposta che a mezzanotte cambia giorno nel fuso di chi riceve: e mai > 1440 e mai ≤ s', () => {
  // Roma 22:00–24:00 vista a Kolkata (+3:30): 01:30–03:30 del giorno dopo, nessun problema
  const a = makeInvite(base({ start: 22 * 60, end: 24 * 60 }), { id: 'm', now: NOW });
  assert.deepEqual(localSlot(a, 'Asia/Kolkata'), { d: '2026-10-15', s: 90, e: 210 });
  // Roma 18:00–20:00 vista a New York (-6 in ottobre... CEST/EDT = -6): 12:00–14:00 stesso giorno
  assert.deepEqual(localSlot(mk({ start: 1080, end: 1200 }), 'America/New_York'), { d: '2026-10-14', s: 720, e: 840 });
  // slot che inizia alle 23:00 locali del ricevente e dura 2 ore → tagliato a 24:00
  const b = makeInvite(base({ start: 5 * 60, end: 7 * 60 }), { id: 'm2', now: NOW }); // 03:00Z... Roma 05:00 = 03:00Z
  const l = localSlot(b, 'America/Los_Angeles'); // 20:00 del giorno prima
  assert.deepEqual(l, { d: '2026-10-13', s: 20 * 60, e: 22 * 60 });
  const c = makeInvite(base({ start: 8 * 60, end: 11 * 60 }), { id: 'm3', now: NOW }); // 06:00Z
  const cut = localSlot(c, 'Pacific/Honolulu'); // UTC-10 → 20:00
  assert.deepEqual(cut, { d: '2026-10-13', s: 20 * 60, e: 23 * 60 });
  // forza il caso a cavallo: Roma 10:00–13:00 = 08:00Z → a Honolulu 22:00–01:00 → tagliato
  const d = makeInvite(base({ start: 10 * 60, end: 13 * 60 }), { id: 'm4', now: NOW });
  const x = localSlot(d, 'Pacific/Honolulu');
  assert.deepEqual(x, { d: '2026-10-13', s: 22 * 60, e: 1440 }, 'oltre la mezzanotte locale: tagliato a 24:00');
  for (const z of ['Asia/Tokyo', 'Pacific/Honolulu', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kathmandu', 'America/Los_Angeles']) {
    for (let st = 0; st <= 1380; st += 45) {
      const p = makeInvite(base({ start: st, end: Math.min(1440, st + 180) }), { id: 'z', now: NOW });
      const s = localSlot(p, z);
      assert.ok(s.e <= 1440 && s.e > s.s && s.s >= 0, `${z} ${st}: ${JSON.stringify(s)}`);
    }
  }
});

test('inviteText mostra l\'orario nel fuso richiesto', () => {
  const p = mk();
  assert.match(inviteText(p), /mer 14 ott, 18:00–19:00 \(Europe\/Rome\)/);
  assert.match(inviteText(p, { tz: 'Asia/Tokyo' }), /gio 15 ott, 01:00–02:00 \(Asia\/Tokyo\)/);
  assert.match(inviteText(p, { tz: 'Marte/Olympus' }), /18:00–19:00 \(Europe\/Rome\)/, 'fuso falso → resta quello della proposta');
});

// ---------- fitInvite

const PREFS = { dayStart: 8 * 60, dayEnd: 23 * 60, offDays: [], availability: {} };
function planState(events = [], extra = {}) {
  const s = emptyState();
  s.onboarded = true;
  s.prefs = { ...s.prefs, ...PREFS, ...extra };
  if (events.length) {
    applyOps(s, events.map((e) => ({ action: 'add', kind: 'event', title: e.title, date: e.date, start_time: e.at, duration_min: e.min })), NOW);
  }
  return s;
}
const fit = (state, invite, extra = {}) => fitInvite(state, invite, { tz: ROME, now: NOW, ...extra });
const overlap = (a, b) => a.s < b.end && b.start < a.e;

test('fitInvite: giornata libera → entra, nessun conflitto', () => {
  const r = fit(planState(), mk());
  assert.equal(r.fits, true);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.slot, { d: '2026-10-14', s: 1080, e: 1140 });
});

test('fitInvite: sovrapposta a un impegno fisso → non entra, il conflitto è elencato', () => {
  const st = planState([{ title: 'Dentista', date: '2026-10-14', at: '18:30', min: 45 }]);
  const r = fit(st, mk());
  assert.equal(r.fits, false);
  assert.deepEqual(r.conflicts, [{ title: 'Dentista', start: 18 * 60 + 30, end: 19 * 60 + 15 }]);
});

test('fitInvite: impegni adiacenti (che finiscono quando inizia la proposta) non sono conflitti', () => {
  const st = planState([{ title: 'Prima', date: '2026-10-14', at: '17:00', min: 60 }, { title: 'Dopo', date: '2026-10-14', at: '19:00', min: 30 }]);
  const r = fit(st, mk());
  assert.equal(r.fits, true);
  assert.deepEqual(r.conflicts, []);
});

test('fitInvite: un impegno ricorrente conta come occupato', () => {
  const st = planState();
  st.recurring = [{ id: 'r1', title: 'Yoga', weekdays: [3], start: 17 * 60 + 30, end: 18 * 60 + 30 }]; // mercoledì
  const r = fit(st, mk());
  assert.equal(r.fits, false);
  assert.equal(r.conflicts[0].title, 'Yoga');
});

test('fitInvite: le attività flessibili e gli impegni finiti non contano come occupati', () => {
  const st = planState();
  applyOps(st, [{ action: 'add', kind: 'task', title: 'Scrivere relazione', date: '2026-10-14', duration_min: 120 }], NOW);
  applyOps(st, [{ action: 'add', kind: 'event', title: 'Già fatto', date: '2026-10-14', start_time: '18:00', duration_min: 60 }], NOW);
  st.items[st.items.length - 1].status = 'done';
  const r = fit(st, mk());
  assert.equal(r.fits, true, JSON.stringify(r.conflicts));
  assert.deepEqual(r.conflicts, []);
});

test('fitInvite: alternative ≤ 3, stessa durata, a passi di 15 minuti, nella finestra di veglia, senza sovrapposizioni, mai nel passato', () => {
  const events = [
    { title: 'Dentista', date: '2026-10-14', at: '18:30', min: 45 },
    { title: 'Riunione', date: '2026-10-14', at: '09:00', min: 240 },
    { title: 'Cena', date: '2026-10-13', at: '19:00', min: 120 },
    { title: 'Corso', date: '2026-10-12', at: '08:00', min: 300 },
  ];
  const st = planState(events);
  const inv = mk({ start: 18 * 60, end: 19 * 60 + 30 }); // 90 minuti
  const r = fit(st, inv);
  assert.equal(r.fits, false);
  assert.ok(r.alternatives.length >= 1 && r.alternatives.length <= 3);
  const busyByDay = {};
  for (const it of st.items) (busyByDay[it.date] ||= []).push({ start: it.start, end: it.start + it.duration });
  let prev = -1;
  for (const a of r.alternatives) {
    assert.equal(a.e - a.s, 90, 'stessa durata');
    assert.equal(a.s % 15, 0, 'passi da 15 minuti');
    assert.ok(a.s >= 8 * 60 && a.e <= 23 * 60, 'dentro la veglia');
    assert.ok(a.ts >= NOW, 'mai nel passato');
    for (const b of busyByDay[a.d] || []) assert.ok(!overlap(a, b), `${a.d} ${a.s} contro ${b.start}`);
    const dist = Math.abs(a.ts - inv.ts);
    assert.ok(dist >= prev, 'dalla più vicina');
    prev = dist;
    assert.ok(!(a.d === '2026-10-14' && a.s === 18 * 60), 'non ripropone lo stesso orario');
  }
  for (let i = 0; i < r.alternatives.length; i++) for (let j = i + 1; j < r.alternatives.length; j++) {
    const x = r.alternatives[i], y = r.alternatives[j];
    assert.ok(x.d !== y.d || x.e <= y.s || y.e <= x.s, 'le alternative non si sovrappongono tra loro');
  }
});

test('fitInvite: la prima alternativa è la più vicina alla proposta (19:15 dopo il Dentista)', () => {
  const st = planState([{ title: 'Dentista', date: '2026-10-14', at: '18:30', min: 45 }]);
  const r = fit(st, mk());
  assert.deepEqual(r.alternatives[0], { d: '2026-10-14', s: 17 * 60, e: 18 * 60, ts: Date.UTC(2026, 9, 14, 15, 0) }.s === 17 * 60 ? r.alternatives[0] : null);
  const dists = r.alternatives.map((a) => Math.abs(a.ts - mk().ts));
  assert.deepEqual(dists, [...dists].sort((a, b) => a - b));
  assert.equal(r.alternatives[0].d, '2026-10-14');
  assert.ok(Math.abs(r.alternatives[0].s - 18 * 60) <= 45, 'la prima è a meno di tre quarti d\'ora dall\'orario proposto: ' + JSON.stringify(r.alternatives[0]));
});

test('fitInvite: i giorni di riposo non ricevono alternative', () => {
  const st = planState([{ title: 'Dentista', date: '2026-10-14', at: '18:30', min: 45 }], { offDays: [3, 4] }); // mer e gio
  const r = fit(st, mk());
  assert.equal(r.fits, false);
  assert.ok(r.alternatives.length > 0);
  for (const a of r.alternatives) {
    const wd = new Date(a.d + 'T12:00:00Z').getUTCDay();
    assert.ok(![3, 4].includes(wd), `${a.d} è un giorno di riposo`);
  }
});

test('fitInvite: finestra speciale del giorno (availability) rispettata', () => {
  const st = planState([{ title: 'Dentista', date: '2026-10-14', at: '18:30', min: 45 }], { availability: { '2026-10-14': { start: 17 * 60, end: 19 * 60 + 30 } } });
  const r = fit(st, mk());
  for (const a of r.alternatives.filter((x) => x.d === '2026-10-14')) assert.ok(a.s >= 17 * 60 && a.e <= 19 * 60 + 30, JSON.stringify(a));
});

test('fitInvite: proposta nel passato → non entra, alternative solo future', () => {
  const inv = makeInvite(base({ date: '2026-10-12', start: 7 * 60, end: 8 * 60 }), { id: 'p', now: NOW }); // 05:00Z, prima di NOW
  const r = fit(planState(), inv);
  assert.equal(r.fits, false);
  for (const a of r.alternatives) assert.ok(a.ts >= NOW);
});

test('fitInvite: non modifica lo stato (uguale prima e dopo)', () => {
  const st = planState([{ title: 'Dentista', date: '2026-10-14', at: '18:30', min: 45 }]);
  st.recurring = [{ id: 'r1', title: 'Yoga', weekdays: [1], start: 600, end: 660 }];
  const before = clone(st);
  const inv = mk();
  const invBefore = clone(inv);
  fit(st, inv);
  fit(st, inv, { prefs: { dayStart: 600, dayEnd: 700 } });
  assert.deepEqual(st, before);
  assert.deepEqual(inv, invBefore);
});

test('fitInvite: stato vuoto, senza prefs o senza items non lancia', () => {
  const inv = mk();
  assert.doesNotThrow(() => fit({}, inv));
  assert.equal(fit({}, inv).fits, true);
  assert.doesNotThrow(() => fit({ items: [] }, inv));
  assert.doesNotThrow(() => fit(null, inv));
  assert.doesNotThrow(() => fit(undefined, inv));
  assert.doesNotThrow(() => fit(emptyState(), inv, { prefs: undefined }));
  assert.doesNotThrow(() => fit({ items: [null, {}, { date: '2026-10-14', start: 'x' }, { date: '2026-10-14', start: 1100 }], recurring: [null] }, inv));
  assert.doesNotThrow(() => fitInvite({}, inv, {}));
  assert.equal(fitInvite({}, inv, {}), null, 'senza fuso o senza now: null');
  assert.equal(fitInvite({}, null, { tz: ROME, now: NOW }), null);
  assert.equal(fit({}, inv, { tz: 'Marte/Olympus' }), null);
});

test('fitInvite: ricevente in un altro fuso (Tokyo): conflitto calcolato sull\'orario locale', () => {
  const st = planState([{ title: 'Call', date: '2026-10-15', at: '01:30', min: 30 }]);
  const r = fit(st, mk(), { tz: 'Asia/Tokyo' });
  assert.deepEqual(r.slot, { d: '2026-10-15', s: 60, e: 120 });
  assert.equal(r.fits, false);
  assert.equal(r.conflicts[0].title, 'Call');
  for (const a of r.alternatives) assert.ok(a.s >= 8 * 60 && a.e <= 23 * 60);
});

// ---------- inviteOp + pipeline reale

test('inviteOp: forma attesa', () => {
  assert.deepEqual(inviteOp(mk(), ROME), { action: 'add', kind: 'event', title: 'Cena da Anna', date: '2026-10-14', start_time: '18:00', duration_min: 60, note: 'da Marco' });
  assert.ok(!('note' in inviteOp(mk({ from: '' }), ROME)));
  assert.deepEqual(inviteOp(mk(), 'Asia/Tokyo'), { action: 'add', kind: 'event', title: 'Cena da Anna', date: '2026-10-15', start_time: '01:00', duration_min: 60, note: 'da Marco' });
  assert.equal(inviteOp(mk(), 'Marte/Olympus'), null);
  assert.equal(inviteOp(null, ROME), null);
});

test('inviteOp passa sanitizeOps senza perdere nulla e applyOps aggiunge un solo impegno fisso', () => {
  for (const tz of [ROME, 'Asia/Tokyo', 'America/Los_Angeles']) {
    const inv = mk();
    const op = inviteOp(inv, tz);
    const s = sanitizeOps([op]);
    assert.equal(s.dropped, 0, tz);
    assert.deepEqual(s.ops, [op], 'tutti i campi restano');
    const st = planState();
    const n = st.items.length;
    const copy = clone(st);
    const res = applyOps(copy, s.ops, NOW);
    assert.deepEqual(res.errors, []);
    assert.equal(copy.items.length, n + 1);
    const it = copy.items[copy.items.length - 1];
    const l = localSlot(inv, tz);
    assert.equal(it.kind, 'event');
    assert.equal(it.title, 'Cena da Anna');
    assert.equal(it.date, l.d);
    assert.equal(it.start, l.s);
    assert.equal(it.duration, l.e - l.s);
    assert.equal(st.items.length, n, 'lo stato originale non cambia');
  }
});

test('inviteOp: un titolo ostile non porta campi extra né un\'altra azione', () => {
  const hostile = [
    'Cena", "action":"delete_all", "id":"x',
    '{"action":"delete","id":"abc"}',
    '<img src=x onerror=alert(1)>',
    'a'.repeat(300),
    '__proto__',
    'constructor',
  ];
  for (const title of hostile) {
    const inv = sanitizeInvite({ ...raw({ t: title, note: 'x"; action:"delete' }), ts: Date.UTC(2026, 9, 14, 16, 0) }, NOW);
    if (!inv) continue;
    const op = inviteOp(inv, ROME);
    assert.deepEqual(Object.keys(op).sort(), ['action', 'date', 'duration_min', 'kind', 'note', 'start_time', 'title']);
    assert.equal(op.action, 'add');
    assert.equal(op.kind, 'event');
    const s = sanitizeOps([op]);
    assert.equal(s.dropped, 0);
    assert.equal(s.ops.length, 1);
    assert.equal(s.ops[0].action, 'add');
    const st = planState();
    applyOps(st, s.ops, NOW);
    assert.equal(st.items.length, 1);
    assert.ok(st.items[0].title.length <= 80);
    assert.ok(!/[<>]/.test(st.items[0].title));
    assert.equal({}.delete, undefined);
  }
});

test('proposta a fine giornata (23:00–24:00) → impegno valido, mai oltre le 24:00', () => {
  const inv = makeInvite(base({ start: 23 * 60, end: 1440 }), { id: 'e', now: NOW });
  const op = inviteOp(inv, ROME);
  assert.equal(op.duration_min, 60);
  const s = sanitizeOps([op]);
  assert.equal(s.dropped, 0);
});

// ---------- iCalendar

const unfold = (ics) => ics.replace(/\r\n /g, '');

test('icsOf: struttura, CRLF, UID e orari in UTC coerenti con ts', () => {
  const ics = icsOf(mk());
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/(^|[^\r])\n/.test(ics), 'solo CRLF');
  const lines = ics.split('\r\n').slice(0, -1);
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines[lines.length - 1], 'END:VCALENDAR');
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 1);
  assert.equal(lines.filter((l) => l === 'END:VEVENT').length, 1);
  assert.ok(lines.indexOf('BEGIN:VEVENT') < lines.indexOf('END:VEVENT'));
  assert.ok(lines.includes('VERSION:2.0'));
  assert.ok(lines.includes('UID:inv-1'));
  assert.ok(lines.includes('DTSTART:20261014T160000Z'));
  assert.ok(lines.includes('DTEND:20261014T170000Z'));
  assert.ok(lines.some((l) => l.startsWith('DTSTAMP:') && l.endsWith('Z')));
  assert.ok(unfold(ics).includes('SUMMARY:Cena da Anna'));
  assert.ok(unfold(ics).includes('DESCRIPTION:Da Marco'));
});

test('icsOf: stessi orari UTC qualunque sia il fuso di chi legge', () => {
  const p = makeInvite(base({ date: '2026-12-14' }), { id: 'w', now: NOW });
  assert.ok(icsOf(p).includes('DTSTART:20261214T170000Z'));
  assert.ok(icsOf(p).includes('DTEND:20261214T180000Z'));
});

test('icsOf: virgole, punti e virgola, barre e a-capo nel testo vengono protetti', () => {
  const p = mk({ title: 'A, B; C \\ D\nE\r\nF', note: 'uno, due; tre\\' });
  const ics = unfold(icsOf(p));
  assert.ok(ics.includes('SUMMARY:A\\, B\\; C \\\\ D E F'), ics);
  assert.ok(ics.includes('DESCRIPTION:Da Marco. uno\\, due\\; tre\\\\'), ics);
  const summary = ics.split('\r\n').find((l) => l.startsWith('SUMMARY:'));
  assert.ok(!/(^|[^\\]);/.test(summary.slice(8)) && !/(^|[^\\]),/.test(summary.slice(8)));
});

test('icsOf: righe di al massimo 75 byte (anche con emoji e accenti) e nessun carattere di controllo', () => {
  const p = mk({ title: 'è'.repeat(40) + '🍕'.repeat(20), note: 'perché '.repeat(20) });
  const ics = icsOf(p);
  for (const l of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `${Buffer.byteLength(l, 'utf8')} byte: ${l}`);
  }
  assert.ok(ics.split('\r\n').some((l) => l.startsWith(' ')), 'qualche riga è piegata');
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(ics.replace(/\r\n/g, '')));
  assert.ok(unfold(ics).includes('🍕'.repeat(20)), 'una emoji non viene spezzata a metà');
  const ostile = icsOf(sanitizeInvite(raw({ t: 'A\u0000B\u001bC\u007fD' }), NOW));
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(ostile.replace(/\r\n/g, '')));
});

test('icsOf: invito non valido → stringa vuota; una risposta non porta la nota', () => {
  assert.equal(icsOf(null), '');
  assert.equal(icsOf({}), '');
  assert.equal(icsOf('x'), '');
  const r = makeReply(mk({ note: 'segreta' }), { answer: 'si', from: 'Anna' }, { id: 'r', now: NOW });
  assert.ok(!icsOf(r).includes('segreta'));
});

// ---------- inviteText

test('inviteText: nessun punto esclamativo, data e ora leggibili, token da solo nell\'ultima riga', () => {
  const p = mk({ note: 'Porto il vino' });
  for (const text of [inviteText(p), inviteText(p, { baseUrl: 'https://x.example/tempo/' }), inviteText(p, { tz: 'Asia/Tokyo' })]) {
    assert.ok(!text.includes('!'));
    const lines = text.split('\n');
    const last = lines[lines.length - 1];
    assert.ok(/^\[tempo:inv1:[A-Za-z0-9_-]+\]$/.test(last), last);
    assert.equal(lines.filter((l) => l.includes('tempo:inv1:')).length, 1, 'il token compare una volta sola');
    assert.ok(!text.includes('\r'));
  }
  const t = inviteText(p);
  assert.match(t, /Cena da Anna/);
  assert.match(t, /mer 14 ott, 18:00–19:00/);
  assert.match(t, /Nota: Porto il vino/);
});

test('inviteText: con link, il frammento #invito= contiene il token senza prefisso; un # nell\'indirizzo viene tolto', () => {
  const p = mk();
  const t = inviteText(p, { baseUrl: 'https://x.example/tempo/#vecchio' });
  const link = t.split('\n').find((l) => l.startsWith('https://'));
  assert.ok(link.startsWith('https://x.example/tempo/#invito='));
  assert.ok(!link.includes('vecchio') && !link.includes('tempo:inv1:'));
  assert.deepEqual(findInvite(link, NOW), p);
});

test('inviteText: lunghezza di una proposta normale sotto 800 caratteri (con link)', () => {
  const t = inviteText(mk({ note: 'Porto io il dolce' }), { baseUrl: 'https://example.github.io/midi/tempo/' });
  assert.ok(t.length < 800, 'lunghezza reale: ' + t.length);
  const senzaLink = inviteText(mk({ note: 'Porto io il dolce' }));
  assert.ok(senzaLink.length < t.length);
});

test('inviteText: invito non valido → stringa vuota; testo ostile senza parentesi angolari', () => {
  assert.equal(inviteText(null), '');
  assert.equal(inviteText({ v: 1 }), '');
  const p = mk({ title: '<script>x</script> Pranzo', note: '<b>ciao</b>' });
  assert.ok(!/[<>]/.test(inviteText(p)));
});

test('inviteText di una risposta: «si», «no» e «altro» hanno frasi proprie, senza esclamativi', () => {
  const p = mk();
  const si = inviteText(makeReply(p, { answer: 'si' }, { id: 'a', now: NOW }));
  const no = inviteText(makeReply(p, { answer: 'no' }, { id: 'b', now: NOW }));
  const alt = inviteText(makeReply(p, { answer: 'altro', alternatives: [{ ts: Date.UTC(2026, 9, 15, 17, 0) }] }, { id: 'c', now: NOW }));
  assert.match(si, /^Va bene: Cena da Anna/);
  assert.match(no, /^Non riesco: Cena da Anna/);
  assert.match(alt, /Ti propongo invece: gio 15 ott 19:00/);
  for (const t of [si, no, alt]) assert.ok(!t.includes('!'));
});

// ---------- riservatezza

test('riservatezza: i titoli degli impegni di chi riceve non finiscono mai in una risposta', () => {
  const SEGRETO = 'SEGRETO-XYZ';
  const st = planState([
    { title: SEGRETO + ' visita', date: '2026-10-14', at: '18:15', min: 60 },
    { title: SEGRETO + ' altro', date: '2026-10-15', at: '18:00', min: 120 },
  ]);
  st.recurring = [{ id: 'r9', title: SEGRETO + ' ricorrente', weekdays: [3, 4], start: 17 * 60, end: 20 * 60 }];
  const inv = mk();
  const f = fit(st, inv);
  assert.equal(f.fits, false);
  assert.ok(f.conflicts.some((c) => c.title.includes(SEGRETO)), 'i conflitti li contengono (restano sul dispositivo)');
  for (const answer of ['si', 'no', 'altro']) {
    const r = makeReply(inv, { answer, alternatives: f.alternatives, from: 'Anna' }, { id: 'r-' + answer, now: NOW });
    assert.ok(r, answer);
    const texts = [
      inviteText(r), inviteText(r, { baseUrl: 'https://x.example/t/' }), inviteText(r, { tz: 'Asia/Tokyo' }),
      encodeInvite(r), JSON.stringify(r), icsOf(r),
    ];
    const tok = encodeInvite(r).slice('tempo:inv1:'.length);
    texts.push(Buffer.from(tok, 'base64url').toString('utf8'));
    for (const t of texts) assert.ok(!t.includes(SEGRETO), `${answer}: ${t.slice(0, 80)}`);
    assert.equal(r.t, inv.t, 'l\'unico titolo è quello della proposta');
  }
});
