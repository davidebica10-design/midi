// Richiesta di ok senza backend e senza account.
// Il producer manda un link: dentro (nel frammento #, che non arriva a nessun server) ci sono
// titolo, versione e impronta. L'artista tocca «approvo» e parte un messaggio WhatsApp con un codice
// che Tempo riconosce quando importi la chat: «tempo ✓ v3 #a1b2c3d4e5f6».
import { b64urlEncode, b64urlDecode } from './util.js';
import { HEX } from './hash.js';

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

export function encodeAsk(p) {
  return b64urlEncode(JSON.stringify({
    k: /^[A-Za-z0-9_-]{1,24}$/.test(p.key || '') ? p.key : undefined, t: str(p.title, 80), w: str(p.artist, 40), n: p.n | 0, f: str(p.fileName, 80),
    h: String(p.hash || '').slice(0, 16), a: safeUrl(p.audio) || undefined, p: phone(p.phone) || undefined, b: str(p.by, 40) || undefined,
  }));
}

/** Legge il frammento del link. Tutto ciò che non torna viene scartato: arriva da fuori. */
export function decodeAsk(s) {
  try {
    if (typeof s !== 'string' || s.length > 4000) return null;
    const j = JSON.parse(b64urlDecode(s));
    const n = Number.isInteger(j.n) && j.n > 0 && j.n < 1000 ? j.n : null;
    const hash = typeof j.h === 'string' && HEX.test(j.h) ? j.h : null;
    const title = str(j.t, 80);
    if (!n || !hash || !title) return null;
    const key = typeof j.k === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(j.k) ? j.k : null;
    return { key, title, artist: str(j.w, 40), n, fileName: str(j.f, 80), hash, audio: safeUrl(j.a), phone: phone(j.p), by: str(j.b, 40) };
  } catch {
    return null;
  }
}

export function safeUrl(u) {
  try {
    const url = new URL(String(u || ''));
    return url.protocol === 'https:' ? url.href.slice(0, 500) : null;
  } catch {
    return null;
  }
}

export const phone = (v) => { const d = String(v || '').replace(/[^\d]/g, ''); return d.length >= 8 && d.length <= 15 ? d : null; };

export const askLink = (base, payload) => `${base.split('#')[0]}#/ok/${payload}`;

/** Codice che chiude il giro: lo genera la pagina dell'artista, lo riconosce chat.js. */
export const replyCode = (kind, n, hash) => `tempo ${kind === 'ok' ? '✓' : '✎'} v${n} #${hash.slice(0, 12)}`;

export function replyText(kind, ask, note = '') {
  const code = replyCode(kind, ask.n, ask.hash);
  if (kind === 'ok') return `${code} · ${ask.title}\napprovo questa versione.`;
  return `${code} · ${ask.title}${note ? `: ${str(note, 400)}` : ''}`;
}

export const waLink = (to, text) => `https://wa.me/${phone(to) || ''}?text=${encodeURIComponent(text)}`;

// ---- link di stato del brano (#/s/…): foto compressa, solo lettura per chi la riceve
async function deflate(text) {
  const s = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(s).text();
}
const toB64 = (bytes) => { let b = ''; for (const x of bytes) b += String.fromCharCode(x); return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Foto → stringa per il link. «z» = compressa, «j» = in chiaro (browser senza CompressionStream). */
export async function encodeSnap(snap) {
  const json = JSON.stringify(snap);
  if (typeof CompressionStream === 'function') return `z${toB64(await deflate(json))}`;
  return `j${b64urlEncode(json)}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['brano', 'versione', 'ok', 'modifica', 'compito', 'decisione', 'fase', 'fatto'];
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const when = (v) => (Number.isFinite(v) && v > 0 && v < 8.64e15 ? v : null);

/** Stringa del link → foto validata, o null. Arriva da fuori: ogni campo viene ricontrollato. */
export async function decodeSnap(s) {
  try {
    if (typeof s !== 'string' || s.length < 2 || s.length > 12000) return null;
    const json = s[0] === 'z' ? await inflate(fromB64(s.slice(1))) : s[0] === 'j' ? b64urlDecode(s.slice(1)) : null;
    if (!json || json.length > 60000) return null;
    const j = JSON.parse(json);
    if (j?.v !== 1 || !str(j.t, 80)) return null;
    const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
    return {
      key: typeof j.k === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(j.k) ? j.k : null,
      title: str(j.t, 80), artist: str(j.w, 40), by: str(j.by, 40), phone: phone(j.p),
      stage: int(j.st, 0, 5) ?? 0, at: when(j.at) || Date.now(), since: when(j.sn), audio: safeUrl(j.a),
      versions: list(j.vs, 12).map((v) => ({
        n: int(v?.[0], 1, 999), fileName: str(v?.[1], 120), duration: int(Math.round(+v?.[2] || 0), 0, 86400) || 0,
        hash: typeof v?.[3] === 'string' && HEX.test(v[3]) ? v[3] : null, okBy: str(v?.[4], 40) || null, okAt: when(v?.[5]), addedAt: when(v?.[6]),
      })).filter((v) => v.n && v.hash),
      tasks: list(j.ts, 12).map((k) => ({ who: str(k?.[0], 40), what: str(k?.[1], 140), due: typeof k?.[2] === 'string' && DATE.test(k[2]) ? k[2] : null })).filter((k) => k.what),
      log: list(j.lg, 12).map((l) => ({ at: when(l?.[0]), who: str(l?.[1], 40), kind: KINDS.includes(l?.[2]) ? l[2] : 'nota', text: str(l?.[3], 300) })).filter((l) => l.at && l.text),
    };
  } catch {
    return null;
  }
}

export const snapLink = (base, payload) => `${base.split('#')[0]}#/s/${payload}`;

/** Messaggio che accompagna il link di stato. */
export function snapText(snap, link, changes) {
  const news = changes > 0 ? `${String(changes).padStart(2, '0')} novità dall'ultimo link. ` : '';
  return `${snap.t} · a che punto siamo\n${news}versioni, ok e cose da fare, aggiornati adesso:\n${link}`;
}

/** Messaggio che il producer manda con il link. */
export const askText = (ask, link) => `${ask.title} · v${ask.n}\nmi dai l'ok? ascolta e rispondi da qui, ci vuole un tocco:\n${link}`;
