// Il companion: guarda il piano, il contesto e la storia e dice cosa fare adesso.
// È deterministico (funziona anche senza AI); l'AI aggiunge solo il linguaggio naturale.
import { fmtMin, dateKey, addDays, daysBetween, weekday, dayLabel, planDays } from './scheduler.js';
import { contextParts, understoodOf } from './parse.js';
import { dateLong } from './format.js';
import { projectOf, applyOps } from './store.js';
import { updateDurations } from './learn.js';
import { goalInProgress } from './goals.js';

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
 * Le osservazioni possibili oggi, dalla più importante: { id, text, actions? }.
 * extra.fits: goalId → goalFit(...) (calcolato dall'app su un orizzonte lungo)
 * extra.learned: osservazioni da learn.js
 * Quali mostrare lo decide pickObservations (massimo 2 al giorno).
 */
export function briefing(state, plan, now, extra = {}) {
  const t = dateKey(new Date(now));
  const p = plan[t];
  if (!p) return [];
  const out = [];
  const n = nowMinOf(now);
  const nice = (d) => dateLong(d, t); // con l'anno quando non è quello in corso
  const where = (id) => {
    for (const [d, x] of Object.entries(plan)) { const b = x.blocks.find((bb) => bb.id === id && bb.type !== 'done' && !(d === t && bb.end <= n)); if (b) return { d, b }; }
    return null;
  };
  const nameOf = (g) => goalName(state, g);
  // bentornato: finché non rispondi, niente allarmi
  if (state.welcome) return [];

  // 1. un obiettivo che non ci sta prima della scadenza (solo se il ritardo dura da due giorni,
  //    mai mentre stai lavorando proprio a quell'obiettivo)
  for (const g of state.goals || []) {
    const fit = extra.fits?.[g.id];
    if (!g.due || g.due < t || !fit || !fit.late) continue;
    if (!g.lateSince || g.lateSince >= t || goalInProgress(state, g, plan, now)) continue;
    // la nuova data: mai nel passato, mai a meno di una settimana da oggi
    let to = fit.lastDay && fit.lastDay > g.due ? fit.lastDay : addDays(g.due, 14);
    if (to < addDays(t, 7)) to = addDays(t, 7);
    const optional = state.items.some((x) => x.goalId === g.id && x.optional && x.status !== 'done');
    out.push({
      id: 'fit-' + g.id, goalId: g.id,
      text: `Le sessioni per ${nameOf(g)} non entrano tutte entro il ${nice(g.due)}: ${fit.late === 1 ? 'ne resta fuori una' : `ne restano fuori ${fit.late}`}. Sposto la scadenza o tengo solo l'essenziale?`,
      actions: [
        { label: `Sposta al ${nice(to)}`, act: 'extend', arg: `${g.id}|${to}` },
        ...(optional ? [{ label: 'Solo l\'essenziale', act: 'trim', arg: g.id }] : []),
      ],
    });
  }
  // 1b. la scadenza è già passata e ci sono ancora sessioni aperte: chiudiamo o scegliamo una nuova data?
  for (const g of state.goals || []) {
    if (!g.due || g.due >= t || (state.habits || []).some((h) => h.goalId === g.id)) continue;
    if (!state.items.some((x) => x.goalId === g.id && x.kind === 'task' && x.status !== 'done')) continue;
    const name = nameOf(g);
    const head = /\buscire\b/i.test(g.title) ? `${name.charAt(0).toUpperCase() + name.slice(1)} doveva uscire il ${nice(g.due)}.` : `La scadenza per ${name} era il ${nice(g.due)}.`;
    out.push({
      id: 'past-' + g.id, goalId: g.id,
      text: `${head} Lo chiudiamo o scegliamo una nuova data?`,
      actions: [{ label: 'È fatto', act: 'goal-done', arg: g.id }, { label: 'Nuova data', act: 'goal-date', arg: g.id }, { label: 'Toglilo', act: 'goal-remove', arg: g.id }],
    });
  }
  // 2. sessioni saltate
  const skips = skippedThisWeek(state, now);
  for (const [pid, k] of Object.entries(skips)) {
    if (k < 3) continue;
    const pr = projectOf(state, pid);
    if (!pr) continue;
    const goal = (state.goals || []).find((g) => g.projectId === pid);
    out.push({
      id: 'skip-' + pid,
      text: `Questa settimana hai saltato ${k} sessioni di ${pr.name}.${goal ? ' Vuoi che riduca l\'obiettivo o preferisci recuperare sabato?' : ' Vuoi recuperare sabato?'}`,
      actions: [
        { label: 'Recupera sabato', act: 'recover', arg: pid },
        ...(goal ? [{ label: 'Riduci l\'obiettivo', act: 'reduce', arg: goal.id }] : []),
      ],
    });
  }
  // 3. scadenza mancante: chiesta una volta sola
  for (const g of state.goals || []) {
    if (g.due || g.dueAnswered || (g.askedDueOn && g.askedDueOn !== t)) continue;
    if ((state.habits || []).some((h) => h.goalId === g.id)) continue;
    out.push({
      id: 'due-' + g.id, goalId: g.id,
      text: `${nameOf(g).charAt(0).toUpperCase() + nameOf(g).slice(1)}: entro quando vuoi arrivarci? Così distribuisco le sessioni.`,
      actions: [['2 settimane', 14], ['1 mese', 'm1'], ['3 mesi', 'm3'], ['Nessuna', 0]].map(([label, v]) => ({ label, act: 'due', arg: `${g.id}|${v}` })),
    });
  }
  // 4. cose imparate (durate, fasce orarie)
  out.push(...(extra.learned || []));
  // 5. continuità: ciò che era iniziato o è rimasto indietro
  let carry = 0;
  for (const it of state.items) {
    if (carry >= 2) break;
    if (it.kind !== 'task' || it.status === 'done' || it.habitId) continue;
    const behind = it.date && it.date < t;
    if (!(it.spent > 0) && !behind) continue;
    const w = where(it.id);
    const at = w ? `${w.d === t ? 'oggi' : dayLabel(w.d, t).toLowerCase()} alle ${fmtMin(w.b.start)}` : null;
    if (it.spent > 0) out.push({ id: 'carry-' + it.id, itemId: it.id, text: `«${it.title}»: hai già fatto ${dur(it.spent)}, non riparti da zero. ${at ? `Gli altri ${dur(remainingOf(it))} li ho messi ${at}.` : (p.missed || []).some((m) => m.item.id === it.id) ? 'Com\'è andata la sessione di prima?' : `Mancano ${dur(remainingOf(it))}, ma per ora non entrano.`}` });
    else out.push({ id: 'behind-' + it.id, itemId: it.id, text: `${it.title} è rimasta indietro. ${at ? 'L\'ho rimessa ' + at + '.' : 'Oggi non entra: la sposto o la togliamo?'}`,
      actions: [{ label: 'Sposta a domani', act: 'item-tomorrow', arg: it.id }, { label: 'Togli', act: 'item-remove', arg: it.id }] });
    carry++;
  }
  // 6. a che punto sono gli obiettivi
  for (const g of state.goals || []) {
    const mine = state.items.filter((x) => x.goalId === g.id && x.kind === 'task' && !x.habitId);
    const open = mine.filter((x) => x.status !== 'done');
    if (g.planned && mine.length && !open.length) {
      out.push({ id: 'done-' + g.id, goalId: g.id, text: `Le sessioni per ${nameOf(g)} sono finite. Obiettivo raggiunto?`, actions: [{ label: 'Sì, archivialo', act: 'goal-done', arg: g.id }, { label: 'Non ancora', act: 'goal-more', arg: g.id }] });
      continue;
    }
    if (!g.due || daysBetween(t, g.due) < 0 || !mine.length) continue;
    const days = daysBetween(t, g.due);
    const when = days === 0 ? 'oggi' : days < 14 ? `tra ${days} giorni` : `tra ${Math.round(days / 7)} settimane`;
    const nDone = mine.length - open.length;
    out.push({ id: 'goal-' + g.id, goalId: g.id, text: `${g.title}: ${when}. ${nDone === 1 ? '1 sessione fatta' : `${nDone} sessioni fatte`} su ${mine.length}.` });
  }
  // 7. backup
  if (extra.backupDue) out.push({ id: 'backup', text: 'Non esporti un backup da più di due settimane. I dati stanno solo su questo telefono.', actions: [{ label: 'Esporta ora', act: 'backup', arg: '' }] });
  return out;
}

/** «l'EP», «Portfolio», «Esame di storia» tra virgolette: come si chiama un obiettivo in una frase. */
export function goalName(state, g) {
  const pr = g.projectId ? projectOf(state, g.projectId) : null;
  return pr ? (pr.name === 'EP' ? "l'EP" : pr.name) : `«${g.title}»`;
}

/**
 * Massimo 2 osservazioni al giorno. Quelle mostrate restano visibili fino a fine giornata
 * (anche se nel frattempo non sarebbero più tra le candidate), finché non le chiudi o rispondi;
 * le nuove entrano solo se c'è posto.
 * seen = { day, ids, closed, snap } (viene aggiornato e restituito). alive(o): l'osservazione ha ancora senso?
 */
export function pickObservations(cands, seen, today, max = 2, alive = () => true) {
  const s = seen && seen.day === today
    ? { day: today, ids: [...(seen.ids || [])], closed: [...(seen.closed || [])], snap: { ...(seen.snap || {}) } }
    : { day: today, ids: [], closed: [], snap: {} };
  const byId = new Map(cands.map((c) => [c.id, c]));
  const shown = [];
  for (const id of s.ids) {
    if (s.closed.includes(id)) continue;
    const o = byId.get(id) || s.snap[id];
    if (!o || !alive(o)) continue;
    s.snap[id] = o;
    shown.push(o);
  }
  for (const c of cands) {
    if (s.ids.length >= max) break;
    if (s.ids.includes(c.id)) continue;
    s.ids.push(c.id);
    s.snap[c.id] = c;
    shown.push(c);
  }
  return { shown: shown.slice(0, max), seen: s };
}

/** Un'osservazione mostrata ha ancora senso? (l'attività o l'obiettivo di cui parla ci sono ancora) */
export const observationAlive = (state) => (o) => {
  if (o.itemId && !(state.items || []).some((x) => x.id === o.itemId && x.status !== 'done')) return false;
  if (o.goalId && !(state.goals || []).some((g) => g.id === o.goalId)) return false;
  return true;
};

/** Dopo averle mostrate: le domande fatte una volta sola si ricordano (non «ho aggiornato le stime»: quello solo quando lo chiudi). */
export function markShown(state, shown, today) {
  for (const o of shown || []) {
    if (o.goalId && String(o.id).startsWith('due-')) { const g = (state.goals || []).find((x) => x.id === o.goalId); if (g && !g.askedDueOn) g.askedDueOn = today; }
    if (o.id === 'backup') (state.stats ||= {}).backupShownOn = today;
  }
}

/** L'hai chiusa o le hai risposto: non si mostra più oggi (e «ho aggiornato le stime» da ora è detto). */
export function closeObservation(state, id, now) {
  const today = dateKey(new Date(now));
  const s = state.seenObs?.day === today ? state.seenObs : (state.seenObs = { day: today, ids: [], closed: [], snap: {} });
  s.closed = [...new Set([...(s.closed || []), id])];
  if (!(s.ids || []).includes(id)) s.ids = [...(s.ids || []), id];
  const key = String(id).startsWith('learn-') ? String(id).slice(6) : null;
  const d = key && state.learned?.durations?.[key];
  if (d) d.announced = d.ratio;
}

/**
 * Il promemoria del backup: niente export da 14 giorni, dati cambiati dall'ultimo export,
 * e al massimo una volta ogni 7 giorni.
 */
export function backupDue(state, now) {
  const st = state.stats || {};
  const t = dateKey(new Date(now));
  const last = state.settings?.lastExportAt || st.createdAt || now;
  if (!(state.items || []).length || now - last <= 14 * 864e5) return false;
  if (state.settings?.lastExportAt && (st.edits || 0) === (st.exportedEdits ?? -1)) return false;
  if (st.backupShownOn && daysBetween(st.backupShownOn, t) < 7) return false;
  return true;
}

// ---------------------------------------------------------------- bentornato
export const AWAY_DAYS = 7;
/**
 * Un'apertura dell'app: se l'ultima è di 7 o più giorni fa, prepara il «Bentornato».
 * Aggiorna stats.lastOpenAt. Restituisce il bentornato (o null).
 */
export function noteOpen(state, now) {
  const st = (state.stats ||= {});
  const last = st.lastOpenAt;
  st.lastOpenAt = now;
  if (!last || now - last < AWAY_DAYS * 864e5) return null;
  state.welcome = { since: last, at: now };
  return state.welcome;
}

/** Le attività senza scadenza nate prima dell'assenza (non quelle degli obiettivi né delle abitudini). */
export function welcomeArchive(state) {
  const since = state.welcome?.since;
  if (!since) return [];
  return (state.items || []).filter((x) => x.kind === 'task' && x.status !== 'done' && !x.deadline && !x.goalId && !x.habitId && (x.createdAt || 0) < since);
}

/** La carta «Bentornato»: { text, days, archive[], goals[{ id, text, actions }] } oppure null. */
export function welcomeView(state, now) {
  const w = state.welcome;
  if (!w) return null;
  const t = dateKey(new Date(now));
  const days = Math.max(AWAY_DAYS, Math.round((w.at - w.since) / 864e5));
  const away = days >= 60 ? `${Math.round(days / 30)} mesi` : days >= 14 ? `${Math.round(days / 7)} settimane` : `${days} giorni`;
  const goals = (state.goals || []).filter((g) => g.due && g.due < t).map((g) => ({
    id: g.id, text: `${cap1(goalName(state, g))}: la scadenza era il ${dateLong(g.due, t)}.`,
    actions: [{ label: 'È fatto', act: 'goal-done', arg: g.id }, { label: 'Nuova data', act: 'goal-date', arg: g.id }, { label: 'Toglilo', act: 'goal-remove', arg: g.id }],
  }));
  const archive = welcomeArchive(state);
  return { days, text: `Bentornato. Non aprivi Tempo da ${days >= 14 ? away + ` (${days} giorni)` : away}.`, archive: archive.map((x) => ({ id: x.id, title: x.title })), goals };
}
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- la fine di una sessione e di un obiettivo
/** «Beat 01 fatto · 3 di 22 per l'EP · Prossima: giovedì alle 19:15» (null se non è una sessione di un obiettivo). */
export function sessionDoneNote(state, itemId, plan, now) {
  const it = (state.items || []).find((x) => x.id === itemId);
  const g = it?.goalId && (state.goals || []).find((x) => x.id === it.goalId);
  if (!g || it.habitId) return null;
  const t = dateKey(new Date(now));
  const mine = state.items.filter((x) => x.goalId === g.id && x.kind === 'task' && !x.habitId);
  const done = mine.filter((x) => x.status === 'done').length;
  let next = null;
  for (const d of Object.keys(plan || {}).sort()) {
    const b = plan[d].blocks.find((bb) => bb.type !== 'done' && bb.item.goalId === g.id && bb.item.kind === 'task' && !(d === t && bb.end <= nowMinOf(now)));
    if (b) { next = { d, b }; break; }
  }
  const when = next ? `${next.d === t ? 'oggi' : next.d === addDays(t, 1) ? 'domani' : new Date(next.d + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long' })} alle ${fmtMin(next.b.start)}` : null;
  const tail = done >= mine.length ? 'era l\'ultima' : when ? `Prossima: ${when}` : 'Prossima: da mettere in programma';
  return { text: `${it.title} fatto · ${done} di ${mine.length} per ${goalName(state, g)} · ${tail}`, nextId: next?.b.item.id || null };
}

/** «L'EP è fatto: 20 sessioni, 31 ore, dal 12 ottobre al 25 novembre.» */
export function goalDoneText(state, g, t) {
  const h = g.history || {};
  const time = h.minutes >= 120 ? `${Math.round(h.minutes / 60)} ore` : `${h.minutes || 0} minuti`;
  const span = h.from && h.to && h.from !== h.to ? `, dal ${dateLong(h.from, t)} al ${dateLong(h.to, t)}` : h.to ? `, il ${dateLong(h.to, t)}` : '';
  return `${cap1(goalName(state, g))} è fatto: ${h.sessions === 1 ? '1 sessione' : `${h.sessions || 0} sessioni`}, ${time}${span}.`;
}

export const REST_DAYS_FOR = 28; // un giorno liberato dal companion dura 4 settimane

/**
 * La risposta a un'osservazione: cambia lo stato e dice cosa è successo.
 * La usa l'app (dentro commit, quindi si può annullare) e la usano le simulazioni.
 * Restituisce { label, toast } oppure null se l'azione non riguarda lo stato.
 */
export function answerObservation(state, act, arg, { now, plan = {} }) {
  const t = dateKey(new Date(now));
  const goalOf = (id) => (state.goals || []).find((x) => x.id === id);
  const longDate = (d) => dateLong(d, t);
  if (act === 'recover') {
    // sabato si aggiunge tempo: le sessioni già in programma nei prossimi giorni restano dove sono
    const sat = nextSaturday(t);
    const soon = new Set([0, 1, 2].flatMap((k) => (plan[addDays(t, k)]?.blocks || []).map((b) => b.id)));
    const later = state.items.filter((x) => x.project === arg && x.kind === 'task' && x.status !== 'done' && x.start == null && !soon.has(x.id)).slice(0, 2);
    const pr = projectOf(state, arg);
    if (later.length) applyOps(state, later.map((x) => ({ action: 'move', id: x.id, date: sat })), now);
    else applyOps(state, [{ action: 'add', kind: 'task', title: `Recupero ${pr?.name || ''}`.trim(), date: sat, duration_min: Math.min(state.prefs.maxBlock || 120, 120), energy: 3, priority: 2, project: arg }], now);
    state.log = (state.log || []).filter((e) => !(e.type === 'skip' && e.project === arg));
    return { label: 'Recupero sabato', toast: `Sabato recuperi ${pr?.name || 'il progetto'}` };
  }
  if (act === 'due') {
    const [gid, v] = String(arg).split('|');
    const g = goalOf(gid);
    if (!g) return null;
    const [y, m, d] = t.split('-').map(Number);
    const due = v === '0' ? null : v.startsWith('m') ? dateKey(new Date(y, m - 1 + +v.slice(1), d)) : addDays(t, +v);
    g.dueAnswered = true;
    if (due) applyOps(state, [{ action: 'set_goal', id: g.id, title: g.title, deadline: due }], now);
    return { label: 'Scadenza', toast: due ? `Scadenza: ${longDate(due)}` : 'Nessuna scadenza' };
  }
  if (act === 'extend') {
    const [gid, to] = String(arg).split('|');
    const g = goalOf(gid);
    if (!g) return null;
    applyOps(state, [{ action: 'set_goal', id: g.id, title: g.title, deadline: to }], now);
    return { label: 'Scadenza spostata', toast: `Nuova scadenza: ${longDate(to)}` };
  }
  if (act === 'trim') {
    const n = state.items.filter((x) => x.goalId === arg && x.optional && x.status !== 'done').length;
    state.items = state.items.filter((x) => !(x.goalId === arg && x.optional && x.status !== 'done'));
    return { label: 'Solo l\'essenziale', toast: `${n} ${n === 1 ? 'sessione facoltativa tolta' : 'sessioni facoltative tolte'}` };
  }
  if (act === 'goal-remove') {
    const g = goalOf(arg);
    if (!g) return null;
    // via l'obiettivo, le sue sessioni ancora aperte e le sue abitudini; quelle fatte restano nella storia
    state.goals = state.goals.filter((x) => x.id !== arg);
    state.items = state.items.filter((x) => !(x.goalId === arg && x.status !== 'done'));
    state.habits = (state.habits || []).filter((h) => h.goalId !== arg);
    return { label: 'Obiettivo tolto', toast: `«${g.title}» tolto` };
  }
  if (act === 'goal-done') {
    // archiviato con la sua storia (sessioni, ore reali, da quando a quando), non cancellato
    const g = goalOf(arg);
    if (!g) return null;
    const mine = state.items.filter((x) => x.goalId === g.id && x.kind === 'task' && !x.habitId);
    const done = mine.filter((x) => x.status === 'done');
    const days = done.map((x) => x.doneAt).filter(Boolean).sort((a, b) => a - b);
    g.archivedAt = now;
    g.history = {
      sessions: done.length,
      minutes: done.reduce((a, x) => a + (x.actual || x.duration || 0), 0),
      from: days.length ? dateKey(new Date(days[0])) : dateKey(new Date(g.at || now)),
      to: days.length ? dateKey(new Date(days.at(-1))) : t,
    };
    state.goals = state.goals.filter((x) => x.id !== g.id);
    state.goalsDone = [...(state.goalsDone || []), g];
    // le sessioni rimaste aperte non servono più (si possono riavere con Annulla)
    state.items = state.items.filter((x) => !(x.goalId === g.id && x.status !== 'done'));
    state.habits = (state.habits || []).filter((h) => h.goalId !== g.id);
    return { label: 'Obiettivo raggiunto', toast: goalDoneText(state, g, t), plain: false };
  }
  if (act === 'item-tomorrow') {
    const it = state.items.find((x) => x.id === arg);
    if (!it) return null;
    applyOps(state, [{ action: 'move', id: it.id, date: addDays(t, 1) }], now);
    return { label: 'Spostata a domani', toast: `«${it.title}» domani` };
  }
  if (act === 'item-remove') {
    const it = state.items.find((x) => x.id === arg);
    if (!it) return null;
    applyOps(state, [{ action: 'delete', id: it.id }], now);
    return { label: 'Tolta', toast: `Tolta «${it.title}»` };
  }
  if (act === 'welcome-close') {
    state.welcome = null;
    return { label: 'Bentornato', toast: 'Bene. Si riparte da oggi.', plain: true };
  }
  if (act === 'learn-off') {
    const d = state.learned?.durations?.[arg];
    if (d) d.disabled = true;
    updateDurations(state);
    return { label: 'Stime come prima', toast: 'Ok, tengo le stime come prima' };
  }
  if (act === 'slot-move') {
    const [from, to] = String(arg).split('|');
    state.prefs.focusWindow = to;
    for (const x of state.items) if (x.window === from && x.status !== 'done' && x.kind === 'task') x.window = to;
    ((state.learned ||= {}).slots ||= {})[from] = now;
    return { label: 'Fascia spostata', toast: `Le sessioni vanno ${to === 'pomeriggio' ? 'al pomeriggio' : `alla ${to}`}` };
  }
  if (act === 'slot-keep') {
    ((state.learned ||= {}).slots ||= {})[arg] = now;
    return { label: 'Fascia confermata', toast: 'Ok, lascio così', plain: true };
  }
  if (act === 'day-off') {
    // per 4 settimane, non per sempre: poi si torna a guardare i dati
    const wd = +arg;
    const until = addDays(t, REST_DAYS_FOR);
    state.prefs.restDays = [...(state.prefs.restDays || []).filter((r) => r.wd !== wd), { wd, until }];
    ((state.learned ||= {}).slots ||= {})['d' + wd] = now;
    return { label: 'Giorno libero dai progetti', toast: `Fatto: niente progetti quel giorno fino al ${longDate(until)}` };
  }
  if (act === 'reduce') {
    const g = goalOf(arg);
    if (!g) return null;
    if (g.due) g.due = addDays(g.due, 14);
    state.log = (state.log || []).filter((e) => !(e.type === 'skip' && e.project === g.projectId));
    return { label: 'Obiettivo alleggerito', toast: 'Traguardo spostato di 2 settimane' };
  }
  return null;
}

/** Prossimo sabato (o oggi se è sabato) */
export function nextSaturday(today) {
  const w = weekday(today);
  return addDays(today, (6 - w + 7) % 7 || 0);
}

// Presentazione iniziale: dal testo libero al contesto (senza AI) → parse.js
export { contextOps } from './parse.js';

/**
 * Prima di applicare la presentazione: cosa ho capito (voce per voce), cosa no, e i primi 7 giorni del piano.
 * Lo stato non cambia: si lavora su una copia. { ops, understood, missed, week: [{ day, items: [{ title, start, end, fixed }] }] }
 */
export function contextReview(answers, today, state, now, given = null) {
  const parts = contextParts(answers, today, state);
  const ops = given || parts.ops, missed = parts.missed;
  const draft = JSON.parse(JSON.stringify(state));
  applyOps(draft, JSON.parse(JSON.stringify(ops)), now);
  const understood = understoodOf(ops, draft, today);
  const plan = planDays(draft, now, 7);
  const week = Object.keys(plan).sort().map((d) => ({
    day: d,
    items: plan[d].blocks.filter((b) => b.type !== 'done' && b.item.kind !== 'rest')
      .map((b) => ({ title: b.item.title, start: b.start, end: b.end, fixed: b.type !== 'flex' })),
  }));
  return { ops, understood, missed, week };
}

// ------------------------------------------------------------------
// Per l'AI: chi è l'utente e come deve parlare il companion
// ------------------------------------------------------------------
export const COMPANION_RULES = `Chi sei
- Non sei un'agenda: sei il companion personale dell'utente. Costruisci le giornate in base a ciò che sta davvero cercando di ottenere (obiettivi), a ciò che non si sposta (vincoli), ai progetti e a come lavora meglio (preferenze). Il valore che dai: niente più fatica di decidere.
- Voce: breve, decisa, calda, in seconda persona. Una cosa alla volta. Esempi: «Hai 47 minuti prima di cena. Finisci il ritornello del beat 03. Non iniziare la copertina: richiede più tempo.» — «Stop. Hai fatto abbastanza.»
- Ricorda il contesto: se una sessione è rimasta a metà (spent > 0) riparti da lì e dillo («ieri non hai finito il beat, i 40 minuti che mancano li ho messi stasera»).
- Osserva e chiedi, non imporre: se lo stato mostra sessioni saltate su un progetto, fai notare il fatto e proponi due strade (recuperare sabato o alleggerire l'obiettivo). Non fare la predica.

Obiettivi e progetti
- "Voglio far uscire il mio EP tra 6 settimane" → set_goal (title, deadline YYYY-MM-DD calcolata da oggi, project "EP"), poi plan_goal (title dell'obiettivo) con sessions: le sessioni concrete fino alla scadenza (massimo 30; key, title, duration_min ≤ sessione massima, energy, after = chiavi delle sessioni da finire prima). Nomina le sessioni come azioni concrete («Beat 02», «Registrazione voce 02», «Carica sul distributore»), mai vaghe («Lavora all'EP»). Se non sai spezzarlo, plan_goal con sessions null usa un modello per categoria. Imposta requires_confirmation=true.
- Abitudini con frequenza ("palestra 3 volte a settimana") → add_habit (title, pref_value = volte a settimana, duration_min): le sessioni vengono sparse nella settimana, mai nei giorni di stacco.
- Ogni attività che appartiene a un progetto ha il campo project (nome del progetto). Nuovo progetto → add_project.
- Lavoro creativo = energy 3: il motore lo mette nella fascia in cui l'utente rende meglio.
- Rispetta la sessione massima (max_block_min): sessioni più lunghe vengono spezzate dal motore con pause. Non riempire ogni sera con lo stesso progetto se l'utente non vuole.

Vincoli e preferenze
- "Lavoro 9–18:30" → add_recurring lun–ven. "Sabato sono libero" → set_pref free_days "6" + remember (category vincolo). "La domenica voglio staccare" → set_pref off_days "0" + remember. "Non voglio più di 2h consecutive" → set_pref max_block_min 120. "La sera produco meglio" → set_pref focus_window sera. Ogni preferenza stabile va anche in remember con la category giusta.
- "Stasera ho solo 2 ore" / "domani sono libero dalle 15" → set_availability (date, start_time, end_time).
- Lavoro fatto a metà ("ho fatto 30 minuti del beat") → progress con actual_min: il resto viene ripianificato senza ripartire da zero. Sessione saltata → skip.
- "Che faccio?" → una sola azione concreta adatta al tempo libero che resta prima del prossimo impegno, e cosa NON iniziare. Niente elenchi.
- Dopo una giornata di lavoro il motore lascia da solo una pausa "Cena e pausa" (decompressione dopo il lavoro): non crearla tu.`;

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
    giorni_liberati_a_tempo: (P.restDays || []).filter((r) => r.until >= t).map((r) => `${['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'][r.wd]} fino al ${r.until}`),
    disponibilita_speciali: Object.entries(P.availability || {}).filter(([d]) => d >= t).map(([d, w]) => `${d}: ${w.start != null ? fmtMin(w.start) : 'inizio'}–${w.end != null ? fmtMin(w.end) : 'fine'}`),
    sessioni_saltate_questa_settimana: Object.entries(skips).map(([pid, n]) => `${projectOf(state, pid)?.name || pid}: ${n}`),
    consiglio_adesso: adv ? `${adv.title} ${adv.why || ''}`.trim() : null,
  };
}
