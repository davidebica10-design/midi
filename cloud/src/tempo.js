// Tempo lato server: le stesse regole dell'app (parser, scheduler, companion), così Mac, Siri, CarPlay
// e gli assistenti AI ricevono risposte identiche a quelle del telefono. L'AI propone, il codice decide.
import { migrate, applyOps, sanitizeOps } from '../../tempo/js/store.js';
import { planDays, dateKey, fmtMin, addDays } from '../../tempo/js/scheduler.js';
import { nowAdvice } from '../../tempo/js/companion.js';
import { localParse, understoodOf } from '../../tempo/js/parse.js';
import { monthRecap, monthKeyOf, recapText } from '../../tempo/js/recap.js';
import { runOpenTurn, ONLINE_PRESETS } from '../../tempo/js/ai-open.js';
import { routeRequest } from '../../tempo/js/decide.js';

/** Scostamento (ms) del fuso dell'utente rispetto a UTC in un certo istante. */
export function tzOffset(tz, at) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(at)).filter((p) => p.type !== 'literal').map((p) => [p.type, +p.value]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(at / 1000) * 1000;
  } catch { return 0; }
}

/**
 * Le regole dell'app usano l'ora locale del processo (sul server è UTC): spostiamo l'istante così che
 * l'ora «locale» del processo coincida con l'ora dell'utente. localNow serve solo per calcolare;
 * i timestamp salvati tornano reali con unshift.
 */
export function clockFor(tz, now = Date.now()) {
  const shift = tzOffset(tz || 'UTC', now) + new Date(now).getTimezoneOffset() * 60000;
  return { now, localNow: now + shift, shift };
}

/** Riporta all'istante reale i timestamp scritti con localNow (createdAt, doneAt, at…). */
export function unshift(state, localNow, now) {
  if (localNow === now) return state;
  const fix = (o) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) if (o[k] === localNow) o[k] = now; };
  for (const list of [state.items, state.goals, state.memory, state.log, state.habits, state.projects, state.chat]) (list || []).forEach(fix);
  fix(state.stats);
  return state;
}

export const loadState = (raw) => migrate(raw && typeof raw === 'object' ? structuredClone(raw) : {}, Date.now());

/** Cosa fare adesso, per Siri, CarPlay, widget del Mac e assistenti AI. */
export function nowFor(raw, tz, at = Date.now()) {
  const state = loadState(raw);
  const { localNow } = clockFor(tz, at);
  const plan = planDays(state, localNow, 2);
  const today = dateKey(new Date(localNow));
  const adv = nowAdvice(state, plan, localNow);
  const d = new Date(localNow);
  const n = d.getHours() * 60 + d.getMinutes();
  const next = (plan[today]?.blocks || []).filter((b) => b.type !== 'done' && b.end > n).slice(0, 5)
    .map((b) => ({ title: b.item.title, start: fmtMin(b.start), end: fmtMin(b.end), kind: b.item.kind }));
  const text = adv ? `${adv.title} ${adv.why || ''}`.trim() : next.length ? `Prossimo: ${next[0].title} alle ${next[0].start}.` : 'Oggi non hai altro in programma.';
  return { day: today, time: fmtMin(n), now: adv ? { title: adv.title, why: adv.why || '', mood: adv.mood } : null, next, text };
}

/** La giornata (oggi o un altro giorno vicino). */
export function dayFor(raw, tz, day = null, at = Date.now()) {
  const state = loadState(raw);
  const { localNow } = clockFor(tz, at);
  const today = dateKey(new Date(localNow));
  const k = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today;
  const plan = planDays(state, localNow, 14);
  const p = plan[k];
  if (!p) return { day: k, blocks: [], text: 'Posso guardare solo i prossimi 14 giorni.' };
  const blocks = p.blocks.map((b) => ({ title: b.item.title, start: fmtMin(b.start), end: fmtMin(b.end), kind: b.item.kind, done: b.type === 'done' }));
  const label = k === today ? 'Oggi' : k === addDays(today, 1) ? 'Domani' : k;
  const text = blocks.length ? `${label}: ${blocks.map((b) => `${b.start} ${b.title}${b.done ? ' (fatto)' : ''}`).join(', ')}.` : `${label} non hai niente in programma.`;
  return { day: k, blocks, free: p.free, notFitting: p.unscheduled.map((u) => u.item.title), text };
}

/** Il racconto del mese (senza AI: i numeri e le frasi del codice). */
export function recapFor(raw, tz, month = null, at = Date.now()) {
  const state = loadState(raw);
  const { localNow } = clockFor(tz, at);
  const key = month && /^\d{4}-\d{2}$/.test(month) ? month : monthKeyOf(localNow);
  const r = monthRecap(state, key, localNow);
  const ai = state.recaps?.[key]?.ai || null;
  return { month: key, title: ai?.title || r.title, sessions: r.sessions, minutes: r.minutes, chapters: r.chapters, text: recapText(r, ai) };
}

/**
 * «Dì a Tempo…» da fuori dal telefono. Senza AI usa il parser dell'app; con la chiave AI dell'utente
 * (se ha scelto di usarla anche fuori dal telefono) le frasi lunghe vanno al modello.
 * Le modifiche che chiedono conferma non vengono applicate: si confermano sul telefono.
 * Restituisce { state (nuovo, o null se non cambia), reply, understood, applied, confirm }.
 */
export async function tell(raw, tz, text, { ai = null, at = Date.now(), fetchImpl } = {}) {
  const state = loadState(raw);
  const { now, localNow } = clockFor(tz, at);
  const clean = String(text || '').trim().slice(0, 500);
  if (!clean) return { state: null, reply: 'Non ho sentito niente.', understood: [], applied: false, confirm: false };
  const quick = localParse(clean, state, localNow);
  let out = { reply: quick.reply || '', ops: quick.ops || [], confirm: !!quick.confirm };
  if (ai?.key && routeRequest(clean, quick) !== 'base') {
    const preset = ONLINE_PRESETS[ai.preset] ? ai.preset : 'gemini';
    state.settings = { ...state.settings, provider: 'online', openPreset: preset, openBaseUrl: ONLINE_PRESETS[preset].baseUrl, openKey: ai.key, openModel: ai.model || '' };
    const plan = planDays(state, localNow, 14);
    const prevFetch = globalThis.fetch;
    try {
      if (fetchImpl) globalThis.fetch = fetchImpl;
      const r = await runOpenTurn({ state, plan, now: localNow, userText: clean, chat: [] });
      out = { reply: r.text, ops: sanitizeOps(r.ops).ops, confirm: !!r.confirm };
    } catch (e) {
      out.reply = `${out.reply || ''} (L'AI non risponde: ho usato la modalità base.)`.trim();
    } finally {
      if (fetchImpl) globalThis.fetch = prevFetch;
    }
  }
  const today = dateKey(new Date(localNow));
  const understood = understoodOf(out.ops, state, today);
  if (!out.ops.length) return { state: null, reply: out.reply || 'Non ho capito.', understood: [], applied: false, confirm: false };
  if (out.confirm) return { state: null, reply: `${out.reply} È una modifica grande: confermala dall'app sul telefono.`.trim(), understood, applied: false, confirm: true };
  const res = applyOps(state, out.ops, localNow);
  unshift(state, localNow, now);
  state.chat = [...(state.chat || []), { id: 'x' + Math.random().toString(36).slice(2, 8), role: 'user', text: clean, ts: now, via: 'cloud' },
    { id: 'x' + Math.random().toString(36).slice(2, 8), role: 'assistant', text: out.reply, ts: now, changes: res.log.slice(0, 12), applied: true, via: 'cloud' }].slice(-60);
  state.stats = { ...(state.stats || {}), edits: (state.stats?.edits || 0) + 1 };
  return { state, reply: out.reply, understood, applied: true, confirm: false, errors: res.errors };
}

/** Lo stato come arriva dal telefono, senza segreti: chiavi API e impostazioni del dispositivo restano sul dispositivo. */
export function stripSecrets(s) {
  if (!s || typeof s !== 'object') return s;
  const { settings, ...rest } = s;
  return { ...rest, settings: { name: settings?.name || '' } };
}
