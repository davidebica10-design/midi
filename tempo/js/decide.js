// Il livello decisionale: quando l'app deve scegliere tra alternative (quale obiettivo dà il tono alla
// schermata, a quale motore mandare una richiesta…) sceglie SEMPRE tra opzioni già valide, calcolate
// dal codice. Un modello può solo dare un punteggio a quelle opzioni: non ne inventa di nuove.
//
// Motori («decider»), dal più semplice:
//  - rules  regole del codice (sempre disponibile, offline, deterministico): è la base e il ripiego;
//  - clm    CLM-8B (Stanford / NVIDIA, Apache 2.0) servito da `clm-serve` (github.com/Contrastive-LM/CLM):
//           una domanda «choice» a POST /v1/systemone, con le opzioni come candidati; stato e azioni sono
//           nello stesso spazio e vince l'azione più vicina allo stato. Niente testo generato, latenza bassa;
//  - embed  qualsiasi servizio /embeddings compatibile OpenAI (NVIDIA NIM, Gemini…): stessa idea di CLM
//           con un modello di embedding generico, somiglianza del coseno;
//  - llm    un modello di chat compatibile OpenAI (NVIDIA Nemotron su NIM, Gemini…) a cui si chiede di
//           scegliere un id tra quelli dati, in JSON.
// Il risultato del modello si mescola con le regole (blend) e vale solo se la fiducia supera una soglia;
// altrimenti, o se il servizio non risponde in tempo, decidono le regole.

export const DECIDERS = {
  rules: { label: 'Regole dell\'app (offline)', needs: [] },
  clm: { label: 'CLM-8B · modello decisionale open source', needs: ['url'], hint: 'Indirizzo https del tuo clm-serve, avviato con --cors e una chiave. Servono una GPU e vLLM: vedi cloud/clm/README.md.' },
  embed: { label: 'Embeddings (NVIDIA NIM, Gemini…)', needs: ['url', 'model'], presets: {
    nvidia: { url: 'https://integrate.api.nvidia.com/v1', model: 'nvidia/llama-3.2-nv-embedqa-1b-v2' },
    gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-embedding-001' },
  } },
  llm: { label: 'Modello di chat (Nemotron, Gemini…)', needs: ['url', 'model'], presets: {
    nvidia: { url: 'https://integrate.api.nvidia.com/v1', model: 'nvidia/nemotron-3-nano-30b-a3b' },
    gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-latest' },
  } },
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Da punteggi qualsiasi a probabilità che sommano a 1 (temperatura bassa = più deciso). */
export function softmax(xs, temp = 1) {
  if (!xs.length) return [];
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp((x - m) / Math.max(0.01, temp)));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

export function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/**
 * Le opzioni valide: { id (stringa), text (come la descriveresti a una persona), prior (punteggio delle regole, ≥ 0) }.
 * Restituisce solo opzioni ben formate e uniche.
 */
export function cleanOptions(options) {
  const seen = new Set();
  const out = [];
  for (const o of Array.isArray(options) ? options : []) {
    if (!o || typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({ id: o.id, text: String(o.text || o.id).slice(0, 300), prior: Number.isFinite(+o.prior) ? Math.max(0, +o.prior) : 0 });
  }
  return out;
}

/** La scelta delle sole regole: l'opzione con il punteggio più alto (a parità, la prima). */
export function decideByRules(options) {
  const opts = cleanOptions(options);
  if (!opts.length) return null;
  const probs = softmax(opts.map((o) => o.prior), 0.6);
  let best = 0;
  for (let i = 1; i < opts.length; i++) if (opts[i].prior > opts[best].prior) best = i;
  return { id: opts[best].id, confidence: probs[best], scores: Object.fromEntries(opts.map((o, i) => [o.id, probs[i]])), source: 'rules' };
}

/**
 * Mescola le probabilità delle regole con quelle del modello.
 * weight: quanto conta il modello (0–1). Restituisce la scelta finale.
 */
export function blend(options, modelScores, weight = 0.6, { probs = false } = {}) {
  const opts = cleanOptions(options);
  const rules = softmax(opts.map((o) => o.prior), 0.6);
  const raw = opts.map((o) => (Number.isFinite(modelScores?.[o.id]) ? modelScores[o.id] : Math.min(...Object.values(modelScores || {}).filter(Number.isFinite), 0)));
  // «probs»: il modello ha già dato una distribuzione (CLM): si usa com'è; altrimenti sono punteggi e si passano da una softmax
  const total = raw.reduce((a, b) => a + Math.max(0, b), 0);
  const model = probs && total > 0 ? raw.map((x) => Math.max(0, x) / total) : softmax(raw, 0.15);
  const mixed = opts.map((o, i) => (1 - weight) * rules[i] + weight * model[i]);
  let best = 0;
  for (let i = 1; i < mixed.length; i++) if (mixed[i] > mixed[best]) best = i;
  return { id: opts[best].id, confidence: mixed[best], scores: Object.fromEntries(opts.map((o, i) => [o.id, mixed[i]])) };
}

// ---------------------------------------------------------------- motori remoti
async function postJson(fetchImpl, url, body, key, signal) {
  const r = await fetchImpl(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw Object.assign(new Error(j?.error?.message || j?.error || `errore ${r.status}`), { status: r.status });
  return j;
}

/** L'indirizzo di clm-serve, con o senza il percorso: «http://host:8700», «…/v1/systemone». */
export const clmEndpoint = (url) => String(url || '').replace(/\/+$/, '').replace(/\/v1(?:\/systemone)?$/, '') + '/v1/systemone';

/**
 * CLM-8B tramite `clm-serve`: una domanda di tipo «choice» sullo stato; ogni opzione è un candidato (la sua
 * descrizione) con il suo id come chiave. La risposta è la distribuzione di probabilità sulle chiavi.
 * Formato: github.com/Contrastive-LM/CLM (README «API Reference», src/clm/client.py).
 */
async function scoreClm(cfg, stateText, opts, { fetchImpl, signal }, task = '') {
  const j = await postJson(fetchImpl, clmEndpoint(cfg.url), {
    state: stateText,
    model: cfg.model || 'clm-latest',
    questions: { decisione: { type: 'choice', instructions: task || 'Qual è la scelta giusta adesso?', criteria: Object.fromEntries(opts.map((o) => [o.id, o.text])) } },
  }, cfg.key, signal);
  const a = j?.answers?.decisione;
  const p = a?.probabilities;
  if (a?.type !== 'choice' || !p || !opts.every((o) => Number.isFinite(+p[o.id]))) throw new Error('risposta del modello decisionale non valida');
  return Object.fromEntries(opts.map((o) => [o.id, +p[o.id]]));
}

/** Embeddings compatibili OpenAI: somiglianza del coseno tra lo stato e ogni azione. */
async function scoreEmbed(cfg, stateText, opts, { fetchImpl, signal }) {
  const base = String(cfg.url).replace(/\/+$/, '');
  const j = await postJson(fetchImpl, `${base}/embeddings`, { model: cfg.model, input: [stateText, ...opts.map((o) => o.text)] }, cfg.key, signal);
  const v = (j.data || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
  if (v.length !== opts.length + 1 || !v.every(Array.isArray)) throw new Error('embeddings non validi');
  return Object.fromEntries(opts.map((o, i) => [o.id, cosine(v[0], v[i + 1])]));
}

/** Un modello di chat sceglie un id tra quelli dati; il codice controlla che esista. */
async function scoreLlm(cfg, stateText, opts, task, { fetchImpl, signal }) {
  const base = String(cfg.url).replace(/\/+$/, '');
  const list = opts.map((o) => `- ${o.id}: ${o.text}`).join('\n');
  const j = await postJson(fetchImpl, `${base}/chat/completions`, {
    model: cfg.model, temperature: 0, max_tokens: 300,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Scegli una sola opzione tra quelle date. Rispondi solo con JSON: {"choice":"<id>","confidence":0.0-1.0}. Non inventare id.' },
      { role: 'user', content: `COMPITO: ${task}\nSTATO:\n${stateText}\nOPZIONI:\n${list}` },
    ],
  }, cfg.key, signal);
  const c = String(j.choices?.[0]?.message?.content || '');
  const o = JSON.parse(c.slice(c.indexOf('{'), c.lastIndexOf('}') + 1));
  if (!opts.some((x) => x.id === o.choice)) throw new Error('scelta fuori dalle opzioni');
  const conf = clamp01(+o.confidence || 0.5);
  return Object.fromEntries(opts.map((x) => [x.id, x.id === o.choice ? conf : (1 - conf) / Math.max(1, opts.length - 1)]));
}

/**
 * Decide tra le opzioni.
 * { task: cosa si decide, state: descrizione testuale dello stato, options, decider: { kind, url, key, model, weight, minConfidence },
 *   fetchImpl, timeoutMs, signal }
 * Restituisce { id, confidence, scores, source: 'rules' | kind, error? }. Non lancia mai: nel dubbio decidono le regole.
 */
export async function decide({ task = '', state = '', options, decider = null, fetchImpl = globalThis.fetch, timeoutMs = 2500, signal } = {}) {
  const opts = cleanOptions(options);
  const byRules = decideByRules(opts);
  if (!byRules || opts.length === 1 || !decider || !decider.kind || decider.kind === 'rules' || !decider.url) return byRules;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  signal?.addEventListener?.('abort', () => ctl.abort());
  try {
    const run = { fetchImpl, signal: ctl.signal };
    const stateText = String(state).slice(0, 4000);
    const scores = decider.kind === 'clm' ? await scoreClm(decider, stateText, opts, run, task)
      : decider.kind === 'embed' ? await scoreEmbed(decider, stateText, opts, run)
      : decider.kind === 'llm' ? await scoreLlm(decider, stateText, opts, task, run)
      : null;
    if (!scores) return byRules;
    const out = blend(opts, scores, Number.isFinite(+decider.weight) ? clamp01(+decider.weight) : 0.6, { probs: decider.kind === 'clm' });
    if (out.confidence < (decider.minConfidence ?? 0.35)) return { ...byRules, model: out };
    return { ...out, source: decider.kind };
  } catch (e) {
    return { ...byRules, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- decisioni dell'app

/**
 * A quale motore mandare un messaggio della barra.
 * 'base' = lo capisce il codice (comando semplice); 'fast' = modello veloce; 'heavy' = richiesta corposa
 * (organizzare la settimana, riassunti, piani lunghi): va al modello più capace con la chiave dell'utente.
 * quick: il risultato di localParse sul messaggio (se già calcolato).
 */
export function routeOptions(text, quick = null) {
  const t = String(text || '').toLowerCase();
  const long = t.length > 220 || (t.match(/[.;\n]/g) || []).length >= 4;
  const open = /\b(organizz\w*|pianific\w*|riorganizz\w*|ripens\w*|strategi\w*|consigli\w*|come (posso|faccio a)|aiutami|riassun\w*|riepilog\w*|bilancio|analizz\w*|mese|settimana prossima|tutta la settimana|piano per)\b/.test(t);
  const simple = !!(quick?.simple && quick?.ops?.length);
  return [
    { id: 'base', text: 'comando semplice che il codice capisce da solo', prior: simple ? 3 : quick?.ops?.length && !long && !open ? 1.2 : 0 },
    { id: 'fast', text: 'richiesta normale: aggiungere, spostare, cambiare qualcosa', prior: simple ? 0.5 : 1.5 },
    { id: 'heavy', text: 'richiesta aperta o corposa: organizzare, riassumere, ragionare su settimane o mesi', prior: (open ? 2.2 : 0) + (long ? 1.2 : 0) },
  ];
}
export const routeRequest = (text, quick) => decideByRules(routeOptions(text, quick)).id;

/**
 * Quale obiettivo dà il tono alla schermata adesso. Opzioni: gli obiettivi attivi, con un punteggio dalle regole:
 * una sessione in corso adesso, sessioni oggi, scadenza vicina, ritardo, recente.
 * ctx: { state, plan, now, today }
 */
export function sceneGoalOptions({ state, plan, now, today }) {
  const p = plan?.[today];
  const nowMin = (() => { const d = new Date(now); return d.getHours() * 60 + d.getMinutes(); })();
  const out = [];
  for (const g of state.goals || []) {
    const mine = (state.items || []).filter((x) => x.goalId === g.id && x.kind === 'task');
    const open = mine.filter((x) => x.status !== 'done');
    if (!open.length && !(state.habits || []).some((h) => h.goalId === g.id)) continue;
    let prior = 0.2;
    const blocks = (p?.blocks || []).filter((b) => b.item.goalId === g.id && b.type !== 'done');
    if (blocks.some((b) => b.start <= nowMin && nowMin < b.end) || open.some((x) => x.status === 'doing')) prior += 4;
    if (blocks.length) prior += 1.5 + Math.min(1, blocks.length * 0.3);
    if (g.due) {
      const days = Math.round((Date.parse(g.due + 'T12:00') - Date.parse(today + 'T12:00')) / 864e5);
      if (days >= 0) prior += Math.max(0, 1.5 - days / 30);
    }
    if (g.lateSince) prior += 0.6;
    prior += Math.max(0, 0.5 - (now - (g.at || 0)) / (30 * 864e5));
    out.push({ id: g.id, text: `${g.title}${g.due ? ` (scadenza ${g.due})` : ''}: ${mine.length - open.length} di ${mine.length} sessioni fatte${blocks.length ? `, ${blocks.length} oggi` : ''}`, prior });
  }
  return out;
}

/** Descrizione compatta dello stato per un motore decisionale (niente dati personali oltre ai titoli). */
export function stateText({ state, plan, now, today }) {
  const d = new Date(now);
  const p = plan?.[today];
  const lines = [`Adesso: ${today} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`];
  if (p) lines.push(`Oggi: ${p.blocks.filter((b) => b.type !== 'done').map((b) => b.item.title).slice(0, 8).join(', ') || 'niente'} · liberi ${p.free} min`);
  if (state.focus) lines.push(`In corso: ${state.focus.title}`);
  return lines.join('\n');
}
