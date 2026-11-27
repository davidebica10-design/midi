// Inviti diretti cifrati da telefono a telefono: le primitive.
// Modulo puro: solo Web Crypto (uguale nel browser, su Node 20+ e su Cloudflare Workers), niente DOM, niente rete,
// niente archivio, niente Date.now() (il tempo arriva da fuori). Nessuna crittografia fatta in casa: solo
// algoritmi standard combinati nel modo più comune.
//
// Ogni dispositivo ha due coppie di chiavi P-256: una per ricevere (ECDH) e una per firmare (ECDSA).
// Le chiavi private sono non esportabili: restano nel dispositivo.
//
// Un messaggio (busta):
//   1. il contenuto `payload` (JSON con id, tipo, ora, mittente, destinatario, corpo) si firma con ECDSA-SHA256;
//   2. contenuto + firma si cifrano con AES-256-GCM. La chiave nasce da ECDH tra una chiave usa-e-getta del
//      mittente e la chiave di ricezione del destinatario, passata da HKDF-SHA256 (ECIES);
//   3. intestazione in chiaro (mittente, destinatario, chiave usa-e-getta) legata al testo cifrato come dati
//      aggiuntivi autenticati: se il server la cambia, la busta non si apre.
// Chi riceve controlla: busta ben fatta, per me, si apre, firma valida di una chiave di cui mi fido, intestazione
// uguale al contenuto firmato, ora plausibile, id mai visto prima (niente ripetizioni).

const subtle = globalThis.crypto?.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export const E2E_V = 1;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

export const MAX_AGE = 30 * 24 * 3600e3;   // una busta più vecchia di 30 giorni non si apre
export const MAX_SKEW = 10 * 60e3;          // ore nel futuro tollerate (orologi sfasati)
export const MAX_BODY = 8192;               // byte del corpo (JSON)
export const MAX_ENV = 16384;               // caratteri della busta intera
export const KINDS = ['contatto', 'invito'];

export class E2EError extends Error { constructor(code, message) { super(message || code); this.code = code; } }
const fail = (code, msg) => { throw new E2EError(code, msg); };

// ---- codifiche

const B64U = /^[A-Za-z0-9_-]*$/;
export function b64u(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** base64url → byte. Rifiuta tutto ciò che non è base64url canonico, e (se dato) una lunghezza diversa. */
export function unb64u(s, len) {
  if (typeof s !== 'string' || !B64U.test(s) || s.length % 4 === 1 || s.length > 65536) fail('formato');
  let out;
  try { out = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)); } catch { fail('formato'); }
  if (b64u(out) !== s) fail('formato'); // una sola scrittura valida per ogni sequenza di byte
  if (len != null && out.length !== len) fail('formato');
  return out;
}
export const randomB64u = (n) => b64u(globalThis.crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (bytes) => new Uint8Array(await subtle.digest('SHA-256', bytes));
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
/** Confronto di due stringhe senza uscire al primo carattere diverso. */
export function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---- identità e chiavi pubbliche

const ID = /^[A-Za-z0-9_-]{6,40}$/;
export const validId = (x) => typeof x === 'string' && ID.test(x);
const POINT = 65; // P-256 non compresso: 0x04 ‖ X ‖ Y

/** La parte pubblica di un dispositivo, controllata campo per campo. Restituisce una copia pulita o null. */
export function cleanPub(p) {
  if (!p || typeof p !== 'object' || p.v !== E2E_V || !validId(p.dev)) return null;
  try {
    for (const k of ['enc', 'sig']) { const b = unb64u(p[k], POINT); if (b[0] !== 4) return null; }
  } catch { return null; }
  if (p.enc === p.sig) return null;
  return { v: E2E_V, dev: p.dev, enc: p.enc, sig: p.sig };
}

/** Un dispositivo nuovo: chiavi private non esportabili. { id, enc, sig, pub } (enc e sig sono CryptoKeyPair). */
export async function createDevice(id = randomB64u(12)) {
  if (!validId(id)) fail('id');
  const encPair = await subtle.generateKey(ECDH, false, ['deriveBits']);
  const sigPair = await subtle.generateKey(ECDSA, false, ['sign', 'verify']);
  const pub = { v: E2E_V, dev: id, enc: b64u(await subtle.exportKey('raw', encPair.publicKey)), sig: b64u(await subtle.exportKey('raw', sigPair.publicKey)) };
  return { id, enc: encPair, sig: sigPair, pub };
}

/** Impronta di una chiave pubblica (32 byte, base64url): è quello che si confronta e si ricorda. */
export async function fingerprint(pub) {
  const p = cleanPub(pub);
  if (!p) fail('chiave');
  return b64u(await sha256(enc.encode(JSON.stringify(['tempo-fp-v1', p.dev, p.enc, p.sig]))));
}

/**
 * Il codice di sicurezza di due persone: 30 cifre in 6 gruppi, uguale sui due telefoni (l'ordine non conta).
 * Se coincide a voce o di persona, nessuno si è messo in mezzo.
 */
export async function safetyCode(fpA, fpB) {
  if (typeof fpA !== 'string' || typeof fpB !== 'string') fail('chiave');
  const [x, y] = [fpA, fpB].sort();
  const h = await sha256(enc.encode(JSON.stringify(['tempo-safety-v1', x, y])));
  const dv = new DataView(h.buffer);
  const groups = [];
  for (let i = 0; i < 6; i++) groups.push(String(dv.getUint32(i * 4) % 100000).padStart(5, '0'));
  return groups.join(' ');
}

// ---- codice per diventare contatti (link monouso)
// Formato: `tempo:ct1:<base64url del JSON>`; nel link `#contatto=<stesso testo senza prefisso>`.
//   l: identificativo per il server (12 byte) · k: segreto che il server non vede mai (16 byte)
//   f: impronta della chiave di chi l'ha creato · n: il nome con cui si firma (solo da mostrare) · x: scadenza

const CT = 'tempo:ct1:';
const MAX_NAME = 40;
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
export { cleanName };

export function makeContactCode({ fp, name, exp }) {
  unb64u(fp, 32);
  if (!Number.isFinite(exp)) fail('scadenza');
  const c = { v: 1, l: randomB64u(12), k: randomB64u(16), f: fp, n: cleanName(name), x: Math.floor(exp) };
  return { code: CT + b64u(enc.encode(JSON.stringify(c))), lookup: c.l, secret: c.k, exp: c.x };
}

/** Legge un codice contatto da un testo (anche un link o un messaggio). null se non c'è o non è valido o è scaduto. */
export function findContactCode(text, now) {
  const t = String(text ?? '').slice(0, 4000);
  const m = t.match(/(?:tempo:ct1:|[#&?]contatto=)([A-Za-z0-9_-]{40,600})/);
  if (!m) return null;
  try {
    const c = JSON.parse(dec.decode(unb64u(m[1])));
    if (!c || c.v !== 1 || !Number.isFinite(c.x) || (now != null && c.x < now)) return null;
    unb64u(c.l, 12); unb64u(c.k, 16); unb64u(c.f, 32);
    return { lookup: c.l, secret: c.k, fp: c.f, name: cleanName(c.n), exp: c.x };
  } catch { return null; }
}

// ---- buste

const canonHeader = (h) => enc.encode(JSON.stringify(['tempo-env-v1', h.from.uid, h.from.dev, h.to.uid, h.to.dev, h.epk]));
const party = (x) => x && typeof x === 'object' && validId(x.uid) && validId(x.dev);

async function aesKey(shared, epkBytes, recipEncBytes, aad) {
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: await sha256(concat(epkBytes, recipEncBytes)), info: concat(enc.encode('tempo-e2e-v1\n'), aad) },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const importEnc = (b64) => subtle.importKey('raw', unb64u(b64, POINT), ECDH, false, []);
const importSig = (b64) => subtle.importKey('raw', unb64u(b64, POINT), ECDSA, false, ['verify']);

/**
 * Prepara una busta per un dispositivo.
 * me: { uid, device } (device da createDevice) · to: { uid, pub } · msg: { kind, body, id?, at }
 */
export async function sealMessage(me, to, msg) {
  const rp = cleanPub(to?.pub);
  if (!rp || !validId(to?.uid) || !validId(me?.uid) || !me.device?.pub) fail('destinatario');
  if (!KINDS.includes(msg?.kind)) fail('tipo');
  if (!Number.isFinite(msg.at)) fail('ora');
  const bodyJson = JSON.stringify(msg.body ?? null);
  if (enc.encode(bodyJson).length > MAX_BODY) fail('troppo');
  const from = { uid: me.uid, dev: me.device.id }, toP = { uid: to.uid, dev: rp.dev };
  const payload = JSON.stringify({ v: E2E_V, id: msg.id || randomB64u(16), kind: msg.kind, at: Math.floor(msg.at), from, to: toP, body: JSON.parse(bodyJson) });
  const sig = new Uint8Array(await subtle.sign(SIGN, me.device.sig.privateKey, enc.encode('tempo-msg-v1\n' + payload)));
  const eph = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const epkBytes = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const head = { from, to: toP, epk: b64u(epkBytes) };
  const aad = canonHeader(head);
  const recipEnc = unb64u(rp.enc, POINT);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: await importEnc(rp.enc) }, eph.privateKey, 256);
  const key = await aesKey(shared, epkBytes, recipEnc, aad);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, enc.encode(JSON.stringify({ p: payload, s: b64u(sig) })));
  const out = { v: E2E_V, ...head, iv: b64u(iv), ct: b64u(ct) };
  if (JSON.stringify(out).length > MAX_ENV) fail('troppo'); // il server e il destinatario la rifiuterebbero
  return out;
}

/** Controlla solo la forma di una busta (serve anche al server). Restituisce una copia pulita o null. */
export function cleanEnvelope(e) {
  if (!e || typeof e !== 'object' || e.v !== E2E_V || !party(e.from) || !party(e.to)) return null;
  try {
    const epk = unb64u(e.epk, POINT); if (epk[0] !== 4) return null;
    unb64u(e.iv, 12);
    const ct = unb64u(e.ct); if (ct.length < 17) return null;
  } catch { return null; }
  const out = { v: E2E_V, from: { uid: e.from.uid, dev: e.from.dev }, to: { uid: e.to.uid, dev: e.to.dev }, epk: e.epk, iv: e.iv, ct: e.ct };
  return JSON.stringify(out).length <= MAX_ENV ? out : null;
}

/**
 * Apre una busta.
 * me: { uid, device }
 * opts.trusted(uid, dev) → pub di cui ci si fida, oppure null
 * opts.introduce(payload) → pub da usare per un mittente sconosciuto (solo per kind 'contatto'; chi chiama
 *   controlla il segreto del codice contatto), oppure null
 * opts.seen(id) → true se l'id è già stato aperto · opts.now: ms
 * Restituisce { id, kind, at, from, body, pub }. Errori: E2EError con code
 *   formato | non-per-me | manomessa | sconosciuto | firma | scaduta | futura | ripetuta
 */
export async function openMessage(me, envelope, { trusted, introduce, seen, now } = {}) {
  const e = cleanEnvelope(envelope);
  if (!e) fail('formato');
  if (!Number.isFinite(now)) fail('ora');
  if (e.to.uid !== me?.uid || e.to.dev !== me?.device?.id) fail('non-per-me');
  const aad = canonHeader(e);
  const epkBytes = unb64u(e.epk, POINT);
  let inner;
  try {
    const epk = await importEnc(e.epk); // un punto fuori dalla curva non si importa
    const shared = await subtle.deriveBits({ name: 'ECDH', public: epk }, me.device.enc.privateKey, 256);
    const key = await aesKey(shared, epkBytes, unb64u(me.device.pub.enc, POINT), aad);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(e.iv, 12), additionalData: aad }, key, unb64u(e.ct));
    inner = JSON.parse(dec.decode(pt));
  } catch { fail('manomessa'); }
  if (!inner || typeof inner.p !== 'string' || typeof inner.s !== 'string' || inner.p.length > MAX_ENV) fail('formato');
  let p;
  try { p = JSON.parse(inner.p); } catch { fail('formato'); }
  if (!p || p.v !== E2E_V || !validId(p.id) || !KINDS.includes(p.kind) || !Number.isFinite(p.at) || !party(p.from) || !party(p.to)) fail('formato');
  // l'intestazione in chiaro deve dire le stesse cose del contenuto firmato
  if (p.from.uid !== e.from.uid || p.from.dev !== e.from.dev || p.to.uid !== e.to.uid || p.to.dev !== e.to.dev) fail('manomessa');
  let pub = cleanPub(trusted ? await trusted(p.from.uid, p.from.dev) : null);
  if (!pub && p.kind === 'contatto' && introduce) pub = cleanPub(await introduce(p));
  if (!pub || pub.dev !== p.from.dev) fail('sconosciuto');
  let ok = false;
  try { ok = await subtle.verify(SIGN, await importSig(pub.sig), unb64u(inner.s, 64), enc.encode('tempo-msg-v1\n' + inner.p)); } catch { ok = false; }
  if (!ok) fail('firma');
  if (p.at < now - MAX_AGE) fail('scaduta');
  if (p.at > now + MAX_SKEW) fail('futura'); // l'orologio di uno dei due è sbagliato: si riprova più tardi
  if (seen && await seen(p.id)) fail('ripetuta');
  return { id: p.id, kind: p.kind, at: p.at, from: { uid: p.from.uid, dev: p.from.dev }, body: p.body, pub };
}
