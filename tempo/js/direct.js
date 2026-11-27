// Inviti diretti: da Tempo a Tempo, cifrati da telefono a telefono, attraverso la casella di Tempo Cloud.
// Le primitive stanno in e2e.js; qui ci sono contatti, casella e regole. Niente DOM: l'app passa
//   S         impostazioni del dispositivo (cloudUrl, cloudToken), o una funzione che le restituisce
//   storage   { get(k), set(k, v) } valori JSON solo su questo dispositivo (mai sincronizzati: il server non deve
//             poter cambiare le chiavi di cui ti fidi)
//   keystore  { load(uid), save(uid, device) } le chiavi private (nel browser: IndexedDB, non esportabili)
//   fetchImpl, now
//
// Fiducia: la chiave di un contatto si impara dal link monouso (che contiene la sua impronta) e poi non cambia
// da sola. Se il server ne mostra un'altra, il contatto è segnato «cambiato» e non si manda né si accetta niente
// con la chiave nuova finché non lo confermi tu.
import { cloudCall, CloudError } from './cloud.js';
import { createDevice, fingerprint, safetyCode, makeContactCode, findContactCode, sealMessage, openMessage, cleanPub, cleanName, sameString, validId, E2EError, MAX_AGE } from './e2e.js';

const KEY = 'tempo.direct';
const CODE_DAYS = 7;
const MAX_CONTACTS = 200;
const MAX_QUEUE = 50;
const INVITE = /^tempo:inv1:[A-Za-z0-9_-]{10,6000}$/;
// errori per cui la busta non si aprirà mai: si toglie dalla casella
// ('sconosciuto' è permanente solo se il mittente non è un tuo contatto; 'futura' si riprova)
const PERMANENT = new Set(['formato', 'non-per-me', 'manomessa', 'firma', 'scaduta', 'ripetuta', 'sconosciuto']);

export const directMsg = (e) => (e instanceof E2EError || e instanceof CloudError ? e.message : 'Qualcosa non ha funzionato.');

export function createDirect({ S: S0, storage, keystore, fetchImpl, now = () => Date.now() }) {
  const Sx = () => (typeof S0 === 'function' ? S0() : S0); // le impostazioni possono essere sostituite (ripristino)
  const call = (method, path, body) => cloudCall(Sx(), method, path, body, fetchImpl ? { fetchImpl } : {});
  // un archivio per account: cambiare account non cancella contatti, link e buste già viste dell'altro
  const blank = () => ({ v: 1, contacts: [], codes: [], seen: {}, queue: [] });
  const root = () => { const r = storage.get(KEY); return r && r.v === 2 && r.byUid && typeof r.byUid === 'object' ? r : { v: 2, cur: null, byUid: {} }; };
  const load = () => {
    const r = root();
    const d = r.cur && r.byUid[r.cur];
    return d && d.v === 1 && Array.isArray(d.contacts) ? { ...blank(), ...d } : blank();
  };
  const save = (d) => {
    const r = root();
    if (!r.cur) return;
    const t = now();
    for (const [id, exp] of Object.entries(d.seen)) if (!(exp > t)) delete d.seen[id];
    d.codes = d.codes.filter((c) => c.exp > t);
    d.queue = d.queue.slice(-MAX_QUEUE);
    r.byUid[r.cur] = d;
    storage.set(KEY, r);
  };

  let meMemo = null;
  /** Chi sono e con quale dispositivo. Crea le chiavi la prima volta. */
  async function me() {
    const S = Sx();
    if (meMemo && meMemo.token === S.cloudToken) return meMemo;
    if (!S.cloudToken) throw new E2EError('account', 'Entra nel tuo account Tempo Cloud per usare gli inviti diretti.');
    const uid = (await call('GET', '/v1/account')).uid;
    if (!validId(uid)) throw new E2EError('account', 'Tempo Cloud non risponde come dovrebbe.');
    const r = root();
    if (r.cur !== uid) { r.cur = uid; storage.set(KEY, r); }
    let device = await keystore.load(uid);
    if (!device || !cleanPub(device.pub)) { device = await createDevice(); await keystore.save(uid, device); }
    meMemo = { uid, device, token: S.cloudToken };
    return meMemo;
  }

  /** Dove arrivano gli inviti: 'qui' | 'altrove' (un altro dispositivo dell'account) | 'spenti'. */
  async function status() {
    const m = await me();
    const r = await call('GET', `/v1/keys/${m.uid}`);
    return !r.pub ? 'spenti' : r.pub.dev === m.device.id ? 'qui' : 'altrove';
  }
  /** Gli inviti diretti arrivano su questo dispositivo (se arrivavano altrove, lì smettono). */
  async function activate() {
    const m = await me();
    await call('PUT', '/v1/keys', { pub: m.device.pub });
    return 'qui';
  }
  async function ensureActive() {
    const st = await status();
    if (st === 'spenti') return activate();
    if (st === 'altrove') throw new E2EError('altrove', 'Gli inviti diretti arrivano su un altro dispositivo. Attivali qui dalle impostazioni.');
    return st;
  }

  /** Un link monouso per diventare contatti (vale 7 giorni). */
  async function createCode(name) {
    await ensureActive();
    const m = await me();
    const c = makeContactCode({ fp: await fingerprint(m.device.pub), name, exp: now() + CODE_DAYS * 24 * 3600e3 });
    await call('POST', '/v1/contact-codes', { lookup: c.lookup, exp: c.exp });
    const d = load();
    d.codes.push({ lookup: c.lookup, secret: c.secret, exp: c.exp });
    save(d);
    return c.code;
  }

  /** Usa il link di un amico: diventate contatti e lui riceve la tua chiave. */
  async function useCode(text, myName) {
    const c = findContactCode(text, now());
    if (!c) throw new E2EError('codice', 'Questo link non vale: forse è scaduto. Chiedine uno nuovo.');
    if (load().codes.some((x) => x.lookup === c.lookup)) throw new E2EError('mio', 'È il tuo link: mandalo a chi vuoi aggiungere.');
    await ensureActive();
    const m = await me();
    const r = await call('POST', `/v1/contact-codes/${c.lookup}/use`);
    if (!validId(r?.uid)) throw new E2EError('impronta', 'Tempo Cloud non risponde come dovrebbe: non ho aggiunto nessuno.');
    const pub = cleanPub(r.pub);
    // la chiave che dà il server deve essere quella scritta nel link: altrimenti qualcuno si è messo in mezzo
    if (!pub || !sameString(await fingerprint(pub), c.fp)) {
      try { await call('DELETE', `/v1/contacts/${r.uid}`); } catch {}
      throw new E2EError('impronta', 'La chiave non corrisponde al link: non ho aggiunto nessuno.');
    }
    const contact = upsertContact({ uid: r.uid, name: c.name || 'Contatto', pub, fp: c.fp });
    try {
      const env = await sealMessage(m, { uid: r.uid, pub }, { kind: 'contatto', at: now(), body: { k: c.secret, name: cleanName(myName), pub: m.device.pub } });
      await call('POST', `/v1/inbox/${r.uid}`, { env });
    } catch {
      // il link è già consumato: senza la busta l'altro non saprebbe chi sei. Meglio non lasciare un contatto a metà.
      try { await removeContact(r.uid); } catch {}
      throw new E2EError('intro', `Non sono riuscito ad avvisare ${contact.name}. Chiedi un link nuovo.`);
    }
    return publicContact(contact);
  }

  function upsertContact({ uid, name, pub, fp }) {
    const d = load();
    const was = d.contacts.find((x) => x.uid === uid);
    if (!was && d.contacts.length >= MAX_CONTACTS) throw new E2EError('troppi', 'Hai troppi contatti.');
    const c = { uid, name: cleanName(name) || 'Contatto', pub, fp, verified: false, changed: null, at: now() };
    d.contacts = [...d.contacts.filter((x) => x.uid !== uid), c];
    save(d);
    return c;
  }
  const publicContact = (c) => ({ uid: c.uid, name: c.name, verified: !!c.verified, changed: !!c.changed, off: !!(c.off || c.gone) });
  const contacts = () => load().contacts.map(publicContact);
  const contactOf = (uid) => load().contacts.find((x) => x.uid === uid) || null;

  /** Il codice di sicurezza con un contatto: da confrontare di persona o a voce. */
  async function safety(uid) { return (await safetyInfo(uid)).code; }
  /** Il codice e l'impronta da cui nasce: confermare vale solo per quella chiave. */
  async function safetyInfo(uid) {
    const c = contactOf(uid);
    if (!c) throw new E2EError('contatto', 'Contatto non trovato.');
    const fp = c.changed ? c.changed.fp : c.fp;
    return { code: await safetyCode(await fingerprint((await me()).device.pub), fp), fp, changed: !!c.changed };
  }
  function setVerified(uid, fp, on = true) {
    const d = load();
    const c = d.contacts.find((x) => x.uid === uid);
    if (!c || c.changed || !sameString(c.fp, fp)) return false; // il codice confrontato era di un'altra chiave
    c.verified = !!on; save(d);
    return true;
  }
  /** Hai controllato il codice nuovo (quello nato da `fp`): da ora ci si fida di quella chiave, e solo di quella. */
  function trustChange(uid, fp) {
    const d = load();
    const c = d.contacts.find((x) => x.uid === uid);
    if (!c?.changed || !sameString(c.changed.fp, fp)) return false;
    Object.assign(c, { pub: c.changed.pub, fp: c.changed.fp, changed: null, verified: false });
    save(d);
    return true;
  }
  async function removeContact(uid) {
    if (!validId(uid)) return;
    try { await call('DELETE', `/v1/contacts/${uid}`); } catch (e) { if (e.status !== 404) throw e; }
    const d = load();
    d.contacts = d.contacts.filter((x) => x.uid !== uid);
    d.queue = d.queue.filter((q) => q.from !== uid);
    save(d);
  }

  /** Confronta le chiavi dei contatti con quelle del server: chi l'ha cambiata va riconfermato. */
  async function refresh() {
    const r = await call('GET', '/v1/contacts');
    const server = new Map((Array.isArray(r.contacts) ? r.contacts : []).filter((x) => validId(x?.uid)).map((x) => [x.uid, cleanPub(x.pub)]));
    const d = load();
    for (const c of d.contacts) {
      // non si cancella mai niente da qui: il server può sbagliare o essere in ritardo; si segna soltanto
      c.gone = !server.has(c.uid);
      const pub = server.get(c.uid) || null;
      c.off = !pub;
      if (!pub) continue;
      const fp = await fingerprint(pub);
      if (!sameString(fp, c.fp)) { if (!c.changed || !sameString(c.changed.fp, fp)) c.changed = { pub, fp }; }
      else c.changed = null;
    }
    save(d);
    return contacts();
  }

  /** Manda qualcosa a un contatto. kind 'invito': body { t: 'tempo:inv1:…' }. */
  async function send(uid, kind, body) {
    if (kind !== 'invito' || !INVITE.test(body?.t || '')) throw new E2EError('tipo', 'Posso mandare solo proposte di Tempo.');
    const c = contactOf(uid);
    if (!c) throw new E2EError('contatto', 'Contatto non trovato.');
    if (c.changed) throw new E2EError('cambiata', `Il codice di sicurezza di ${c.name} è cambiato: controllalo nelle impostazioni prima di mandare.`);
    await ensureActive();
    const m = await me();
    const env = await sealMessage(m, { uid, pub: c.pub }, { kind, at: now(), body: { t: body.t } });
    try {
      await call('POST', `/v1/inbox/${uid}`, { env });
    } catch (e) {
      if (e.status === 409 && e.body && 'pub' in e.body) {
        const pub = cleanPub(e.body.pub);
        const d = load();
        const x = d.contacts.find((y) => y.uid === uid);
        if (x) { if (pub) x.changed = { pub, fp: await fingerprint(pub) }; else x.off = true; save(d); }
        throw new E2EError(pub ? 'cambiata' : 'spento', pub ? `Il codice di sicurezza di ${c.name} è cambiato: controllalo nelle impostazioni prima di mandare.` : `${c.name} non ha attivato gli inviti diretti.`);
      }
      throw e;
    }
    return true;
  }

  /**
   * Ritira la casella: apre, controlla, mette in coda gli inviti e aggiunge i contatti nuovi.
   * Restituisce gli eventi nuovi: [{ type: 'contatto', uid, name } | { type: 'invito', id, from, name }].
   */
  async function receive() {
    const m = await me();
    if ((await status()) !== 'qui') return [];
    try { await refresh(); } catch {}
    const r = await call('GET', '/v1/inbox');
    const events = [];
    for (const msg of Array.isArray(r.messages) ? r.messages.slice(0, 100) : []) {
      if (typeof msg?.id !== 'string' || !/^[A-Za-z0-9_-]{21}$/.test(msg.id)) continue;
      let keep = false;
      try {
        const d0 = load();
        const out = await openMessage(m, msg.env, {
          now: now(),
          trusted: (uid, dev) => { const c = d0.contacts.find((x) => x.uid === uid); return c && c.pub.dev === dev ? c.pub : null; },
          // un mittente nuovo è accettato solo se conosce il segreto di un tuo link ancora valido
          introduce: (p) => {
            const b = p.body;
            if (!b || typeof b !== 'object' || p.from.uid !== msg.from) return null;
            const code = d0.codes.find((c) => sameString(c.secret, b.k) && c.exp > now());
            const pub = cleanPub(b.pub);
            return code && pub && pub.dev === p.from.dev ? pub : null;
          },
          seen: (id) => !!d0.seen[id],
        });
        const d = load();
        d.seen[out.id] = out.at + MAX_AGE + 24 * 3600e3;
        const known = d.contacts.find((x) => x.uid === out.from.uid && x.pub.dev === out.from.dev);
        if (out.kind === 'contatto' && !known) {
          const b = out.body;
          d.codes = d.codes.filter((c) => !sameString(c.secret, b.k)); // il link vale una volta sola
          save(d);
          const c = upsertContact({ uid: out.from.uid, name: b.name, pub: out.pub, fp: await fingerprint(out.pub) });
          events.push({ type: 'contatto', uid: c.uid, name: c.name });
        } else if (out.kind === 'invito' && known && INVITE.test(out.body?.t || '')) {
          d.queue.push({ id: out.id, from: known.uid, name: known.name, t: out.body.t, at: out.at });
          save(d);
          events.push({ type: 'invito', id: out.id, from: known.uid, name: known.name });
        } else save(d);
      } catch (e) {
        // una busta firmata con la chiave nuova di un contatto «cambiato» aspetta che tu la confermi
        // (o di un contatto con una chiave che qui non conosci ancora). Restano in casella al massimo 30 giorni.
        if (e.code === 'sconosciuto' && contactOf(msg.from)) keep = true;
        else if (!(e instanceof E2EError) || !PERMANENT.has(e.code)) keep = true; // rete, orologio sfasato o altro: si riprova
      }
      if (!keep) { try { await call('DELETE', `/v1/inbox/${msg.id}`); } catch {} }
    }
    return events;
  }

  /** Gli inviti arrivati e non ancora mostrati, dal più vecchio. */
  const queue = () => load().queue.map((q) => ({ ...q }));
  function dropQueued(id) { const d = load(); d.queue = d.queue.filter((q) => q.id !== id); save(d); }
  /** Esci dall'account su questo dispositivo: i contatti restano, le chiavi anche. */
  const forget = () => { meMemo = null; };

  return { me, status, activate, createCode, useCode, contacts, safety, safetyInfo, setVerified, trustChange, removeContact, refresh, send, receive, queue, dropQueued, forget };
}

/** Le chiavi private nel browser: IndexedDB, che conserva le CryptoKey non esportabili così come sono. */
export function idbKeystore(indexedDB = globalThis.indexedDB) {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('tempo-direct', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    try {
      return await new Promise((res, rej) => {
        const t = db.transaction('keys', mode);
        const req = fn(t.objectStore('keys'));
        t.oncomplete = () => res(req?.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    } finally { db.close(); }
  };
  return {
    load: (uid) => tx('readonly', (s) => s.get(uid)).then((v) => v || null),
    save: (uid, device) => tx('readwrite', (s) => s.put(device, uid)),
  };
}

/** localStorage come archivio JSON (con il nome del dispositivo, non sincronizzato). */
export function localJson(ls = globalThis.localStorage) {
  return {
    get: (k) => { try { return JSON.parse(ls.getItem(k) || 'null'); } catch { return null; } },
    set: (k, v) => { try { ls.setItem(k, JSON.stringify(v)); } catch {} },
  };
}
