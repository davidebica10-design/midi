// Il companion: guarda il piano, il contesto e la storia e dice cosa fare adesso.
// È deterministico (funziona anche senza AI); l'AI aggiunge solo il linguaggio naturale.
import { fmtMin, dateKey, addDays, daysBetween, weekday, dayLabel } from './scheduler.js';
import { projectOf } from './store.js';

const nowMinOf = (now) => { const d = new Date(now); return d.getHours() * 60 + d.getMinutes(); };
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + "'" : ''}` : `${m} minuti`);
const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const isTask = (b) => b.item.kind === 'task' && !/^(rec|rest):/.test(String(b.id));
const remainingOf = (it) => Math.max(5, (it.duration || 30) - (it.spent || 0));

/**
 * Cosa fare adesso: una frase decisa, il perché e cosa NON fare.
 * Restituisce { title, why, avoid, action: { type, id } | null, mood }.
 */
export function nowAdvice(state, plan, now) {
  const t = dateKey(new Date(now));
  const p = plan[t];
  if (!p) return null;
  const n = nowMinOf(now);
  const blocks = p.blocks.filter((b) => b.type !== 'done');
  const cur = blocks.find((b) => b.start <= n && n < b.end);
  const later = blocks.filter((b) => b.start > n);
  const nextFixed = later.find((b) => !isTask(b));
  const pendingTasks = later.filter(isTask);
  const doneToday = p.blocks.filter((b) => b.type === 'done' && b.item.kind === 'task').length;

  if (cur && isTask(cur)) {
    const after = later[0];
    return {
      title: `Resta su ${low(cur.item.title)}.`,
      why: `Hai ancora ${dur(cur.end - n)}.${after ? ` Poi ${after.item.kind === 'rest' ? 'stacca per cena' : `pausa e ${low(after.item.title)}`}.` : ' Poi hai finito.'}`,
      action: cur.item.status === 'doing' ? { type: 'complete', id: cur.item.id, label: 'Fatto' } : { type: 'start', id: cur.item.id, label: 'Inizia' },
      mood: 'focus',
    };
  }
  if (cur && cur.item.kind === 'rest') {
    const nx = pendingTasks[0];
    return {
      title: 'Stacca. Mangia con calma.',
      why: nx ? `Alle ${fmtMin(nx.start)} riparti con ${low(nx.item.title)}: arrivaci riposato.` : 'Per stasera non c\'è altro.',
      action: null, mood: 'rest',
    };
  }
  if (cur) {
    const nx = pendingTasks[0];
    return {
      title: `${cur.item.title} fino alle ${fmtMin(cur.end)}.`,
      why: nx ? `Dopo: ${low(nx.item.title)} alle ${fmtMin(nx.start)}. Non ci pensare adesso.` : 'Dopo sei libero.',
      action: null, mood: 'busy',
    };
  }

  // finestra libera fino al prossimo impegno
  const until = nextFixed ? nextFixed.start : (state.prefs.availability?.[t]?.end ?? state.prefs.dayEnd);
  const free = Math.max(0, until - n);
  const untilName = nextFixed ? (nextFixed.item.kind === 'rest' ? 'cena' : low(nextFixed.item.title)) : null;
  const next = pendingTasks[0];

  if (!pendingTasks.length && !p.unscheduled.length) {
    if (doneToday) return { title: 'Per oggi hai fatto abbastanza.', why: 'Stacca davvero: domani riparti meglio.', action: null, mood: 'stop' };
    return { title: 'Oggi è libero.', why: 'Dimmi cosa vuoi ottenere e ti costruisco la giornata.', action: null, mood: 'empty' };
  }
  if (next && next.start - n <= 10) {
    return { title: `Tra poco: ${low(next.item.title)}.`, why: `Alle ${fmtMin(next.start)}, ${dur(next.end - next.start)}. Preparati.`, action: { type: 'start', id: next.item.id, label: 'Inizia ora' }, mood: 'focus' };
  }
  // c'è un buco prima della prossima cosa pianificata: usalo bene, senza aprire roba lunga
  const gap = next ? Math.min(free, next.start - n) : free;
  const fits = [...pendingTasks.map((b) => b.item), ...p.unscheduled.map((u) => u.item)]
    .filter((it, i, arr) => arr.findIndex((x) => x.id === it.id) === i)
    .filter((it) => remainingOf(it) <= gap - 5)
    .sort((a, b) => (b.spent > 0) - (a.spent > 0) || (b.priority || 2) - (a.priority || 2) || remainingOf(a) - remainingOf(b));
  const pick = fits[0];
  const longOne = pendingTasks.map((b) => b.item).find((it) => remainingOf(it) > gap && (it.energy || 2) >= 3 && it !== next?.item);
  const avoid = longOne && longOne !== pick ? `Non iniziare ${low(longOne.title)}: richiede più tempo.` : '';
  const head = untilName ? `Hai ${dur(gap)} prima di ${untilName}.` : `Hai ${dur(gap)} liberi.`;
  if (pick && gap >= 15) {
    return {
      title: `${head} ${pick.spent > 0 ? 'Finisci' : 'Fai'} ${low(pick.title)}.`,
      why: [pick.spent > 0 ? `Ne mancano ${dur(remainingOf(pick))}: chiudi quello che hai aperto.` : `Ti servono circa ${dur(remainingOf(pick))}.`, avoid].filter(Boolean).join(' '),
      action: { type: 'start', id: pick.id, label: 'Inizia' }, mood: 'focus',
    };
  }
  if (next) {
    return { title: `${head} Riposati.`, why: `Alle ${fmtMin(next.start)}: ${low(next.item.title)}.${avoid ? ' ' + avoid : ''}`, action: null, mood: 'rest' };
  }
  return { title: `${head}`, why: 'Niente di urgente: goditeli.', action: null, mood: 'rest' };
}

/** Quante sessioni di un progetto sono state saltate negli ultimi 7 giorni. */
export function skippedThisWeek(state, now) {
  const since = now - 7 * 864e5;
  const out = {};
  for (const e of state.log || []) if (e.type === 'skip' && e.at >= since && e.project) out[e.project] = (out[e.project] || 0) + 1;
  return out;
}

/**
 * Il briefing: memoria di ieri, obiettivi, osservazioni.
 * Ogni voce: { id, text, actions?: [{ label, act, arg }] }
 */
export function briefing(state, plan, now) {
  const t = dateKey(new Date(now));
  const p = plan[t];
  if (!p) return [];
  const out = [];
  const n = nowMinOf(now);
  const where = (id) => {
    for (const [d, x] of Object.entries(plan)) { const b = x.blocks.find((bb) => bb.id === id && bb.type !== 'done' && !(d === t && bb.end <= n)); if (b) return { d, b }; }
    return null;
  };
  // 1. continuità: ciò che era iniziato o è rimasto indietro
  for (const it of state.items) {
    if (it.kind !== 'task' || it.status === 'done') continue;
    const behind = it.date && it.date < t;
    if (!(it.spent > 0) && !behind) continue;
    const w = where(it.id);
    const at = w ? `${w.d === t ? 'oggi' : dayLabel(w.d, t).toLowerCase()} alle ${fmtMin(w.b.start)}` : null;
    if (it.spent > 0) out.push({ id: 'carry-' + it.id, text: `«${it.title}»: hai già fatto ${dur(it.spent)}, non riparti da zero. ${at ? `Gli altri ${dur(remainingOf(it))} li ho messi ${at}.` : (p.missed || []).some((m) => m.item.id === it.id) ? 'Com\'è andata la sessione di prima?' : `Mancano ${dur(remainingOf(it))}, ma per ora non entrano.`}` });
    else out.push({ id: 'behind-' + it.id, text: `${it.title} è rimasta indietro. ${at ? 'L\'ho rimessa ' + at + '.' : 'Oggi non entra: dimmi se la sposto o la togliamo.'}` });
    if (out.length >= 2) break;
  }
  // 2. obiettivi con scadenza
  for (const g of state.goals || []) {
    if (!g.due) continue;
    const days = daysBetween(t, g.due);
    if (days < 0) continue;
    const pr = g.projectId ? projectOf(state, g.projectId) : null;
    const planned = pr ? Object.values(plan).reduce((s, x) => s + x.blocks.filter((b) => b.item.project === pr.id && b.type !== 'done').length, 0) : 0;
    const when = days === 0 ? 'oggi' : days < 14 ? `tra ${days} giorni` : `tra ${Math.round(days / 7)} settimane`;
    out.push({ id: 'goal-' + g.id, text: `${g.title}: ${when}.${pr ? planned ? ` Hai ${planned} sessioni di ${pr.name} in programma nelle prossime due settimane.` : ` Non c'è niente di ${pr.name} in programma: dimmi il prossimo passo.` : ''}` });
    if (out.length >= 3) break;
  }
  // 3. osservazioni: sessioni saltate
  const skips = skippedThisWeek(state, now);
  for (const [pid, n] of Object.entries(skips)) {
    if (n < 3) continue;
    const pr = projectOf(state, pid);
    if (!pr) continue;
    const goal = (state.goals || []).find((g) => g.projectId === pid);
    out.unshift({
      id: 'skip-' + pid,
      text: `Questa settimana hai saltato ${n} sessioni di ${pr.name}.${goal ? ' Vuoi che riduca l\'obiettivo o preferisci recuperare sabato?' : ' Vuoi recuperare sabato?'}`,
      actions: [
        { label: 'Recupera sabato', act: 'recover', arg: pid },
        ...(goal ? [{ label: 'Riduci l\'obiettivo', act: 'reduce', arg: goal.id }] : []),
      ],
    });
  }
  return out.slice(0, 2);
}

/** Prossimo sabato (o oggi se è sabato) */
export function nextSaturday(today) {
  const w = weekday(today);
  return addDays(today, (6 - w + 7) % 7 || 0);
}

// Presentazione iniziale: dal testo libero al contesto (senza AI) → parse.js
export { contextOps } from './parse.js';

// ------------------------------------------------------------------
// Per l'AI: chi è l'utente e come deve parlare il companion
// ------------------------------------------------------------------
export const COMPANION_RULES = `Chi sei
- Non sei un'agenda: sei il companion personale dell'utente. Costruisci le giornate in base a ciò che sta davvero cercando di ottenere (obiettivi), a ciò che non si sposta (vincoli), ai progetti e a come lavora meglio (preferenze). Il valore che dai: niente più fatica di decidere.
- Voce: breve, decisa, calda, in seconda persona. Una cosa alla volta. Esempi: «Hai 47 minuti prima di cena. Finisci il ritornello del beat 03. Non iniziare la copertina: richiede più tempo.» — «Stop. Hai fatto abbastanza.»
- Ricorda il contesto: se una sessione è rimasta a metà (spent > 0) riparti da lì e dillo («ieri non hai finito il beat, i 40 minuti che mancano li ho messi stasera»).
- Osserva e chiedi, non imporre: se lo stato mostra sessioni saltate su un progetto, fai notare il fatto e proponi due strade (recuperare sabato o alleggerire l'obiettivo). Non fare la predica.

Obiettivi e progetti
- "Voglio far uscire il mio EP tra 6 settimane" → set_goal (title, deadline YYYY-MM-DD calcolata da oggi, project "EP"). Poi spezzalo in sessioni concrete (add, kind task, project, energy, duration_min ≤ sessione massima, depends_on quando c'è un ordine: prima il beat, poi l'arrangiamento, poi l'export). Nomina le sessioni come azioni concrete («Finisci il beat 02», «Arrangiamento», «Esporta e manda al rapper»), mai vaghe («Lavora all'EP»).
- Ogni attività che appartiene a un progetto ha il campo project (nome del progetto). Nuovo progetto → add_project.
- Lavoro creativo = energy 3: il motore lo mette nella fascia in cui l'utente rende meglio.
- Rispetta la sessione massima (max_block_min): sessioni più lunghe vengono spezzate dal motore con pause. Non riempire ogni sera con lo stesso progetto se l'utente non vuole.

Vincoli e preferenze
- "Lavoro 9–18:30" → add_recurring lun–ven. "Sabato sono libero" → remember (category vincolo). "La domenica voglio staccare" → set_pref off_days "0" + remember. "Non voglio più di 2h consecutive" → set_pref max_block_min 120. "La sera produco meglio" → set_pref focus_window sera. Ogni preferenza stabile va anche in remember con la category giusta.
- "Stasera ho solo 2 ore" / "domani sono libero dalle 15" → set_availability (date, start_time, end_time).
- Lavoro fatto a metà ("ho fatto 30 minuti del beat") → progress con actual_min: il resto viene ripianificato senza ripartire da zero. Sessione saltata → skip.
- "Che faccio?" → una sola azione concreta adatta al tempo libero che resta prima del prossimo impegno, e cosa NON iniziare. Niente elenchi.
- Dopo una giornata di lavoro il motore lascia da solo una pausa "Cena / decompressione": non crearla tu.`;

/** Il contesto del companion in forma compatta, per l'AI. */
export function companionContext(state, plan, now) {
  const t = dateKey(new Date(now));
  const P = state.prefs;
  const skips = skippedThisWeek(state, now);
  const adv = nowAdvice(state, plan, now);
  return {
    obiettivi: (state.goals || []).map((g) => `${g.id}: ${g.title}${g.due ? ` (entro ${g.due}, tra ${daysBetween(t, g.due)} giorni)` : ''}${g.projectId ? ' · progetto ' + (projectOf(state, g.projectId)?.name || '') : ''}`),
    progetti: (state.projects || []).map((p) => p.name),
    sessione_massima_min: P.maxBlock,
    decompressione_min: P.decompress,
    giorni_di_riposo: (P.offDays || []).map((d) => ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'][d]),
    disponibilita_speciali: Object.entries(P.availability || {}).filter(([d]) => d >= t).map(([d, w]) => `${d}: ${w.start != null ? fmtMin(w.start) : 'inizio'}–${w.end != null ? fmtMin(w.end) : 'fine'}`),
    sessioni_saltate_questa_settimana: Object.entries(skips).map(([pid, n]) => `${projectOf(state, pid)?.name || pid}: ${n}`),
    consiglio_adesso: adv ? `${adv.title} ${adv.why || ''}`.trim() : null,
  };
}
