// Piccoli attrezzi condivisi: DOM sicuro (mai innerHTML con dati utente), formati, id.

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Crea un elemento. props: class, text, attrs, on{Evento}, dataset. I figli stringa diventano testo. */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** 3:42 */
export const fmtDur = (s) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${pad2(s % 60)}` : '--:--');

/** 12.11 */
export const fmtDay = (t) => { const d = new Date(t); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`; };

/** 18:04 */
export const fmtTime = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

const WD = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
/** ven 14.11 */
export const fmtDue = (key) => {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WD[dt.getDay()]} ${pad2(d)}.${pad2(m)}`;
};

/** 48.2 mb */
export const fmtSize = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} mb` : b >= 1e3 ? `${Math.round(b / 1e3)} kb` : `${b || 0} b`);

/** a1b2 c3d4 e5f6: le prime 12 cifre dell'impronta, a gruppi di 4. */
export const fmtPrint = (hash) => (hash ? hash.slice(0, 12).match(/.{1,4}/g).join(' ') : '—');

/** Estensione del file in minuscolo, senza punto. */
export const extOf = (name) => (String(name || '').match(/\.([a-z0-9]{1,5})$/i)?.[1] || '').toLowerCase();

export const dateKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

/** Numero a due cifre per i conteggi: 04 brani. */
export const count = (n) => pad2(n);

// base64url per testo unicode
export function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Seme numerico stabile da una stringa (per le copertine). */
export function seedOf(str) {
  let x = 2166136261;
  for (const c of String(str)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
