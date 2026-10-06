// Interpretazione del linguaggio naturale.
// L'AI trasforma ciò che dice l'utente in operazioni strutturate; il motore di
// pianificazione (scheduler.js) e la validazione (store.js) decidono il resto.
import { fmtMin, dateKey, addDays, dayLabel } from './scheduler.js';
import { COMPANION_RULES, companionContext } from './companion.js';
import { sanitizeOps } from './store.js';

let sdkPromise = null;
const loadSdk = () => (sdkPromise ||= import('../vendor/anthropic-sdk.mjs').then((m) => m.default));

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — più accurato' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — più veloce ed economico' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — il più economico' },
];

const SYSTEM = `Rispondi sempre in italiano, in modo breve e concreto (1–4 frasi), come una persona di fiducia, non come un software.

${COMPANION_RULES}

Come lavori
- L'utente ti dice cosa deve fare, cosa è cambiato, cosa vuole ottenere. Tu traduci tutto in operazioni con lo strumento update_plan. Un motore di pianificazione deterministico decide poi gli orari esatti delle attività flessibili: non devi calcolarli tu.
- Ad ogni messaggio ricevi in <stato> l'ora attuale, le attività con i loro id, i piani di oggi e domani già calcolati, le preferenze e la memoria. È l'unica fonte di verità: usa gli id che trovi lì.
- Dopo update_plan ricevi il risultato (nuovo piano, cosa non entra, conflitti, cosa si è spostato). Spiega in breve le conseguenze importanti.

Tipi di elemento
- kind "event" = impegno fisso con orario (lavoro, call, appuntamenti, arrivo di un amico). Serve start_time; usa end_time o duration_min se li conosci.
- kind "task" = attività flessibile: NON dare start_time, lo sceglie il motore. Dai start_time a un task solo se l'utente chiede esplicitamente quell'orario.
- "Lavoro fino alle 18:30" senza inizio: crea un event dall'ora attuale (o dall'inizio giornata) fino alle 18:30.
- "Oggi ho solo tre ore libere": crea un event "Non disponibile" che copre il resto della giornata, così restano 3 ore.
- "Sono in ritardo di un'ora": crea un event "Ritardo" di 60 minuti da adesso, così il motore sposta in avanti le attività flessibili.
- "La riunione è durata un'ora invece di trenta minuti": update della durata dell'event.
- "Ho finito X" → complete (con actual_min se lo dice). "Sto iniziando X" → start. "Non ho fatto X, spostalo a domani" → move con date di domani.
- "Non ho ancora iniziato X" → reopen: l'attività torna da pianificare a partire da adesso. Le attività del piano il cui orario è iniziato sono considerate in corso (tipo "current"); quelle in "da_confermare" erano previste ma l'utente non ha detto se le ha fatte.
- "Questo è più importante" → priority 3. "Sono stanco / giornata più leggera" → abbassa priorità o sposta a domani le attività pesanti (energy 3), e chiedi conferma.
- Abitudini ricorrenti ("lavoro dal lunedì al venerdì 9–18") → add_recurring con weekdays (0=domenica … 6=sabato).
- Preferenze dichiarate stabilmente ("non voglio cose creative dopo il lavoro", "rendo di più la mattina") → remember con una nota breve, e se utile set_pref (focus_window, buffer_min, slack_percent, day_start, day_end).

Stime
- Se l'utente non dà una durata, stimala in modo realistico e generoso (le persone sottostimano) e metti duration_is_estimate=true. Considera la memoria e le durate reali passate presenti nello stato.
- energy: 1 leggera (commissioni, spesa), 2 media, 3 pesante/alta concentrazione (creatività, studio, sport intenso).
- priority: 1 bassa, 2 normale, 3 alta (l'utente dice "assolutamente", "devo", scadenze).

Regole
- Non inventare attività, appuntamenti o disponibilità. Se manca un'informazione essenziale (es. l'orario di un appuntamento), fai una domanda breve e NON chiamare lo strumento per quell'elemento.
- Distingui ciò che l'utente ha detto da ciò che stai stimando ("ho stimato 60 min per il portfolio").
- Non dire che una giornata è fattibile se il tempo non basta: preferisci un piano realistico e proponi cosa rimandare.
- Per modifiche importanti (spostare o cancellare impegni fissi, cancellare attività, svuotare la serata) imposta requires_confirmation=true: l'utente vedrà le modifiche e deciderà se applicarle.
- Domande come "cosa riesco a fare oggi?" o "cosa posso rimandare?": rispondi leggendo il piano nello stato, senza modificare nulla (o proponendo modifiche con requires_confirmation=true).
- Le date sono nel formato YYYY-MM-DD, gli orari HH:MM (24h).
- Non elencare di nuovo tutta la timeline: l'utente la vede già. Cita solo ciò che conta.`;

const N = (t) => ({ type: [t, 'null'] });
const OP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['add', 'update', 'move', 'start', 'complete', 'reopen', 'delete', 'progress', 'skip', 'remember', 'forget', 'set_pref', 'add_recurring', 'remove_recurring', 'set_goal', 'remove_goal', 'plan_goal', 'add_project', 'set_availability', 'add_habit', 'remove_habit'] },
    id: { ...N('string'), description: 'id dell\'elemento esistente (per update/move/start/complete/reopen/delete/forget/remove_recurring)' },
    title: N('string'),
    kind: { type: ['string', 'null'], enum: ['task', 'event', null] },
    date: { ...N('string'), description: 'YYYY-MM-DD' },
    start_time: { ...N('string'), description: 'HH:MM' },
    end_time: { ...N('string'), description: 'HH:MM' },
    duration_min: N('integer'),
    duration_is_estimate: N('boolean'),
    priority: { ...N('integer'), description: '1 bassa, 2 normale, 3 alta' },
    deadline: { ...N('string'), description: 'YYYY-MM-DD' },
    earliest_date: { ...N('string'), description: 'non prima di questa data, YYYY-MM-DD' },
    window: { type: ['string', 'null'], enum: ['mattina', 'pomeriggio', 'sera', null] },
    energy: { ...N('integer'), description: '1 leggera, 2 media, 3 pesante' },
    depends_on: { type: ['array', 'null'], items: { type: 'string' }, description: 'id o titoli delle attività da completare prima' },
    actual_min: N('integer'),
    note: { ...N('string'), description: 'per remember: la nota; per add/update: una nota sull\'attività' },
    project: { ...N('string'), description: 'nome del progetto a cui appartiene l\'attività o l\'obiettivo' },
    category: { type: ['string', 'null'], enum: ['vincolo', 'preferenza', 'obiettivo', 'nota', null], description: 'per remember' },
    sessions: {
      type: ['array', 'null'], description: 'per plan_goal: le sessioni concrete dell\'obiettivo (massimo 30)',
      items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, title: { type: 'string' }, duration_min: { type: 'integer' }, energy: { type: 'integer' }, after: { type: 'array', items: { type: 'string' } } }, required: ['key', 'title', 'duration_min', 'energy', 'after'] },
    },
    pref_key: { type: ['string', 'null'], enum: ['day_start', 'day_end', 'buffer_min', 'slack_percent', 'focus_window', 'max_block_min', 'decompress_min', 'off_days', 'free_days', null] },
    pref_value: N('string'),
    weekdays: { type: ['array', 'null'], items: { type: 'integer' } },
    unpin: { ...N('boolean'), description: 'true per togliere l\'orario fisso a un task' },
  },
  required: ['action', 'id', 'title', 'kind', 'date', 'start_time', 'end_time', 'duration_min', 'duration_is_estimate', 'priority', 'deadline', 'earliest_date', 'window', 'energy', 'depends_on', 'actual_min', 'note', 'project', 'category', 'sessions', 'pref_key', 'pref_value', 'weekdays', 'unpin'],
};

const TOOL = {
  name: 'update_plan',
  description: 'Crea, modifica, completa, sposta o elimina attività e impegni; gestisce obiettivi, progetti, disponibilità, preferenze e memoria. Il motore ricalcola poi la pianificazione e restituisce il risultato.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ops: { type: 'array', items: OP_SCHEMA },
      summary: { type: 'string', description: 'Riassunto di una riga delle modifiche, per l\'utente' },
      requires_confirmation: { type: 'boolean', description: 'true se le modifiche sono importanti e l\'utente deve confermarle' },
    },
    required: ['ops', 'summary', 'requires_confirmation'],
  },
};

const WD = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

/** Rappresentazione compatta dello stato da passare al modello. */
export function stateForModel(state, plan, now) {
  const d = new Date(now);
  const today = dateKey(d);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const recentDone = (x) => x.status !== 'done' || (x.doneAt && now - x.doneAt < 2 * 864e5);
  const items = state.items.filter(recentDone).map((x) => ({
    id: x.id, title: x.title, kind: x.kind, status: x.status,
    date: x.date, start: x.start != null ? fmtMin(x.start) : null, duration_min: x.duration,
    estimate: x.durationEstimated || undefined, priority: x.priority, energy: x.energy,
    deadline: x.deadline || undefined, window: x.window || undefined,
    depends_on: x.dependsOn?.length ? x.dependsOn : undefined,
    actual_min: x.actual || undefined, notes: x.notes || undefined,
    project: x.project ? state.projects?.find((p) => p.id === x.project)?.name : undefined,
    gia_fatti_min: x.spent || undefined,
  }));
  const dayPlan = (day) => {
    const p = plan[day];
    if (!p) return null;
    return {
      blocks: p.blocks.map((b) => `${fmtMin(b.start)}-${fmtMin(b.end)} ${b.item.title} [${b.type}${b.item.priority === 3 ? ',alta' : ''}${b.id && !String(b.id).startsWith('rec:') ? ',id=' + b.id : ''}]`),
      non_entra: p.unscheduled.map((u) => `${u.item.title} (${u.reason})`),
      slitta_al_giorno_dopo: (p.deferred || []).map((t) => t.title),
      conflitti: p.conflicts.map(([a, b]) => `${a} / ${b}`),
      da_confermare: (p.missed || []).map((m) => `${m.item.title} (id=${m.item.id}, previsto ${fmtMin(m.start)}-${fmtMin(m.end)})`),
      tempo_libero_min: p.free,
    };
  };
  const ratios = state.items.filter((x) => x.status === 'done' && x.actual && x.duration).slice(-15)
    .map((x) => `${x.title}: stimati ${x.duration}, reali ${x.actual}`);
  return {
    adesso: `${WD[d.getDay()]} ${today} ore ${fmtMin(nowMin)}`,
    oggi: today, domani: addDays(today, 1),
    preferenze: {
      inizio_giornata: fmtMin(state.prefs.dayStart), fine_giornata: fmtMin(state.prefs.dayEnd),
      pausa_tra_attivita_min: state.prefs.buffer, margine_imprevisti_percento: Math.round(state.prefs.slack * 100),
      fascia_concentrazione: state.prefs.focusWindow,
    },
    impegni_ricorrenti: state.recurring.map((r) => `${r.id}: ${r.title} ${fmtMin(r.start)}-${fmtMin(r.end)} giorni ${r.weekdays.join(',')}`),
    memoria: state.memory.map((m) => `${m.id}: ${m.category ? '[' + m.category + '] ' : ''}${m.text}`),
    ...companionContext(state, plan, now),
    durate_reali_passate: ratios,
    elementi: items,
    piano_oggi: dayPlan(today),
    piano_domani: dayPlan(addDays(today, 1)),
  };
}

function historyMessages(chat) {
  const msgs = [];
  for (const m of chat.slice(-14)) {
    if (m.pending || m.error || !m.text) continue;
    let text = m.text;
    if (m.role === 'assistant' && m.changes?.length) text += `\n[modifiche ${m.applied === false ? 'proposte e non applicate' : 'applicate'}: ${m.changes.join('; ')}]`;
    const role = m.role === 'user' ? 'user' : 'assistant';
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + text;
    else msgs.push({ role, content: text });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

/**
 * Esegue un turno di conversazione.
 * hooks.apply(ops) → applica le operazioni a una bozza e restituisce un testo con l'esito per il modello.
 */
export async function runTurn({ state, plan, now, userText, hooks, signal, chat = state.chat }) {
  const Anthropic = await loadSdk();
  const client = new Anthropic({ apiKey: state.settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const model = state.settings.model || 'claude-opus-5-5';
  const isHaiku = model.startsWith('claude-haiku');

  const messages = historyMessages(chat);
  const ctx = JSON.stringify(stateForModel(state, plan, now));
  const userContent = `<stato>\n${ctx}\n</stato>\n\n${userText}`;
  if (messages.length && messages[messages.length - 1].role === 'user') messages[messages.length - 1].content += '\n\n' + userContent;
  else messages.push({ role: 'user', content: userContent });

  const base = {
    model,
    max_tokens: 8000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [TOOL],
  };
  if (!isHaiku) {
    base.output_config = { effort: 'low' };
    base.betas = ['server-side-fallback-2026-07-01'];
    base.fallbacks = 'default';
  }

  let finalText = '';
  for (let i = 0; i < 4; i++) {
    const res = isHaiku
      ? await client.messages.create({ ...base, messages }, { signal })
      : await client.beta.messages.create({ ...base, messages }, { signal });
    if (res.stop_reason === 'refusal') {
      return { text: 'Non posso aiutarti con questa richiesta.' };
    }
    const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (text) finalText = text;
    const uses = res.content.filter((c) => c.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) break;
    messages.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const u of uses) {
      let out;
      try {
        out = u.name === 'update_plan' && u.input && Array.isArray(u.input.ops)
          ? hooks.apply({ ...u.input, ops: sanitizeOps(u.input.ops).ops })
          : { text: 'Strumento sconosciuto o input non valido', error: true };
      } catch (e) {
        out = { text: 'Errore: ' + e.message, error: true };
      }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out.text, is_error: !!out.error });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: finalText || 'Fatto.' };
}

// ------------------------------------------------------------------
// Da obiettivo a piano con l'AI (la risposta viene validata da templates.validatePlan)
// ------------------------------------------------------------------
export function goalPlanPrompt(state, goal, now) {
  const pr = (state.projects || []).find((p) => p.id === goal.projectId);
  const today = dateKey(new Date(now));
  return `Trasforma questo obiettivo in sessioni di lavoro concrete. Rispondi SOLO con un oggetto JSON, senza altro testo:
{"sessions":[{"key":"s1","title":"Beat 01","duration_min":120,"energy":3,"after":[]},{"key":"s2","title":"Arrangiamento 01","duration_min":90,"energy":3,"after":["s1"]}]}

Regole:
- Al massimo 30 sessioni, ognuna tra 20 e ${state.prefs.maxBlock || 120} minuti.
- Titoli brevi e concreti, come azioni («Registrazione voce 02», «Caso studio 1»), mai vaghi («Lavora all'obiettivo»).
- energy: 1 leggera (amministrativa), 2 media, 3 concentrazione o lavoro creativo.
- after: le chiavi delle sessioni che devono essere finite prima.
- Metti le fasi nell'ordine reale del lavoro; ciò che va fatto con anticipo (per esempio il caricamento su un distributore) va prima della scadenza.

Oggi è ${today}.
Obiettivo: ${goal.title}${goal.note && goal.note !== goal.title ? ` (detto così: «${goal.note}»)` : ''}
Scadenza: ${goal.due || 'nessuna'}
Progetto: ${pr?.name || 'nessuno'}
Cosa so dell'utente: ${(state.memory || []).map((m) => m.text).join('; ') || 'niente'}`;
}

/** Piano dell'obiettivo con Claude: restituisce l'oggetto JSON grezzo. */
export async function claudeGoalPlan(state, goal, now, signal) {
  const Anthropic = await loadSdk();
  const client = new Anthropic({ apiKey: state.settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const res = await client.messages.create({
    model: state.settings.model || 'claude-opus-5-5', max_tokens: 4000,
    messages: [{ role: 'user', content: goalPlanPrompt(state, goal, now) }],
  }, { signal });
  const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  return JSON.parse(text.slice(a, b + 1));
}

/** Il contesto per le domande del riepilogo: punti chiave già calcolati + lo stato compatto. */
export function askSystem(state, plan, now, sum) {
  return `Sei Tempo, il companion che organizza le giornate dell'utente. Qui l'utente ti chiede come sta andando, cosa lo aspetta, come procedono obiettivi e progetti.
Rispondi in italiano, in seconda persona, breve e concreta: al massimo 5 punti chiave, ognuno su una riga che inizia con «• », oppure 1–3 frasi se basta. Niente titoli, niente markdown, niente punti esclamativi.
Usa solo i dati qui sotto: non inventare attività, numeri o date. Da qui non puoi modificare il piano: se l'utente chiede un cambiamento, digli di scriverlo nella barra del giorno.

Oggi: ${dateKey(new Date(now))}
Punti chiave calcolati:
${sum.points.map((p) => '- ' + p).join('\n')}
Prossimi 7 giorni:
${sum.list.rows.map((r) => `- ${r.title} (${r.sub})${r.done ? ' fatta' : ''}`).join('\n') || '- niente'}
Progetti:
${sum.projects.map((p) => `- ${p.name}: ${p.text} ${p.footer}`).join('\n') || '- nessuno'}
Stato dettagliato:
${JSON.stringify(stateForModel(state, plan, now))}`;
}

/** Domanda al riepilogo con Claude: risposta a parole. */
export async function claudeAsk(state, system, history, signal) {
  const Anthropic = await loadSdk();
  const client = new Anthropic({ apiKey: state.settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const res = await client.messages.create({ model: state.settings.model || 'claude-opus-5-5', max_tokens: 1200, system, messages: history }, { signal });
  return res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
}

/** Una promessa con un tempo massimo: oltre, viene annullata e rifiutata con code 'timeout'. */
export function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  let timer;
  return Promise.race([
    fn(ctrl.signal),
    new Promise((_, reject) => { timer = setTimeout(() => { ctrl.abort(); reject(Object.assign(new Error('timeout'), { code: 'timeout' })); }, ms); }),
  ]).finally(() => clearTimeout(timer));
}

// ------------------------------------------------------------------
// Modalità base senza AI: vive in parse.js
// ------------------------------------------------------------------
export { localParse, parseDuration } from './parse.js';
