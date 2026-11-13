process.env.TZ = 'Europe/Rome';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChat, extract, dueFrom, unzipText, sampleChat, participants } from '../js/chat.js';

const IOS = `[12/11/26, 18:04:22] Midi: la v3 spacca, per me è ok
[12/11/26, 18:05:01] Midi: però mi mandi anche la strumentale entro venerdì?
continua su una riga nuova
[12/11/26, 18:06:40] Davide: sì te la giro domani
‎[12/11/26, 18:07:00] Midi: ‎audio omesso
[12/11/26, 18:09:13] Midi: teniamo il titolo notte a ortigia, niente inglese`;

const ANDROID = `12/11/26, 18:04 - I messaggi e le chiamate sono crittografati end-to-end.
12/11/26, 18:04 - Midi: non va bene la v2, la voce è bassa
12/11/26, 18:10 - Davide: ok la rifaccio
13/11/26, 09:00 - Midi: tempo ✓ v3 #a1b2c3d4e5f6 · notte a ortigia
13/11/26, 09:01 - Midi: tempo ✎ v2 #0011223344aa · notte a ortigia: voce più alta nel ritornello`;

test('legge l’export iOS con righe a capo e salta i media', () => {
  const m = parseChat(IOS);
  assert.equal(m.length, 4);
  assert.equal(m[0].who, 'Midi');
  assert.equal(new Date(m[0].at).getHours(), 18);
  assert.match(m[1].text, /continua su una riga nuova/);
  assert.deepEqual(participants(m), ['Midi', 'Davide']);
});

test('legge l’export Android e ignora i messaggi di sistema', () => {
  const m = parseChat(ANDROID);
  assert.equal(m.length, 4);
  assert.equal(m[0].who, 'Midi');
});

test('ok con versione esplicita → approve alta', () => {
  const p = extract(parseChat(IOS), { me: 'Davide', versions: [{ n: 3 }] });
  const ok = p.find((x) => x.op.action === 'approve');
  assert.equal(ok.op.version, 'v3');
  assert.equal(ok.op.by, 'Midi');
  assert.equal(ok.confidence, 'alta');
});

test('richiesta all’altro → task per l’altro, con scadenza', () => {
  const p = extract(parseChat(IOS), { me: 'Davide', versions: [{ n: 3 }] });
  const t = p.find((x) => x.op.action === 'task' && x.op.who === 'Davide');
  assert.ok(t);
  assert.equal(t.op.due, '2026-11-13'); // giovedì 12 → venerdì 13
  assert.equal(t.mine, true);
});

test('impegno preso → task per chi parla', () => {
  const p = extract(parseChat(IOS), { me: 'Davide' });
  const t = p.find((x) => x.op.action === 'task' && /giro domani/.test(x.op.what));
  assert.equal(t.op.who, 'Davide');
  assert.equal(t.op.due, '2026-11-13');
});

test('decisione', () => {
  const p = extract(parseChat(IOS), {});
  assert.ok(p.some((x) => x.op.action === 'decide' && /teniamo il titolo/.test(x.op.text)));
});

test('negazione: nessun ok', () => {
  const p = extract(parseChat(ANDROID), { versions: [{ n: 2 }] });
  assert.ok(!p.some((x) => x.op.action === 'approve' && x.op.source === 'chat'));
});

test('codici della pagina ok → approve e request certi, con impronta', () => {
  const p = extract(parseChat(ANDROID), {});
  const ok = p.find((x) => x.op.action === 'approve');
  const ch = p.find((x) => x.op.action === 'request');
  assert.equal(ok.op.version, 'a1b2c3d4e5f6');
  assert.equal(ok.op.source, 'link');
  assert.equal(ch.op.version, '0011223344aa');
  assert.equal(ch.op.text, 'voce più alta nel ritornello');
});

test('scadenze relative al giorno del messaggio', () => {
  const at = new Date(2026, 10, 12, 18, 0).getTime(); // giovedì
  assert.equal(dueFrom('entro domani', at), '2026-11-13');
  assert.equal(dueFrom('lunedì', at), '2026-11-16');
  assert.equal(dueFrom('giovedì prossimo', at), '2026-11-19');
  assert.equal(dueFrom('per il 20/11', at), '2026-11-20');
  assert.equal(dueFrom('quando puoi', at), null);
});

test('la chat di esempio produce proposte', () => {
  const m = parseChat(sampleChat(new Date(2026, 10, 13, 10).getTime()));
  const p = extract(m, { me: 'davide', versions: [{ n: 3 }] });
  assert.ok(p.length >= 4);
});

test('unzip: chat dentro uno zip deflate (come l’export iOS)', async () => {
  const text = '[12/11/26, 18:04:22] Midi: ciao\n';
  const zip = await makeZip('_chat.txt', text);
  assert.equal(await unzipText(zip), text);
});

// zip minimale con un file compresso deflate
async function makeZip(name, text) {
  const raw = new TextEncoder().encode(text);
  const comp = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const nm = new TextEncoder().encode(name);
  const crc = crc32(raw);
  const local = new Uint8Array(30 + nm.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 8, true);
  lv.setUint32(14, crc, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nm.length, true);
  local.set(nm, 30);
  const central = new Uint8Array(46 + nm.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 8, true);
  cv.setUint32(16, crc, true); cv.setUint32(20, comp.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, 0, true);
  central.set(nm, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  const cdOff = local.length + comp.length;
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true); ev.setUint32(12, central.length, true); ev.setUint32(16, cdOff, true);
  const out = new Uint8Array(cdOff + central.length + end.length);
  out.set(local, 0); out.set(comp, local.length); out.set(central, cdOff); out.set(end, cdOff + central.length);
  return out;
}
function crc32(b) {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
