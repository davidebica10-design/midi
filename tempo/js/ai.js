// Interpretazione del linguaggio naturale.
// L'AI trasforma ciò che dice l'utente in operazioni strutturate; il motore di
// pianificazione (scheduler.js) e la validazione (store.js) decidono il resto.
import { fmtMin, dateKey, addDays, dayLabel } from './scheduler.js';
import { COMPANION_RULES, companionContext } from './companion.js';

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
    action: { type: 'string', enum: ['add', 'update', 'move', 'start', 'complete', 'reopen', 'delete', 'progress', 'skip', 'remember', 'forget', 'set_pref', 'add_recurring', 'remove_recurring', 'set_goal', 'remove_goal', 'add_project', 'set_availability'] },
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
    pref_key: { type: ['string', 'null'], enum: ['day_start', 'day_end', 'buffer_min', 'slack_percent', 'focus_window', 'max_block_min', 'decompress_min', 'off_days', null] },
    pref_value: N('string'),
    weekdays: { type: ['array', 'null'], items: { type: 'integer' } },
    unpin: { ...N('boolean'), description: 'true per togliere l\'orario fisso a un task' },
  },
  required: ['action', 'id', 'title', 'kind', 'date', 'start_time', 'end_time', 'duration_min', 'duration_is_estimate', 'priority', 'deadline', 'earliest_date', 'window', 'energy', 'depends_on', 'actual_min', 'note', 'project', 'category', 'pref_key', 'pref_value', 'weekdays', 'unpin'],
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
          ? hooks.apply(u.input)
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
// Modalità base senza AI: riconosce le frasi più semplici.
// ------------------------------------------------------------------
const NUM = { un: 1, una: 1, uno: 1, mezza: 0.5, mezz: 0.5, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, dieci: 10, venti: 20, trenta: 30, quaranta: 40, quindici: 15 };
const num = (s) => (s == null ? null : isNaN(+s.replace(',', '.')) ? NUM[s] ?? null : +s.replace(',', '.'));

function parseDuration(t) {
  let m = t.match(/(\d+(?:[.,]\d+)?|un'?|una|mezz'?|due|tre|quattro|cinque|sei)\s*(?:ora|ore|h)\b(?:\s*e\s*(mezza|\d+))?/i);
  if (m) {
    let h = num(m[1].replace("'", '')) || 1;
    if (m[2]) h += m[2] === 'mezza' ? 0.5 : +m[2] / 60;
    return Math.round(h * 60);
  }
  m = t.match(/(\d+|dieci|quindici|venti|trenta|quaranta)\s*(?:min|minuti|m)\b/i);
  if (m) return num(m[1]);
  if (/mezz'?\s*ora/i.test(t)) return 30;
  return null;
}

export function localParse(text, state, now) {
  const today = dateKey(new Date(now));
  const t = text.trim();
  const low = t.toLowerCase();
  const date = /dopodomani/.test(low) ? addDays(today, 2) : /domani/.test(low) ? addDays(today, 1) : null;
  const find = (frag) => {
    const f = frag.toLowerCase().replace(/^(il|la|lo|l'|i|gli|le)\s*/, '').trim();
    return state.items.find((x) => x.status !== 'done' && x.title.toLowerCase().includes(f)) ||
      state.items.find((x) => x.status !== 'done' && f.includes(x.title.toLowerCase()));
  };
  const base = { id: null, title: null, kind: null, date: null, start_time: null, end_time: null, duration_min: null, duration_is_estimate: null, priority: null, deadline: null, earliest_date: null, window: null, energy: null, depends_on: null, actual_min: null, note: null, pref_key: null, pref_value: null, weekdays: null, unpin: null };

  let m;
  if ((m = low.match(/^ho fatto\s+(.+?)\s+(?:di|del|della|dello|sul|sulla|al|alla)\s+(.+)/)) && parseDuration(m[1])) {
    const it = find(m[2]);
    return it ? { ops: [{ ...base, action: 'progress', id: it.id, actual_min: parseDuration(m[1]) }], reply: `Segnati ${parseDuration(m[1])} minuti su «${it.title}». Il resto lo rimetto in programma.` } : { reply: 'Non trovo quell\'attività.' };
  }
  if (/(?:tra|fra|entro)\s+\S+\s+(?:giorni|settiman|mes)/.test(low) && /^(voglio|vorrei|devo|obiettivo)/.test(low)) {
    const pr = (state.projects || []).find((p) => low.includes(p.name.toLowerCase()));
    return { ops: [{ ...base, action: 'set_goal', title: t.replace(/^(voglio|vorrei|devo|obiettivo:?)\s+/i, '').replace(/\s*(tra|fra|entro)\s+\S+\s+\S+\s*\.?$/i, ''), note: t, project: pr?.name || null }], reply: 'Segnato come obiettivo. Ora dimmi il primo passo concreto e lo metto al posto giusto.' };
  }
  if ((m = low.match(/^(?:ho finito|fatto|finito|completat[oa])\s+(.+)/))) {
    const it = find(m[1]);
    return it ? { ops: [{ ...base, action: 'complete', id: it.id }], reply: `Segnato «${it.title}» come fatto.` } : { reply: 'Non trovo quell\'attività.' };
  }
  if ((m = low.match(/^(?:inizio|sto iniziando|comincio)\s+(.+)/))) {
    const it = find(m[1]);
    return it ? { ops: [{ ...base, action: 'start', id: it.id }], reply: `Via con «${it.title}».` } : { reply: 'Non trovo quell\'attività.' };
  }
  if ((m = low.match(/^(?:togli|elimina|cancella|rimuovi)\s+(.+)/))) {
    const it = find(m[1]);
    return it ? { ops: [{ ...base, action: 'delete', id: it.id }], reply: `Tolta «${it.title}».`, confirm: it.kind === 'event' } : { reply: 'Non trovo quell\'attività.' };
  }
  if ((m = low.match(/^sposta\s+(.+?)\s+(?:a|ad|per)\s+(domani|dopodomani|oggi)/))) {
    const it = find(m[1]);
    const d = m[2] === 'oggi' ? today : m[2] === 'domani' ? addDays(today, 1) : addDays(today, 2);
    return it ? { ops: [{ ...base, action: 'move', id: it.id, date: d }], reply: `Spostata «${it.title}» a ${dayLabel(d, today)}.` } : { reply: 'Non trovo quell\'attività.' };
  }
  if ((m = low.match(/(?:sono\s+)?in ritardo di\s+(.+)/))) {
    const dur = parseDuration(m[1]) || 30;
    const d = new Date(now);
    return { ops: [{ ...base, action: 'add', kind: 'event', title: 'Ritardo', date: today, start_time: fmtMin(d.getHours() * 60 + d.getMinutes()), duration_min: dur }], reply: `Ok, ho spostato in avanti di ${dur} minuti quello che restava.` };
  }

  // Nuove attività: una per frase/virgola
  const parts = t.split(/[.;\n]|,\s*|\s+e poi\s+|\s+poi\s+/i).map((s) => s.trim()).filter(Boolean);
  const ops = [];
  for (const p of parts) {
    const pl = p.toLowerCase();
    const tm = pl.match(/\b(?:alle|ore|dalle)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:alle|-|fino alle)\s*(\d{1,2})(?:[:.](\d{2}))?)?/);
    const until = pl.match(/fino alle\s+(\d{1,2})(?:[:.](\d{2}))?/);
    const dur = parseDuration(pl);
    const title = p
      .replace(/\b(oggi|domani|dopodomani|stasera|stamattina|questa sera|questo pomeriggio)\b/gi, '')
      .replace(/\b(devo|voglio|vorrei|ho|c'è|c'e|assolutamente|almeno|per|anche|poi)\b/gi, '')
      .replace(/\b(?:alle|ore|dalle|fino alle)\s+\d{1,2}(?:[:.]\d{2})?/gi, '')
      .replace(/\b(\d+(?:[.,]\d+)?|un'?|una|mezz'?|due|tre|quattro)\s*(ora|ore|h|min|minuti)\b(\s*e\s*mezza)?/gi, '')
      .replace(/\s+/g, ' ').replace(/^[\s,e]+|[\s,]+$/g, '').trim();
    if (!title || title.length < 2) continue;
    const cap = title[0].toUpperCase() + title.slice(1);
    const prio = /assolutamente|important|urgente|devo/.test(pl) ? 3 : 2;
    if (until && !tm?.[3]) {
      const d = new Date(now);
      const s = date ? state.prefs.dayStart : Math.max(state.prefs.dayStart, d.getHours() * 60 + d.getMinutes());
      ops.push({ ...base, action: 'add', kind: 'event', title: cap, date: date || today, start_time: fmtMin(s), end_time: `${until[1]}:${until[2] || '00'}` });
    } else if (tm) {
      const st = `${tm[1]}:${tm[2] || '00'}`;
      const en = tm[3] ? `${tm[3]}:${tm[4] || '00'}` : null;
      ops.push({ ...base, action: 'add', kind: 'event', title: cap, date: date || today, start_time: st, end_time: en, duration_min: en ? null : dur || 60 });
    } else {
      ops.push({ ...base, action: 'add', kind: 'task', title: cap, date: date, duration_min: dur || 45, duration_is_estimate: !dur, priority: prio, window: /stasera|sera/.test(pl) ? 'sera' : /mattina/.test(pl) ? 'mattina' : null });
    }
  }
  // le attività che nominano un progetto ci finiscono dentro
  for (const o of ops) {
    const pr = (state.projects || []).find((p) => o.title.toLowerCase().includes(p.name.toLowerCase()));
    if (pr) { o.project = pr.name; if (o.kind === 'task') o.energy = 3; }
  }
  if (!ops.length) return { reply: 'In modalità base capisco frasi semplici come «Domani alle 16 call», «Beat 90 min», «Ho finito spesa», «Sposta portfolio a domani». Aggiungi una chiave API nelle impostazioni per la conversazione completa.' };
  return { ops, reply: `Aggiunto: ${ops.map((o) => o.title).join(', ')}.` };
}
