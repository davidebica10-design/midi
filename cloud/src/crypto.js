// Crittografia con le sole Web Crypto API (uguali su Cloudflare Workers, Node 20+ e browser).
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Un token casuale da 32 byte, leggibile in un URL. */
export const randomToken = (prefix = 'tmp') => `${prefix}_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
export const randomId = () => b64url(crypto.getRandomValues(new Uint8Array(9)));

export async function sha256hex(text) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// PBKDF2: Cloudflare Workers accetta al massimo 100.000 iterazioni
export const PBKDF2_ITER = 100000;
export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16)), iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return { salt: b64(salt), hash: b64(bits), iter };
}
/** Confronto a tempo costante. */
export async function verifyPassword(password, rec) {
  if (!rec?.salt || !rec?.hash) return false;
  const h = await hashPassword(password, unb64(rec.salt), rec.iter || PBKDF2_ITER);
  const a = unb64(h.hash), b = unb64(rec.hash);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** Chiave AES-GCM per un utente, derivata (HKDF) dal segreto del server: ogni utente ha la sua. */
async function userKey(secret, uid) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('tempo-cloud-v1'), info: enc.encode(uid) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** Cifra un valore JSON per un utente (i dati sono cifrati anche dentro il database). */
export async function seal(secret, uid, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await userKey(secret, uid), enc.encode(JSON.stringify(value)));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv); out.set(new Uint8Array(ct), 12);
  return 'v1:' + b64(out);
}
export async function unseal(secret, uid, sealed) {
  if (typeof sealed !== 'string' || !sealed.startsWith('v1:')) return null;
  const raw = unb64(sealed.slice(3));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, await userKey(secret, uid), raw.subarray(12));
  return JSON.parse(dec.decode(pt));
}
