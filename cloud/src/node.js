// Tempo Cloud su Node (sviluppo, oppure un piccolo server tuo / un Mac sempre acceso).
//   TEMPO_SECRET=… node src/node.js        (PORT, TEMPO_DATA, TEMPO_ORIGINS facoltativi)
// I dati stanno in un file JSON (cifrati per utente come su Cloudflare).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';

export function fileStore(path) {
  let data = {};
  try { data = JSON.parse(readFileSync(path, 'utf8')); } catch {}
  let timer = null;
  const flush = () => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path + '.tmp', JSON.stringify(data)); renameSync(path + '.tmp', path); };
  const later = () => { clearTimeout(timer); timer = setTimeout(flush, 200); };
  return { get: async (k) => data[k] ?? null, put: async (k, v) => { data[k] = v; later(); }, delete: async (k) => { delete data[k]; later(); }, flush };
}

/** Adatta un gestore fetch al server http di Node. */
export function serve(app, port) {
  return createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : null;
    const url = `http://${req.headers.host || 'localhost'}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', req.socket.remoteAddress || 'local');
    const r = await app.fetch(new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(port);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = +process.env.PORT || 8787;
  const store = fileStore(process.env.TEMPO_DATA || new URL('../data/tempo-cloud.json', import.meta.url).pathname);
  const app = createApp({ store, secret: process.env.TEMPO_SECRET, origins: process.env.TEMPO_ORIGINS?.split(',').map((s) => s.trim()) });
  serve(app, port);
  console.log(`Tempo Cloud su http://localhost:${port}`);
}
