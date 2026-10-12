// L'account Tempo Cloud (cartella cloud/ del repository): lo stesso tempo su iPhone, Mac e web, e un
// accesso per Siri, Comandi rapidi, CarPlay e assistenti AI. Facoltativo: senza account tutto resta sul
// dispositivo come prima. Le chiavi AI e le impostazioni del dispositivo non lasciano mai il dispositivo.
//
// Sincronizzazione: il server tiene una revisione. Chi salva con la revisione giusta vince; chi arriva
// dopo riceve lo stato attuale (409), unisce voce per voce (mergeStates) e riprova.

import { cleanChecklist } from './store.js';

/** Indirizzo predefinito del server (vuoto finché non lo pubblichi: vedi cloud/README.md). */
export const DEFAULT_CLOUD_URL = '';

const SYNCED = ['items', 'habits', 'learned', 'seenObs', 'welcome', 'askChat', 'timeChat', 'askIntro', 'focus', 'prefs', 'recurring', 'memory', 'goals', 'goalsDone', 'projects', 'log', 'onboarded', 'anchors', 'chat', 'stats', 'skins', 'recaps', 'schema'];

/** Cosa va al server: tutto lo stato tranne le impostazioni del dispositivo (chiavi AI comprese). */
export function cloudPayload(state) {
  const out = {};
  for (const k of SYNCED) if (state[k] !== undefined) out[k] = state[k];
  out.settings = { name: state.settings?.name || '' };
  return JSON.parse(JSON.stringify(out));
}

const tsOf = (x) => Math.max(+x?.updatedAt || 0, +x?.doneAt || 0, +x?.startedAt || 0, +x?.createdAt || 0, +x?.at || 0, +x?.archivedAt || 0);
const bornOf = (x) => +x?.createdAt || +x?.at || 0;

/**
 * Unisce due elenchi di voci con id. lastSync = quando i due dispositivi erano d'accordo l'ultima volta.
 * - presente da entrambe le parti: vince la versione modificata più di recente;
 * - solo da una parte: se è nata dopo l'ultima sincronizzazione è nuova (si tiene); altrimenti l'altra
 *   parte l'ha cancellata (si toglie). Le voci senza date (progetti) si tengono sempre.
 */
export function mergeById(local = [], remote = [], lastSync = 0, preferLocal = false) {
  const L = new Map(local.filter((x) => x?.id).map((x) => [x.id, x]));
  const R = new Map(remote.filter((x) => x?.id).map((x) => [x.id, x]));
  const out = [];
  const seen = new Set();
  for (const x of [...remote, ...local]) {
    if (!x?.id || seen.has(x.id)) continue;
    seen.add(x.id);
    const a = L.get(x.id), b = R.get(x.id);
    if (a && b) {
      const aWins = tsOf(a) > tsOf(b) || (preferLocal && tsOf(a) === tsOf(b));
      out.push(mergeLists(aWins ? a : b, aWins ? b : a, lastSync));
      continue;
    }
    const only = a || b;
    const born = bornOf(only);
    if (!born || born > lastSync || tsOf(only) > lastSync) out.push(only);
  }
  return out;
}

/**
 * Le cose da fare dentro una carta, voce per voce: ogni voce ha l'ora dell'ultima modifica (`at`) e vince la più recente
 * (a parità, «fatto» batte «da fare»). Una voce che c'è solo nella carta perdente resta se è nata dopo l'ultima
 * sincronizzazione, altrimenti l'altra parte l'ha tolta. Le voci della carta vincente restano sempre.
 */
function mergeLists(win, lose, lastSync) {
  const wl = Array.isArray(win.checklist) ? win.checklist : [], ll = Array.isArray(lose.checklist) ? lose.checklist : [];
  if (!wl.length && !ll.length) return win;
  const byId = new Map(ll.map((x) => [x.id, x]));
  const have = new Set(wl.map((x) => x.id));
  // una voce di una sola parte resta se è nata dopo l'ultima sincronizzazione (o se non ha data: non si può dire);
  // altrimenti l'altra parte l'aveva già e l'ha tolta
  const fresh = (x) => !(+x.at > 0) || +x.at > lastSync;
  const merged = [];
  for (const x of wl) {
    const y = byId.get(x.id);
    if (!y) { if (fresh(x)) merged.push(x); continue; }
    const ax = +x.at || 0, ay = +y.at || 0;
    merged.push(ay > ax || (ay === ax && y.done && !x.done) ? { ...x, done: !!y.done, at: Math.max(ax, ay) } : x);
  }
  for (const y of ll) if (!have.has(y.id) && fresh(y)) merged.push(y);
  return { ...win, checklist: cleanChecklist(merged) };
}

/** Elenchi di eventi senza id stabile (registro): unione senza doppioni, in ordine di tempo. */
function mergeLog(a = [], b = [], max = 400) {
  const key = (e) => `${e.type}|${e.id}|${e.at}`;
  const m = new Map();
  for (const e of [...b, ...a]) if (e && typeof e === 'object') m.set(key(e), e);
  return [...m.values()].sort((x, y) => (x.at || 0) - (y.at || 0)).slice(-max);
}
/** Conversazioni: unione per id, in ordine di tempo. */
function mergeChat(a = [], b = [], max = 60) {
  const m = new Map();
  for (const x of [...b, ...a]) if (x?.id && !x.pending) m.set(x.id, x);
  return [...m.values()].sort((x, y) => (x.ts || 0) - (y.ts || 0)).slice(-max);
}

/**
 * Lo stato unito. Le voci con id si uniscono una per una; preferenze, apprendimento e statistiche
 * vengono dal lato che ha modifiche non ancora sincronizzate (localDirty), altrimenti dal server.
 */
export function mergeStates(local, remote, { lastSync = 0, localDirty = true } = {}) {
  if (!remote) return local;
  const base = localDirty ? local : remote;
  const out = { ...remote, ...cloudPayload(base) };
  for (const k of ['items', 'goals', 'goalsDone', 'recurring', 'memory', 'habits', 'projects']) out[k] = mergeById(local[k], remote[k], lastSync, localDirty);
  out.log = mergeLog(local.log, remote.log);
  out.chat = mergeChat(local.chat, remote.chat, 60);
  out.askChat = mergeChat(local.askChat, remote.askChat, 40);
  out.timeChat = mergeChat(local.timeChat, remote.timeChat, 40);
  out.skins = { ...(remote.skins || {}), ...(local.skins || {}) };
  out.recaps = { ...(remote.recaps || {}), ...(local.recaps || {}) };
  out.stats = { ...(remote.stats || {}), ...(local.stats || {}), edits: Math.max(+local.stats?.edits || 0, +remote.stats?.edits || 0) };
  // il focus in corso: quello partito più di recente
  out.focus = [local.focus, remote.focus].filter(Boolean).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0] || null;
  return out;
}

// ---------------------------------------------------------------- chiamate al server
export class CloudError extends Error { constructor(status, message, body) { super(message); this.status = status; this.body = body; } }

export async function cloudCall(S, method, path, body, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const base = String(S.cloudUrl || DEFAULT_CLOUD_URL).replace(/\/+$/, '');
  if (!base) throw new CloudError(0, 'Manca l\'indirizzo di Tempo Cloud.');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(base + path, {
      method, signal: ctl.signal,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(S.cloudToken ? { Authorization: `Bearer ${S.cloudToken}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new CloudError(r.status, j.error || `errore ${r.status}`, j);
    return j;
  } catch (e) {
    if (e instanceof CloudError) throw e;
    throw new CloudError(0, e.name === 'AbortError' ? 'Tempo Cloud non risponde.' : 'Niente connessione con Tempo Cloud.');
  } finally { clearTimeout(t); }
}

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'Europe/Rome'; } };
const device = () => (/Mac/.test(globalThis.navigator?.platform || '') && !('ontouchend' in globalThis) ? 'Mac' : /iPhone|iPad/.test(globalThis.navigator?.userAgent || '') ? 'iPhone' : 'browser');

/** Crea l'account o entra: salva il token nelle impostazioni del dispositivo. */
export async function signIn(S, { email, password, create }, opts) {
  const r = await cloudCall(S, 'POST', create ? '/v1/signup' : '/v1/login', { email, password, tz: tz(), device: device() }, opts);
  Object.assign(S, { cloudToken: r.token, cloudEmail: String(email).trim().toLowerCase(), cloudRev: 0, cloudAt: 0, cloudEdits: null, cloudError: null });
  return r;
}

/**
 * Una sincronizzazione completa. apply(nuovoStato) sostituisce lo stato locale (l'app ricalcola il piano).
 * Restituisce 'pushed' | 'pulled' | 'merged' | 'same'.
 */
export async function syncNow(state, apply, opts = {}) {
  const S = state.settings;
  if (!S.cloudToken) return 'off';
  const edits = state.stats?.edits || 0;
  // appena collegato: è «da mandare» solo se qui c'è già qualcosa (si unirà con l'account)
  const dirty = S.cloudEdits == null ? !!(state.items?.length || state.goals?.length) : S.cloudEdits !== edits;
  const done = (rev, how) => { Object.assign(S, { cloudRev: rev, cloudAt: Date.now(), cloudEdits: state.stats?.edits || 0, cloudError: null }); return how; };
  if (!dirty) {
    const cur = await cloudCall(S, 'GET', '/v1/state', undefined, opts);
    if (!cur.state || cur.rev <= (S.cloudRev || 0)) {
      // il server non ha ancora niente: mandiamo quello che c'è qui
      if (!cur.state && (state.items?.length || state.goals?.length)) return done((await cloudCall(S, 'PUT', '/v1/state', { rev: cur.rev, state: cloudPayload(state) }, opts)).rev, 'pushed');
      return done(cur.rev, 'same');
    }
    apply(mergeStates(state, cur.state, { lastSync: S.cloudAt || 0, localDirty: false }));
    return done(cur.rev, 'pulled');
  }
  try {
    const r = await cloudCall(S, 'PUT', '/v1/state', { rev: S.cloudRev || 0, state: cloudPayload(state) }, opts);
    return done(r.rev, 'pushed');
  } catch (e) {
    if (e.status !== 409) throw e;
    // un altro dispositivo ha salvato prima: uniamo e riproviamo una volta
    const merged = mergeStates(state, e.body.state, { lastSync: S.cloudAt || 0, localDirty: true });
    apply(merged);
    const r = await cloudCall(S, 'PUT', '/v1/state', { rev: e.body.rev, state: cloudPayload(merged) }, opts);
    return done(r.rev, 'merged');
  }
}

/** Esci da questo dispositivo (i dati restano qui e sul server). */
export async function signOut(S, opts) {
  try { await cloudCall(S, 'POST', '/v1/logout', {}, opts); } catch {}
  Object.assign(S, { cloudToken: '', cloudRev: 0, cloudAt: 0, cloudEdits: null });
}
