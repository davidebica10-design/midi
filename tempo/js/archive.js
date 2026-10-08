// Archivio delle attività fatte e degli impegni passati da più di 60 giorni: sta in IndexedDB,
// fuori dallo stato salvato in localStorage, così lo stato resta piccolo anche dopo anni d'uso.
// Le voci archiviate finiscono anche nel backup (exportData) e si ripristinano con l'import.
const DB = 'tempo-archive';
const STORE = 'items';
let dbPromise = null;

function db() {
  return (dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** Scrive le voci nell'archivio (tutte o nessuna). */
export const archivePut = (items) => tx('readwrite', (s) => { for (const it of items) s.put(it); });
/** Tutte le voci archiviate (per il backup). */
export const archiveAll = () => tx('readonly', (s) => s.getAll());
