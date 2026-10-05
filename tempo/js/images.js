// Foto delle carte: compresse e salvate sul telefono (IndexedDB), non nel localStorage.
const DB = 'tempo-images';
const STORE = 'images';
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
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
  }));
}

const urls = new Map();

export const putImage = (id, blob) => tx('readwrite', (s) => s.put(blob, id)).then(() => { urls.delete(id); });
export const deleteImage = (id) => tx('readwrite', (s) => s.delete(id)).then(() => {
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
});

/** URL già pronto (sincrono) se la foto è stata caricata in precedenza. */
export const cachedImageUrl = (id) => urls.get(id) || null;

export async function imageUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const blob = await tx('readonly', (s) => s.get(id));
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
}

/** Riduce la foto a una dimensione ragionevole (le foto dell'iPhone pesano diversi MB). */
export async function compressImage(file, max = 1100, quality = 0.82) {
  let src;
  try {
    src = await createImageBitmap(file);
  } catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height;
  const k = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
}
