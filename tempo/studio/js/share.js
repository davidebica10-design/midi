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

/** Messaggio che il producer manda con il link. */
export const askText = (ask, link) => `${ask.title} · v${ask.n}\nmi dai l'ok? ascolta e rispondi da qui, ci vuole un tocco:\n${link}`;
