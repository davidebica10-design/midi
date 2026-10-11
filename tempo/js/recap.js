// Il tuo mese: un racconto di come hai usato il tempo, come i riepiloghi annuali delle app che le persone
// condividono, ma onesto e senza punteggi. I numeri li calcola il codice (sempre veri, anche offline);
// con un'AI (la chiave Gemini dell'utente, il modello più capace) il racconto è scritto a parole,
// usando solo quei numeri. Da qui si può anche chiacchierare con il proprio tempo.
import { dateKey, addDays, WINDOWS } from './scheduler.js';
import { durLabel, windowLabel, plural, dateLong } from './format.js';
import { themeOf, THEMES } from './themes.js';
import { windowOf } from './learn.js';

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const WD = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** «il lunedì», «la domenica» */
const theDay = (wd) => (wd === 'domenica' ? 'la domenica' : `il ${wd}`);
const MIN_RHYTHM = 4; // sotto le 4 sessioni non si parla di ritmo: sarebbe un'impressione, non un fatto

export const monthKeyOf = (now) => dateKey(new Date(now)).slice(0, 7);
export const prevMonthKey = (key) => { const [y, m] = key.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
export const monthName = (key) => MONTHS[+key.slice(5, 7) - 1];
const inMonth = (t, key) => Number.isFinite(t) && dateKey(new Date(t)).slice(0, 7) === key;
const hours = (min) => (min >= 90 ? `${Math.round(min / 60)} ore` : durLabel(min));
/** «il 60%», «l'80%», «l'11%»: l'articolo giusto davanti al numero. */
const pctText = (n) => (/^(8|11)/.test(String(n)) ? `l'${n}%` : `il ${n}%`);

/**
 * I numeri del mese (key: 'YYYY-MM'). Contano le sessioni fatte (anche quelle già in archivio,
 * da learned.samples), i minuti reali quando ci sono, le sessioni saltate da te (non quelle segnate
 * dall'app perché non l'hai aperta).
 */
export function monthRecap(state, key, now = Date.now()) {
  const today = dateKey(new Date(now));
  const proj = new Map((state.projects || []).map((p) => [p.id, p]));
  const sessions = [];
  for (const x of state.items || []) {
    if (x.kind !== 'task' || x.status !== 'done' || !inMonth(x.doneAt, key)) continue;
    sessions.push({ id: x.id, title: x.title, project: x.project || null, minutes: Math.round(x.actual || x.duration || 0), at: x.doneAt, habit: !!x.habitId, theme: themeOf(x, proj.get(x.project)?.name || '').key });
  }
  for (const s of state.learned?.samples || []) {
    if (!inMonth(s.doneAt, key)) continue;
    const pk = (s.keys || []).find((k) => k.startsWith('p:'));
    sessions.push({ id: null, title: null, project: pk ? pk.slice(2) : null, minutes: Math.round(s.actual || 0), at: s.doneAt, habit: false, theme: 'generic' });
  }
  const startOf = new Map();
  let skipped = 0;
  const skipDays = {};
  for (const e of state.log || []) {
    if (!inMonth(e.at, key)) continue;
    if (e.type === 'done' && e.id && e.start != null) startOf.set(e.id, e.start);
    if (e.type === 'skip' && !e.auto) { skipped++; const wd = new Date(e.at).getDay(); skipDays[wd] = (skipDays[wd] || 0) + 1; }
  }
  const minutes = sessions.reduce((a, s) => a + s.minutes, 0);
  const days = new Set(sessions.map((s) => dateKey(new Date(s.at))));

  // per progetto
  const byP = new Map();
  for (const s of sessions) {
    const k = s.project && proj.has(s.project) ? s.project : null;
    const o = byP.get(k) || { id: k, name: k ? proj.get(k).name : 'Senza progetto', color: k ? proj.get(k).color : null, minutes: 0, sessions: 0 };
    o.minutes += s.minutes; o.sessions++;
    byP.set(k, o);
  }
  const projects = [...byP.values()].sort((a, b) => b.minutes - a.minutes).map((p) => ({ ...p, pct: minutes ? Math.round((p.minutes / minutes) * 100) : 0 }));

  // per tipo di attività
  const byT = {};
  for (const s of sessions) byT[s.theme] = (byT[s.theme] || 0) + s.minutes;
  const themes = Object.entries(byT).sort((a, b) => b[1] - a[1]).map(([k, m]) => ({ key: k, label: THEMES[k]?.label || 'Attività', minutes: m }));

  // ritmo: fascia e giorno in cui fai di più
  const win = {}, wday = {};
  for (const s of sessions) {
    const d = new Date(s.at);
    const start = s.id && startOf.has(s.id) ? startOf.get(s.id) : d.getHours() * 60 + d.getMinutes() - s.minutes;
    const w = windowOf(Math.max(0, start));
    if (WINDOWS[w]) win[w] = (win[w] || 0) + 1;
    wday[d.getDay()] = (wday[d.getDay()] || 0) + s.minutes;
  }
  const bestWin = Object.entries(win).sort((a, b) => b[1] - a[1])[0] || null;
  const bestDay = Object.entries(wday).sort((a, b) => b[1] - a[1])[0] || null;
  const worstSkip = Object.entries(skipDays).sort((a, b) => b[1] - a[1])[0] || null;
  const longest = sessions.filter((s) => s.title).sort((a, b) => b.minutes - a.minutes)[0] || null;

  // stime: quanto ci metti davvero rispetto al previsto
  const measured = (state.items || []).filter((x) => x.kind === 'task' && x.status === 'done' && x.actual && (x.baseDuration || x.duration) && inMonth(x.doneAt, key));
  const ratio = measured.length >= 3 ? measured.reduce((a, x) => a + x.actual / (x.baseDuration || x.duration), 0) / measured.length : null;

  // obiettivi
  const goals = (state.goals || []).map((g) => {
    const mine = (state.items || []).filter((x) => x.goalId === g.id && x.kind === 'task' && !x.habitId);
    const doneMonth = mine.filter((x) => x.status === 'done' && inMonth(x.doneAt, key)).length;
    return { id: g.id, title: g.title, due: g.due || null, done: mine.filter((x) => x.status === 'done').length, total: mine.length, doneMonth, late: !!g.lateSince };
  }).filter((g) => g.total);
  const reached = (state.goalsDone || []).filter((g) => inMonth(g.archivedAt, key)).map((g) => ({ id: g.id, title: g.title, history: g.history }));

  const r = {
    key, month: monthName(key), year: +key.slice(0, 4), title: `Il tuo ${monthName(key)}`,
    current: key === today.slice(0, 7), sessions: sessions.length, minutes, hoursText: hours(minutes), activeDays: days.size,
    skipped, rate: sessions.length + skipped ? Math.round((sessions.length / (sessions.length + skipped)) * 100) : null,
    projects, themes,
    best: { window: bestWin?.[0] || null, windowText: bestWin ? windowLabel(bestWin[0]) : null, windowCount: bestWin?.[1] || 0, weekday: bestDay ? WD[bestDay[0]] : null, skipDay: worstSkip && worstSkip[1] >= 2 ? WD[worstSkip[0]] : null },
    longest: longest ? { title: longest.title, minutes: longest.minutes } : null,
    ratio, goals, reached, empty: sessions.length === 0,
  };
  r.chapters = chaptersOf(r, state, today);
  return r;
}

/** Il racconto senza AI: poche frasi vere, in seconda persona, senza punti esclamativi. */
export function chaptersOf(r, state, today) {
  if (r.empty) return [{ kind: 'cover', head: r.title, text: r.current ? 'Il mese è appena iniziato: quando segni le sessioni come fatte, qui racconto com\'è andato.' : 'In questo mese non hai segnato sessioni fatte.' }];
  const out = [];
  out.push({ kind: 'cover', head: r.title, big: r.hoursText, text: `${plural(r.sessions, 'sessione fatta', 'sessioni fatte')} in ${plural(r.activeDays, 'giorno', 'giorni')}.${r.current ? ' Il mese non è ancora finito.' : ''}` });
  const top = r.projects[0];
  if (top && top.id) out.push({ kind: 'projects', head: top.name, big: r.projects.length > 1 ? hours(top.minutes) : null, color: top.color, text: r.projects.length > 1 ? `${cap(pctText(top.pct))} del tempo è andato a ${top.name}. Poi ${r.projects.slice(1, 3).map((p) => `${p.name} (${hours(p.minutes)})`).join(', ')}.` : `Tutto il tempo dei progetti è andato a ${top.name}.` });
  if (r.best.window && r.sessions >= MIN_RHYTHM) out.push({ kind: 'rhythm', head: `Rendi di più ${r.best.windowText}`, text: `${r.best.windowCount} ${r.best.windowCount === 1 ? 'sessione' : 'sessioni'} su ${r.sessions} ${r.best.windowCount === 1 ? 'è finita' : 'sono finite'} ${r.best.windowText}.${r.best.weekday ? ` ${cap(theDay(r.best.weekday))} è ${r.best.weekday === 'domenica' ? 'stata' : 'stato'} il tuo giorno più pieno.` : ''}` });
  for (const g of r.goals.slice(0, 2)) {
    const when = g.due ? (g.due < today ? `La scadenza del ${dateLong(g.due, today)} è passata.` : g.late ? `Qualche sessione non entra prima del ${dateLong(g.due, today)}.` : `In tempo per il ${dateLong(g.due, today)}.`) : 'Senza scadenza.';
    out.push({ kind: 'goal', head: g.title, big: `${g.done}/${g.total}`, text: `${plural(g.doneMonth, 'sessione', 'sessioni')} questo mese. ${when}` });
  }
  for (const g of r.reached) out.push({ kind: 'reached', head: 'Obiettivo raggiunto', text: `${g.title}: ${plural(g.history?.sessions || 0, 'sessione', 'sessioni')}, ${hours(g.history?.minutes || 0)}.` });
  const honest = [];
  if (r.skipped) honest.push(`Hai saltato ${plural(r.skipped, 'sessione', 'sessioni')}${r.best.skipDay ? `, soprattutto ${theDay(r.best.skipDay)}` : ''}.`);
  if (r.ratio && Math.abs(r.ratio - 1) >= 0.15) honest.push(`Ci metti ${r.ratio > 1 ? `il ${Math.round((r.ratio - 1) * 100)}% in più` : `il ${Math.round((1 - r.ratio) * 100)}% in meno`} di quanto stimato: ne tengo conto.`);
  if (r.longest && r.longest.minutes >= 90) honest.push(`La sessione più lunga: ${r.longest.title}, ${durLabel(r.longest.minutes)}.`);
  if (honest.length) out.push({ kind: 'honest', head: 'Com\'è andata davvero', text: honest.join(' ') });
  out.push({ kind: 'next', head: r.current ? 'Da qui a fine mese' : 'Il mese prossimo', text: nextAdvice(r, state) });
  return out;
}

/** Un solo consiglio concreto per il mese che viene. */
function nextAdvice(r, state) {
  const fw = state.prefs?.focusWindow;
  if (r.best.window && fw && r.best.window !== fw && r.best.windowCount >= 4) return `Dici di rendere di più ${windowLabel(fw)}, ma le sessioni le chiudi ${r.best.windowText}. Se vuoi, sposto lì quelle pesanti.`;
  if (r.best.skipDay) return `${cap(theDay(r.best.skipDay))} salti spesso: posso ${r.best.skipDay === 'domenica' ? 'tenerla' : 'tenerlo'} più leggero${r.best.skipDay === 'domenica' ? 'a' : ''}.`;
  const late = r.goals.find((g) => g.late);
  if (late) return `${late.title}: qualche sessione non entra. Scegli tu se spostare la scadenza o tenere solo l'essenziale.`;
  if (r.ratio && r.ratio > 1.15) return 'Le stime erano strette: d\'ora in poi lascio più margine alle sessioni lunghe.';
  return 'Stesso ritmo: funziona. Se arriva un nuovo obiettivo, dimmelo nella barra.';
}

/** Testo semplice del racconto (per condividerlo o per la Live Activity). */
export const recapText = (r, ai = null) => (ai ? [ai.title, ...ai.lines, ai.next] : r.chapters.map((c) => [c.head, c.big, c.text].filter(Boolean).join(' · '))).join('\n');

// ---------------------------------------------------------------- con l'AI
/** Firma dei numeri: il racconto dell'AI si rifà solo quando i numeri cambiano. */
export const recapHash = (r) => [r.key, r.sessions, r.minutes, r.skipped, r.goals.map((g) => g.done).join('.'), r.reached.length].join('|');

/** I messaggi per far scrivere il racconto al modello più capace (Gemini Pro con la chiave dell'utente). */
export function recapPrompt(r, state) {
  const facts = {
    mese: `${r.month} ${r.year}`, in_corso: r.current, sessioni: r.sessions, ore: Math.round(r.minutes / 6) / 10, giorni_attivi: r.activeDays,
    saltate: r.skipped, completamento_percento: r.rate,
    progetti: r.projects.map((p) => ({ nome: p.name, ore: Math.round(p.minutes / 6) / 10, percento: p.pct })),
    tipi: r.themes.slice(0, 5).map((t) => ({ tipo: t.label, ore: Math.round(t.minutes / 6) / 10 })),
    fascia_migliore: r.best.windowText, giorno_piu_pieno: r.best.weekday, giorno_con_piu_saltate: r.best.skipDay,
    rapporto_durata_reale_su_stimata: r.ratio ? Math.round(r.ratio * 100) / 100 : null,
    sessione_piu_lunga: r.longest, obiettivi: r.goals, obiettivi_raggiunti: r.reached.map((g) => g.title),
    preferenze: { fascia_dichiarata: state.prefs?.focusWindow || null }, memoria: (state.memory || []).slice(-8).map((m) => m.text),
  };
  return [
    { role: 'system', content: `Sei Tempo, il companion che organizza il tempo dell'utente. Scrivi il racconto del suo mese, come una storia breve a capitoli.
Regole: italiano, seconda persona, frasi brevi, tono caldo ma onesto, niente punti esclamativi, niente punteggi o serie di giorni, niente colpe.
Usa SOLO i numeri dati: non inventare attività, numeri o date. Se il mese è in corso, dillo.
Rispondi SOLO con JSON: {"title":"titolo breve (max 40 caratteri)","lines":["4-6 capitoli, ognuno max 160 caratteri"],"next":"un solo consiglio concreto per il mese prossimo, max 160 caratteri"}` },
    { role: 'user', content: JSON.stringify(facts) },
  ];
}

const clean = (s, max) => String(s || '').replace(/[!¡]+/g, '.').replace(/\.{2,}/g, '.').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Tiene solo un racconto ben formato. */
export function sanitizeRecapAi(raw) {
  let o = raw;
  if (typeof raw === 'string') { const t = raw.replace(/```(?:json)?/g, ''); o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); }
  if (!o || typeof o !== 'object' || !Array.isArray(o.lines)) return null;
  const lines = o.lines.map((l) => clean(l, 160)).filter((l) => l.length > 3).slice(0, 6);
  if (lines.length < 2) return null;
  return { title: clean(o.title, 40) || 'Il tuo mese', lines, next: clean(o.next, 160) };
}

/** Il sistema per «chiacchiere col tempo»: parla come il tempo dell'utente, con i numeri veri del mese. */
export function timeChatSystem(r, state, base) {
  return `${base}

Qui l'utente chiacchiera con il proprio tempo: può chiedere com'è andato il mese, perché qualcosa non funziona, come vorrebbe usare le prossime settimane, o solo parlare. Rispondi come il suo Tempo: presente, curioso, onesto, mai giudicante. Al massimo 4 frasi. Se emerge una cosa da cambiare nel piano, proponila e ricorda che si fa dalla barra del giorno.
Il mese (${r.month} ${r.year}): ${r.sessions} sessioni, ${r.hoursText}, ${r.skipped} saltate, fascia migliore: ${r.best.windowText || 'n.d.'}, progetti: ${r.projects.map((p) => `${p.name} ${hours(p.minutes)}`).join(', ') || 'nessuno'}.`;
}

/** I primi giorni del mese, se il mese scorso c'è qualcosa da raccontare: un'osservazione per aprirlo. */
export function recapObservation(state, now) {
  const today = dateKey(new Date(now));
  if (+today.slice(8, 10) > 5) return null;
  const key = prevMonthKey(today.slice(0, 7));
  if ((state.recaps?.[key]?.seen)) return null;
  const r = monthRecap(state, key, now);
  if (r.sessions < 3) return null;
  return { id: 'recap-' + key, text: `Il tuo ${r.month} è pronto: ${plural(r.sessions, 'sessione', 'sessioni')}, ${r.hoursText}.`, actions: [{ label: 'Guarda', act: 'recap', arg: key }] };
}

export { addDays };
