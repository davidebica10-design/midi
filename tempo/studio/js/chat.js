// Chat WhatsApp esportata → proposte (ok, modifiche, cose da fare, decisioni).
// Niente Business API: l'utente esporta la chat («Esporta chat» → senza media) e la dà a Tempo.
// Modalità base, senza AI: regole semplici e prudenti. Ogni proposta va confermata.
import { dateKey } from './util.js';

const LRM = /[‎‏‪-‮⁦-⁩]/g;
// iOS:     [12/11/26, 18:04:22] Midi: testo
const IOS = /^\[(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(?:[ap]\.?m\.?)?\]\s+([^:]{1,60}?):\s?(.*)$/i;
// Android: 12/11/26, 18:04 - Midi: testo
const AND = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})\s*(?:[ap]\.?m\.?)?\s+[-–]\s+([^:]{1,60}?):\s?(.*)$/i;
const MEDIA = /^<?(media omess[oi]|allegato|immagine omessa|audio omesso|video omesso|sticker omesso|gif omessa|documento omesso|messaggio eliminato|questo messaggio è stato eliminato|null)>?$/i;

/** Testo dell'export → [{ at, who, text }]. Le righe senza intestazione continuano il messaggio prima. */
export function parseChat(text) {
  const out = [];
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(LRM, '').trimEnd();
    let m = line.match(IOS);
    let msg = null;
    if (m) msg = mk(m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    else if ((m = line.match(AND))) msg = mk(m[1], m[2], m[3], m[4], m[5], 0, m[6], m[7]);
    if (msg) { out.push(msg); continue; }
    if (out.length && line.trim()) out[out.length - 1].text += '\n' + line.trim();
  }
  return out.filter((x) => x.text && !MEDIA.test(x.text.trim()));
}

function mk(d, mo, y, hh, mm, ss, who, text) {
  let year = +y;
  if (year < 100) year += 2000;
  const at = new Date(year, +mo - 1, +d, +hh, +mm, +ss || 0).getTime();
  if (!Number.isFinite(at)) return null;
  return { at, who: who.trim(), text: (text || '').trim() };
}

export const participants = (msgs) => [...new Set(msgs.map((m) => m.who))];

// ---- regole
// \b di JS conosce solo [A-Za-z0-9_]: «lunedì» o «è quella» non hanno confini. Qui i confini valgono per tutte le lettere.
const W = '[\\p{L}\\p{N}_]';
const BOUND = `(?:(?<!${W})(?=${W})|(?<=${W})(?!${W}))`;
const U = (re) => new RegExp(re.source.replace(/\\b/g, BOUND), re.flags.includes('u') ? re.flags : `${re.flags}u`);

const CODE = /tempo\s*([✓✔✎✏])️?\s*v(\d{1,3})\s*#([0-9a-f]{8,16})(?:[^:\n]*:\s*(.+))?/i;
const VREF = U(/\b(?:v|ver(?:sione)?\s*|mix\s*|master\s*)(\d{1,3})\b/i);
const NEG = U(/\b(non|no|mica|manco)\b[^.!?\n]{0,25}\b(va bene|approv|mi piace|mi convince|ci siamo|è quell|perfett|ok)/i);
const APPROVE = U(/\b(approv(o|ato|ata|iamo)|va bene così|ok così|okay così|perfett[oa]|spacca|è quell[ao] giust[ao]|questa è quella|(lo )?chiudiamo|mandal[ao] (a|al) master|definitiv[ao]|via così|per me è ok|ok per me|ci siamo)\b/i);
const ASK_OTHER = U(/\b(mi mandi|mandami|me l[oa] mandi|mi giri|girami|puoi|potresti|riesci a|rifai|rifammi|sistemi|sistemami|alza|abbassa|togli|aggiungi|registra|rimandami|ricordati di)\b/i);
const SELF = U(/\b(devo|ti mando|ti giro|te l[oa] mando|te l[oa] giro|l[oa] rifaccio|l[oa] sistemo|registro|ci penso io|me ne occupo)\b/i);
const DECIDE = U(/\b(decidiamo|abbiamo deciso|facciamo così|teniamo|scartiamo|andiamo con|usiamo|esce il|uscita il|la mettiamo|lasciamo)\b/i);

const WD = { domenica: 0, lunedi: 1, lunedì: 1, martedi: 2, martedì: 2, mercoledi: 3, mercoledì: 3, giovedi: 4, giovedì: 4, venerdi: 5, venerdì: 5, sabato: 6 };

/** «entro venerdì», «domani», «per il 20/11» → AAAA-MM-GG relativo al giorno del messaggio. */
export function dueFrom(text, at) {
  const t = String(text).toLowerCase();
  const base = new Date(at);
  const day = (n) => dateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n).getTime());
  if (U(/\b(oggi|stasera|entro sera)\b/).test(t)) return day(0);
  if (U(/\bdopodomani\b/).test(t)) return day(2);
  if (U(/\bdomani\b/).test(t)) return day(1);
  const w = t.match(U(/\b(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)\b/));
  if (w) { const diff = (WD[w[1]] - base.getDay() + 7) % 7 || 7; return day(diff); }
  const d = t.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/);
  if (d && +d[2] >= 1 && +d[2] <= 12 && +d[1] >= 1 && +d[1] <= 31) {
    let y = d[3] ? +d[3] : base.getFullYear();
    if (y < 100) y += 2000;
    let dt = new Date(y, +d[2] - 1, +d[1]);
    if (!d[3] && dt.getTime() < base.getTime() - 864e5) dt = new Date(y + 1, +d[2] - 1, +d[1]);
    return dateKey(dt.getTime());
  }
  if (U(/\b(fine settimana|weekend)\b/).test(t)) return day(((6 - base.getDay() + 7) % 7) || 7);
  return null;
}

const clean = (text, max = 110) => {
  const t = String(text).replace(/\s+/g, ' ').replace(/^(raga|ehi|ei|oh|allora|senti|bro|fra)[, ]+/i, '').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

/**
 * Messaggi → proposte. Ognuna: { op, msg, confidence: 'alta'|'media', why }.
 * `me` = il tuo nome nella chat (serve a capire a chi tocca), `versions` = versioni del brano.
 */
export function extract(msgs, { me = '', versions = [] } = {}) {
  const people = participants(msgs);
  const meKey = me.trim().toLowerCase();
  const other = (who) => people.find((p) => p !== who) || '';
  const out = [];
  for (const msg of msgs) {
    const text = msg.text;
    // 1. codice generato dalla pagina «chiedi ok»: certo
    const c = text.match(CODE);
    if (c) {
      const ok = /[✓✔]/.test(c[1]);
      out.push({ op: { action: ok ? 'approve' : 'request', version: c[3].toLowerCase(), by: msg.who, at: msg.at, source: 'link', text: ok ? '' : clean(c[4] || '', 200) }, msg, confidence: 'alta', why: 'codice tempo' });
      continue;
    }
    const vref = text.match(VREF)?.[1] || null;
    // 2. ok a parole
    if (APPROVE.test(text) && !NEG.test(text) && !/\?\s*$/.test(text)) {
      const known = vref && versions.some((v) => v.n === +vref);
      out.push({ op: { action: 'approve', version: known ? `v${vref}` : null, by: msg.who, at: msg.at, source: 'chat', text: clean(text, 200) }, msg, confidence: known ? 'alta' : 'media', why: known ? `ok su v${vref}` : 'ok senza versione: uso l’ultima prima del messaggio' });
      continue;
    }
    // 3. cose da fare
    const due = dueFrom(text, msg.at);
    if (ASK_OTHER.test(text)) {
      out.push({ op: { action: 'task', who: other(msg.who), what: clean(text), due, by: msg.who, at: msg.at }, msg, confidence: due ? 'alta' : 'media', why: `richiesta di ${msg.who}` });
      continue;
    }
    if (SELF.test(text)) {
      out.push({ op: { action: 'task', who: msg.who, what: clean(text), due, by: msg.who, at: msg.at }, msg, confidence: due ? 'alta' : 'media', why: `${msg.who} si prende l’impegno` });
      continue;
    }
    // 4. decisioni
    if (DECIDE.test(text) && text.length > 12) {
      out.push({ op: { action: 'decide', text: clean(text, 200), by: msg.who, at: msg.at }, msg, confidence: 'media', why: 'sembra una decisione' });
    }
  }
  // segna le cose che toccano a te: la UI le mostra come «tu»
  for (const p of out) p.mine = !!meKey && (p.op.who || '').toLowerCase() === meKey;
  return out;
}

// ---- file: .txt oppure lo .zip che esporta iOS (contiene _chat.txt)
export async function readChatFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4b) return unzipText(buf);
  return new TextDecoder().decode(buf);
}

/** Primo .txt dentro uno zip (stored o deflate), con la directory centrale per avere le dimensioni giuste. */
export async function unzipText(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('zip non valido');
  const total = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < total && p + 46 <= b.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!/\.txt$/i.test(name) || /(^|\/)__MACOSX\//.test(name)) continue;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = b.subarray(start, start + csize);
    if (method === 0) return dec.decode(data);
    if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    }
    throw new Error('compressione zip non supportata');
  }
  throw new Error('nello zip non c’è una chat');
}

/** Chat di esempio per provare senza esportare niente. */
export function sampleChat(now = Date.now()) {
  const d = new Date(now - 864e5);
  const p = (n) => String(n).padStart(2, '0');
  const day = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
  return [
    `[${day}, 17:58:10] davide: ti ho mandato la v3, ho alzato la voce nel ritornello`,
    `[${day}, 18:04:22] midi: la v3 spacca, per me è ok`,
    `[${day}, 18:05:01] midi: però mi mandi anche la strumentale entro venerdì?`,
    `[${day}, 18:06:40] davide: sì te la giro domani`,
    `[${day}, 18:09:13] midi: teniamo il titolo notte a ortigia, niente inglese`,
    `[${day}, 18:10:55] davide: ok, la doppia della strofa 2 la rifai tu lunedì?`,
    `[${day}, 18:11:30] midi: ‎audio omesso`,
  ].join('\n');
}
