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
        store: { get: (k) => kv.get(k), put: (k, v) => kv.put(k, v), delete: (k) => kv.delete(k) },
      });
    }
    return app.fetch(request);
  },
};
