// UI generativa controllata: la schermata cambia forma in base a cosa stai facendo e a cosa stai
// cercando di ottenere, ma sempre con pezzi di un catalogo fisso (gusto coerente, niente layout inventati).
//
// Una «scena» = umore del momento (mood) + dominio dell'obiettivo che dà il tono (domain) →
//   palette delle tre macchie dello sfondo, motivo, variante di layout, widget del catalogo e una frase guida.
// La scena la decide il codice con regole deterministiche (funziona offline e senza AI).
// L'AI può proporre una «pelle» per un obiettivo (dominio, palette, motivo, ordine dei widget, frase):
// la proposta passa da sanitizeSkin, che tiene solo valori ammessi; si genera una volta per obiettivo,
// non a ogni apertura. L'utente può bloccare palette e layout o spegnere l'adattamento.
import { THEMES } from './themes.js';
import { goalCategory } from './parse.js';
import { decideByRules, sceneGoalOptions } from './decide.js';
import { dateKey, daysBetween, fmtMin, addDays, weekday } from './scheduler.js';
import { dateLong } from './format.js';

const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Gli umori del momento: ognuno ha un layout e un numero massimo di widget. */
export const MOODS = {
  first: { label: 'primo avvio', layout: 'calm', widgets: 0 },
  empty: { label: 'giornata libera', layout: 'calm', widgets: 2 },
  normal: { label: 'giornata normale', layout: 'standard', widgets: 1 },
  before: { label: 'prima di un impegno', layout: 'calm', widgets: 0 },
  doing: { label: 'attività in corso', layout: 'focus', widgets: 0 },
  focus: { label: 'focus', layout: 'focus', widgets: 0 },
  full: { label: 'giornata piena', layout: 'dense', widgets: 1 },
  evening: { label: 'sera libera', layout: 'calm', widgets: 2 },
  off: { label: 'giorno di stacco', layout: 'calm', widgets: 1 },
};
export const LAYOUTS = ['standard', 'calm', 'dense', 'focus'];
export const MOTIFS = ['none', 'dots', 'grid', 'lanes', 'waves', 'rings'];
export const WIDGETS = ['pipeline', 'countdown', 'deadline', 'checklist', 'week'];

/** I domini degli obiettivi: tono visivo e widget più utili, in ordine. */
export const DOMAINS = {
  release: { label: 'Uscita musicale', icon: 'music-notes', motif: 'waves', pal: THEMES.music.pal, accent: THEMES.music.accent, widgets: ['pipeline', 'countdown', 'deadline'], until: 'all\'uscita' },
  creative: { label: 'Progetto creativo', icon: 'palette', motif: 'dots', pal: THEMES.create.pal, accent: THEMES.create.accent, widgets: ['pipeline', 'deadline', 'checklist'], until: 'alla consegna' },
  study: { label: 'Studio', icon: 'graduation-cap', motif: 'grid', pal: THEMES.study.pal, accent: '#2F5FC1', widgets: ['countdown', 'deadline', 'checklist'], until: 'all\'esame' },
  fitness: { label: 'Allenamento', icon: 'barbell', motif: 'lanes', pal: THEMES.sport.pal, accent: THEMES.sport.accent, widgets: ['week', 'countdown', 'checklist'], until: 'alla gara' },
  trip: { label: 'Viaggio', icon: 'airplane-tilt', motif: 'dots', pal: THEMES.travel.pal, accent: THEMES.travel.accent, widgets: ['countdown', 'checklist', 'deadline'], until: 'alla partenza' },
  move: { label: 'Trasloco', icon: 'house', motif: 'grid', pal: THEMES.home.pal, accent: THEMES.home.accent, widgets: ['checklist', 'deadline', 'countdown'], until: 'al trasloco' },
  launch: { label: 'Lancio', icon: 'flag', motif: 'rings', pal: THEMES.work.pal, accent: '#3D5AFE', widgets: ['pipeline', 'countdown', 'deadline'], until: 'al lancio' },
  event: { label: 'Evento', icon: 'confetti', motif: 'dots', pal: THEMES.fun.pal, accent: THEMES.fun.accent, widgets: ['countdown', 'checklist', 'deadline'], until: 'al giorno' },
  generic: { label: 'Obiettivo', icon: 'sparkle', motif: 'none', pal: null, accent: null, widgets: ['deadline', 'checklist', 'countdown'], until: 'alla scadenza' },
};
export const DOMAIN_KEYS = Object.keys(DOMAINS);

const RULES = [
  [/\b(trasloc\w*|casa nuova|nuova casa|cambiare casa)\b/, 'move'],
  [/\b(viagg\w*|vacanz\w*|volo|partenz\w*|giappone|interrail|zaino|erasmus)\b/, 'trip'],
  [/\b(matrimoni\w*|festa|compleanno|evento|cerimoni\w*|laurea party|serata)\b/, 'event'],
  [/\b(lanci\w*|startup|prodotto|kickstarter|beta|app|saas|negozio online|e-?commerce)\b/, 'launch'],
  [/\b(maratona|mezza|gara|triathlon|10 ?km|5 ?km|granfondo)\b/, 'fitness'],
];

/** Il dominio di un obiettivo dalle sue parole (titolo, nota, progetto). */
export function domainOf(goal, projectName = '') {
  const text = ` ${strip(goal?.title)} ${strip(goal?.note)} ${strip(projectName)} `;
  const cat = goalCategory(text);
  if (cat === 'music') return 'release';
  for (const [re, key] of RULES) if (re.test(text)) return key;
  return { creative: 'creative', study: 'study', fitness: 'fitness' }[cat] || 'generic';
}

// ---------------------------------------------------------------- colori
const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export const mixHex = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v * t + y[i] * (1 - t))); };
/** Luminanza relativa (WCAG). */
export function luminance(h) {
  const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Le macchie dello sfondo restano chiare (il testo scuro sopra si legge sempre): una tinta troppo scura si schiarisce. */
export const softTint = (h) => (luminance(h) >= 0.45 ? h.toLowerCase() : mixHex(h, '#ffffff', 0.35));

// ---------------------------------------------------------------- pelle proposta dall'AI
/**
 * Tiene solo i valori ammessi di una pelle proposta dall'AI per un obiettivo:
 * { domain, pal: [3 hex], motif, widgets: [≤3], line (≤ 90 caratteri, senza «!») }.
 */
export function sanitizeSkin(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (DOMAIN_KEYS.includes(raw.domain)) out.domain = raw.domain;
  if (Array.isArray(raw.pal) && raw.pal.length >= 3 && raw.pal.slice(0, 3).every((h) => HEX.test(h))) out.pal = raw.pal.slice(0, 3).map(softTint);
  if (MOTIFS.includes(raw.motif)) out.motif = raw.motif;
  if (Array.isArray(raw.widgets)) {
    const w = [...new Set(raw.widgets.filter((x) => WIDGETS.includes(x)))].slice(0, 3);
    if (w.length) out.widgets = w;
  }
  if (typeof raw.line === 'string') {
    const line = raw.line.replace(/[!¡]+/g, '.').replace(/\.{2,}/g, '.').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (line.length >= 3) out.line = line;
  }
  return Object.keys(out).length ? out : null;
}

/** I messaggi per chiedere all'AI la pelle di un obiettivo (risposta in JSON). */
export function skinPrompt(goal, projectName = '') {
  return [
    { role: 'system', content: `Sei il designer di Tempo, un'app che organizza il tempo. Dato un obiettivo, scegli come deve apparire la schermata mentre l'utente ci lavora. Rispondi SOLO con JSON:
{"domain": uno tra ${DOMAIN_KEYS.map((k) => `"${k}"`).join(', ')},
 "pal": tre colori pastello chiari "#rrggbb" per lo sfondo (luminosi, armoniosi, adatti al tema),
 "motif": uno tra ${MOTIFS.map((k) => `"${k}"`).join(', ')},
 "widgets": fino a 3 tra ${WIDGETS.map((k) => `"${k}"`).join(', ')}, dal più utile,
 "line": una frase guida in italiano, seconda persona, massimo 90 caratteri, senza punti esclamativi}
pipeline = avanzamento per fasi; countdown = giorni alla data; deadline = sessioni fatte rispetto alla scadenza; checklist = prossime sessioni; week = volte a settimana (abitudini).` },
    { role: 'user', content: `Obiettivo: ${goal.title}${goal.note && goal.note !== goal.title ? `\nNota: ${goal.note}` : ''}${projectName ? `\nProgetto: ${projectName}` : ''}${goal.due ? `\nScadenza: ${goal.due}` : ''}` },
  ];
}

// ---------------------------------------------------------------- widget
const STAGE = /^(.*?)[\s·#\-–]*(\d{1,3})$/;
const stateOf = (x) => (x.status === 'done' ? 'done' : x.status === 'doing' || x.spent > 0 ? 'doing' : 'todo');

/**
 * Avanzamento per fasi: «Beat 01», «Mix 03» → una griglia brani × fasi; le sessioni senza numero
 * («Master», «Copertina») vanno in fondo come passi finali.
 */
export function pipelineOf(goal, items) {
  const mine = items.filter((x) => x.goalId === goal.id && x.kind === 'task' && !x.habitId);
  if (mine.length < 2) return null;
  const stages = [], rowsIdx = [], tail = [];
  const cell = new Map();
  for (const x of mine) {
    const m = String(x.title).match(STAGE);
    if (m && m[1].trim()) {
      const stage = m[1].trim(), idx = m[2].padStart(2, '0');
      if (!stages.includes(stage)) stages.push(stage);
      if (!rowsIdx.includes(idx)) rowsIdx.push(idx);
      cell.set(`${stage}|${idx}`, { id: x.id, state: stateOf(x), title: x.title });
    } else tail.push({ id: x.id, label: x.title, state: stateOf(x) });
  }
  const done = mine.filter((x) => x.status === 'done').length;
  const base = { type: 'pipeline', done, total: mine.length };
  if (stages.length >= 2 && rowsIdx.length >= 2) {
    rowsIdx.sort();
    const cols = stages.slice(0, 5);
    const rows = rowsIdx.slice(0, 6).map((idx) => ({ label: idx, cells: cols.map((s) => cell.get(`${s}|${idx}`) || null) }));
    const colStats = cols.map((s) => {
      const cs = rowsIdx.map((i) => cell.get(`${s}|${i}`)).filter(Boolean);
      return { label: s, done: cs.filter((c) => c.state === 'done').length, total: cs.length };
    });
    return { ...base, matrix: { cols: colStats, rows }, tail: tail.slice(0, 6) };
  }
  // niente griglia: le fasi in ordine, ognuna con il suo stato
  return { ...base, matrix: null, tail: mine.slice(0, 8).map((x) => ({ id: x.id, label: x.title, state: stateOf(x) })) };
}

/** Sessioni fatte rispetto alla scadenza. */
export function deadlineOf(goal, items, today, fit = null) {
  const mine = items.filter((x) => x.goalId === goal.id && x.kind === 'task' && !x.habitId);
  if (!mine.length) return null;
  const done = mine.filter((x) => x.status === 'done').length;
  const days = goal.due ? daysBetween(today, goal.due) : null;
  const late = fit?.late || 0;
  return {
    type: 'deadline', done, total: mine.length, pct: Math.round((done / mine.length) * 100),
    due: goal.due || null, dueText: goal.due ? dateLong(goal.due, today) : null, days,
    status: !goal.due ? 'none' : days < 0 ? 'past' : late ? 'late' : 'ok',
    caption: !goal.due ? `${done} di ${mine.length} sessioni · senza scadenza`
      : days < 0 ? `Scadenza passata · ${done} di ${mine.length}`
      : late ? `${late === 1 ? '1 sessione non entra' : `${late} sessioni non entrano`} entro il ${dateLong(goal.due, today)}`
      : `${done} di ${mine.length} sessioni · in tempo per il ${dateLong(goal.due, today)}`,
  };
}

/** Giorni alla data dell'obiettivo (solo entro 4 mesi). */
export function countdownOf(goal, today, domain) {
  if (!goal.due) return null;
  const days = daysBetween(today, goal.due);
  if (days < 0 || days > 120) return null;
  return { type: 'countdown', days, date: goal.due, dateText: dateLong(goal.due, today), label: days === 0 ? 'È oggi' : days === 1 ? `Manca 1 giorno ${DOMAINS[domain]?.until || 'alla scadenza'}` : `Mancano ${days} giorni ${DOMAINS[domain]?.until || 'alla scadenza'}` };
}

/** Le prossime sessioni dell'obiettivo, nell'ordine del piano. */
export function checklistOf(goal, items, plan, today) {
  const rows = [];
  const seen = new Set();
  for (const d of Object.keys(plan || {}).sort()) {
    for (const b of plan[d].blocks || []) {
      if (b.type === 'done' || b.item.goalId !== goal.id || seen.has(b.item.id)) continue;
      seen.add(b.item.id);
      rows.push({ id: b.item.id, title: b.item.title, when: d === today ? `oggi ${fmtMin(b.start)}` : d === addDays(today, 1) ? `domani ${fmtMin(b.start)}` : dateLong(d, today) });
      if (rows.length >= 3) break;
    }
    if (rows.length >= 3) break;
  }
  for (const x of items) {
    if (rows.length >= 3) break;
    if (x.goalId === goal.id && x.kind === 'task' && x.status !== 'done' && !seen.has(x.id)) rows.push({ id: x.id, title: x.title, when: 'da pianificare' });
  }
  return rows.length ? { type: 'checklist', rows } : null;
}

/** Abitudini dell'obiettivo: quante volte questa settimana rispetto all'obiettivo settimanale. */
export function weekOf(goal, state, today) {
  const habits = (state.habits || []).filter((h) => h.goalId === goal.id);
  if (!habits.length) return null;
  const wd = weekday(today);
  const monday = addDays(today, -((wd + 6) % 7));
  const target = habits.reduce((a, h) => a + (h.perWeek || 1), 0);
  const days = [];
  let done = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const n = (state.items || []).filter((x) => habits.some((h) => h.id === x.habitId) && x.status === 'done' && x.doneAt && dateKey(new Date(x.doneAt)) === d).length;
    done += n;
    days.push({ day: d, label: 'LMMGVSD'[i], done: n > 0, today: d === today });
  }
  return { type: 'week', done, target, days, caption: `${done} di ${target} questa settimana` };
}

// ---------------------------------------------------------------- la scena
/** L'umore del momento dalla schermata del giorno (viewmodel.today) e dal focus in corso. */
export function moodOf({ state, view, now }) {
  if (!view || !view.isToday) return view?.status === 'empty' || view?.status === 'off' ? 'empty' : 'normal';
  if (state.focus && ['work', 'break'].includes(state.focus.phase)) return 'focus';
  if (view.status === 'first') return 'first';
  if (view.now?.block && view.now.block.kind !== 'rest') return 'doing';
  if (view.status === 'off') return 'off';
  const d = new Date(now);
  const n = d.getHours() * 60 + d.getMinutes();
  const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
  const nextEvent = (view.cards || []).find((c) => c.type === 'event' && hm(c.start) > n);
  if (nextEvent && hm(nextEvent.start) - n <= 45) return 'before';
  if (view.status === 'full' || view.status === 'goal-late') return 'full';
  const left = (view.cards || []).filter((c) => c.type === 'task' && !c.done).length;
  if (n >= 19 * 60 && !left) return 'evening';
  if (view.status === 'empty') return 'empty';
  return 'normal';
}

/**
 * La scena di adesso.
 * ctx: { state, plan, now, view (viewmodel.today), fits?, goalId? (scelta di un motore decisionale) }
 * Restituisce null se l'adattamento è spento.
 */
export function sceneFor(ctx) {
  const { state, plan, now, view } = ctx;
  const ui = state.prefs?.ui || {};
  if (ui.adaptive === false) return null;
  const today = dateKey(new Date(now));
  const mood = moodOf({ state, view, now });
  const M = MOODS[mood];

  // l'obiettivo che dà il tono: deciso dal motore (se ha risposto) o dalle regole
  const options = sceneGoalOptions({ state, plan, now, today });
  const goalId = ctx.goalId && options.some((o) => o.id === ctx.goalId) ? ctx.goalId : decideByRules(options)?.id || null;
  const goal = goalId ? state.goals.find((g) => g.id === goalId) : null;
  const projectName = goal?.projectId ? (state.projects || []).find((p) => p.id === goal.projectId)?.name || '' : '';
  const skin = goal ? state.skins?.[goal.id] : null;
  const skinOk = skin && skin.title === goal.title ? sanitizeSkin(skin) : null;
  const domain = skinOk?.domain || (goal ? domainOf(goal, projectName) : 'generic');
  const D = DOMAINS[domain];
  const project = goal?.projectId ? (state.projects || []).find((p) => p.id === goal.projectId) : null;

  // palette: dal dominio (o dalla pelle), modificata dall'umore; bloccata se l'hai bloccata
  let pal = skinOk?.pal || D.pal || null;
  if (pal && mood === 'evening') pal = pal.map((c) => mixHex(c, '#CFC6EC', 0.55));
  if (pal && mood === 'off') pal = pal.map((c) => mixHex(c, '#DCEBDD', 0.5));
  if (Array.isArray(ui.lockPalette) && ui.lockPalette.length === 3 && ui.lockPalette.every((h) => HEX.test(h))) pal = ui.lockPalette;
  const layout = LAYOUTS.includes(ui.lockLayout) ? ui.lockLayout : M.layout;

  // widget: quelli del dominio (o della pelle), solo se hanno dati, al massimo quanti ne permette l'umore
  const widgets = [];
  if (goal && M.widgets > 0) {
    const fit = ctx.fits?.[goal.id] || null;
    const order = mood === 'full' ? ['deadline', 'checklist'] : skinOk?.widgets || D.widgets;
    for (const w of order) {
      if (widgets.length >= M.widgets) break;
      const data = w === 'pipeline' ? pipelineOf(goal, state.items)
        : w === 'deadline' ? deadlineOf(goal, state.items, today, fit)
        : w === 'countdown' ? countdownOf(goal, today, domain)
        : w === 'checklist' ? checklistOf(goal, state.items, plan, today)
        : w === 'week' ? weekOf(goal, state, today)
        : null;
      if (data && !(mood === 'full' && w === 'deadline' && data.status !== 'late')) widgets.push({ ...data, id: `${w}-${goal.id}` });
    }
  }

  const line = skinOk?.line || null;
  const scene = {
    v: 1, mood, moodLabel: M.label, domain, domainLabel: D.label, goalId: goal?.id || null,
    goalTitle: goal?.title || null, icon: D.icon, accent: project?.color || D.accent || null,
    palette: pal, motif: ui.motif === false ? 'none' : skinOk?.motif || D.motif, layout, widgets, line,
    source: skinOk ? 'ai' : 'rules',
  };
  scene.key = sceneKey(scene);
  return scene;
}

/** Una chiave che cambia solo quando cambia qualcosa di visibile (per non ridisegnare a vuoto). */
export function sceneKey(s) {
  return [s.mood, s.domain, s.goalId, (s.palette || []).join(','), s.motif, s.layout, s.line,
    s.widgets.map((w) => `${w.type}:${w.done ?? ''}/${w.total ?? ''}:${w.days ?? ''}:${w.status ?? ''}:${(w.rows || []).map((r) => r.id || r.label).join('.')}`).join('|')].join('#');
}

/** Testo per lo screen reader che descrive un widget (il colore non è mai l'unico segnale). */
export function widgetLabel(w) {
  if (w.type === 'pipeline') return w.matrix
    ? `Avanzamento: ${w.matrix.cols.map((c) => `${c.label} ${c.done} di ${c.total}`).join(', ')}${w.tail.length ? `; poi ${w.tail.map((t) => `${t.label}${t.state === 'done' ? ' fatto' : ''}`).join(', ')}` : ''}`
    : `Avanzamento: ${w.done} di ${w.total} sessioni`;
  if (w.type === 'deadline') return w.caption;
  if (w.type === 'countdown') return `${w.label}, ${w.dateText}`;
  if (w.type === 'checklist') return `Prossime sessioni: ${w.rows.map((r) => `${r.title}, ${r.when}`).join('; ')}`;
  if (w.type === 'week') return w.caption;
  return '';
}
