// Il companion impara dal comportamento: quanto durano davvero le cose, quando le fai davvero.
// Tutto ciò che impara è visibile e dimenticabile ("Cosa ho imparato"); niente si applica di nascosto.
import { dateKey, weekday, WINDOWS } from './scheduler.js';

const STOP = new Set(['il', 'la', 'lo', 'i', 'gli', 'le', 'l', 'un', 'una', 'uno', 'di', 'del', 'della', 'dello', 'dell', 'per', 'con', 'su', 'sul', 'sulla', 'al', 'alla', 'a', 'e', 'in', 'da',
  'finire', 'fare', 'chiudere', 'completare', 'continuare', 'lavorare', 'iniziare', 'sessione', 'registrazione', 'carica', 'piano', 'contenuti']);
const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);
const MIN_SAMPLES = 3;
const THRESHOLD = 0.15; // sotto il 15% di differenza non vale la pena cambiare

/** La parola che dice che tipo di attività è ("Beat 02" → "beat"). */
export function kindWord(title) {
  return strip(title).split(/[^a-z]+/).find((w) => w.length > 2 && !STOP.has(w)) || null;
}

/** Le chiavi di apprendimento di un'attività: tipo (parola) e progetto. */
const keysOf = (title, project) => [kindWord(title) && `w:${kindWord(title)}`, project && `p:${project}`].filter(Boolean);

export const MAX_SAMPLES = 300;
/** Un'attività fatta in forma compatta, per non perdere ciò che insegna quando va in archivio. */
export function sampleOf(x) {
  if (!x || x.kind !== 'task' || x.status !== 'done' || !x.actual || x.habitId) return null;
  const base = x.baseDuration || x.duration;
  if (!base) return null;
  return { keys: keysOf(x.title, x.project), base, actual: x.actual, doneAt: x.doneAt || 0 };
}

/** Campioni: attività fatte con la durata reale (nello stato e già archiviate). Il rapporto è con la stima iniziale. */
function samples(state) {
  const out = {};
  const ignore = state.learned?.ignoreBefore || {};
  const all = [...(state.learned?.samples || []), ...(state.items || []).map(sampleOf).filter(Boolean)];
  for (const sm of all) {
    for (const k of sm.keys || []) {
      if (ignore[k] && (sm.doneAt || 0) < ignore[k]) continue;
      (out[k] ||= []).push({ ratio: sm.actual / sm.base, base: sm.base, actual: sm.actual });
    }
  }
  return out;
}

/** Aggiorna le durate imparate (mediana, almeno 3 campioni) e corregge le stime delle attività ancora da fare. */
export function updateDurations(state) {
  const L = (state.learned ||= { durations: {}, slots: {}, samples: [] });
  L.durations ||= {};
  const S = samples(state);
  for (const [k, xs] of Object.entries(S)) {
    const cur = L.durations[k] || {};
    L.durations[k] = { ...cur, n: xs.length, ratio: xs.length >= MIN_SAMPLES ? +median(xs.map((x) => x.ratio)).toFixed(2) : null,
      base: Math.round(median(xs.map((x) => x.base))), actual: Math.round(median(xs.map((x) => x.actual))) };
  }
  for (const k of Object.keys(L.durations)) if (!S[k]) delete L.durations[k];
  // le stime delle attività aperte seguono ciò che hai imparato
  for (const x of state.items || []) {
    if (x.kind !== 'task' || x.status === 'done' || !x.durationEstimated || x.habitId) continue;
    x.baseDuration ||= x.duration;
    const r = ratioFor(state, x.title, x.project);
    const next = round5(x.baseDuration * r);
    if (next !== x.duration) x.duration = next;
  }
}

/** Il rapporto reale/stimato da usare per un'attività (1 se non c'è niente di affidabile). */
export function ratioFor(state, title, project) {
  const D = state.learned?.durations || {};
  for (const k of keysOf(title, project)) {
    const d = D[k];
    if (d && d.ratio && !d.disabled && Math.abs(d.ratio - 1) >= THRESHOLD) return d.ratio;
  }
  return 1;
}

/** Stima per un'attività nuova (usata da store.js). */
export const estimate = (state, title, project, minutes) => round5(minutes * ratioFor(state, title, project));

// ---------------------------------------------------------------- fasce orarie
const windowOf = (min) => (min < 13 * 60 ? 'mattina' : min < 18 * 60 ? 'pomeriggio' : 'sera');
const LABEL = { mattina: 'del mattino', pomeriggio: 'del pomeriggio', sera: 'della sera' };
const WD = ['la domenica', 'il lunedì', 'il martedì', 'il mercoledì', 'il giovedì', 'il venerdì', 'il sabato'];

/** Completamento per fascia e per giorno negli ultimi 14 giorni. */
export function slotStats(state, now) {
  const since = Math.max(now - 14 * 864e5, state.learned?.ignoreBefore?.slots || 0);
  const win = {}, day = {};
  let first = null;
  for (const e of state.log || []) {
    if ((e.type !== 'done' && e.type !== 'skip') || e.at < since) continue;
    const d = new Date(e.at);
    const start = e.start ?? d.getHours() * 60 + d.getMinutes();
    const w = windowOf(start), wd = d.getDay();
    for (const [map, k] of [[win, w], [day, wd]]) { (map[k] ||= { done: 0, skip: 0 })[e.type]++; }
    if (!first || e.at < first) first = e.at;
  }
  return { win, day, spanDays: first ? (now - first) / 864e5 : 0 };
}

const rate = (s) => s.done / (s.done + s.skip);

/**
 * Osservazioni da ciò che è stato imparato (al massimo una per tipo).
 * Le proposte sugli orari sono domande: si applicano solo dopo conferma.
 */
export function learnedObservations(state, now) {
  const out = [];
  const L = state.learned || {};
  // durate
  for (const [k, d] of Object.entries(L.durations || {})) {
    if (!d.ratio || d.disabled || Math.abs(d.ratio - 1) < THRESHOLD) continue;
    if (d.announced && Math.abs(d.announced - d.ratio) < 0.2) continue;
    const name = k.startsWith('w:') ? `«${k.slice(2).charAt(0).toUpperCase() + k.slice(3)}»` : `Le sessioni di ${(state.projects || []).find((p) => 'p:' + p.id === k)?.name || 'questo progetto'}`;
    const real = round5(d.base * d.ratio);
    out.push({ id: `learn-${k}`, learnKey: k, text: `${name} lo chiudi in circa ${real} minuti, non ${d.base}: ho aggiornato le stime.`, actions: [{ label: 'Non cambiarle', act: 'learn-off', arg: k }] });
    break;
  }
  // fasce orarie: due settimane di dati prima di proporre
  const st = slotStats(state, now);
  if (st.spanDays >= 10) {
    const dismissed = L.slots || {};
    const bad = Object.entries(st.win).find(([w, s]) => s.done + s.skip >= 4 && rate(s) < 0.4 && !(dismissed[w] > now - 14 * 864e5));
    if (bad) {
      const [w, s] = bad;
      const better = Object.keys(WINDOWS).filter((x) => x !== w).sort((a, b) => (st.win[b] ? rate(st.win[b]) : 0.5) - (st.win[a] ? rate(st.win[a]) : 0.5))[0];
      out.push({ id: `slot-${w}`, text: `Le sessioni ${LABEL[w]} le salti spesso (${s.done} su ${s.done + s.skip} nelle ultime due settimane). Le sposto ${better === 'pomeriggio' ? 'al pomeriggio' : `alla ${better}`}?`,
        actions: [{ label: 'Sì, spostale', act: 'slot-move', arg: `${w}|${better}` }, { label: 'No, lascia così', act: 'slot-keep', arg: w }] });
    } else {
      const off = new Set(state.prefs?.offDays || []);
      const badDay = Object.entries(st.day).find(([wd, s]) => !off.has(+wd) && s.done + s.skip >= 3 && rate(s) < 0.34 && !(dismissed['d' + wd] > now - 14 * 864e5));
      if (badDay) {
        const [wd, s] = badDay;
        out.push({ id: `day-${wd}`, text: `${WD[wd].charAt(0).toUpperCase() + WD[wd].slice(1)} salti quasi sempre le sessioni (${s.done} su ${s.done + s.skip}). Lo tengo libero dai progetti?`,
          actions: [{ label: 'Sì, tienilo libero', act: 'day-off', arg: wd }, { label: 'No', act: 'slot-keep', arg: 'd' + wd }] });
      }
    }
  }
  return out;
}

/** Per "Cosa ho imparato": tutto ciò che il companion usa, in parole. */
export function learnedList(state, now) {
  const L = state.learned || {};
  const rows = [];
  for (const [k, d] of Object.entries(L.durations || {})) {
    const name = k.startsWith('w:') ? `«${k.slice(2)}»` : (state.projects || []).find((p) => 'p:' + p.id === k)?.name || '?';
    if (!d.ratio) { rows.push({ key: k, text: `${name}: ${d.n} ${d.n === 1 ? 'sessione misurata' : 'sessioni misurate'}, ne servono ${MIN_SAMPLES} per correggere le stime`, active: false }); continue; }
    const same = Math.abs(d.ratio - 1) < THRESHOLD;
    rows.push({ key: k, text: same ? `${name}: le tue stime sono giuste (${d.n} sessioni)` : `${name}: ci metti circa ${round5(d.base * d.ratio)} minuti invece di ${d.base} (${d.n} sessioni)`, active: !same && !d.disabled, toggle: !same, disabled: !!d.disabled });
  }
  const st = slotStats(state, now);
  for (const [w, s] of Object.entries(st.win)) rows.push({ key: 'slots', text: `Sessioni ${LABEL[w]}: ${s.done} fatte su ${s.done + s.skip} nelle ultime due settimane` });
  return rows;
}

/** Dimentica ciò che è stato imparato su una chiave: si riparte da zero da adesso. */
export function forgetLearned(state, key, now) {
  const L = (state.learned ||= { durations: {}, slots: {} });
  (L.ignoreBefore ||= {})[key] = now;
  delete L.durations[key];
  updateDurations(state);
}

export { windowOf, dateKey, weekday };
