// Inviti senza server: una persona propone un impegno a un'altra con un messaggio di testo.
// Modulo puro: niente DOM, niente archivio, niente rete, niente Date.now() (il tempo arriva da fuori).
// Qui si codifica, si valida e si calcola. Non si applica mai nulla: l'impegno entra nel piano solo
// passando da `inviteOp` → `sanitizeOps` → `applyOps` (quindi con annulla), dopo un tocco dell'utente.
//
// Ogni conversione di orario passa dal fuso IANA indicato (Intl.DateTimeFormat), mai da quello del processo.
// Formato: `tempo:inv1:<base64url del JSON>`. Il link è `<baseUrl>#invito=<token SENZA il prefisso>`
// (il frammento non arriva mai al server); `findInvite` accetta entrambe le forme.
import { DEFAULT_PREFS, isOffDay, recurringFor } from './scheduler.js';

const PREFIX = 'tempo:inv1:';
const MAX_BYTES = 4096;       // dimensione massima del JSON decodificato
const MAX_TEXT = 20000;       // testo incollato: oltre non si guarda
const MAX_ALT = 3;
const MIN_PER_DAY = 1440;
const KINDS = ['proposta', 'risposta'];
const ANSWERS = ['si', 'no', 'altro'];
const MS_MIN = 60000;

// ---- Fusi orari (solo Intl)

const fmtCache = new Map();
function zoneFormat(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Il fuso esiste? (stringa breve, accettata da Intl) */
function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64 || /[^A-Za-z0-9_+\-/]/.test(tz)) return false;
  try { zoneFormat(tz); return true; } catch { return false; }
}

/** Parti di calendario di un istante letto nel fuso tz. */
function partsAt(ts, tz) {
  const o = {};
  for (const p of zoneFormat(tz).formatToParts(new Date(ts))) if (p.type !== 'literal') o[p.type] = +p.value;
  return o;
}
/** Scarto (ms) del fuso rispetto a UTC in quell'istante. */
function offsetAt(ts, tz) {
  const p = partsAt(Math.floor(ts / 1000) * 1000, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}
/** 'AAAA-MM-GG' + minuti dalla mezzanotte nel fuso tz → istante assoluto in ms UTC. */
function zonedToTs(d, min, tz) {
  const [y, m, dd] = d.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, dd, 0, min);
  const o1 = offsetAt(guess, tz);
  let t = guess - o1;
  const o2 = offsetAt(t, tz);
  if (o2 !== o1) t = guess - o2; // a cavallo del cambio dell'ora legale
  return t;
}
/** Istante assoluto → { d, s } nel fuso tz. */
function tsToLocal(ts, tz) {
  const p = partsAt(ts, tz);
  return { d: `${p.year}-${pad(p.month)}-${pad(p.day)}`, s: (p.hour % 24) * 60 + p.minute };
}

// ---- Date di calendario (aritmetica in UTC, indipendente dal fuso del processo)

const pad = (n) => String(n).padStart(2, '0');
function realDate(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  return y >= 1970 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === dd;
}
const addDay = (d, n) => {
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
const WD = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const MO = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const hm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; // 1440 → «24:00»
function dayLabel(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return `${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]} ${dd} ${MO[m - 1]}`;
}

// ---- Base64url (browser e Node, senza Buffer)

function toB64u(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(tok) {
  let b = tok.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (b.length % 4 === 1) throw new Error('base64');
  b += '='.repeat((4 - (b.length % 4)) % 4);
  const bin = atob(b);
  if (bin.length > MAX_BYTES) throw new Error('troppo grande');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// ---- Validazione (gemella di sanitizeOps)

/** Testo pulito: niente caratteri di controllo, di direzione o parentesi angolari; accorciato. */
function clean(v, max) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const okId = (v) => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(v);

/** Controlla d/s/e/ts; restituisce {d,s,e,ts} oppure null. `ts` che non torna con d/s/tz viene ricalcolato. */
function cleanSlot(r, tz, now) {
  if (!r || typeof r !== 'object') return null;
  const { d, s, e } = r;
  if (!realDate(d) || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > MIN_PER_DAY || e - s < 5) return null;
  let ts = zonedToTs(d, s, tz);
  if (Number.isFinite(r.ts) && Math.abs(r.ts - ts) <= MS_MIN) ts = Math.round(r.ts);
  if (Number.isFinite(now) && (ts < now - 2 * 864e5 || ts > now + 400 * 864e5)) return null;
  return { d, s, e, ts };
}

/**
 * Tiene solo un invito valido (proposta o risposta); altrimenti null. Non lancia mai.
 * @param {*} raw  oggetto arrivato da fuori
 * @param {number} [now]  ms UTC: se c'è, scarta date più di 2 giorni nel passato o 400 nel futuro
 */
export function sanitizeInvite(raw, now) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.v !== 1 || !KINDS.includes(raw.kind) || !okId(raw.id)) return null;
    const tz = raw.tz;
    if (!validTz(tz)) return null;
    const slot = cleanSlot(raw, tz, now);
    if (!slot) return null;
    const t = clean(raw.t, 80);
    if (!t) return null;
    const from = clean(raw.from, 40);
    if (raw.kind === 'proposta') {
      return { v: 1, kind: 'proposta', id: raw.id, t, ...slot, tz, from, note: clean(raw.note, 140) };
    }
    if (!ANSWERS.includes(raw.ans) || !okId(raw.re)) return null;
    const alt = [];
    if (raw.ans === 'altro' && Array.isArray(raw.alt)) {
      for (const a of raw.alt.slice(0, 8)) {
        const c = cleanSlot(a, tz, now);
        if (c && alt.length < MAX_ALT) alt.push(c);
      }
    }
    return { v: 1, kind: 'risposta', id: raw.id, re: raw.re, ans: raw.ans, alt, t, ...slot, tz, from };
  } catch { return null; }
}

// ---- Creazione

/**
 * Crea una proposta. Restituisce null se i dati non sono validi.
 * @param {{title:string,date:string,start:number,end:number,tz:string,from?:string,note?:string}} p  start/end in minuti dalla mezzanotte locale
 * @param {{id:string,now?:number}} o  l'id lo dà chi chiama (crypto.randomUUID nell'app)
 */
export function makeInvite(p, { id, now } = {}) {
  try {
    if (!validTz(p?.tz) || !realDate(p?.date)) return null;
    return sanitizeInvite({
      v: 1, kind: 'proposta', id, t: p.title, d: p.date, s: p.start, e: p.end, tz: p.tz,
      ts: zonedToTs(p.date, p.start, p.tz), from: p.from || '', note: p.note || '',
    }, now);
  } catch { return null; }
}

/**
 * Crea la risposta a una proposta. `answer` è 'si' | 'no' | 'altro'. Le alternative (da `fitInvite`, nel fuso di chi
 * risponde) contano per il loro `ts`: giorno e orari vengono riscritti nel fuso della proposta e con la sua durata,
 * così proposta e risposta si leggono nello stesso fuso. Il titolo e lo spazio originali restano nella risposta.
 */
export function makeReply(invite, { answer, alternatives, from } = {}, { id, now } = {}) {
  try {
    const inv = sanitizeInvite(invite);
    if (!inv || inv.kind !== 'proposta' || !ANSWERS.includes(answer)) return null;
    const dur = inv.e - inv.s;
    const alt = [];
    if (answer === 'altro') {
      for (const a of Array.isArray(alternatives) ? alternatives : []) {
        if (!Number.isFinite(a?.ts) || alt.length >= MAX_ALT) continue;
        const l = tsToLocal(a.ts, inv.tz);
        if (l.s + dur > MIN_PER_DAY) continue;
        alt.push({ d: l.d, s: l.s, e: l.s + dur, ts: Math.round(a.ts) });
      }
    }
    return sanitizeInvite({
      v: 1, kind: 'risposta', id, re: inv.id, ans: answer, alt, t: inv.t, d: inv.d, s: inv.s, e: inv.e, tz: inv.tz, ts: inv.ts, from: from || '',
    }, now);
  } catch { return null; }
}

// ---- Codifica e lettura

/** Invito → `tempo:inv1:<base64url>`. Restituisce '' se non è un invito valido. */
export function encodeInvite(obj) {
  try {
    const o = sanitizeInvite(obj);
    return o ? PREFIX + toB64u(JSON.stringify(o)) : '';
  } catch { return ''; }
}

const decodeToken = (tok, now) => {
  try { return sanitizeInvite(JSON.parse(fromB64u(tok)), now); } catch { return null; }
};
/** Il token può essere spezzato da a-capo o seguito da parole: si prova da tutti i pezzi a uno solo. */
function tryChunks(capture, now) {
  const chunks = capture.split(/\s+/).filter(Boolean).slice(0, 200);
  for (let k = chunks.length; k >= 1; k--) {
    const tok = chunks.slice(0, k).join('');
    if (tok.length > 6000) continue;
    const o = decodeToken(tok, now);
    if (o) return o;
  }
  return null;
}

/**
 * Cerca il primo invito valido in un testo incollato o in un indirizzo con `invito=`.
 * Tollera testo attorno, a-capo dentro il token, punteggiatura finale e codifica %XX. Restituisce l'oggetto pulito o null.
 * @param {string} text
 * @param {number} [now]  vedi sanitizeInvite
 */
export function findInvite(text, now) {
  try {
    if (typeof text !== 'string') return null;
    const src = text.slice(0, MAX_TEXT);
    let dec = src;
    try { dec = decodeURIComponent(src); } catch { /* resta com'è */ }
    for (const s of dec === src ? [src] : [src, dec]) {
      for (const re of [/tempo:inv1:((?:(?!tempo:inv1:)[A-Za-z0-9_\-\s])*)/gi, /invito=(?:tempo:inv1:)?([A-Za-z0-9_\-\s]*)/gi]) {
        let n = 0;
        for (const m of s.matchAll(re)) {
          if (++n > 5) break;
          const o = tryChunks(m[1], now);
          if (o) return o;
        }
      }
    }
    return null;
  } catch { return null; }
}

// ---- Messaggio da condividere

const slotLabel = (x) => `${dayLabel(x.d)}, ${hm(x.s)}`;

/**
 * Il messaggio da mandare: leggibile anche da chi non ha Tempo, con il token tra parentesi quadre nell'ultima riga.
 * @param {object} obj  proposta o risposta
 * @param {{baseUrl?:string, tz?:string}} [o]  baseUrl: se c'è, aggiunge il link `…#invito=<token senza prefisso>`;
 *   tz: mostra gli orari in quel fuso (di default quello dell'invito)
 */
export function inviteText(obj, { baseUrl, tz } = {}) {
  const o = sanitizeInvite(obj);
  if (!o) return '';
  const token = encodeInvite(o);
  let view = { d: o.d, s: o.s, e: o.e };
  let zone = o.tz;
  if (tz && validTz(tz) && tz !== o.tz) {
    const l = localSlot(o, tz);
    if (l) { view = l; zone = tz; }
  }
  const lines = [];
  if (o.kind === 'proposta') {
    lines.push(`Ti propongo: ${o.t} · ${slotLabel(view)}–${hm(view.e)} (${zone}).`);
    if (o.note) lines.push(`Nota: ${o.note}`);
    lines.push('Per rispondere apri Tempo e incolla questo messaggio.');
  } else if (o.ans === 'si') {
    lines.push(`Va bene: ${o.t} · ${slotLabel(view)}.`);
  } else {
    let l = `Non riesco: ${o.t} · ${slotLabel(view)}.`;
    if (o.ans === 'altro' && o.alt.length) {
      const dur = view.e - view.s;
      l += ` Ti propongo invece: ${o.alt.map((a) => {
        const x = zone === o.tz ? a : (localSlot({ ...a, e: a.s + dur, tz: o.tz }, zone) || a);
        return `${dayLabel(x.d)} ${hm(x.s)}`;
      }).join(', ')}.`;
    }
    lines.push(l);
  }
  if (o.kind === 'risposta') lines.push('Apri Tempo e incolla questo messaggio per vedere la risposta.');
  if (baseUrl && typeof baseUrl === 'string') lines.push(`${baseUrl.replace(/#.*$/, '')}#invito=${token.slice(PREFIX.length)}`);
  lines.push(`[${token}]`);
  return lines.join('\n');
}

// ---- Dal punto di vista di chi riceve

/**
 * La proposta nel fuso di chi riceve → { d, s, e } (gestisce cambio di giorno e ora legale).
 * Se l'orario sfora la mezzanotte locale, `e` è tagliato a 1440.
 */
export function localSlot(invite, tz) {
  try {
    if (!validTz(tz) || !Number.isFinite(invite?.ts) || !Number.isFinite(invite?.s) || !Number.isFinite(invite?.e)) return null;
    const l = tsToLocal(invite.ts, tz);
    return { d: l.d, s: l.s, e: Math.min(MIN_PER_DAY, l.s + (invite.e - invite.s)) };
  } catch { return null; }
}

/** Impegni fissi di un giorno: eventi (e attività con orario) non finiti, più le ricorrenze. Solo orari e titoli. */
function busyOn(state, day) {
  const out = [];
  const items = [...(state?.items || []), ...recurringFor(day, state?.recurring || [])];
  for (const it of items) {
    if (!it || it.status === 'done' || it.date !== day || !Number.isFinite(it.start)) continue;
    const end = Math.min(MIN_PER_DAY, it.start + (it.duration || 60));
    if (end > it.start) out.push({ title: String(it.title || ''), start: it.start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

/**
 * Controlla la proposta contro il piano di chi riceve, senza modificarlo.
 * Contano solo gli impegni fissi (le attività flessibili le sposta lo scheduler).
 * Finestra di veglia: `prefs.availability[giorno]` se c'è, altrimenti `prefs.dayStart`–`prefs.dayEnd`
 * (default dello scheduler 08:00–23:00); i giorni di riposo (`isOffDay`) non ricevono alternative.
 * Alternative: fino a 3 fasce della stessa durata, a passi di 15 minuti, non sovrapposte tra loro né agli impegni,
 * mai nel passato, le più vicine alla proposta per prime, sui 7 giorni che partono da max(oggi, giorno proposto − 3).
 * @returns {{fits:boolean, slot:{d,s,e}, conflicts:{title:string,start:number,end:number}[], alternatives:{d,s,e,ts}[]}|null}
 */
export function fitInvite(state, invite, { tz, now, prefs } = {}) {
  try {
    const slot = localSlot(invite, tz);
    if (!slot || !Number.isFinite(now)) return null;
    const P = { ...DEFAULT_PREFS, ...(prefs || state?.prefs || {}) };
    const conflicts = busyOn(state, slot.d).filter((b) => overlaps(slot.s, slot.e, b.start, b.end));
    const past = invite.ts < now;
    const dur = slot.e - slot.s;
    const today = tsToLocal(now, tz).d;
    const first = slot.d > addDay(today, 3) ? addDay(slot.d, -3) : today;
    const cands = [];
    for (let i = 0; i < 7; i++) {
      const day = addDay(first, i);
      if (isOffDay(P, day)) continue;
      const win = (P.availability || {})[day];
      const ws = Math.max(0, win?.start ?? P.dayStart), we = Math.min(MIN_PER_DAY, win?.end ?? P.dayEnd);
      const busy = busyOn(state, day);
      for (let s = Math.ceil(ws / 15) * 15; s + dur <= we; s += 15) {
        if (busy.some((b) => overlaps(s, s + dur, b.start, b.end))) continue;
        const ts = zonedToTs(day, s, tz);
        if (ts < now || ts === invite.ts) continue;
        cands.push({ d: day, s, e: s + dur, ts });
      }
    }
    cands.sort((a, b) => Math.abs(a.ts - invite.ts) - Math.abs(b.ts - invite.ts) || a.ts - b.ts);
    const alternatives = [];
    for (const c of cands) {
      if (alternatives.length >= MAX_ALT) break;
      if (alternatives.some((a) => a.d === c.d && overlaps(a.s, a.e, c.s, c.e))) continue;
      alternatives.push(c);
    }
    return { fits: !past && conflicts.length === 0, slot, conflicts, alternatives };
  } catch { return null; }
}

/**
 * L'operazione da dare alla pipeline esistente (`sanitizeOps` → `applyOps`) per aggiungere la proposta come
 * impegno fisso nel piano di chi riceve. Il titolo non ha prefissi; la nota è «da <chi>» se c'è.
 * Questo modulo non chiama mai applyOps.
 */
export function inviteOp(invite, tz) {
  const l = localSlot(invite, tz);
  if (!l) return null;
  const op = { action: 'add', kind: 'event', title: invite.t, date: l.d, start_time: hm(l.s), duration_min: l.e - l.s };
  if (invite.from) op.note = `da ${invite.from}`;
  return op;
}

// ---- iCalendar per chi non ha Tempo

const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (ts) => { const d = new Date(ts); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
/** Righe lunghe al massimo 75 byte (UTF-8); la continuazione inizia con uno spazio. */
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

/** Un evento iCalendar minimo (UID = id, orari in UTC, fine riga CRLF). DTSTAMP = inizio: il modulo non conosce l'ora attuale. */
export function icsOf(invite) {
  const o = sanitizeInvite(invite);
  if (!o) return '';
  const end = o.ts + (o.e - o.s) * MS_MIN;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tempo//Invito//IT', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${o.id}`, `DTSTAMP:${icsTime(o.ts)}`, `DTSTART:${icsTime(o.ts)}`, `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsEsc(o.t)}`,
  ];
  const desc = [o.from && `Da ${o.from}`, o.kind === 'proposta' && o.note].filter(Boolean).join('. ');
  if (desc) lines.push(`DESCRIPTION:${icsEsc(desc)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
