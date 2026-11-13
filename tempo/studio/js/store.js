// Stato di tempo studio: brani, versioni (con impronta), ok, cose da fare, registro.
// Come in Tempo: chi propone (parser della chat, AI) manda operazioni; qui vengono validate e applicate.
import { uid, dateKey } from './util.js';
import { HEX, matches } from './hash.js';

const KEY = 'tempo.studio.v1';
export const SCHEMA = 1;

export const STAGES = ['idea', 'beat', 'take', 'mix', 'master', 'uscita'];

export function emptyState() {
  return {
    schema: SCHEMA,
    me: { name: '', phone: '' },
    ai: { base: '', key: '', model: '' },
    tracks: [],    // { id, title, artist, stage, createdAt }
    versions: [],  // { id, trackId, n, fileName, size, duration, hash, peaks, blobId, addedAt }
    approvals: [], // { id, trackId, versionId, hash, by, at, source, text }
    tasks: [],     // { id, trackId, who, what, due, done, at, source }
    log: [],       // { id, trackId, at, kind, who, text }
  };
}

// ---- validazione: anche un backup importato passa di qui
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const sid = (v) => (typeof v === 'string' && SAFE_ID.test(v) ? v : null);
const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, max) : v == null ? '' : String(v).slice(0, max));
const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d);
const arr = (v) => (Array.isArray(v) ? v : []);
const date = (v) => (typeof v === 'string' && DATE.test(v) ? v : null);
const time = (v, d) => num(v, 0, 8.64e15, d);

export function sanitizeState(raw) {
  const s = { ...emptyState(), ...(raw && typeof raw === 'object' ? raw : {}) };
  const withId = (list) => arr(list).filter((x) => x && typeof x === 'object' && sid(x.id));
  s.me = { name: str(s.me?.name, 40), phone: str(s.me?.phone, 20) };
  s.ai = { base: str(s.ai?.base, 200), key: str(s.ai?.key, 200), model: str(s.ai?.model, 80) };
  s.tracks = withId(s.tracks).map((t) => ({ id: t.id, title: str(t.title, 80) || 'senza titolo', artist: str(t.artist, 40), stage: num(t.stage, 0, STAGES.length - 1, 0) | 0, createdAt: time(t.createdAt, Date.now()) }));
  const tids = new Set(s.tracks.map((t) => t.id));
  s.versions = withId(s.versions).filter((v) => tids.has(v.trackId)).map((v) => ({
    id: v.id, trackId: v.trackId, n: num(v.n, 1, 999, 1) | 0, fileName: str(v.fileName, 120), size: num(v.size, 0, 1e11),
    duration: num(v.duration, 0, 86400), hash: typeof v.hash === 'string' && /^[0-9a-f]{64}$/.test(v.hash) ? v.hash : null,
    peaks: arr(v.peaks).slice(0, 96).map((p) => num(p, 0, 1)), blobId: sid(v.blobId), addedAt: time(v.addedAt, Date.now()),
  })).filter((v) => v.hash);
  const vids = new Set(s.versions.map((v) => v.id));
  s.approvals = withId(s.approvals).filter((a) => vids.has(a.versionId)).map((a) => ({ id: a.id, trackId: a.trackId, versionId: a.versionId, hash: str(a.hash, 64), by: str(a.by, 40), at: time(a.at, Date.now()), source: ['link', 'chat', 'mano', 'ai'].includes(a.source) ? a.source : 'mano', text: str(a.text, 300) }));
  s.tasks = withId(s.tasks).filter((t) => tids.has(t.trackId)).map((t) => ({ id: t.id, trackId: t.trackId, who: str(t.who, 40), what: str(t.what, 140), due: date(t.due), done: !!t.done, at: time(t.at, Date.now()), source: str(t.source, 10) }));
  s.log = withId(s.log).filter((l) => tids.has(l.trackId)).slice(-500).map((l) => ({ id: l.id, trackId: l.trackId, at: time(l.at, Date.now()), kind: str(l.kind, 12), who: str(l.who, 40), text: str(l.text, 300) }));
  s.schema = SCHEMA;
  return s;
}

let saveError = false;
export const saveFailed = () => saveError;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeState(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveError = false;
  } catch {
    saveError = true;
  }
  return !saveError;
}

// ---- annulla: istantanee in memoria
const undoStack = [];
export function snapshot(state, label) {
  undoStack.push({ label, json: JSON.stringify(state) });
  if (undoStack.length > 20) undoStack.shift();
}
export const canUndo = () => undoStack.length > 0;
export function undo(state) {
  const u = undoStack.pop();
  if (!u) return null;
  const prev = JSON.parse(u.json);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, prev);
  return u.label;
}

// ---- letture
export const trackOf = (s, id) => s.tracks.find((t) => t.id === id) || null;
export const versionsOf = (s, tid) => s.versions.filter((v) => v.trackId === tid).sort((a, b) => b.n - a.n);
export const latestVersion = (s, tid) => versionsOf(s, tid)[0] || null;
export const approvalsOf = (s, vid) => s.approvals.filter((a) => a.versionId === vid).sort((a, b) => b.at - a.at);
export const openTasks = (s, tid) => s.tasks.filter((t) => t.trackId === tid && !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.at - b.at);
export const logOf = (s, tid) => s.log.filter((l) => l.trackId === tid).sort((a, b) => b.at - a.at);

/** Ultima versione con un ok, e l'ok più recente. */
export function approvedVersion(s, tid) {
  const nOf = (a) => s.versions.find((x) => x.id === a.versionId)?.n || 0;
  const list = s.approvals.filter((a) => a.trackId === tid).sort((a, b) => b.at - a.at || nOf(b) - nOf(a));
  for (const a of list) {
    const v = s.versions.find((x) => x.id === a.versionId);
    if (v) return { version: v, approval: a };
  }
  return null;
}

/** Riassunto di una riga per la libreria e per la vista del brano. */
export function statusOf(s, tid) {
  const last = latestVersion(s, tid);
  const ok = approvedVersion(s, tid);
  if (!last) return { kind: 'vuoto', text: 'nessun bounce' };
  if (ok && ok.version.id === last.id) return { kind: 'ok', text: `v${last.n} ok`, ok };
  if (ok) return { kind: 'attesa', text: `v${ok.version.n} ok · v${last.n} da sentire`, ok };
  return { kind: 'attesa', text: `v${last.n} senza ok` };
}

/** Cosa fare adesso: la prossima cosa aperta con scadenza, poi le altre. */
export const nextStep = (s, tid) => openTasks(s, tid)[0] || null;

/** Una versione con questa impronta, in qualsiasi brano. */
export function findByHash(s, hash) {
  const v = s.versions.find((x) => x.hash === hash);
  if (!v) return null;
  return { version: v, track: trackOf(s, v.trackId), approval: approvalsOf(s, v.id)[0] || null };
}

// ---- scritture dirette (UI)
function addLog(s, trackId, kind, who, text, at = Date.now()) {
  s.log.push({ id: uid(), trackId, at, kind, who: str(who, 40), text: str(text, 300) });
}

export function addTrack(s, { title, artist }, now = Date.now()) {
  const t = { id: uid(), title: str(title, 80).trim() || 'senza titolo', artist: str(artist, 40).trim(), stage: 0, createdAt: now };
  s.tracks.unshift(t);
  addLog(s, t.id, 'brano', s.me.name, 'brano creato', now);
  return t;
}

export function deleteTrack(s, id) {
  const blobs = s.versions.filter((v) => v.trackId === id).map((v) => v.blobId).filter(Boolean);
  s.tracks = s.tracks.filter((t) => t.id !== id);
  s.versions = s.versions.filter((v) => v.trackId !== id);
  s.approvals = s.approvals.filter((a) => a.trackId !== id);
  s.tasks = s.tasks.filter((t) => t.trackId !== id);
  s.log = s.log.filter((l) => l.trackId !== id);
  return blobs;
}

/** Nuova versione. Se l'impronta c'è già nel brano, restituisce quella esistente con `dup: true`. */
export function addVersion(s, trackId, f, now = Date.now()) {
  if (!trackOf(s, trackId)) throw new Error('brano non trovato');
  if (!/^[0-9a-f]{64}$/.test(f.hash || '')) throw new Error('impronta non valida');
  const same = s.versions.find((v) => v.trackId === trackId && v.hash === f.hash);
  if (same) return { version: same, dup: true };
  const n = Math.max(0, ...s.versions.filter((v) => v.trackId === trackId).map((v) => v.n)) + 1;
  const v = { id: uid(), trackId, n, fileName: str(f.fileName, 120), size: num(f.size, 0, 1e11), duration: num(f.duration, 0, 86400), hash: f.hash, peaks: arr(f.peaks).slice(0, 96), blobId: sid(f.blobId), addedAt: now };
  s.versions.push(v);
  addLog(s, trackId, 'versione', s.me.name, `v${n} caricata · ${v.fileName}`, now);
  return { version: v, dup: false };
}

export function deleteVersion(s, vid) {
  const v = s.versions.find((x) => x.id === vid);
  if (!v) return null;
  s.versions = s.versions.filter((x) => x.id !== vid);
  s.approvals = s.approvals.filter((a) => a.versionId !== vid);
  addLog(s, v.trackId, 'versione', s.me.name, `v${v.n} eliminata`);
  return v.blobId;
}

export function setStage(s, tid, stage) {
  const t = trackOf(s, tid);
  const st = num(stage, 0, STAGES.length - 1, t?.stage ?? 0) | 0;
  if (!t || t.stage === st) return;
  t.stage = st;
  addLog(s, tid, 'fase', s.me.name, `fase → ${String(st + 1).padStart(2, '0')} ${STAGES[st]}`);
}

export function toggleTask(s, id) {
  const t = s.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  addLog(s, t.trackId, 'fatto', s.me.name, `${t.done ? 'fatto' : 'riaperto'}: ${t.who ? t.who + ' · ' : ''}${t.what}`);
}

export function renameTrack(s, id, { title, artist }) {
  const t = trackOf(s, id);
  if (!t) return;
  if (title != null) t.title = str(title, 80).trim() || t.title;
  if (artist != null) t.artist = str(artist, 40).trim();
}

// ---- operazioni proposte (chat, link, AI, mano)
const ACTIONS = ['approve', 'request', 'task', 'decide', 'stage'];

/** Tiene solo operazioni ben formate. Tutto ciò che arriva dall'AI o da una chat passa di qui. */
export function sanitizeOps(raw) {
  return arr(raw).slice(0, 60).map((o) => {
    if (!o || typeof o !== 'object' || !ACTIONS.includes(o.action)) return null;
    const op = { action: o.action, at: time(o.at, Date.now()), by: str(o.by, 40).trim() };
    if (o.action === 'approve' || o.action === 'request') {
      op.version = o.version == null ? null : String(o.version).toLowerCase().replace(/^#/, '').slice(0, 64);
      op.source = ['link', 'chat', 'mano', 'ai'].includes(o.source) ? o.source : 'chat';
      op.text = str(o.text, 300);
    }
    if (o.action === 'task') {
      op.who = str(o.who, 40).trim(); op.what = str(o.what, 140).trim(); op.due = date(o.due);
      if (!op.what) return null;
    }
    if (o.action === 'decide') { op.text = str(o.text, 300).trim(); if (!op.text) return null; }
    if (o.action === 'stage') { op.stage = +o.stage; if (!Number.isInteger(op.stage) || op.stage < 0 || op.stage >= STAGES.length) return null; }
    if (o.action === 'request') op.text = str(o.text, 300).trim();
    return op;
  }).filter(Boolean);
}

/** v3, 3, #a1b2c3d4… → versione del brano. Senza riferimento: l'ultima caricata prima di `at`. */
export function resolveVersion(s, tid, ref, at = Date.now()) {
  const list = versionsOf(s, tid);
  if (ref) {
    const r = String(ref).toLowerCase().replace(/^#/, '');
    if (HEX.test(r) && r.length >= 8) return list.find((v) => matches(v.hash, r)) || null;
    const n = +(r.match(/^v?(\d{1,3})$/)?.[1] || 0);
    if (n) return list.find((v) => v.n === n) || null;
    return null;
  }
  return list.find((v) => v.addedAt <= at) || list[list.length - 1] || null;
}

/** Applica le operazioni al brano `tid`. Restituisce cosa è successo e cosa no. */
export function applyOps(s, tid, ops, now = Date.now()) {
  const done = [];
  const errors = [];
  if (!trackOf(s, tid)) return { done, errors: ['brano non trovato'] };
  for (const op of sanitizeOps(ops)) {
    if (op.action === 'approve') {
      const v = resolveVersion(s, tid, op.version, op.at);
      if (!v) { errors.push(`versione ${op.version || ''} non trovata`.replace('  ', ' ')); continue; }
      if (s.approvals.some((a) => a.versionId === v.id && a.by.toLowerCase() === op.by.toLowerCase())) { errors.push(`ok di ${op.by || '?'} su v${v.n} già registrato`); continue; }
      s.approvals.push({ id: uid(), trackId: tid, versionId: v.id, hash: v.hash, by: op.by, at: op.at, source: op.source, text: op.text });
      addLog(s, tid, 'ok', op.by, `✓ ok su v${v.n} (${op.source})`, op.at);
      done.push(`✓ v${v.n} · ${op.by || '?'}`);
    } else if (op.action === 'request') {
      const v = resolveVersion(s, tid, op.version, op.at);
      const what = `modifiche${v ? ` v${v.n}` : ''}${op.text ? `: ${op.text}` : ''}`.slice(0, 140);
      if (s.tasks.some((t) => t.trackId === tid && t.what === what)) { errors.push('richiesta già registrata'); continue; }
      s.tasks.push({ id: uid(), trackId: tid, who: s.me.name || 'io', what, due: null, done: false, at: op.at, source: op.source });
      addLog(s, tid, 'modifica', op.by, `✎ ${what}`, op.at);
      done.push(`✎ ${what}`);
    } else if (op.action === 'task') {
      if (s.tasks.some((t) => t.trackId === tid && t.what === op.what && !t.done)) { errors.push(`già in lista: ${op.what}`); continue; }
      s.tasks.push({ id: uid(), trackId: tid, who: op.who, what: op.what, due: op.due, done: false, at: op.at, source: 'chat' });
      addLog(s, tid, 'compito', op.by, `→ ${op.who ? op.who + ' · ' : ''}${op.what}`, op.at);
      done.push(`→ ${op.who || '?'} · ${op.what}`);
    } else if (op.action === 'decide') {
      if (s.log.some((l) => l.trackId === tid && l.kind === 'decisione' && l.text === op.text)) { errors.push('decisione già nel registro'); continue; }
      addLog(s, tid, 'decisione', op.by, op.text, op.at);
      done.push(`◆ ${op.text}`);
    } else if (op.action === 'stage') {
      setStage(s, tid, op.stage);
      done.push(`fase ${STAGES[op.stage]}`);
    }
  }
  return { done, errors };
}

export const todayKey = (now = Date.now()) => dateKey(now);

// ---- demo: un brano finto per vedere com'è, senza audio sul dispositivo
export function demoState(now = Date.now()) {
  const s = emptyState();
  s.me.name = 'davide';
  const H = 3600e3;
  const D = 24 * H;
  const hex = (seed) => { let x = seed, o = ''; while (o.length < 64) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; o += x.toString(16).padStart(8, '0'); } return o.slice(0, 64); };
  const wave = (seed, len = 48) => Array.from({ length: len }, (_, i) => Math.round((0.35 + 0.65 * Math.abs(Math.sin(i * 0.37 + seed) * Math.cos(i * 0.11 + seed * 2))) * 100) / 100);
  const t1 = { id: 'demo1', title: 'notte a ortigia', artist: 'midi', stage: 3, createdAt: now - 12 * D };
  const t2 = { id: 'demo2', title: 'vetro', artist: 'sara', stage: 1, createdAt: now - 4 * D };
  const t3 = { id: 'demo3', title: 'scirocco', artist: 'midi', stage: 5, createdAt: now - 40 * D };
  s.tracks = [t1, t2, t3];
  s.versions = [
    { id: 'd1v1', trackId: 'demo1', n: 1, fileName: 'ortigia_demo.wav', size: 41.2e6, duration: 214, hash: hex(11), peaks: wave(1), blobId: null, addedAt: now - 10 * D },
    { id: 'd1v2', trackId: 'demo1', n: 2, fileName: 'ortigia_mix2.wav', size: 44.9e6, duration: 222, hash: hex(12), peaks: wave(2), blobId: null, addedAt: now - 5 * D },
    { id: 'd1v3', trackId: 'demo1', n: 3, fileName: 'ortigia_mix3_voxup.wav', size: 45.1e6, duration: 222, hash: hex(13), peaks: wave(3), blobId: null, addedAt: now - 1 * D },
    { id: 'd2v1', trackId: 'demo2', n: 1, fileName: 'vetro_beat_140.wav', size: 30.4e6, duration: 168, hash: hex(21), peaks: wave(4), blobId: null, addedAt: now - 3 * D },
    { id: 'd3v1', trackId: 'demo3', n: 1, fileName: 'scirocco_master.wav', size: 52.3e6, duration: 189, hash: hex(31), peaks: wave(5), blobId: null, addedAt: now - 30 * D },
  ];
  s.approvals = [
    { id: 'da1', trackId: 'demo1', versionId: 'd1v2', hash: hex(12), by: 'midi', at: now - 4 * D, source: 'link', text: '' },
    { id: 'da3', trackId: 'demo3', versionId: 'd3v1', hash: hex(31), by: 'midi', at: now - 29 * D, source: 'chat', text: '' },
  ];
  const k = (d) => dateKey(now + d * D);
  s.tasks = [
    { id: 'dt1', trackId: 'demo1', who: 'midi', what: 'rifare la doppia della strofa 2', due: k(1), done: false, at: now - 1 * D, source: 'chat' },
    { id: 'dt2', trackId: 'demo1', who: 'davide', what: 'alzare la voce nel ritornello di 1 dB', due: k(3), done: false, at: now - 1 * D, source: 'chat' },
    { id: 'dt3', trackId: 'demo2', who: 'sara', what: 'mandare il topline del ritornello', due: k(2), done: false, at: now - 2 * D, source: 'chat' },
  ];
  s.log = [
    { id: 'dl1', trackId: 'demo1', at: now - 12 * D, kind: 'brano', who: 'davide', text: 'brano creato' },
    { id: 'dl2', trackId: 'demo1', at: now - 10 * D, kind: 'versione', who: 'davide', text: 'v1 caricata · ortigia_demo.wav' },
    { id: 'dl3', trackId: 'demo1', at: now - 6 * D, kind: 'decisione', who: 'midi', text: 'teniamo il beat a 92, niente cambio di tonalità' },
    { id: 'dl4', trackId: 'demo1', at: now - 5 * D, kind: 'versione', who: 'davide', text: 'v2 caricata · ortigia_mix2.wav' },
    { id: 'dl5', trackId: 'demo1', at: now - 4 * D, kind: 'ok', who: 'midi', text: '✓ ok su v2 (link)' },
    { id: 'dl6', trackId: 'demo1', at: now - 1 * D, kind: 'versione', who: 'davide', text: 'v3 caricata · ortigia_mix3_voxup.wav' },
    { id: 'dl7', trackId: 'demo2', at: now - 4 * D, kind: 'brano', who: 'davide', text: 'brano creato' },
    { id: 'dl8', trackId: 'demo3', at: now - 29 * D, kind: 'ok', who: 'midi', text: '✓ ok su v1 (chat)' },
  ];
  return s;
}
