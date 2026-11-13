// Audio sul dispositivo: i file stanno in IndexedDB, mai nel localStorage.
// Da ogni bounce ricaviamo durata e una forma d'onda di poche barre per la lista.
const DB = 'tempo-studio-audio';
const STORE = 'audio';
let dbPromise = null;

function db() {
  return (dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
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

const urls = new Map();

export const putAudio = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
export const deleteAudio = (id) => tx('readwrite', (s) => s.delete(id)).then(() => {
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
});

/** URL riproducibile del file, o null se non è su questo dispositivo. */
export async function audioUrl(id) {
  if (!id) return null;
  if (urls.has(id)) return urls.get(id);
  const blob = await tx('readonly', (s) => s.get(id)).catch(() => null);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
}

/** Durata in secondi e `bars` picchi tra 0 e 1. Se il formato non si decodifica: { duration: 0, peaks: [] }. */
export async function analyze(buf, bars = 48) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const audio = await ctx.decodeAudioData(buf.slice(0));
    ctx.close?.();
    const ch = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / bars));
    const peaks = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const end = Math.min(ch.length, (i + 1) * step);
      for (let j = i * step; j < end; j += 16) { const v = Math.abs(ch[j]); if (v > max) max = v; }
      peaks.push(max);
    }
    const top = Math.max(...peaks, 0.001);
    return { duration: Math.round(audio.duration), peaks: peaks.map((p) => Math.round((p / top) * 100) / 100) };
  } catch {
    return { duration: 0, peaks: [] };
  }
}
