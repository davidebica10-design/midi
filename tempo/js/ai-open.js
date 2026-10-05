// Modelli open e gratuiti: in locale sull'iPhone (WebLLM + WebGPU) oppure tramite un
// servizio compatibile con l'API OpenAI (OpenRouter, Groq, …).
// I modelli piccoli non usano strumenti: rispondono con un JSON che il codice valida.
import { fmtMin, dateKey, addDays } from './scheduler.js';
import { localParse } from './ai.js';

export const LOCAL_MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B · consigliato' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B · leggero' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 3B · più bravo, pesante' },
];

export const ONLINE_PRESETS = {
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', keyUrl: 'https://openrouter.ai/settings/keys' },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  custom: { label: 'Altro (compatibile OpenAI)', baseUrl: '', model: '', keyUrl: '' },
};

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
    const res = await eng.chat.completions.create({
      messages, temperature: 0.2, max_tokens: 700, response_format: { type: 'json_object' },
    });
    content = res.choices?.[0]?.message?.content;
  } else {
    const base = (S.openBaseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('Manca l\'indirizzo del servizio');
    const call = async (json) => {
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(S.openKey ? { Authorization: `Bearer ${S.openKey}` } : {}),
          ...(base.includes('openrouter.ai') ? { 'X-Title': 'Tempo' } : {}),
        },
        body: JSON.stringify({
          model: S.openModel, messages, temperature: 0.2, max_tokens: 1200,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(body?.error?.message || `errore ${r.status}`), { status: r.status });
      return body.choices?.[0]?.message?.content;
    };
    try { content = await call(true); }
    catch (e) {
      // alcuni modelli non accettano response_format: riprova senza
      if (e.status === 400) content = await call(false);
      else throw e;
    }
  }

  let out;
  try { out = parseJson(content); }
  catch {
    // il modello ha risposto a parole: mostriamo il testo senza modifiche
    return { text: String(content || '').trim() || 'Non ho capito, puoi riformulare?', ops: [], confirm: false };
  }
  return { text: out.reply || (out.ops.length ? 'Fatto.' : 'Non ho capito, puoi riformulare?'), ops: out.ops, confirm: out.requires_confirmation };
}
