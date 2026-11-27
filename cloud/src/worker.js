// Tempo Cloud su Cloudflare Workers. Variabili: TEMPO_SECRET (segreto), TEMPO_ORIGINS (facoltativo,
// origini ammesse separate da virgola). Archivio: KV «TEMPO_KV».
import { createApp } from './app.js';

let app = null;
export default {
  async fetch(request, env) {
    if (!app) {
      const kv = env.TEMPO_KV;
      app = createApp({
        secret: env.TEMPO_SECRET,
        origins: env.TEMPO_ORIGINS ? env.TEMPO_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        store: {
          get: (k) => kv.get(k),
          put: (k, v, o) => kv.put(k, v, o?.ttl ? { expirationTtl: Math.max(60, o.ttl) } : undefined),
          delete: (k) => kv.delete(k),
          // KV elenca le chiavi a pagine da 1000; la casella non ne tiene mai di più
          list: async (prefix, limit = 1000) => { const out = []; let cursor; do { const r = await kv.list({ prefix, cursor, limit: Math.min(1000, limit - out.length) }); out.push(...r.keys.map((k) => k.name)); cursor = r.list_complete ? null : r.cursor; } while (cursor && out.length < limit); return out; },
        },
      });
    }
    return app.fetch(request);
  },
};
