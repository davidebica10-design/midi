// AI facoltativa per leggere la chat meglio delle regole. Stesso schema di Tempo (ai-open.js):
// servizio compatibile OpenAI (Gemini gratis, OpenRouter, Groq, Ollama in locale), risposta JSON,
// validata dal codice con sanitizeOps. L'AI legge solo il testo della chat: mai l'audio.
import { sanitizeOps } from './store.js';
import { fmtDay, fmtTime, dateKey } from './util.js';

export const PRESETS = {
  gemini: { label: 'gemini · gratis', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-latest' },
  ollama: { label: 'ollama · sul mac', base: 'http://localhost:11434/v1', model: 'llama3.2' },
  openrouter: { label: 'openrouter', base: 'https://openrouter.ai/api/v1', model: '' },
  groq: { label: 'groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
};

export const aiReady = (cfg) => !!(cfg?.base && cfg?.model && (cfg.key || /localhost|127\.0\.0\.1/.test(cfg.base)));

function prompt(me, versions, today) {
  return `Leggi una chat WhatsApp tra persone che lavorano a un brano musicale. Estrai SOLO fatti espliciti.
Rispondi SOLO con JSON: {"ops":[ ... ]}. Ogni op ha "msg": indice del messaggio da cui viene.
Oggi è ${today}. L'utente nella chat si chiama "${me || '?'}".
Versioni del brano: ${versions.map((v) => `v${v.n} (${v.fileName})`).join(', ') || 'nessuna'}.
Op possibili:
- ok esplicito a una versione: {"action":"approve","version":"v3","by":"nome","msg":4}  (version null se non si capisce quale)
- richiesta di modifiche a una versione: {"action":"request","version":"v3","by":"nome","text":"voce più alta nel ritornello","msg":5}
- cosa da fare: {"action":"task","who":"nome di chi la deve fare","what":"verbo + oggetto, max 12 parole","due":"AAAA-MM-GG o null","by":"chi l'ha detto","msg":6}
- decisione presa: {"action":"decide","text":"breve","by":"nome","msg":7}
Regole: niente ok se c'è una negazione o una domanda. Non inventare scadenze. Niente op per saluti e chiacchiere.`;
}

/** Messaggi → proposte nello stesso formato di chat.extract. */
export async function aiExtract(msgs, { me, versions, cfg, now = Date.now(), signal } = {}) {
  const recent = msgs.slice(-200);
  const offset = msgs.length - recent.length;
  const lines = recent.map((m, i) => `${i}. [${fmtDay(m.at)} ${fmtTime(m.at)}] ${m.who}: ${m.text.slice(0, 400)}`).join('\n');
  const base = cfg.base.replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}) },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: prompt(me, versions, dateKey(now)) }, { role: 'user', content: lines }],
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || j?.[0]?.error?.message || `il servizio risponde ${res.status}`);
  const content = j.choices?.[0]?.message?.content || '';
  const json = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
  const raw = Array.isArray(json.ops) ? json.ops : [];
  const out = [];
  for (const o of raw) {
    const msg = recent[+o.msg] || null;
    const [op] = sanitizeOps([{ ...o, at: msg?.at ?? now, source: 'ai' }]);
    if (op) out.push({ op, msg, confidence: msg ? 'alta' : 'media', why: 'letto dall’ai', index: msg ? offset + +o.msg : null });
  }
  return out;
}
