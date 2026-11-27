// Tempo Cloud: account, sincronizzazione tra dispositivi e accesso da fuori dal telefono
// (Mac, Siri e Comandi rapidi anche in CarPlay, assistenti AI via MCP).
// Un solo gestore fetch standard: gira uguale su Cloudflare Workers (worker.js) e su Node (node.js).
//
// Archivio: un'interfaccia chiave → valore { get, put, delete } (KV di Cloudflare, file su Node, mappa nei test).
//   user:<sha(email)>  account (password con PBKDF2)          uid:<uid>     email dell'account
//   state:<uid>        lo stato di Tempo, cifrato (AES-GCM, chiave per utente)
//   tok:<sha(token)>   un token di accesso { uid, scope, name } toks:<uid>    elenco dei token
//   ai:<uid>           la chiave AI dell'utente per le richieste da fuori (cifrata, solo se l'ha scelto)
//   rl:<chiave>        limiti di frequenza
// Inviti diretti cifrati (il server non legge il contenuto: vedi tempo/js/e2e.js):
//   keys:<uid>         la chiave pubblica del dispositivo che riceve gli inviti   contacts:<uid> elenco dei contatti (uid)
//   cc:<lookup>        un codice contatto monouso { uid, exp }                     msg:<uid>:<id> una busta cifrata in attesa
// L'archivio può avere list(prefisso) → nomi delle chiavi: serve solo per la casella.
import { hashPassword, verifyPassword, randomToken, randomId, sha256hex, seal, unseal } from './crypto.js';
import { nowFor, dayFor, recapFor, tell, stripSecrets } from './tempo.js';
import { handleMcp } from './mcp.js';
import { cleanPub, cleanEnvelope, MAX_AGE } from '../../tempo/js/e2e.js';

export const VERSION = '1.0.0';
const MAX_BODY = 4 * 1024 * 1024;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const DEFAULT_ORIGINS = ['https://davidebica10-design.github.io', 'capacitor://localhost', 'ionic://localhost', 'http://localhost', 'https://localhost', 'http://localhost:8765', 'http://127.0.0.1:8765'];

class HttpError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; } }

/**
 * opts: { store, secret (≥ 32 caratteri), origins?: string[], now?: () => ms, fetchImpl? (per l'AI) }
 */
export function createApp({ store, secret, origins = DEFAULT_ORIGINS, now = () => Date.now(), fetchImpl } = {}) {
  if (!store) throw new Error('manca lo store');
  if (!secret || secret.length < 32) throw new Error('TEMPO_SECRET deve avere almeno 32 caratteri');

  const getJson = async (k) => { const v = await store.get(k); return v == null ? null : typeof v === 'string' ? JSON.parse(v) : v; };
  const putJson = (k, v) => store.put(k, JSON.stringify(v));

  // ---- limiti di frequenza (finestra fissa)
  async function limit(key, max, windowMs) {
    const t = now();
    const r = (await getJson('rl:' + key)) || { n: 0, until: t + windowMs };
    if (t > r.until) { r.n = 0; r.until = t + windowMs; }
    r.n++;
    await putJson('rl:' + key, r);
    if (r.n > max) throw new HttpError(429, 'Troppe richieste: riprova tra poco.', { retryAfter: Math.ceil((r.until - t) / 1000) });
  }

  // ---- token
  async function issueToken(uid, scope, name) {
    const token = randomToken(scope === 'full' ? 'tmp' : 'tmx');
    const hash = await sha256hex(token);
    const id = randomId();
    const rec = { id, uid, scope, name: String(name || '').slice(0, 60), created: now(), last: null };
    await putJson('tok:' + hash, rec);
    const list = (await getJson('toks:' + uid)) || [];
    list.push({ id, hash, scope, name: rec.name, created: rec.created });
    await putJson('toks:' + uid, list.slice(-50));
    return { token, id };
  }
  async function auth(req, url, needFull = false) {
    const h = req.headers.get('authorization') || '';
    let token = /^Bearer\s+(\S+)$/i.exec(h)?.[1] || null;
    // per i client MCP che non sanno mandare intestazioni: /mcp/t/<token> (solo token esterni)
    const m = url.pathname.match(/^\/mcp\/t\/([A-Za-z0-9_-]{20,})$/);
    if (!token && m) token = m[1];
    if (!token) throw new HttpError(401, 'Accesso richiesto.');
    const hash = await sha256hex(token);
    const rec = await getJson('tok:' + hash);
    if (!rec) throw new HttpError(401, 'Accesso scaduto: entra di nuovo.');
    if (m && rec.scope === 'full') throw new HttpError(403, 'Nell\'indirizzo vanno solo i token per i collegamenti esterni.');
    if (needFull && rec.scope !== 'full') throw new HttpError(403, 'Questo collegamento non può farlo.');
    return { ...rec, hash };
  }

  // ---- account
  const userKey = async (email) => 'user:' + await sha256hex(String(email).trim().toLowerCase());
  async function signup(body, ip) {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!EMAIL.test(email)) throw new HttpError(400, 'Email non valida.');
    if (password.length < 10) throw new HttpError(400, 'La password deve avere almeno 10 caratteri.');
    await limit('signup:' + ip, 10, 3600e3);
    const k = await userKey(email);
    if (await store.get(k)) throw new HttpError(409, 'Esiste già un account con questa email.');
    const uid = 'u_' + randomId();
    await putJson(k, { uid, pass: await hashPassword(password), created: now(), tz: validTz(body.tz) });
    await putJson('uid:' + uid, { email, key: k });
    const t = await issueToken(uid, 'full', body.device || 'telefono');
    return { status: 201, body: { token: t.token, uid } };
  }
  async function login(body, ip) {
    const email = String(body.email || '').trim().toLowerCase();
    await limit('login:' + ip + ':' + email, 10, 15 * 60e3);
    const u = await getJson(await userKey(email));
    if (!u || !(await verifyPassword(String(body.password || ''), u.pass))) throw new HttpError(401, 'Email o password non corrette.');
    if (body.tz && validTz(body.tz) !== u.tz) { u.tz = validTz(body.tz); await putJson(await userKey(email), u); }
    const t = await issueToken(u.uid, 'full', body.device || 'dispositivo');
    return { body: { token: t.token, uid: u.uid } };
  }
  async function accountOf(uid) {
    const ix = await getJson('uid:' + uid);
    if (!ix) throw new HttpError(404, 'Account non trovato.');
    const u = await getJson(ix.key);
    return { ix, u };
  }
  /** Cancellazione dell'account dall'app (richiesta dall'App Store): tutto, subito. */
  async function deleteAccount(tok, body) {
    const { ix, u } = await accountOf(tok.uid);
    if (!(await verifyPassword(String(body.password || ''), u.pass))) throw new HttpError(401, 'Password non corretta.');
    await dropDirect(tok.uid); // prima dei token: se si interrompe, l'utente può riprovare
    for (const t of (await getJson('toks:' + tok.uid)) || []) await store.delete('tok:' + t.hash);
    for (const k of ['toks:', 'state:', 'ai:', 'uid:']) await store.delete(k + tok.uid);
    await store.delete(ix.key);
    return { body: { deleted: true } };
  }

  // ---- stato
  async function readState(uid) {
    const row = await getJson('state:' + uid);
    if (!row) return { rev: 0, updatedAt: null, state: null };
    return { rev: row.rev, updatedAt: row.updatedAt, state: await unseal(secret, uid, row.data) };
  }
  async function writeState(uid, rev, state) {
    const row = { rev, updatedAt: now(), data: await seal(secret, uid, stripSecrets(state)) };
    await putJson('state:' + uid, row);
    return row;
  }
  const tzOf = async (uid) => (await accountOf(uid)).u.tz || 'Europe/Rome';
  async function aiOf(uid) {
    const v = await store.get('ai:' + uid);
    return v ? unseal(secret, uid, typeof v === 'string' ? v : JSON.stringify(v)) : null;
  }

  async function doTell(tok, text) {
    await limit('tell:' + tok.uid, 60, 3600e3);
    const cur = await readState(tok.uid);
    if (!cur.state) throw new HttpError(409, 'Apri Tempo sul telefono e accedi all\'account: poi posso rispondere anche da qui.');
    const r = await tell(cur.state, await tzOf(tok.uid), text, { ai: await aiOf(tok.uid), at: now(), fetchImpl });
    let rev = cur.rev;
    if (r.state) rev = (await writeState(tok.uid, cur.rev + 1, r.state)).rev;
    return { reply: r.reply, understood: r.understood, applied: r.applied, confirm: r.confirm, rev };
  }

  // ---- inviti diretti cifrati: chiavi pubbliche, contatti, casella
  const ID = /^[A-Za-z0-9_-]{6,40}$/;
  const LOOKUP = /^[A-Za-z0-9_-]{16}$/;
  const MSG_ID = /^[0-9a-z]{9}[A-Za-z0-9_-]{12}$/;
  const MAX_CONTACTS = 500, MAX_INBOX = 500, CODE_DAYS = 7;
  const keysOf = async (uid) => (await getJson('keys:' + uid))?.pub || null;
  const contactsOf = async (uid) => { const l = await getJson('contacts:' + uid); return Array.isArray(l) ? l : []; };
  const listKeys = async (prefix, limit) => {
    if (typeof store.list !== 'function') throw new HttpError(501, 'Questo archivio non supporta gli inviti diretti.');
    return store.list(prefix, limit);
  };
  async function linkContacts(a, b) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const l = await contactsOf(x);
      if (l.includes(y)) continue;
      if (l.length >= MAX_CONTACTS) throw new HttpError(409, 'Troppi contatti.');
      await putJson('contacts:' + x, [...l, y]);
    }
  }
  async function unlinkContacts(a, b) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const l = await contactsOf(x);
      if (l.includes(y)) await putJson('contacts:' + x, l.filter((u) => u !== y));
    }
  }
  async function needKeys(uid) {
    const pub = await keysOf(uid);
    if (!pub) throw new HttpError(409, 'Prima attiva gli inviti diretti su questo dispositivo.');
    return pub;
  }
  async function readInbox(uid) {
    // al massimo 50 per volta (le letture per richiesta sono limitate): le altre arrivano al giro dopo
    const names = (await listKeys('msg:' + uid + ':', 50)).sort();
    const pub = await keysOf(uid);
    const out = [];
    for (const k of names) {
      let m = null;
      try { m = await getJson(k); } catch { m = null; } // una voce rotta non deve bloccare la casella
      // scaduta, rotta o per una chiave che non c'è più: non si potrà mai aprire
      if (!m || !m.env || m.at < now() - MAX_AGE || !pub || m.env.to?.dev !== pub.dev) { await store.delete(k); continue; }
      out.push(m);
    }
    return out;
  }
  /** Alla cancellazione dell'account: chiavi, contatti (da entrambe le parti) e casella. */
  async function dropDirect(uid) {
    for (const c of await contactsOf(uid)) await unlinkContacts(uid, c);
    if (typeof store.list === 'function') for (const k of await store.list('msg:' + uid + ':', 10000)) await store.delete(k);
    for (const k of ['keys:', 'contacts:']) await store.delete(k + uid);
  }
  async function direct(p, M, tok, body) {
    if (p === '/v1/keys' && M === 'PUT') {
      const b = await body();
      const pub = cleanPub(b.pub);
      if (!pub) throw new HttpError(400, 'Chiave non valida.');
      await limit('keys:' + tok.uid, 20, 24 * 3600e3);
      await putJson('keys:' + tok.uid, { pub, at: now() });
      return { body: { pub } };
    }
    const km = p.match(/^\/v1\/keys\/([A-Za-z0-9_-]{6,40})$/);
    if (km && M === 'GET') {
      if (km[1] !== tok.uid && !(await contactsOf(tok.uid)).includes(km[1])) throw new HttpError(404, 'Contatto non trovato.');
      return { body: { uid: km[1], pub: await keysOf(km[1]) } };
    }
    if (p === '/v1/contact-codes' && M === 'POST') {
      const b = await body();
      if (typeof b.lookup !== 'string' || !LOOKUP.test(b.lookup)) throw new HttpError(400, 'Codice non valido.');
      await needKeys(tok.uid);
      await limit('cc:' + tok.uid, 20, 24 * 3600e3);
      if (await store.get('cc:' + b.lookup)) throw new HttpError(409, 'Codice già usato.');
      const exp = Math.min(Number.isFinite(+b.exp) ? +b.exp : Infinity, now() + CODE_DAYS * 24 * 3600e3);
      if (!(exp > now())) throw new HttpError(400, 'Scadenza non valida.');
      await putJson('cc:' + b.lookup, { uid: tok.uid, exp });
      return { status: 201, body: { exp } };
    }
    const use = p.match(/^\/v1\/contact-codes\/([A-Za-z0-9_-]{16})\/use$/);
    if (use && M === 'POST') {
      await limit('ccuse:' + tok.uid, 30, 3600e3);
      await needKeys(tok.uid);
      const cc = await getJson('cc:' + use[1]);
      if (!cc || cc.exp < now()) throw new HttpError(404, 'Questo link non vale più: chiedine uno nuovo.');
      if (cc.uid === tok.uid) throw new HttpError(400, 'È il tuo link: mandalo a chi vuoi aggiungere.');
      const pub = await keysOf(cc.uid);
      if (!pub || !(await getJson('uid:' + cc.uid))) { await store.delete('cc:' + use[1]); throw new HttpError(404, 'Questo link non vale più: chiedine uno nuovo.'); }
      await store.delete('cc:' + use[1]); // monouso
      await linkContacts(tok.uid, cc.uid);
      return { body: { uid: cc.uid, pub } };
    }
    if (p === '/v1/contacts' && M === 'GET') {
      const out = [];
      for (const uid of await contactsOf(tok.uid)) out.push({ uid, pub: await keysOf(uid) });
      return { body: { contacts: out } };
    }
    const cm = p.match(/^\/v1\/contacts\/([A-Za-z0-9_-]{6,40})$/);
    if (cm && M === 'DELETE') { await unlinkContacts(tok.uid, cm[1]); return { body: { ok: true } }; }
    const im = p.match(/^\/v1\/inbox\/([A-Za-z0-9_-]{6,40})$/);
    if (im && M === 'POST') {
      const to = im[1];
      await limit('send:' + tok.uid, 120, 3600e3);
      const b = await body();
      const env = cleanEnvelope(b.env);
      if (!env) throw new HttpError(400, 'Busta non valida.');
      const mine = await needKeys(tok.uid);
      // il mittente scritto nella busta è chi sta parlando, con la chiave registrata
      if (env.from.uid !== tok.uid || env.from.dev !== mine.dev || env.to.uid !== to) throw new HttpError(400, 'Busta non valida.');
      if (!(await contactsOf(to)).includes(tok.uid)) throw new HttpError(403, 'Non siete contatti.');
      // un solo contatto non può riempire la casella di un altro
      await limit('pair:' + tok.uid + ':' + to, 60, 24 * 3600e3);
      const theirs = await keysOf(to);
      if (!theirs) throw new HttpError(409, 'Non ha attivato gli inviti diretti.', { pub: null });
      if (theirs.dev !== env.to.dev) throw new HttpError(409, 'La sua chiave è cambiata.', { pub: theirs });
      if ((await listKeys('msg:' + to + ':', MAX_INBOX + 1)).length >= MAX_INBOX) throw new HttpError(429, 'La sua casella è piena: riprova più tardi.');
      const at = now();
      const id = Math.floor(at).toString(36).padStart(9, '0').slice(-9) + randomId().slice(0, 12).padEnd(12, '0');
      await store.put('msg:' + to + ':' + id, JSON.stringify({ id, from: tok.uid, env, at }), { ttl: Math.ceil(MAX_AGE / 1000) });
      return { status: 201, body: { id } };
    }
    if (p === '/v1/inbox' && M === 'GET') return { body: { messages: await readInbox(tok.uid) } };
    const dm = p.match(/^\/v1\/inbox\/([A-Za-z0-9_-]{21})$/);
    if (dm && M === 'DELETE') {
      if (!MSG_ID.test(dm[1])) throw new HttpError(400, 'Id non valido.');
      await store.delete('msg:' + tok.uid + ':' + dm[1]);
      return { body: { ok: true } };
    }
    return null;
  }

  // ---- instradamento
  async function route(req, url, ip) {
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const M = req.method;
    const body = async () => {
      const len = +req.headers.get('content-length') || 0;
      if (len > MAX_BODY) throw new HttpError(413, 'Troppi dati.');
      const t = await req.text();
      if (t.length > MAX_BODY) throw new HttpError(413, 'Troppi dati.');
      try { return t ? JSON.parse(t) : {}; } catch { throw new HttpError(400, 'JSON non valido.'); }
    };

    if (p === '/' || p === '/v1/health') return { body: { ok: true, name: 'Tempo Cloud', version: VERSION } };
    if (p === '/v1/signup' && M === 'POST') return signup(await body(), ip);
    if (p === '/v1/login' && M === 'POST') return login(await body(), ip);

    if (p === '/mcp' || p.startsWith('/mcp/t/')) {
      if (M === 'GET') return { status: 405, body: { error: 'Usa POST (MCP Streamable HTTP).' } };
      if (M === 'DELETE') return { status: 204 };
      const tok = await auth(req, url);
      return handleMcp(await body(), {
        now: async () => nowFor((await readState(tok.uid)).state || {}, await tzOf(tok.uid), now()),
        day: async (d) => dayFor((await readState(tok.uid)).state || {}, await tzOf(tok.uid), d, now()),
        recap: async (m) => recapFor((await readState(tok.uid)).state || {}, await tzOf(tok.uid), m, now()),
        tell: (text) => doTell(tok, text),
      });
    }

    const tok = await auth(req, url, false);
    const full = () => { if (tok.scope !== 'full') throw new HttpError(403, 'Questo collegamento non può farlo.'); };

    if (p === '/v1/logout' && M === 'POST') {
      await store.delete('tok:' + tok.hash);
      await putJson('toks:' + tok.uid, ((await getJson('toks:' + tok.uid)) || []).filter((t) => t.hash !== tok.hash));
      return { body: { ok: true } };
    }
    if (p === '/v1/account' && M === 'GET') {
      full();
      const { ix, u } = await accountOf(tok.uid);
      const st = await getJson('state:' + tok.uid);
      return { body: { uid: tok.uid, email: ix.email, created: u.created, tz: u.tz, ai: !!(await store.get('ai:' + tok.uid)), rev: st?.rev || 0 } };
    }
    if (p === '/v1/account' && M === 'DELETE') { full(); return deleteAccount(tok, await body()); }
    if (p === '/v1/settings' && M === 'PATCH') {
      full();
      const b = await body();
      const { ix, u } = await accountOf(tok.uid);
      if (b.tz !== undefined) { u.tz = validTz(b.tz); await putJson(ix.key, u); }
      if (b.ai === null) await store.delete('ai:' + tok.uid);
      else if (b.ai && typeof b.ai === 'object' && typeof b.ai.key === 'string' && b.ai.key.length >= 10) {
        await store.put('ai:' + tok.uid, await seal(secret, tok.uid, { key: b.ai.key.slice(0, 300), preset: String(b.ai.preset || 'gemini').slice(0, 20), model: String(b.ai.model || '').slice(0, 120) }));
      }
      return { body: { tz: u.tz, ai: !!(await store.get('ai:' + tok.uid)) } };
    }
    if (p === '/v1/state' && M === 'GET') { full(); return { body: await readState(tok.uid) }; }
    if (p === '/v1/state' && M === 'PUT') {
      full();
      const b = await body();
      if (!b.state || typeof b.state !== 'object' || !Array.isArray(b.state.items)) throw new HttpError(400, 'Stato non valido.');
      const cur = await getJson('state:' + tok.uid);
      const rev = cur?.rev || 0;
      // revisione diversa: qualcun altro ha salvato prima; il client unisce e riprova
      if (+b.rev !== rev) return { status: 409, body: { error: 'conflict', ...(await readState(tok.uid)) } };
      const row = await writeState(tok.uid, rev + 1, b.state);
      return { body: { rev: row.rev, updatedAt: row.updatedAt } };
    }
    if (p === '/v1/tokens' && M === 'GET') {
      full();
      return { body: { tokens: ((await getJson('toks:' + tok.uid)) || []).map(({ hash, ...t }) => ({ ...t, current: hash === tok.hash })) } };
    }
    if (p === '/v1/tokens' && M === 'POST') {
      full();
      const b = await body();
      const t = await issueToken(tok.uid, 'external', b.name || 'collegamento');
      return { status: 201, body: t };
    }
    const del = p.match(/^\/v1\/tokens\/([A-Za-z0-9_-]{6,})$/);
    if (del && M === 'DELETE') {
      full();
      const list = (await getJson('toks:' + tok.uid)) || [];
      const t = list.find((x) => x.id === del[1]);
      if (!t) throw new HttpError(404, 'Collegamento non trovato.');
      await store.delete('tok:' + t.hash);
      await putJson('toks:' + tok.uid, list.filter((x) => x !== t));
      return { body: { ok: true } };
    }
    if (/^\/v1\/(keys|contact-codes|contacts|inbox)(\/|$)/.test(p)) {
      full();
      const r = await direct(p, M, tok, body);
      if (r) return r;
    }
    const asText = url.searchParams.get('format') === 'text';
    if (p === '/v1/now' && M === 'GET') {
      const r = nowFor((await readState(tok.uid)).state || {}, await tzOf(tok.uid), now());
      return asText ? { text: r.text } : { body: r };
    }
    if (p === '/v1/today' && M === 'GET') {
      const r = dayFor((await readState(tok.uid)).state || {}, await tzOf(tok.uid), url.searchParams.get('day'), now());
      return asText ? { text: r.text } : { body: r };
    }
    if (p === '/v1/recap' && M === 'GET') {
      const r = recapFor((await readState(tok.uid)).state || {}, await tzOf(tok.uid), url.searchParams.get('month'), now());
      return asText ? { text: r.text } : { body: r };
    }
    if (p === '/v1/tell' && M === 'POST') {
      const ct = req.headers.get('content-type') || '';
      const text = ct.includes('application/json') ? (await body()).text : await req.text();
      const r = await doTell(tok, text);
      return asText ? { text: r.reply } : { body: r };
    }
    throw new HttpError(404, 'Non trovato.');
  }

  function cors(req) {
    const o = req.headers.get('origin');
    if (!o || !origins.includes(o)) return {};
    return { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  }

  return {
    async fetch(req) {
      const url = new URL(req.url);
      const base = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors(req) };
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: base });
      const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
      try {
        const r = await route(req, url, ip);
        if (r.status === 204) return new Response(null, { status: 204, headers: base });
        if (r.text != null) return new Response(r.text, { status: r.status || 200, headers: { ...base, 'Content-Type': 'text/plain; charset=utf-8' } });
        if (r.empty) return new Response(null, { status: r.status || 202, headers: base });
        return new Response(JSON.stringify(r.body), { status: r.status || 200, headers: { ...base, 'Content-Type': 'application/json; charset=utf-8' } });
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) console.error(e);
        const headers = { ...base, 'Content-Type': 'application/json; charset=utf-8', ...(e.extra?.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : {}) };
        const extra = e.extra && 'pub' in e.extra ? { pub: e.extra.pub } : {};
        return new Response(JSON.stringify({ error: status === 500 ? 'Errore del server.' : e.message, ...extra }), { status, headers });
      }
    },
  };
}

function validTz(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return 'Europe/Rome';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'Europe/Rome'; }
}

/** Archivio in memoria (test e sviluppo). */
export function memoryStore() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); },
    list: async (prefix, limit = 1000) => [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit),
    _map: m,
  };
}
