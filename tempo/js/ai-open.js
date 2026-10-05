// Modelli gratuiti: in locale sull'iPhone (WebLLM + WebGPU) oppure tramite un servizio
// compatibile con l'API OpenAI (Google Gemini, OpenRouter, Groq, …).
// I modelli piccoli non usano strumenti: rispondono con un JSON che il codice valida.
import { fmtMin, dateKey, addDays } from './scheduler.js';
import { localParse } from './ai.js';

export const LOCAL_MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B · consigliato' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B · leggero' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 3B · più bravo, pesante' },
];

export const ONLINE_PRESETS = {
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '', keyUrl: 'https://openrouter.ai/settings/keys' },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: '', keyUrl: 'https://console.groq.com/keys' },
  custom: { label: 'Altro (compatibile OpenAI)', baseUrl: '', model: '', keyUrl: '' },
};
export const DEFAULT_PRESET = 'gemini';

export const presetOf = (S) => S.openPreset || (S.openBaseUrl?.includes('openrouter.ai') ? 'openrouter' : S.openBaseUrl ? 'custom' : DEFAULT_PRESET);

// Modelli di riserva se l'elenco non è raggiungibile
const FALLBACK_MODELS = {
  gemini: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'],
  openrouter: [],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  custom: [],
};

// Preferenze tra i modelli gratuiti di OpenRouter: prima quelli grandi e bravi a seguire istruzioni
const FREE_PREF = [/deepseek-(chat|v3)/, /qwen.*(235b|72b|32b)/, /gpt-oss-120b/, /llama-3\.3-70b/, /llama-4-maverick/, /gemma-3-27b/, /mistral-small/, /llama-4/, /qwen/, /gemma/];

function rankGemini(id) {
  // flash prima (veloce e con limiti gratuiti ampi), poi flash-lite, poi pro; versioni più recenti prima
  const tier = /flash-lite/.test(id) ? 1 : /flash/.test(id) ? 0 : /pro/.test(id) ? 2 : 3;
  const v = +(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || (/latest/.test(id) ? 99 : 0));
  const unstable = /preview|exp/.test(id) ? 1 : 0;
  return [tier, unstable, -v];
}
const cmp = (x, y) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

/** Elenco dei modelli utilizzabili del servizio, dal migliore. */
export async function listModels(preset, base, key) {
  base = (base || ONLINE_PRESETS[preset]?.baseUrl || '').replace(/\/+$/, '');
  if (!base || preset === 'custom') return [];
  const r = await fetch(`${base}/models`, key && preset !== 'openrouter' ? { headers: { Authorization: `Bearer ${key}` } } : undefined);
  const j = await r.json().catch(() => ({}));
  const err = Array.isArray(j) ? j[0]?.error : j?.error;
  if (!r.ok || err) throw Object.assign(new Error(err?.message || `elenco modelli non disponibile (${r.status})`), { status: r.status });
  const data = (j.data || []).map((m) => ({ ...m, id: String(m.id || '').replace(/^models\//, '') })).filter((m) => m.id);
  if (preset === 'openrouter') {
    const isFree = (m) => m.id.endsWith(':free') || (m.pricing && +m.pricing.prompt === 0 && +m.pricing.completion === 0);
    const textOut = (m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text');
    const free = data.filter((m) => !m.id.startsWith('openrouter/') && isFree(m) && textOut(m) && (m.context_length || 0) >= 8000);
    const rank = (m) => { const i = FREE_PREF.findIndex((re) => re.test(m.id)); return i < 0 ? 99 : i; };
    return free.sort((a, b) => rank(a) - rank(b) || (b.context_length || 0) - (a.context_length || 0)).map((m) => ({ id: m.id, name: (m.name || m.id).replace(/\s*\(free\)\s*$/i, '') }));
  }
  if (preset === 'gemini') {
    const ok = data.filter((m) => /^gemini/.test(m.id) && !/embedding|image|tts|audio|live|vision|computer|robotics|native|thinking|learnlm|aqa/.test(m.id));
    return ok.sort((a, b) => cmp(rankGemini(a.id), rankGemini(b.id))).map((m) => ({ id: m.id, name: m.display_name || m.id }));
  }
  if (preset === 'groq') {
    const ok = data.filter((m) => m.active !== false && !/whisper|tts|guard|playai|orpheus|prompt/.test(m.id));
    const pref = [/llama-3\.3-70b/, /gpt-oss-120b/, /llama-4/, /qwen/, /kimi/, /gpt-oss/, /llama/];
    const rank = (m) => { const i = pref.findIndex((re) => re.test(m.id)); return i < 0 ? 99 : i; };
    return ok.sort((a, b) => rank(a) - rank(b)).map((m) => ({ id: m.id, name: m.id }));
  }
  return [];
}
/** Compatibilità con la versione precedente. */
export const listFreeModels = (base) => listModels('openrouter', base);

const WD = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

function systemPrompt(now) {
  const d = new Date(now);
  const today = dateKey(d);
  return `Sei un assistente che gestisce la giornata dell'utente. Rispondi SOLO con un oggetto JSON, senza altro testo:
{"reply": "risposta breve in italiano", "ops": [ ... ], "requires_confirmation": false}

Adesso è ${WD[d.getDay()]} ${today}, ore ${fmtMin(d.getHours() * 60 + d.getMinutes())}. Domani è ${addDays(today, 1)}.

Operazioni possibili in "ops" (metti solo i campi che servono):
- Nuova attività flessibile (l'orario lo sceglie l'app): {"action":"add","kind":"task","title":"Spesa","duration_min":30,"priority":2,"energy":1}
  Puoi aggiungere "date":"YYYY-MM-DD" se è per un giorno preciso, "window":"mattina"|"pomeriggio"|"sera".
- Nuovo impegno fisso con orario: {"action":"add","kind":"event","title":"Call","date":"${addDays(today, 1)}","start_time":"16:00","end_time":"17:00"}
- Attività finita: {"action":"complete","id":"ID"}
- Spostare: {"action":"move","id":"ID","date":"YYYY-MM-DD"}
- Modificare: {"action":"update","id":"ID","duration_min":120} oppure "priority":3, "start_time":"HH:MM"
- Non ancora iniziata: {"action":"reopen","id":"ID"}
- Eliminare: {"action":"delete","id":"ID"}
- Ricordare una preferenza: {"action":"remember","note":"testo"}

Regole:
- priority: 1 bassa, 2 normale, 3 alta. energy: 1 leggera, 2 media, 3 pesante (attività creative o di concentrazione).
- Se l'utente non dà la durata, stimala in modo realistico.
- Usa gli ID dell'elenco attività. Non inventare impegni. Se manca un orario necessario, chiedilo in "reply" con "ops": [].
- "Lavoro fino alle 18:30" = impegno fisso da adesso alle 18:30. "Sono in ritardo di un'ora" = impegno fisso "Ritardo" di 60 minuti da adesso.
- Per eliminare cose o spostare impegni fissi metti "requires_confirmation": true.
- Per domande ("cosa faccio oggi?") rispondi leggendo il piano, con "ops": [].`;
}

function compactState(state, plan, now) {
  const today = dateKey(new Date(now));
  const lines = [];
  const active = state.items.filter((x) => x.status !== 'done' || (x.doneAt && now - x.doneAt < 864e5));
  lines.push('ATTIVITÀ (id | titolo | tipo | stato | giorno | ora | minuti | priorità):');
  for (const x of active.slice(-40)) {
    lines.push(`${x.id} | ${x.title} | ${x.kind === 'event' ? 'fisso' : 'flessibile'} | ${x.status} | ${x.date || '-'} | ${x.start != null ? fmtMin(x.start) : '-'} | ${x.duration} | ${x.priority}`);
  }
  if (!active.length) lines.push('(nessuna)');
  for (const [label, day] of [['OGGI', today], ['DOMANI', addDays(today, 1)]]) {
    const p = plan[day];
    if (!p) continue;
    lines.push(`PIANO ${label}: ${p.blocks.map((b) => `${fmtMin(b.start)}-${fmtMin(b.end)} ${b.item.title}${b.type === 'done' ? ' (fatto)' : ''}`).join('; ') || 'vuoto'}`);
    if (p.unscheduled.length) lines.push(`NON ENTRA ${label}: ${p.unscheduled.map((u) => u.item.title).join(', ')}`);
    if (p.deferred?.length) lines.push(`SLITTA: ${p.deferred.map((t) => t.title).join(', ')}`);
    lines.push(`Tempo libero ${label.toLowerCase()}: ${p.free} min`);
  }
  if (state.memory.length) lines.push('PREFERENZE: ' + state.memory.map((m) => m.text).join('; '));
  return lines.join('\n');
}

function history(chat, n) {
  const out = [];
  for (const m of chat.slice(-n)) {
    if (m.pending || m.error || !m.text) continue;
    const role = m.role === 'user' ? 'user' : 'assistant';
    const content = role === 'assistant' ? JSON.stringify({ reply: m.text, ops: [] }) : m.text;
    if (out.length && out[out.length - 1].role === role) continue;
    out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    ops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'move', 'start', 'complete', 'reopen', 'delete', 'remember'] },
          id: { type: 'string' },
          title: { type: 'string' },
          kind: { type: 'string', enum: ['task', 'event'] },
          date: { type: 'string' },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          duration_min: { type: 'integer' },
          priority: { type: 'integer' },
          energy: { type: 'integer' },
          window: { type: 'string', enum: ['mattina', 'pomeriggio', 'sera'] },
          note: { type: 'string' },
        },
        required: ['action'],
      },
    },
    requires_confirmation: { type: 'boolean' },
  },
  required: ['reply', 'ops', 'requires_confirmation'],
};

function parseJson(text) {
  const t = String(text || '').replace(/```(?:json)?/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('risposta non in formato JSON');
  const o = JSON.parse(t.slice(a, b + 1));
  return {
    reply: typeof o.reply === 'string' ? o.reply : '',
    ops: Array.isArray(o.ops) ? o.ops.filter((x) => x && typeof x.action === 'string') : [],
    requires_confirmation: !!o.requires_confirmation,
  };
}

// ---------------------------------------------------------------- in locale
let engine = null, engineModel = null, enginePromise = null;

export const webgpuAvailable = () => typeof navigator !== 'undefined' && !!navigator.gpu;

async function getEngine(model, onProgress) {
  if (engine && engineModel === model) return engine;
  if (enginePromise && engineModel === model) return enginePromise;
  if (!webgpuAvailable()) throw Object.assign(new Error('webgpu'), { code: 'webgpu' });
  engineModel = model;
  enginePromise = (async () => {
    const webllm = await import('../vendor/web-llm.mjs');
    if (engine) { try { await engine.unload(); } catch {} }
    engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (r) => onProgress?.(r.progress ?? 0, r.text || ''),
    });
    return engine;
  })();
  try { return await enginePromise; } catch (e) { engine = null; engineModel = null; throw e; } finally { enginePromise = null; }
}

export const localModelLoaded = (model) => !!engine && engineModel === model;
export const preloadLocal = (model, onProgress) => getEngine(model, onProgress);

// ---------------------------------------------------------------- turno
/**
 * Un turno con un modello open. Restituisce { text, ops, confirm }.
 * onProgress(frazione, testo) viene chiamato durante il primo download del modello locale.
 */
export async function runOpenTurn({ state, plan, now, userText, onProgress, signal, chat = [] }) {
  // comandi semplici: li gestisce il codice, più veloce e affidabile di un modello piccolo
  const quick = localParse(userText, state, now);
  if (quick.ops?.length && quick.ops.every((o) => o.action !== 'add' || o.title === 'Ritardo')) {
    return { text: quick.reply, ops: quick.ops, confirm: !!quick.confirm };
  }

  const S = state.settings;
  const isLocal = S.provider === 'local';
  const messages = [
    { role: 'system', content: systemPrompt(now) },
    ...history(chat, isLocal ? 4 : 10),
    { role: 'user', content: `${compactState(state, plan, now)}\n\nMESSAGGIO DELL'UTENTE: ${userText}` },
  ];

  let content;
  if (isLocal) {
    const eng = await getEngine(S.localModel || LOCAL_MODELS[0].id, onProgress);
    const ask = (format) => eng.chat.completions.create({
      messages, temperature: 0.2, max_tokens: 700, ...(format ? { response_format: format } : {}),
    });
    let res;
    try {
      // lo schema vincola il modello a produrre esattamente il JSON atteso
      res = await ask({ type: 'json_object', schema: JSON.stringify(REPLY_SCHEMA) });
    } catch (e) {
      if (/grammar|schema|response format/i.test(e?.message || '')) res = await ask(null);
      else throw e;
    }
    content = res.choices?.[0]?.message?.content;
  } else {
    content = (await onlineComplete(S, messages, signal)).content;
  }

  let out;
  try { out = parseJson(content); }
  catch {
    // il modello ha risposto a parole: mostriamo il testo senza modifiche
    return { text: String(content || '').trim() || 'Non ho capito, puoi riformulare?', ops: [], confirm: false };
  }
  return { text: out.reply || (out.ops.length ? 'Fatto.' : 'Non ho capito, puoi riformulare?'), ops: out.ops, confirm: out.requires_confirmation };
}

// ---------------------------------------------------------------- servizio online
const authError = (e) => e.status === 401 || e.status === 403 || /api key|apikey|unauthori[sz]ed|invalid.*key|key.*invalid/i.test(e.message || '');

/**
 * Manda i messaggi al servizio online provando, se serve, più modelli.
 * Restituisce { content, model }.
 */
export async function onlineComplete(S, messages, signal) {
  const preset = presetOf(S);
  const base = (S.openBaseUrl || ONLINE_PRESETS[preset]?.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Manca l\'indirizzo del servizio');
  if (preset !== 'custom' && !S.openKey) throw Object.assign(new Error('manca la chiave'), { code: 'nokey' });

  const call = async (model, json) => {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(S.openKey ? { Authorization: `Bearer ${S.openKey}` } : {}),
        ...(preset === 'openrouter' ? { 'X-Title': 'Tempo' } : {}),
      },
      body: JSON.stringify({
        model, messages, temperature: 0.2,
        // i modelli Gemini "pensano" prima di rispondere: serve spazio anche per quello
        max_tokens: preset === 'gemini' ? 8192 : 1200,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    let body = await r.json().catch(() => ({}));
    if (Array.isArray(body)) body = body[0] || {};
    if (!r.ok || body?.error) throw Object.assign(new Error(body?.error?.message || `errore ${r.status}`), { status: r.ok ? +body?.error?.code || 500 : r.status });
    const c = body.choices?.[0]?.message?.content;
    if (!c) throw Object.assign(new Error('risposta vuota'), { status: 502 });
    return c;
  };

  // modelli da provare: quello scelto, poi gli altri del servizio dal migliore
  const bad = S.badModels || {};
  const isBad = (id) => bad[id] && Date.now() - bad[id] < 864e5;
  const candidates = [];
  if (S.openModel && !isBad(S.openModel)) candidates.push(S.openModel);
  if (S.lastWorkingModel && S.lastWorkingPreset === preset && !candidates.includes(S.lastWorkingModel)) candidates.push(S.lastWorkingModel);
  let listErr = null;
  if (preset !== 'custom') {
    if (S.freeModelsPreset !== preset || !S.freeModels?.length || Date.now() - (S.freeModelsAt || 0) > 6 * 36e5) {
      try { S.freeModels = (await listModels(preset, base, S.openKey)).slice(0, 40); S.freeModelsAt = Date.now(); S.freeModelsPreset = preset; }
      catch (e) { listErr = e; if (authError(e)) throw Object.assign(e, { code: 'badkey' }); }
    }
    const listed = S.freeModelsPreset === preset ? (S.freeModels || []).map((m) => m.id) : [];
    for (const id of [...listed, ...FALLBACK_MODELS[preset]]) if (!candidates.includes(id) && !isBad(id)) candidates.push(id);
    if (!candidates.length) candidates.push(...listed, ...FALLBACK_MODELS[preset]); // tutti scartati di recente: riprova comunque
  }
  if (!candidates.length) throw new Error(listErr ? 'Non riesco a scaricare l\'elenco dei modelli: ' + listErr.message : 'Manca il nome del modello');

  const tried = [];
  let lastErr;
  for (const model of candidates.slice(0, 8)) {
    tried.push(model);
    try {
      let content;
      try { content = await call(model, true); }
      catch (e) {
        // alcuni modelli non accettano response_format: riprova senza
        if (e.status === 400 && !authError(e) && !/free|unavailable|not found|no endpoints|does not exist|decommission/i.test(e.message)) content = await call(model, false);
        else throw e;
      }
      if (S.openModel && S.openModel !== model) S.openModel = ''; // il modello scelto non risponde: torna su Automatico
      S.lastWorkingModel = model;
      S.lastWorkingPreset = preset;
      return { content, model };
    } catch (e) {
      lastErr = e;
      if (authError(e)) throw Object.assign(e, { code: 'badkey' }); // chiave sbagliata: inutile provare altri modelli
      if (e.name === 'AbortError') throw e;
      bad[model] = Date.now();
      S.badModels = bad;
    }
  }
  throw Object.assign(new Error(`Nessun modello ha risposto. Provati: ${tried.map((m) => m.replace(/:free$/, '')).join(', ')}. Ultimo errore: ${lastErr.message}`), { code: 'nofree', status: lastErr.status });
}

/** Prova veloce di chiave e modello, per le impostazioni. */
export async function testOnline(S) {
  const { content, model } = await onlineComplete(S, [
    { role: 'system', content: 'Rispondi solo con questo JSON: {"reply":"ok","ops":[],"requires_confirmation":false}' },
    { role: 'user', content: 'Prova di connessione' },
  ]);
  return { model, ok: /ok/i.test(content || '') };
}
