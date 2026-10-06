// Capire le frasi senza AI: attività, impegni, durate, scadenze, vincoli, preferenze, obiettivi.
// Restituisce sempre operazioni strutturate: è store.js a validarle e applicarle.
import { fmtMin, dateKey, addDays, daysBetween, weekday, dayLabel } from './scheduler.js';

// ---------------------------------------------------------------- utilità
const ap = (s) => String(s ?? '').replace(/[’`´]/g, "'");
const lower = (s) => ap(s).toLowerCase();
const strip = (s) => lower(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tidy = (s) => s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '').trim();

const NUMW = { un: 1, una: 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, quindici: 15, venti: 20, trenta: 30, quaranta: 40, cinquanta: 50 };
const numOf = (w) => {
  const x = String(w).replace("'", '').replace(',', '.');
  return isNaN(+x) ? NUMW[x] ?? null : +x;
};

// ---------------------------------------------------------------- durate
const DUR_H = /(?:\b(?:circa|almeno|massimo|max|tipo)\s+)?(\d+(?:[.,]\d+)?|un'?|una|uno|mezz'?|due|tre|quattro|cinque|sei|sette|otto)\s*(ore|ora|oretta|orette|h)\b(?:\s*e\s*(mezza|un quarto|\d+)(?:\s*(?:min|minuti)\b)?)?/i;
const DUR_M = /(?:\b(?:circa|almeno|massimo|max|tipo)\s+)?(\d+|dieci|quindici|venti|trenta|quaranta|cinquanta)\s*(?:min|minuti|m)\b/i;
const DUR_Q = /\b(tre quarti|un quarto)\s+d'?ora\b/i;
const DUR_ANY = new RegExp(`${DUR_Q.source}|${DUR_H.source}|${DUR_M.source}`, 'gi');

/** "2 ore", "un'oretta", "un'ora e mezza", "30 min", "mezz'ora" → minuti */
export function parseDuration(text) {
  const t = lower(text);
  let m = t.match(DUR_Q);
  if (m) return m[1] === 'tre quarti' ? 45 : 15;
  m = t.match(DUR_H);
  if (m) {
    let h = m[1].startsWith('mezz') ? 0.5 : numOf(m[1]) ?? 1;
    if (m[3]) h += m[3] === 'mezza' ? 0.5 : m[3] === 'un quarto' ? 0.25 : +m[3] / 60;
    return Math.round(h * 60);
  }
  m = t.match(DUR_M);
  if (m) return numOf(m[1]);
  return null;
}

// ---------------------------------------------------------------- giorni della settimana
const WD_RE = ['domenic', 'luned', 'marted', 'mercoled', 'gioved', 'venerd', 'sabat'];
const WD_FULL = /\b(domenic[ah]e?|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabat[oi])(?![a-zà-ù])/g;
const wdOf = (w) => WD_RE.findIndex((p) => strip(w).startsWith(strip(p)));

/** Giorni nominati: "dal lunedì al venerdì", "il weekend", "la domenica"… → [0..6] */
export function weekdaysIn(text) {
  const t = lower(text);
  const out = new Set();
  const r = t.match(/\bda[l]?\s+(domenica|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato)\s+(?:al|a)\s+(domenica|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato)(?![a-zà-ù])/);
  if (r) {
    let a = wdOf(r[1]); const b = wdOf(r[2]);
    for (let i = 0; i < 7; i++) { out.add(a); if (a === b) break; a = (a + 1) % 7; }
  }
  if (/\b(weekend|week-end|fine settimana|fine-settimana)\b/.test(t)) { out.add(6); out.add(0); }
  if (/\b(feriali|giorni lavorativi)\b/.test(t)) [1, 2, 3, 4, 5].forEach((d) => out.add(d));
  for (const m of t.matchAll(WD_FULL)) out.add(wdOf(m[1]));
  return [...out];
}

// ---------------------------------------------------------------- scadenze
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MONTH_RE = MONTHS.join('|');
const NUM_RE = '\\d+|un|una|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici';
const DUE_PATTERNS = [
  new RegExp(`\\b(?:tra|fra|entro|in)\\s+(?:(?:un|una|il|la)\\s+)?(${NUM_RE})?\\s*(giorn|settiman|mes)\\w*`, 'i'),
  new RegExp(`\\b(?:(?:entro|per|prima\\s+de(?:lla|l))\\s+)?(?:la\\s+|a\\s+)?fine\\s+(?:di\\s+|del\\s+mese\\s+di\\s+)?(${MONTH_RE})\\b`, 'i'),
  /\b(?:(?:entro|per)\s+)?(?:la\s+|a\s+)?fine\s+(?:del\s+|di\s+questo\s+)?mese\b/i,
  /\b(?:(?:entro|per)\s+)?(?:la\s+|a\s+)?fine\s+(?:dell'|d'|del\s+)?anno\b/i,
  /\b(?:entro|per|prima\s+di)\s+(natale|capodanno)\b/i,
  /\b(?:entro|per|prima\s+del)\s+(?:il\s+|del\s+)?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/i,
  new RegExp(`\\b(?:entro|per|prima\\s+del)\\s+(?:il\\s+)?(\\d{1,2})\\s+(${MONTH_RE})\\b`, 'i'),
  new RegExp(`\\b(?:entro|per)\\s+(${MONTH_RE})\\b`, 'i'),
  /\b(?:entro|per|prima\s+di)\s+(?:il\s+|la\s+)?(domenica|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato)(?![a-zà-ù])/i,
];

/** "entro fine novembre", "tra 6 settimane", "entro il 15/12", "per Natale"… → { due, match } */
export function parseDue(text, today) {
  const t = lower(text);
  const [y, mo, d] = today.split('-').map(Number);
  const iso = (Y, M, D) => dateKey(new Date(Y, M - 1, D));
  const last = (Y, M) => new Date(Y, M, 0).getDate();
  const ahead = (M, D) => (M < mo || (M === mo && D < d) ? y + 1 : y);
  const P = DUE_PATTERNS;
  let r;
  if ((r = t.match(P[0]))) {
    const n = r[1] ? numOf(r[1]) : 1;
    if (n) {
      if (r[2] === 'mes') { const dt = new Date(y, mo - 1 + n, d); return { due: dateKey(dt), match: r[0] }; }
      return { due: addDays(today, r[2] === 'giorn' ? n : n * 7), match: r[0] };
    }
  }
  if ((r = t.match(P[1]))) { const M = MONTHS.indexOf(r[1]) + 1; const Y = ahead(M, last(y, M)); return { due: iso(Y, M, last(Y, M)), match: r[0] }; }
  if ((r = t.match(P[2]))) return { due: iso(y, mo, last(y, mo)), match: r[0] };
  if ((r = t.match(P[3]))) return { due: iso(y, 12, 31), match: r[0] };
  if ((r = t.match(P[4]))) { const D = r[1] === 'natale' ? 25 : 31; return { due: iso(ahead(12, D), 12, D), match: r[0] }; }
  if ((r = t.match(P[5]))) {
    const D = +r[1], M = +r[2];
    if (M >= 1 && M <= 12 && D >= 1 && D <= 31) { const Y = r[3] ? (+r[3] < 100 ? 2000 + +r[3] : +r[3]) : ahead(M, D); return { due: iso(Y, M, D), match: r[0] }; }
  }
  if ((r = t.match(P[6]))) { const D = +r[1], M = MONTHS.indexOf(r[2]) + 1; return { due: iso(ahead(M, D), M, D), match: r[0] }; }
  if ((r = t.match(P[7]))) { const M = MONTHS.indexOf(r[1]) + 1; const Y = ahead(M, last(y, M)); return { due: iso(Y, M, last(Y, M)), match: r[0] }; }
  if ((r = t.match(P[8]))) { const w = wdOf(r[1]); const diff = ((w - weekday(today)) + 7) % 7 || 7; return { due: addDays(today, diff), match: r[0] }; }
  return null;
}

// ---------------------------------------------------------------- orari e giorni
const TIME_WORDS = /\b(?:oggi|domani|dopodomani|stasera|stanotte|stamattina|stamani|questa\s+sera|questa\s+mattina|questo\s+pomeriggio|nel\s+pomeriggio|di\s+pomeriggio|in\s+serata|in\s+mattinata|di\s+sera|di\s+mattina|la\s+sera|la\s+mattina|il\s+pomeriggio)\b/gi;
const AT_RE = /\b(?:alle|ore|dalle|verso\s+le|per\s+le)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:alle|-|–|fino\s+alle)\s*(\d{1,2})(?:[:.](\d{2}))?)?/i;
const UNTIL_RE = /\bfino\s+alle\s+(\d{1,2})(?:[:.](\d{2}))?/i;
const hm = (h, m) => `${String(+h).padStart(2, '0')}:${m || '00'}`;

function whenOf(text, today) {
  const t = lower(text);
  const date = /\bdopodomani\b/.test(t) ? addDays(today, 2) : /\bdomani\b/.test(t) ? addDays(today, 1)
    : /\b(oggi|stasera|stanotte|stamattina|stamani|questa sera|questa mattina|questo pomeriggio)\b/.test(t) ? today : null;
  const window = /\b(stasera|sera|serata|stanotte)\b/.test(t) ? 'sera' : /\b(mattin\w*|stamani)\b/.test(t) ? 'mattina' : /\bpomeriggio\b/.test(t) ? 'pomeriggio' : null;
  return { date, window };
}

// ---------------------------------------------------------------- progetti
const PREP = "(?:per|del|della|dello|dell'|sul|sulla|sullo|sull'|al|alla|allo|all'|nel|nella|nell'|di|d'|con|dal|dall'|dalla)";
const ART = "(?:il|la|lo|l'|i|gli|le|mio|mia|miei|mie|nuovo|nuova)";
const projectRe = (name) => new RegExp(`(^|\\s)(?:${PREP}\\s*)?(?:${ART}\\s*)*${esc(lower(name))}(?=$|[\\s,.;:!?])`, 'i');

/** Il progetto nominato nel testo, per nome o alias (maiuscole e articoli non contano). */
export function findProject(text, projects) {
  const t = lower(text);
  let best = null;
  for (const p of projects || []) {
    for (const n of [p.name, ...(p.aliases || [])]) {
      if (n && projectRe(n).test(' ' + t) && (!best || n.length > best.n.length)) best = { p, n };
    }
  }
  return best;
}

// categorie riconoscibili negli obiettivi (servono anche a scegliere il modello di piano)
export function goalCategory(text) {
  const t = strip(text);
  if (/\b(ep|singol[oi]|album|disco|mixtape|brani|tracce|canzon[ei]|uscita)\b/.test(t)) return 'music';
  if (/\b(portfolio|sito|showreel|book|mostra|libro|romanzo|video|cortometraggio|collezione|progetto creativo)\b/.test(t)) return 'creative';
  if (/\b(palestra|allenament\w*|correre|corsa|maratona|in forma|dimagrir\w*|chili|peso|nuoto|yoga|sport)\b/.test(t)) return 'fitness';
  if (/\b(esame|esami|studiar\w*|studio|tesi|certificazion\w*|corso|lingua|inglese|test)\b/.test(t)) return 'study';
  return 'generic';
}
const inferredProject = (text) => {
  const t = strip(text);
  const m = t.match(/\b(ep|singolo|album|mixtape|portfolio|tesi)\b/);
  if (!m) return null;
  return m[1] === 'ep' ? 'EP' : cap(m[1]);
};

// ---------------------------------------------------------------- titoli
const INTENT = /^(?:(?:e|poi|anche|ancora)\s+)*(?:devo|dovrei|voglio|vorrei|mi\s+tocca|bisogna|ho\s+da|c'[eè]\s+da|vado\s+a|andare\s+a|andare\s+in|vado\s+in|il\s+mio\s+obiettivo\s+[eè]|obiettivo:?)\s+/i;
const LEAD = /^(?:(?:sul|sulla|sullo|sull'|sui|sulle|al|alla|allo|all'|ai|alle|per|di|del|della|dello|dell'|dei|delle|il|la|lo|l'|i|gli|le|un|una|uno|un'|a|in|e)\s*)+/i;
const FILLER = /\b(?:mi\s+servono|mi\s+serve|ci\s+metto|ci\s+vogliono|ci\s+vuole|servono|serve|circa|più\s+o\s+meno|piu\s+o\s+meno|tipo|almeno|al\s+massimo|in\s+tutto|di\s+tempo|stimo|direi)\b/gi;

function cleanTitle(raw, projectName) {
  let s = ap(raw);
  s = s.replace(DUR_ANY, ' ').replace(TIME_WORDS, ' ').replace(new RegExp(AT_RE.source, 'gi'), ' ').replace(FILLER, ' ');
  s = tidy(s);
  if (projectName) {
    const without = tidy(s.replace(projectRe(projectName), ' '));
    if (without.split(' ').filter((w) => w.length > 1).length >= 2) s = without;
  }
  for (let i = 0; i < 3; i++) s = tidy(s.replace(INTENT, ''));
  s = tidy(s.replace(LEAD, ''));
  s = tidy(s.replace(/\s+(?:per|di|a|da|con|su|in|e|il|la|lo)$/i, ''));
  return cap(s).slice(0, 80);
}

/** È solo una durata o un modificatore ("mi servono 2 ore", "ci metto un'oretta")? */
const TIME_TEST = new RegExp(TIME_WORDS.source, 'i');
function isModifier(piece) {
  const rest = lower(piece).replace(DUR_ANY, ' ').replace(TIME_WORDS, ' ').replace(FILLER, ' ')
    .replace(/\b(?:e|per|ci|mi|metto|più|o|meno|così|cosi)\b/g, ' ').replace(/[^a-zà-ù0-9]/g, '');
  return rest.length < 2 && (parseDuration(piece) != null || TIME_TEST.test(piece));
}

// parole che non distinguono un'attività da un'altra
const STOP = new Set(['il', 'la', 'lo', 'i', 'gli', 'le', 'l', 'un', 'una', 'uno', 'di', 'del', 'della', 'dello', 'dell', 'per', 'con', 'su', 'sul', 'sulla', 'al', 'alla', 'a', 'e', 'in', 'da', 'finire', 'fare', 'chiudere', 'completare', 'continuare', 'lavorare', 'iniziare', 'cominciare', 'terminare', 'sessione']);
const tokens = (s) => strip(s).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));

/** Un'attività aperta che parla della stessa cosa ("beat 02" ↔ "Finire il beat 02"). */
export function findSimilarTask(title, items) {
  const tk = tokens(title);
  if (!tk.some((w) => !/^\d+$/.test(w))) return null;
  return (items || []).find((x) => x.kind === 'task' && x.status !== 'done' && !x.habitId && (() => {
    const xt = new Set(tokens(x.title));
    return tk.every((w) => xt.has(w));
  })()) || null;
}

// ---------------------------------------------------------------- frasi strutturate (vincoli, preferenze, abitudini)
const BASE = { id: null, title: null, kind: null, date: null, start_time: null, end_time: null, duration_min: null, duration_is_estimate: null, priority: null, deadline: null, earliest_date: null, window: null, energy: null, depends_on: null, actual_min: null, note: null, project: null, category: null, pref_key: null, pref_value: null, weekdays: null, unpin: null };
const op = (o) => ({ ...BASE, ...o });
const WD_NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const listDays = (ds) => { const n = ds.map((d) => WD_NAMES[d]); return n.length > 1 ? n.slice(0, -1).join(', ') + ' e ' + n.at(-1) : n[0]; };

const HABIT_RE = /\b(\d+|una|due|tre|quattro|cinque|sei|sette)\s+volt[ae]\s+(?:a|alla|per|ogni)\s+settimana\b|\b(ogni\s+giorno|tutti\s+i\s+giorni)\b/i;

/**
 * Vincoli, preferenze e abitudini dentro una frase → operazioni strutturate (o null).
 * ctx: { offDays, projects }
 */
export function structuredOps(sentence, ctx = {}) {
  const t = lower(sentence);
  const ops = [], said = [];
  let category = null;

  // abitudine con frequenza
  const hb = t.match(HABIT_RE);
  if (hb) {
    const per = hb[2] ? 7 : numOf(hb[1]);
    const proj = findProject(sentence, ctx.projects);
    let title = cleanTitle(sentence.replace(HABIT_RE, ' '), null) || 'Allenamento';
    if (proj && strip(title) === strip(proj.p.name)) title = cap(proj.p.name);
    const dur = parseDuration(sentence);
    ops.push(op({ action: 'add_habit', title, pref_value: String(per), duration_min: dur || 60, duration_is_estimate: !dur, project: proj?.p.name || null, window: whenOf(sentence).window }));
    said.push(`${title}: ${per === 7 ? 'ogni giorno' : `${per} volte a settimana`}, sparse nella settimana`);
    return { ops, said, category: 'obiettivo' };
  }

  const offWords = /(stacc\w*|non\s+lavor\w*|riposo|riposar\w*|niente\s+progetti|nessun\s+progetto|\boff\b|non\s+voglio\s+(?:lavorare|fare\s+niente)|mi\s+fermo|giorno\s+libero\s+dai\s+progetti)/;
  // orario di lavoro (impegno fisso ricorrente)
  const work = t.match(/\b(?:lavor\w*|ufficio|turno)\b[^.]*?(?:dalle\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|—|alle|a|fino\s+alle)\s*(\d{1,2})(?:[:.](\d{2}))?/);
  if (work && !/\bnon\s+lavor/.test(t)) {
    const all = weekdaysIn(sentence);
    const wds = all.length && !offWords.test(t) ? all.sort() : [1, 2, 3, 4, 5];
    ops.push(op({ action: 'add_recurring', title: 'Lavoro', start_time: hm(work[1], work[2]), end_time: hm(work[3], work[4]), weekdays: wds }));
    said.push(`lavoro ${hm(work[1], work[2])}–${hm(work[3], work[4])} ${wds.length === 5 && !wds.includes(0) && !wds.includes(6) ? 'dal lunedì al venerdì' : listDays(wds)}`);
    category = 'vincolo';
  }

  // giorni di stacco / giorni liberi
  const after = work ? t.slice(t.indexOf(work[0]) + work[0].length) : t;
  const days = weekdaysIn(after);
  if (days.length && offWords.test(after)) {
    const next = [...new Set([...(ctx.offDays || []), ...days])].sort();
    ctx.offDays = next;
    ops.push(op({ action: 'set_pref', pref_key: 'off_days', pref_value: next.join(',') }));
    said.push(`${listDays(days)} stacchi`);
    category ||= 'vincolo';
  } else if (days.length && /\b(sono\s+liber[oa]|ho\s+tempo|libero|libera)\b/.test(after)) {
    ctx.offDays = (ctx.offDays || []).filter((d) => !days.includes(d));
    ops.push(op({ action: 'set_pref', pref_key: 'free_days', pref_value: days.join(',') }));
    said.push(`${listDays(days)} hai la giornata libera per i progetti`);
    category ||= 'vincolo';
  }

  // fascia in cui rendi di più
  if (/(meglio|rendo|produco|concentr\w*|creativ\w*|più\s+lucid\w*|carico)/.test(t)) {
    const w = /\b(sera|serata|notte|stasera)\b/.test(t) ? 'sera' : /\bmattin\w*\b/.test(t) ? 'mattina' : /\bpomeriggio\b/.test(t) ? 'pomeriggio' : null;
    if (w) { ops.push(op({ action: 'set_pref', pref_key: 'focus_window', pref_value: w })); said.push(`il lavoro creativo va ${w === 'pomeriggio' ? 'il pomeriggio' : `la ${w}`}`); category ||= 'preferenza'; }
  }

  // sessione massima
  if (/(di\s+fila|consecutiv\w*|\bmax\b|massimo|non\s+più\s+di|non\s+piu\s+di|al\s+massimo)/.test(t)) {
    const d = parseDuration(sentence);
    if (d && d >= 20) { ops.push(op({ action: 'set_pref', pref_key: 'max_block_min', pref_value: String(d) })); said.push(`sessioni di al massimo ${d >= 60 && d % 60 === 0 ? d / 60 + ' h' : d + ' min'}`); category ||= 'preferenza'; }
  }

  // pausa tra le sessioni
  const pause = t.match(/\bpaus[ae]\s+(?:di\s+)?(\d+)\s*(?:min|minuti)/);
  if (pause) { ops.push(op({ action: 'set_pref', pref_key: 'buffer_min', pref_value: pause[1] })); said.push(`pause di ${pause[1]} minuti`); category ||= 'preferenza'; }

  return ops.length ? { ops, said, category } : null;
}

// ---------------------------------------------------------------- obiettivi
/** Una frase-obiettivo → set_goal + piano. force = siamo nella domanda "Obiettivi". */
export function goalOps(sentence, ctx, today, force = false) {
  const due = parseDue(sentence, today);
  const horizon = due ? daysBetween(today, due.due) : null;
  const intent = /^(?:voglio|vorrei|il\s+mio\s+obiettivo|obiettivo|devo\s+riuscire)/i.test(ap(sentence).trim());
  const cat = goalCategory(sentence);
  if (!force && !(horizon != null && horizon >= 14) && !(intent && cat !== 'generic')) return null;
  let title = ap(sentence);
  if (due) title = title.replace(new RegExp(esc(due.match), 'i'), ' ');
  title = tidy(title);
  for (let i = 0; i < 2; i++) title = tidy(title.replace(INTENT, ''));
  title = cap(title).slice(0, 120);
  if (!title) return null;
  const ops = [];
  const named = findProject(sentence, ctx.projects);
  let project = named?.p.name || null;
  if (!project) {
    project = inferredProject(sentence);
    if (project) { ops.push(op({ action: 'add_project', title: project })); (ctx.projects ||= []).push({ name: project }); }
  }
  ops.push(op({ action: 'set_goal', title, deadline: due?.due || null, note: ap(sentence).trim(), project }));
  ops.push(op({ action: 'plan_goal', title }));
  return { ops, title, due: due?.due || null, project };
}

// ---------------------------------------------------------------- attività e impegni
function taskOps(sentence, state, today, nowMin, ctx) {
  const pieces = ap(sentence).split(/\s*,\s*|\s+e\s+poi\s+|\s+poi\s+/i).map((x) => x.trim()).filter(Boolean);
  // le clausole che sono solo una durata o un "quando" si attaccano all'attività principale
  const groups = [];
  for (const p of pieces) {
    if (isModifier(p) && groups.length) groups.at(-1).push(p);
    else if (isModifier(p)) groups.push([p]);
    else if (groups.length === 1 && groups[0].every(isModifier)) groups[0].push(p);
    else groups.push([p]);
  }
  const ops = [], said = [];
  for (const g of groups) {
    const main = g.find((p) => !isModifier(p)) || g[0];
    const all = g.join(' ');
    const pl = lower(all);
    const { date, window } = whenOf(sentence, today);
    const tm = pl.match(AT_RE);
    const until = pl.match(UNTIL_RE);
    const dur = parseDuration(all);
    const named = findProject(all, ctx.projects) || findProject(sentence, ctx.projects);
    const deadline = parseDue(all, today);
    const title = cleanTitle(deadline ? main.replace(new RegExp(esc(deadline.match), 'i'), ' ') : main, named?.n);
    if (!title || title.length < 2) continue;
    const prio = /assolutamente|important|urgente/.test(pl) ? 3 : null;

    if (until && !tm?.[3]) {
      const s = date && date !== today ? state.prefs.dayStart : Math.max(state.prefs.dayStart, nowMin);
      ops.push(op({ action: 'add', kind: 'event', title, date: date || today, start_time: fmtMin(s), end_time: hm(until[1], until[2]) }));
      said.push(`${title} fino alle ${hm(until[1], until[2])}`);
      continue;
    }
    if (tm) {
      const st = hm(tm[1], tm[2]);
      const en = tm[3] ? hm(tm[3], tm[4]) : null;
      ops.push(op({ action: 'add', kind: 'event', title, date: date || today, start_time: st, end_time: en, duration_min: en ? null : dur || 60, project: named?.p.name || null }));
      said.push(`${title} ${dayLabel(date || today, today)} alle ${st}`);
      continue;
    }
    // stessa attività già aperta: si aggiorna, niente doppioni
    const same = findSimilarTask(title, state.items);
    if (same) {
      const upd = op({ action: 'update', id: same.id, duration_min: dur, duration_is_estimate: dur ? false : null, date, window, priority: prio, project: !same.project && named ? named.p.name : null });
      if (dur || date || window || prio || upd.project) {
        ops.push(upd);
        said.push(`aggiornata «${same.title}»${dur ? ` · ${dur >= 60 && dur % 60 === 0 ? dur / 60 + ' h' : dur + ' min'}` : ''}${date ? ' · ' + dayLabel(date, today) : ''}${window && !date ? ' · ' + window : ''}`);
      } else said.push(`«${same.title}» c'è già`);
      continue;
    }
    ops.push(op({ action: 'add', kind: 'task', title, date, duration_min: dur || null, duration_is_estimate: !dur, priority: prio || 2, window,
      deadline: deadline?.due || null, project: named?.p.name || null, energy: named ? 3 : null }));
    said.push(title);
  }
  return { ops, said };
}

// ---------------------------------------------------------------- comandi
function commandOps(text, state, today, now) {
  const low = lower(text).trim().replace(/[.!]+$/, '');
  const find = (frag) => {
    const f = strip(frag).replace(/^(il|la|lo|l'|i|gli|le)\s*/, '').trim();
    const open = state.items.filter((x) => x.status !== 'done');
    return open.find((x) => strip(x.title) === f) || open.find((x) => strip(x.title).includes(f)) || findSimilarTask(frag, open) || open.find((x) => f.includes(strip(x.title)));
  };
  const nf = { reply: 'Non trovo quell\'attività.' };
  let m;
  if ((m = low.match(/^(?:ho\s+fatto|ho\s+lavorato|ho\s+passato)\s+(.+?)\s+(?:di|del|della|dello|dell'|sul|sulla|sull'|al|alla|all'|a|su)\s*(.+)$/)) && parseDuration(m[1])) {
    const it = find(m[2]);
    const d = parseDuration(m[1]);
    return it ? { ops: [op({ action: 'progress', id: it.id, actual_min: d })], reply: `Segnati ${d} minuti su «${it.title}». Il resto lo rimetto in programma.` } : nf;
  }
  if ((m = low.match(/^(?:ho\s+finito|fatto|finito|completat[oa])\s+(.+)/))) {
    const it = find(m[1]);
    return it ? { ops: [op({ action: 'complete', id: it.id })], reply: `Segnato «${it.title}» come fatto.` } : nf;
  }
  if ((m = low.match(/^(?:inizio|sto\s+iniziando|comincio)\s+(.+)/))) {
    const it = find(m[1]);
    return it ? { ops: [op({ action: 'start', id: it.id })], reply: `Via con «${it.title}».` } : nf;
  }
  if ((m = low.match(/^(?:togli|elimina|cancella|rimuovi)\s+(.+)/))) {
    const it = find(m[1]);
    return it ? { ops: [op({ action: 'delete', id: it.id })], reply: `Tolta «${it.title}».`, confirm: it.kind === 'event' } : nf;
  }
  if ((m = low.match(/^sposta\s+(.+?)\s+(?:a|ad|per)\s+(domani|dopodomani|oggi)/))) {
    const it = find(m[1]);
    const d = m[2] === 'oggi' ? today : m[2] === 'domani' ? addDays(today, 1) : addDays(today, 2);
    return it ? { ops: [op({ action: 'move', id: it.id, date: d })], reply: `Spostata «${it.title}» a ${dayLabel(d, today)}.` } : nf;
  }
  if ((m = low.match(/(?:sono\s+)?in\s+ritardo\s+di\s+(.+)/))) {
    const dur = parseDuration(m[1]) || 30;
    const dt = new Date(now);
    return { ops: [op({ action: 'add', kind: 'event', title: 'Ritardo', date: today, start_time: fmtMin(dt.getHours() * 60 + dt.getMinutes()), duration_min: dur })], reply: `Ok, ho spostato in avanti di ${dur} minuti quello che restava.` };
  }
  return null;
}

// ---------------------------------------------------------------- ingresso
const sentencesOf = (text) => ap(text).split(/\.(?!\d)|[;\n!?]+/).map((x) => x.trim()).filter(Boolean);
const memoryOp = (note, category) => op({ action: 'remember', note: tidy(note), category });

/**
 * Modalità base: una frase scritta nella barra → { ops?, reply, confirm? }.
 */
export function localParse(text, state, now) {
  const today = dateKey(new Date(now));
  const d = new Date(now);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const cmd = commandOps(text, state, today, now);
  if (cmd) return cmd;

  const ctx = { projects: [...(state.projects || [])], offDays: [...(state.prefs?.offDays || [])] };
  const ops = [], said = [];
  let confirm = false, goalsMade = 0;
  for (const s of sentencesOf(text)) {
    const st = structuredOps(s, ctx);
    if (st) { ops.push(...st.ops, memoryOp(s, st.category)); said.push(...st.said); continue; }
    // un modo di essere, non una cosa da fare: lo ricordo
    if (/^(?:non\s+voglio|non\s+mi\s+piace|preferisco|preferirei|mi\s+piace|odio|evito|cerco\s+di|di\s+solito|sono\s+una?\s+person)/i.test(s.trim())) {
      ops.push(memoryOp(s, 'preferenza')); said.push(`me lo ricordo: ${lower(s.trim()).replace(/[.]$/, '')}`); continue;
    }
    const g = goalOps(s, ctx, today);
    if (g) { ops.push(...g.ops); said.push(`obiettivo «${g.title}»${g.due ? ' entro ' + dayLabel(g.due, today) : ''}`); goalsMade++; continue; }
    const tk = taskOps(s, state, today, nowMin, ctx);
    ops.push(...tk.ops); said.push(...tk.said);
  }
  if (goalsMade) confirm = true;
  if (!ops.length) {
    return { reply: said.length ? cap(said.join(', ')) + '.' : 'Senza AI capisco frasi semplici: «Domani alle 16 call», «Stasera 2 ore sul beat 02», «Ho fatto 30 minuti del beat», «La domenica stacco». Per il resto scegli un\'AI gratuita in ⋯ → Assistente AI.' };
  }
  const reply = goalsMade ? `Ho preparato un piano per ${said.filter((x) => x.startsWith('obiettivo')).join(' e ')}. Guarda le sessioni e conferma.`
    : cap(said.join(' · ')) + '.';
  return { ops, reply, confirm };
}

/**
 * Le quattro risposte della presentazione → operazioni.
 * answers: { goals, constraints, projects, prefs }
 */
export function contextOps(answers, today, offDays = []) {
  const ops = [];
  const ctx = { projects: [], offDays: [...offDays] };
  const projects = ap(answers.projects || '').split(/[,\n;]|\s+e\s+/).map((x) => tidy(x)).filter((x) => x && x.length < 40);
  for (const p of projects) { ops.push(op({ action: 'add_project', title: p })); ctx.projects.push({ name: p }); }
  for (const key of ['constraints', 'prefs']) {
    for (const s of sentencesOf(answers[key])) {
      const st = structuredOps(s, ctx);
      if (st) ops.push(...st.ops);
      ops.push(memoryOp(s, st?.category || (key === 'constraints' ? 'vincolo' : 'preferenza')));
    }
  }
  for (const s of sentencesOf(answers.goals)) {
    const st = structuredOps(s, ctx);
    if (st && st.ops.some((o) => o.action === 'add_habit')) { ops.push(...st.ops); continue; }
    const g = goalOps(s, ctx, today, true);
    if (g) ops.push(...g.ops);
  }
  return ops;
}

/** Una nota di memoria che si può strutturare → le operazioni equivalenti (per la migrazione). */
export function structureMemory(text, ctx) {
  const st = structuredOps(text, ctx);
  return st ? st.ops.filter((o) => o.action === 'set_pref') : [];
}
