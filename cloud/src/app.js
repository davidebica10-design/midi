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
import { hashPassword, verifyPassword, randomToken, randomId, sha256hex, seal, unseal } from './crypto.js';
import { nowFor, dayFor, recapFor, tell, stripSecrets } from './tempo.js';
import { handleMcp } from './mcp.js';

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
      return { body: { email: ix.email, created: u.created, tz: u.tz, ai: !!(await store.get('ai:' + tok.uid)), rev: st?.rev || 0 } };
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
        return new Response(JSON.stringify({ error: status === 500 ? 'Errore del server.' : e.message }), { status, headers });
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
  return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, _map: m };
}
