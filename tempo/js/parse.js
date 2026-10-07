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
  // «entro il 15»: il giorno del mese (questo, o il prossimo se è già passato)
  if ((r = t.match(/\b(?:entro|per|prima\s+del)\s+(?:il\s+)?(\d{1,2})(?!\s*(?:[:./]\d|ore\b|min|h\b|giorn|settiman|mes))/))) {
    const D = +r[1];
    if (D >= 1 && D <= 31) return { due: dateKey(D >= d ? new Date(y, mo - 1, D) : new Date(y, mo, D)), match: r[0] };
  }
  // «questa settimana», «entro la settimana», «entro fine settimana» → domenica; «la settimana prossima» → la domenica dopo
  if ((r = t.match(/\b(?:entro\s+(?:la\s+)?(?:fine\s+)?|per\s+|in\s+)?(?:questa|la)\s+settimana(?!\s+prossima)\b|\bentro\s+fine\s+settimana\b/))) return { due: addDays(today, (7 - weekday(today)) % 7), match: r[0] };
  if ((r = t.match(/\b(?:entro\s+)?(?:la\s+)?(?:settimana\s+prossima|prossima\s+settimana)\b/))) return { due: addDays(today, (7 - weekday(today)) % 7 + 7), match: r[0] };
  return null;
}

// ---------------------------------------------------------------- orari e giorni
const TIME_WORDS = /\b(?:oggi|domani|dopodomani|stasera|stanotte|stamattina|stamani|questa\s+sera|questa\s+mattina|questo\s+pomeriggio|nel\s+pomeriggio|di\s+pomeriggio|in\s+serata|in\s+mattinata|di\s+sera|di\s+mattina|la\s+sera|la\s+mattina|il\s+pomeriggio|in\s+giornata|dopo\s+cena|dopo\s+pranzo|prima\s+di\s+cena|prima\s+di\s+pranzo|(?:la\s+)?mattina\s+presto|presto|tardi|a\s+mezzogiorno|mezzogiorno|a\s+mezzanotte|mezzanotte|tutto\s+il\s+giorno|tutta\s+la\s+giornata|pomeriggio|sera|serata|mattina|mattino|notte)\b/gi;
const AT_RE = /\b(?:alle|ore|dalle|verso\s+le|per\s+le|all')\s*(\d{1,2}|una)(?:[:.](\d{2}))?(?:\s*(?:alle|-|–|fino\s+alle)\s*(\d{1,2})(?:[:.](\d{2}))?)?/i;
const UNTIL_RE = /\bfino\s+alle\s+(\d{1,2})(?:[:.](\d{2}))?/i;
const hm = (h, m) => `${String(+h).padStart(2, '0')}:${m || '00'}`;

/** La fascia della giornata nominata ("stasera", "dopo cena", "la mattina"…). */
function windowOf(text) {
  const t = lower(text);
  return /\b(stasera|sera|serata|stanotte|notte|dopo\s+cena)\b/.test(t) ? 'sera' : /\b(mattin\w*|stamani)\b/.test(t) ? 'mattina' : /\b(pomeriggio|dopo\s+pranzo)\b/.test(t) ? 'pomeriggio' : null;
}

// i giorni della settimana: «il martedì», «ogni martedì» = tutte le settimane; «martedì» = il prossimo
const WD_WORD = '(?:domenic[ah]e?|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabat[oi])';
const REC_RE = new RegExp(`(?:^|\\s)(?:ogni|tutti\\s+i|tutte\\s+le|il|i|la|le)\\s+${WD_WORD}(?![a-zà-ù])`, 'i');
const isRecurring = (text) => REC_RE.test(lower(text));
const WD_ONE = new RegExp(`(?:^|\\s)(${WD_WORD})(?![a-zà-ù])(\\s+prossim[oa])?`, 'i');
const DATE_WORDS = new RegExp([
  `(?:\\b(?:ogni|tutti\\s+i|tutte\\s+le|il|i|la|le|di|del|della|questo|questa|per|entro|da|dal|al|a)\\s+)?${WD_WORD}(?![a-zà-ù])(?:\\s+(?:prossim[oa]|e|,)(?![a-zà-ù]))*`,
  `\\b(?:il\\s+|l'|del\\s+|per\\s+il\\s+)?\\d{1,2}\\s+(?:${'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre'})\\b`,
  '\\b(?:il\\s+|del\\s+)?\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b',
  '\\b(?:tra|fra)\\s+(?:\\d+|un|una|due|tre|quattro|cinque|sei)?\\s*(?:giorn|settiman|mes)\\w*',
  '\\b(?:questa|la\\s+prossima|la)\\s+settimana(?:\\s+prossima)?\\b',
  '\\bsettimana\\s+prossima\\b',
].join('|'), 'gi');

/** Il giorno nominato in una frase → { date, match } (non i giorni ricorrenti). */
export function dateOf(text, today) {
  const t = lower(text);
  const [y, mo, d] = today.split('-').map(Number);
  const iso = (Y, M, D) => dateKey(new Date(Y, M - 1, D));
  const ahead = (M, D) => (M < mo || (M === mo && D < d) ? y + 1 : y);
  if (/\bdopodomani\b/.test(t)) return { date: addDays(today, 2), match: 'dopodomani' };
  if (/\bdomani\b/.test(t)) return { date: addDays(today, 1), match: 'domani' };
  if (/\b(oggi|stasera|stanotte|stamattina|stamani|questa\s+sera|questa\s+mattina|questo\s+pomeriggio)\b/.test(t)) return { date: today, match: '' };
  let r = t.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_RE})\\b`));
  if (r) { const D = +r[1], M = MONTHS.indexOf(r[2]) + 1; if (D >= 1 && D <= 31) return { date: iso(ahead(M, D), M, D), match: r[0] }; }
  r = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (r) { const D = +r[1], M = +r[2]; if (M >= 1 && M <= 12 && D >= 1 && D <= 31) return { date: iso(r[3] ? (+r[3] < 100 ? 2000 + +r[3] : +r[3]) : ahead(M, D), M, D), match: r[0] }; }
  if (!isRecurring(t)) {
    r = t.match(WD_ONE);
    if (r) {
      const w = wdOf(r[1]);
      let diff = ((w - weekday(today)) + 7) % 7;
      if (r[2] && diff === 0) diff = 7;
      if (/\bsettimana\s+prossima|prossima\s+settimana\b/.test(t) && diff + weekday(today) <= 7) diff += 7;
      return { date: addDays(today, diff), match: r[0].trim() };
    }
  }
  r = t.match(/\b(?:il|per\s+il|entro\s+il|del)\s+(\d{1,2})(?!\s*(?:[:./,]\d|ore\b|or[ae]\b|min|h\b|volt|session|pagin|capitol|euro|%))/);
  if (r && +r[1] >= 1 && +r[1] <= 31) {
    const D = +r[1];
    const dt = D >= d ? new Date(y, mo - 1, D) : new Date(y, mo, D);
    return { date: dateKey(dt), match: r[0] };
  }
  r = t.match(/\b(?:tra|fra)\s+(?:(\d+|un|una|due|tre|quattro|cinque|sei)\s+)?(giorn|settiman|mes)\w*/);
  if (r) {
    const n = r[1] ? numOf(r[1]) : 1;
    if (r[2] === 'mes') return { date: dateKey(new Date(y, mo - 1 + n, d)), match: r[0] };
    return { date: addDays(today, r[2] === 'giorn' ? n : n * 7), match: r[0] };
  }
  return null;
}

/** L'orario di una frase: «alle 15:30», «dalle 9 alle 18», «a mezzogiorno», «stasera alle 9» → { start, end } */
function timeOf(text) {
  const t = lower(text);
  if (/\b(?:a\s+|verso\s+)?mezzogiorno\b/.test(t) && !AT_RE.test(t)) return { start: '12:00', end: null };
  const m = t.match(AT_RE);
  if (!m) return null;
  let h = m[1] === 'una' ? 13 : +m[1];
  const evening = /\b(stasera|sera|serata|di\s+sera|notte|dopo\s+cena)\b/.test(t), afternoon = /\b(pomeriggio|dopo\s+pranzo)\b/.test(t);
  if (h >= 1 && h < 12 && (evening || (afternoon && h <= 7) || h <= 6) && !/\b(mattin\w*|stamani)\b/.test(t)) h += 12;
  if (h > 24) return null;
  let end = null;
  if (m[3]) {
    let e = +m[3];
    if (e < h && e + 12 > h && e + 12 <= 24) e += 12;
    if (e <= 24) end = hm(e === 24 ? 23 : e, e === 24 ? '59' : m[4]);
  }
  return { start: hm(h, m[2]), end };
}

function whenOf(text, today) {
  const d = dateOf(text, today);
  return { date: d?.date || null, window: windowOf(text) };
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
const INTENT = /^(?:(?:e|poi|anche|ancora|inoltre|quindi|però|pero)\s+)*(?:devo|dovrei|voglio|vorrei|mi\s+tocca|bisogna|ho\s+da|c'[eè]\s+da|c'[eè]|ci\s+sono|ho(?!\s+(?:fatto|finito|lavorato|passato|iniziato))|sono(?=\s+(?:in|a|al|alla|dal|dalla|da)\s)|vado\s+a|vado\s+al|vado\s+in|devo\s+andare\s+a|andare\s+a|andare\s+in|aggiungi(?:mi)?|aggiungere|metti(?:mi)?|segna(?:mi)?|ricordami\s+di|ricordati\s+di|ricorda(?:mi)?\s+di|promemoria:?|il\s+mio\s+obiettivo\s+[eè]|obiettivo:?)\s+/i;
const LEAD = /^(?:(?:sul|sulla|sullo|sui|sulle|al|alla|allo|ai|alle|per|di|del|della|dello|dei|delle|il|la|lo|i|gli|le|un|una|uno|a|in|e|da|dal|dalla|dai)\s+|(?:sull'|all'|dell'|dall'|l'|un')\s*)+/i;
// parole di conversazione all'inizio («allora», «ah», «ok»…)
const CHAT = /^(?:allora|ah|ahh|oh|ok|okay|ecco|beh|be'|insomma|dunque|comunque|cioè|cioe|tipo|senti|ciao|ehi|hey|poi|e)\b[\s,]*/i;
// frasi che commentano e basta: niente da mettere in programma
const COMMENT = /^(?:(?:allora|ah|beh|insomma|ok)\s+)?(?:questa\s+settimana\s+|oggi\s+|domani\s+)?(?:è|sarà|e')\s+(?:un\s+casino|pesante|dura|piena|un\s+delirio|tosta|intensa|tranquilla)\b|^(?:che\s+(?:settimana|giornata|casino))|^(?:sono|sarò)\s+(?:pien[oa]|incasinat[oa]|sommers[oa])\b/i;
const FILLER = /\b(?:mi\s+servono|mi\s+serve|ci\s+metto|ci\s+vogliono|ci\s+vuole|servono|serve|circa|più\s+o\s+meno|piu\s+o\s+meno|tipo|almeno|al\s+massimo|in\s+tutto|in\s+totale|di\s+tempo|stimo|direi|ancora|mi\s+mancano|mi\s+manca|mancano|manca)\b/gi;

function cleanTitle(raw, projectName) {
  let s = ap(raw);
  s = s.replace(DUR_ANY, ' ').replace(TIME_WORDS, ' ').replace(new RegExp(AT_RE.source, 'gi'), ' ').replace(FILLER, ' ').replace(DATE_WORDS, ' ');
  s = tidy(s);
  if (projectName) {
    const without = tidy(s.replace(projectRe(projectName), ' '));
    if (without.split(' ').filter((w) => w.length > 1).length >= 2) s = without;
  }
  for (let i = 0; i < 3; i++) { s = tidy(s.replace(CHAT, '')); s = tidy(s.replace(INTENT, '')); s = tidy(s.replace(LEAD, '')); }
  for (let i = 0; i < 2; i++) s = tidy(s.replace(/\s+(?:per|di|a|da|con|su|in|e|il|la|lo|è|e'|sono|ho|alle|dalle|verso)$/i, ''));
  return cap(s).slice(0, 80);
}

/** È solo una durata o un modificatore ("mi servono 2 ore", "ci metto un'oretta")? */
const TIME_TEST = new RegExp(TIME_WORDS.source, 'i');
const DATE_TEST = new RegExp(DATE_WORDS.source, 'i');
function isModifier(piece) {
  if (/^(?:sono|saranno|in\s+tutto|in\s+totale)\s+\d+\s+[a-zà-ù]+$/i.test(ap(piece).trim())) return true;
  const rest = lower(piece).replace(DUR_ANY, ' ').replace(TIME_WORDS, ' ').replace(FILLER, ' ')
    .replace(/\b(?:e|per|ci|mi|metto|più|o|meno|così|cosi)\b/g, ' ').replace(/[^a-zà-ù0-9]/g, '');
  return rest.length < 2 && (parseDuration(piece) != null || TIME_TEST.test(piece));
}
/** È solo un giorno ("il martedì", "domani")? Si attacca alla frase che segue. */
function isOnlyDay(piece) {
  const rest = lower(piece).replace(DATE_WORDS, ' ').replace(TIME_WORDS, ' ').replace(/\b(?:e|ogni|il|la|i|le|tutti|tutte)\b/g, ' ').replace(/[^a-zà-ù0-9]/g, '');
  return rest.length < 2 && (DATE_TEST.test(piece) || TIME_TEST.test(piece));
}

// parole che non distinguono un'attività da un'altra
const STOP = new Set(['il', 'la', 'lo', 'i', 'gli', 'le', 'l', 'un', 'una', 'uno', 'di', 'del', 'della', 'dello', 'dell', 'per', 'con', 'su', 'sul', 'sulla', 'al', 'alla', 'a', 'e', 'in', 'da', 'finire', 'fare', 'chiudere', 'completare', 'continuare', 'lavorare', 'iniziare', 'cominciare', 'terminare', 'sessione',
  'consegnare', 'preparare', 'faccio', 'scrivere', 'mandare', 'inviare', 'rivedere', 'sistemare', 'andare', 'fatto', 'mio', 'mia']);
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

/**
 * Divide una frase nelle cose diverse che dice: «ho finito la spesa, sposta il beat a domani e aggiungi la lavatrice».
 * Le parti che sono solo una durata o solo un giorno si attaccano a quella vicina.
 */
const NEXT = `(?:(?:poi|anche|inoltre|dopo\\s+di\\s+che)\\s+)*(?:devo|dovrei|voglio|vorrei|ho\\b|c'[eè]|vado|andare|aggiungi|metti|segna|sposta|togli|elimina|cancella|ricordami|ricorda|dopo|prima\\s+di|alle|dalle|domani|dopodomani|oggi|stasera|stamattina|stanotte|la\\s+sera|la\\s+mattina|il\\s+pomeriggio|nel\\s+pomeriggio|in\\s+serata|ogni|il\\s+\\d|${WD_WORD}|(?:il|la|i|le)\\s+${WD_WORD}|mi\\s+svegli|vado\\s+a\\s+(?:dormire|letto)|non\\s+posso|sono\\b|esco|[a-zà-ù]{3,}(?:are|ere|ire)\\b)`;
const SPLIT = new RegExp(`\\s*,\\s*|(?<!\\d)\\s*:\\s*|\\s*:(?!\\d)\\s*|\\s+(?:quindi|allora|così|cosi)\\s+|\\s+(?:e\\s+poi|poi|e|ed)\\s+(?=${NEXT})`, 'i');
function clausesOf(sentence) {
  const raw = ap(sentence).split(SPLIT).map((x) => tidy(x)).filter(Boolean);
  const out = [];
  let pendingDay = '';
  for (const p of raw) {
    if (isModifier(p) && out.length && !isOnlyDay(p)) { out[out.length - 1] += ', ' + p; continue; }
    if (isOnlyDay(p)) { pendingDay += p + ' '; continue; }
    out.push(pendingDay + p);
    pendingDay = '';
  }
  if (pendingDay) { if (out.length) out[out.length - 1] += ' ' + pendingDay.trim(); else out.push(pendingDay.trim()); }
  return out;
}

// ---------------------------------------------------------------- frasi strutturate (vincoli, preferenze, abitudini)
const BASE = { id: null, title: null, kind: null, date: null, start_time: null, end_time: null, duration_min: null, duration_is_estimate: null, priority: null, deadline: null, earliest_date: null, window: null, energy: null, depends_on: null, actual_min: null, note: null, project: null, category: null, pref_key: null, pref_value: null, weekdays: null, unpin: null };
const op = (o) => ({ ...BASE, ...o });
const WD_NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const listDays = (ds) => { const n = ds.map((d) => WD_NAMES[d]); return n.length > 1 ? n.slice(0, -1).join(', ') + ' e ' + n.at(-1) : n[0]; };

const HABIT_RE = /\b(\d+|una|due|tre|quattro|cinque|sei|sette)\s+volt[ae]\s+(?:a|alla|per|ogni)\s+settimana\b|\b(ogni\s+giorno|tutti\s+i\s+giorni|al\s+giorno|ogni\s+(?:sera|mattina|pomeriggio)|tutte\s+le\s+(?:sere|mattine))\b/i;
const niceDate = (d, today) => dayLabel(d, today);

/**
 * Vincoli, preferenze e abitudini dentro una frase → operazioni strutturate (o null).
 * ctx: { offDays, projects, today, prefs }
 */
export function structuredOps(sentence, ctx = {}) {
  const t = lower(sentence);
  const ops = [], said = [];
  let category = null;
  const today = ctx.today || null;

  // abitudine con frequenza («3 volte a settimana», «ogni lunedì, mercoledì e venerdì» senza orario)
  const hb = t.match(HABIT_RE);
  const recDays = isRecurring(t) ? weekdaysIn(sentence) : [];
  const tm0 = timeOf(sentence);
  const isWork = /\b(?:lavor\w*|ufficio|turno)\b/.test(t) && !/\bnon\s+lavor/.test(t);
  if (hb || (recDays.length >= 2 && !tm0 && /\bogni\b/.test(t) && !isWork)) {
    const per = hb ? (hb[2] ? 7 : numOf(hb[1])) : recDays.length;
    const proj = findProject(sentence, ctx.projects);
    let title = cleanTitle(sentence.replace(HABIT_RE, ' '), null) || 'Allenamento';
    if (proj && strip(title) === strip(proj.p.name)) title = cap(proj.p.name);
    const dur = parseDuration(sentence);
    ops.push(op({ action: 'add_habit', title, pref_value: String(per), duration_min: dur || 60, duration_is_estimate: !dur, project: proj?.p.name || null, window: windowOf(sentence) }));
    said.push(`${title}: ${per === 7 ? 'ogni giorno' : `${per} volte a settimana`}, sparse nella settimana`);
    return { ops, said, category: 'obiettivo' };
  }

  // impegno fisso ogni settimana con orario («il martedì sera corso di inglese dalle 20 alle 21:30»)
  if (recDays.length && tm0 && !isWork) {
    const title = cleanTitle(sentence, null);
    if (title) {
      const st = parseHMs(tm0.start);
      const end = tm0.end || fmtMin(Math.min(24 * 60 - 1, st + (parseDuration(sentence) || 60)));
      const days = recDays.sort();
      ops.push(op({ action: 'add_recurring', title, start_time: tm0.start, end_time: end, weekdays: days }));
      said.push(`${title} ${listDays(days.map(Number))} ${tm0.start}–${end}, ogni settimana`);
      return { ops, said, category: 'vincolo' };
    }
  }

  // orari della giornata: «mi sveglio alle 7», «vado a dormire a mezzanotte», «non posso lavorare dopo le 22»
  const wake = t.match(/\bmi\s+svegli\w*\s+(?:alle\s+|verso\s+le\s+)?(\d{1,2})(?:[:.](\d{2}))?/);
  if (wake) { const v = hm(+wake[1] === 24 ? 0 : wake[1], wake[2]); ops.push(op({ action: 'set_pref', pref_key: 'day_start', pref_value: v })); said.push(`la giornata inizia alle ${v}`); category = 'vincolo'; }
  const sleep = t.match(/\b(?:vado\s+a\s+(?:dormire|letto)|a\s+letto|dormo|mi\s+corico)\s+(?:alle\s+|verso\s+le\s+|a\s+|verso\s+)?(mezzanotte|\d{1,2})(?:[:.](\d{2}))?/)
    || t.match(/\bnon\s+(?:posso|voglio|riesco\s+a)\s+(?:lavorare|fare\s+(?:niente|nulla|cose))\s+dopo\s+(?:le\s+)?(mezzanotte|\d{1,2})(?:[:.](\d{2}))?/);
  if (sleep) {
    let h = sleep[1] === 'mezzanotte' ? 24 : +sleep[1];
    if (h >= 1 && h <= 6) h += 12; // «alle 11» la sera
    if (h < 12 && h !== 0) h += 12;
    const v = h >= 24 ? '24:00' : hm(h, sleep[2]);
    ops.push(op({ action: 'set_pref', pref_key: 'day_end', pref_value: v === '24:00' ? '23:59' : v })); said.push(`niente attività dopo ${v === '24:00' ? 'mezzanotte' : 'le ' + v}`); category ||= 'vincolo';
  }
  if (wake || sleep) return { ops, said, category };

  // disponibilità di un giorno: «oggi sono libero solo dalle 15 alle 19», «domani ho tempo fino alle 18»
  if (/\b(liber[oaie]|disponibil\w*|ho\s+tempo|posso)\b/.test(t) && (tm0 || UNTIL_RE.test(t)) && !isRecurring(t)) {
    const d = (today && dateOf(sentence, today)?.date) || today;
    const until = t.match(UNTIL_RE);
    const from = /\bdalle\b/.test(t) && tm0 ? tm0.start : null;
    const to = tm0?.end || (until ? hm(until[1], until[2]) : null);
    if (d && (from || to)) {
      ops.push(op({ action: 'set_availability', date: d, start_time: from, end_time: to }));
      said.push(`${niceDate(d, today)} sei libero${from ? ' dalle ' + from : ''}${to ? ' alle ' + to : ''}: il resto non lo uso`);
      return { ops, said, category: 'vincolo' };
    }
  }

  const offWords = /(stacc\w*|non\s+lavor\w*|riposo|riposar\w*|niente\s+progetti|nessun\s+progetto|\boff\b|non\s+voglio\s+(?:lavorare|fare\s+niente)|mi\s+fermo|giorno\s+libero\s+dai\s+progetti)/;
  // orario di lavoro (impegno fisso ricorrente)
  const work = t.match(/\b(?:lavor\w*|ufficio|turno)\b[^.]*?(?:dalle\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|—|alle|a|fino\s+alle)\s*(\d{1,2})(?:[:.](\d{2}))?/);
  if (work && !/\bnon\s+lavor/.test(t)) {
    const all = weekdaysIn(sentence);
    const wds = all.length && !offWords.test(t) ? all.sort() : [1, 2, 3, 4, 5];
    const wEnd = +work[3] * 60 + +(work[4] || 0) <= +work[1] * 60 + +(work[2] || 0) ? '23:59' : hm(work[3], work[4]);
    ops.push(op({ action: 'add_recurring', title: 'Lavoro', start_time: hm(work[1], work[2]), end_time: wEnd, weekdays: wds }));
    said.push(`lavoro ${hm(work[1], work[2])}–${wEnd} ${wds.length === 5 && !wds.includes(0) && !wds.includes(6) ? 'dal lunedì al venerdì' : listDays(wds)}`);
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
const parseHMs = (v) => { const [h, m] = String(v).split(':').map(Number); return h * 60 + (m || 0); };

// ---------------------------------------------------------------- obiettivi
/** Una frase-obiettivo → set_goal + piano. force = siamo nella domanda "Obiettivi". */
export function goalOps(sentence, ctx, today, force = false) {
  const due = parseDue(sentence, today);
  const horizon = due ? daysBetween(today, due.due) : null;
  const intent = /^(?:voglio|vorrei|il\s+mio\s+obiettivo|obiettivo|devo\s+riuscire)/i.test(ap(sentence).trim());
  const cat = goalCategory(sentence);
  // un obiettivo è qualcosa di grande (un EP, un esame, un portfolio): una cosa da fare con una scadenza resta un'attività
  const big = cat !== 'generic' && !parseDuration(sentence);
  if (!force && !(intent && cat !== 'generic') && !(horizon != null && horizon >= 14 && big) && !/^(?:il\s+mio\s+)?obiettivo/i.test(ap(sentence).trim())) return null;
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
const SING = [[/zioni$/, 'zione'], [/oni$/, 'one'], [/qui$/, 'quio'], [/ami$/, 'ame'], [/enti$/, 'ento'], [/iti$/, 'ita'], [/ite$/, 'ita'], [/hi$/, 'o'], [/i$/, 'o']];
function singular(title) {
  const m = title.match(/^(\d+|due|tre|quattro|cinque|sei)\s+(.+)$/i);
  if (!m) return title;
  const words = m[2].split(' ');
  for (const [re, to] of SING) if (re.test(words[0])) { words[0] = words[0].replace(re, to); break; }
  return cap(words.join(' '));
}
const durText = (d) => (d >= 60 ? `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60}'` : ''}` : `${d} min`);
// frasi che dicono un fatto con una data, non una cosa da fare: servono da scadenza per quello che segue
const STATEMENT = /^(?:(?:io\s+)?(?:parto|partiamo|partenza|arriv\w+|torno|torniamo|ho\s+(?:l'|il|la|un|una|lo)?\s*(?:esame|colloquio|volo|treno|aereo|matrimonio|compleanno|scadenza|consegna|appello|concorso|trasloco|discussione))|c'[eè]\s+(?:l'|il|la|un|una)?\s*(?:esame|scadenza|consegna|matrimonio|compleanno))/i;
const NSESS = /\b(\d+|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+(?:sessioni|session[ei]|volte)\s+(?:di|da|per)\s+(.+)/i;

/** Una parte di frase → attività o impegno. carry: il giorno (o la scadenza) detti prima nella stessa frase. */
function taskOps(clause, state, today, nowMin, ctx, carry) {
  const ops = [], said = [];
  const pl = lower(clause);
  const deadline = parseDue(clause, today);
  const rest = deadline ? clause.replace(new RegExp(esc(deadline.match), 'i'), ' ') : clause;
  const own = dateOf(carry.nextWeek && !/settimana/.test(lower(rest)) ? rest + ' settimana prossima' : rest, today);
  const window = windowOf(clause) || (own ? null : carry.window);
  // «venerdì devo consegnare la relazione»: il giorno è una scadenza, non il giorno in cui farla
  const isDue = own && /\b(consegn\w*|scad\w*|presentar\w*|mandar\w*|inviar\w*|pagar\w*)\b/.test(pl) && !timeOf(clause);
  let date = isDue ? null : own?.date || (carry.asDeadline ? null : carry.date);
  let due = deadline?.due || (isDue ? own.date : null) || (carry.asDeadline ? carry.date : null);
  const rel = pl.match(/\b(?:tra|fra)\s+(un'ora|un\s+ora|mezz'ora|un\s+quarto\s+d'ora|\d+\s*(?:min|minuti|ore|ora|h)\b|(?:un|una|due|tre|dieci|venti|quindici)\s+(?:minuti|ore))/);
  const relMin = rel ? parseDuration(rel[1].replace(/^un\s+ora$/, "un'ora")) : null;
  const tm = timeOf(clause) || (relMin && !own ? { start: fmtMin(Math.min(23 * 60 + 59, nowMin + relMin)), end: null } : null);
  if (relMin && !own) date = today;
  const until = pl.match(UNTIL_RE);
  const dur = parseDuration(rel ? pl.replace(rel[0], ' ') : clause);
  const named = findProject(clause, ctx.projects);
  const prio = /assolutamente|important|urgente|priorit/.test(pl) ? 3 : null;

  // un fatto con una data, senza orario («tra due settimane parto per Londra»): diventa la scadenza di ciò che segue
  if (STATEMENT.test(cleanTitle(clause, null).replace(/^/, '')) || STATEMENT.test(tidy(lower(rest).replace(DATE_WORDS, ' ').replace(TIME_WORDS, ' ')))) {
    const d = own?.date || deadline?.due || carry.date;
    if (d && !tm) {
      const what = cleanTitle(clause, null);
      ops.push(op({ action: 'remember', note: `${what}: ${niceDate(d, today)} (${d})`, category: 'nota' }));
      said.push(`${what.charAt(0).toLowerCase() + what.slice(1)} ${niceDate(d, today)}: me lo segno`);
      return { ops, said, carry: { date: d, asDeadline: true, window: null } };
    }
  }

  // «3 sessioni di mix da 2 ore»
  const ns = clause.match(NSESS);
  if (ns && !tm) {
    const n = Math.min(12, numOf(ns[1]) || 1);
    const what = cleanTitle(ns[2], named?.n) || 'Sessione';
    for (let i = 1; i <= n; i++) ops.push(op({ action: 'add', kind: 'task', title: `${what} · ${i}`, duration_min: dur || null, duration_is_estimate: !dur, priority: prio || 2, deadline: due, project: named?.p.name || null, energy: named ? 3 : null, window }));
    said.push(`${n} sessioni di ${lower(what)}${dur ? ' da ' + durText(dur) : ''}${due ? ' entro ' + niceDate(due, today) : ''}`);
    return { ops, said, carry };
  }

  if (/^(?:aggiungi|aggiungere|metti|segna|ricordami|promemoria|cose\s+da\s+fare|da\s+fare|todo|lista)$/i.test(tidy(clause)) || COMMENT.test(tidy(lower(clause)))) return { ops, said, carry };
  if (!tidy(lower(clause).replace(CHAT, '').replace(/[^a-zà-ù0-9]/g, ''))) return { ops, said, carry };
  // richieste e domande («organizzami la settimana», «cosa faccio domani?»): senza AI non diventano attività
  if (/^(?:organizza\w*|pianifica\w*|aiutami|fammi|dimmi|spiegami|cosa|che\s+cosa|come|quando|perch[eé]|quanto|quante|quali|riesco|ce\s+la\s+faccio)\b/i.test(tidy(lower(clause).replace(CHAT, '')))) {
    said.push('per richieste come questa serve un\'AI: scegline una gratuita in ⋯ → Assistente AI');
    return { ops, said, carry };
  }
  let title = singular(cleanTitle(rel ? rest.replace(new RegExp(esc(rel[0]), 'i'), ' ') : rest, named?.n));
  if (/\b(?:ho\s+lavorato|lavoro|sto\s+lavorando)\s+fino\b/.test(pl)) title = 'Lavoro';
  // «lunedì alle 10, mercoledì alle 15»: senza titolo vale quello detto prima
  if ((!title || title.length < 2) && tm && carry.title) title = carry.title;
  if (!title || title.length < 2) return { ops, said, carry };

  // «lunedì e mercoledì lavoro fino alle 19»: lo stesso impegno in più giorni
  const many = !isRecurring(pl) && !isDue ? [...pl.matchAll(new RegExp(`(?:^|\\s)(${WD_WORD})(?![a-zà-ù])`, 'g'))].map((x) => dateOf(x[1], today)?.date).filter(Boolean) : [];
  const days = many.length > 1 && (tm || until) ? [...new Set(many)] : [date];
  if (until && !tm?.end && !/\bdalle\b/.test(pl)) {
    for (const dd of days) {
      const s = dd && dd !== today ? state.prefs.dayStart : Math.max(state.prefs.dayStart, nowMin);
      ops.push(op({ action: 'add', kind: 'event', title, date: dd || today, start_time: fmtMin(s), end_time: hm(until[1], until[2]) }));
    }
    said.push(`${title} ${days.filter(Boolean).map((dd) => niceDate(dd, today)).join(' e ') || 'oggi'} fino alle ${hm(until[1], until[2])}`);
    return { ops, said, carry: { date: date || today, window } };
  }
  if (tm && days.length > 1) {
    for (const dd of days) ops.push(op({ action: 'add', kind: 'event', title, date: dd, start_time: tm.start, end_time: tm.end, duration_min: tm.end ? null : dur || 60, project: named?.p.name || null }));
    said.push(`${title} ${days.map((dd) => niceDate(dd, today)).join(' e ')} alle ${tm.start}`);
    return { ops, said, carry: { date, window, title } };
  }
  if (tm) {
    const d = date || today;
    // lo stesso impegno già in programma quel giorno: si aggiorna l'orario
    const same = state.items.find((x) => x.kind === 'event' && x.date === d && strip(x.title) === strip(title));
    if (same) {
      ops.push(op({ action: 'update', id: same.id, start_time: tm.start, end_time: tm.end, duration_min: tm.end ? null : dur }));
      said.push(`«${same.title}» ${niceDate(d, today)} alle ${tm.start}`);
    } else {
      ops.push(op({ action: 'add', kind: 'event', title, date: d, start_time: tm.start, end_time: tm.end, duration_min: tm.end ? null : dur || 60, project: named?.p.name || null, priority: prio }));
      said.push(`${title} ${niceDate(d, today)} alle ${tm.start}`);
    }
    return { ops, said, carry: { date: d, window, title, nextWeek: carry.nextWeek } };
  }
  // stessa attività già aperta: si aggiorna, niente doppioni
  const same = findSimilarTask(title, state.items);
  if (same) {
    const upd = op({ action: 'update', id: same.id, duration_min: dur, duration_is_estimate: dur ? false : null, date, window, priority: prio, deadline: due, project: !same.project && named ? named.p.name : null });
    if (dur || date || window || prio || due || upd.project) {
      ops.push(upd);
      said.push(`aggiornata «${same.title}»${dur ? ' · ' + durText(dur) : ''}${date ? ' · ' + niceDate(date, today) : ''}${window && !date ? ' · ' + window : ''}${due ? ' · entro ' + niceDate(due, today) : ''}`);
    } else said.push(`«${same.title}» c'è già`);
    return { ops, said, carry: { date, window, asDeadline: false } };
  }
  ops.push(op({ action: 'add', kind: 'task', title, date, duration_min: dur || null, duration_is_estimate: !dur, priority: prio || 2, window,
    deadline: due, project: named?.p.name || null, energy: named ? 3 : /\b(studi|ripass|scriver|tesi|esame)\w*/.test(pl) ? 3 : null }));
  said.push(`${title}${date && date !== today ? ' · ' + niceDate(date, today) : ''}${due ? ' entro ' + niceDate(due, today) : ''}`);
  return { ops, said, carry: { date: own ? date : carry.date, window: own ? window : carry.window, asDeadline: own ? false : carry.asDeadline } };
}

// ---------------------------------------------------------------- comandi
const TIRED = /\b(?:sono\s+(?:stanc\w+|distrutt\w+|a\s+pezzi|cott\w+|esaust\w+)|giornata\s+(?:leggera|tranquilla|soft)|alleggerisci|sto\s+male|non\s+ce\s+la\s+faccio)\b/;
const COLOR_WORDS = { rosa: 'rose', lilla: 'lilac', viola: 'lilac', salvia: 'sage', verde: 'sage', sabbia: 'sand', beige: 'sand', crema: 'sand', cielo: 'sky', azzurro: 'sky', blu: 'sky' };
function commandOps(text, state, today, now) {
  let low = lower(text).trim().replace(/[.!]+$/, '').replace(/^(?:(?:oggi|stamattina|stamani|stasera|ieri|prima|poco\s+fa|adesso|ora|già|gia|ok|allora)\s*,?\s+)+/, '');
  // forme che vogliono dire «sposta»: «la riunione è stata spostata alle 11», «la spesa la faccio domani»
  let r0 = low.match(/^(.+?)\s+(?:è\s+stat[ao]\s+|è\s+|e'\s+|sono\s+stat[ei]\s+)?(?:spostat[aoei]|anticipat[aoei]|posticipat[aoei]|rimandat[aoei])\s+(?:a\s+|ad\s+|al\s+)?(.+)$/)
    || low.match(/^(.+?)\s+(?:la|lo|le|li)\s+(?:faccio|sposto|rimando|metto|facciamo)\s+(.+)$/)
    || low.match(/^(.+?)\s+slitta\s+(?:a\s+|ad\s+|al\s+)?(.+)$/);
  if (r0 && (dateOf(r0[2], today) || timeOf(r0[2].replace(/^(\d)/, 'alle $1')) || /^(?:alle|domani|dopodomani)/.test(r0[2]))) low = `sposta ${r0[1]} ${/^alle|^\d/.test(r0[2]) ? '' : 'a '}${r0[2]}`;
  /** L'attività di cui si parla: per titolo, preferendo quella del giorno nominato. */
  const find = (frag, all = false) => {
    const day = dateOf(frag, today)?.date;
    const f = strip(tidy(lower(frag).replace(DATE_WORDS, ' ').replace(TIME_WORDS, ' ')).replace(/^(?:(?:il|la|lo|l'|i|gli|le|mio|mia)\s*)+/, '').replace(/\s+(?:di|del|della|a|per)$/, '')).trim();
    if (!f) return null;
    const pool = state.items.filter((x) => all || x.status !== 'done');
    const hits = [pool.filter((x) => strip(x.title) === f), pool.filter((x) => strip(x.title).includes(f)), [findSimilarTask(f, pool)].filter(Boolean), pool.filter((x) => f.includes(strip(x.title)))]
      .find((h) => h.length) || [];
    return (day && hits.find((x) => x.date === day)) || hits[0] || null;
  };
  const findRec = (frag) => {
    const f = strip(tidy(lower(frag).replace(DATE_WORDS, ' ').replace(TIME_WORDS, ' ')).replace(/^(?:(?:il|la|lo|l'|i|gli|le)\s*)+/, '')).trim();
    return f ? (state.recurring || []).find((r) => strip(r.title) === f || strip(r.title).includes(f) || f.includes(strip(r.title))) : null;
  };
  const nf = (what) => ({ reply: `Non trovo «${tidy(what)}» tra le tue attività.`, notFound: true });
  let m;
  // giornata pesante: le cose di concentrazione di oggi passano a domani (con conferma)
  if (TIRED.test(low)) {
    const heavy = state.items.filter((x) => x.kind === 'task' && x.status !== 'done' && !x.habitId && x.energy >= 3 && (!x.date || x.date === today) && !(x.deadline && x.deadline <= today));
    if (!heavy.length) return { ops: [], reply: 'Oggi non hai attività pesanti in programma: tieni quelle leggere e fermati quando vuoi.' };
    return { ops: heavy.map((x) => op({ action: 'move', id: x.id, date: addDays(today, 1) })), reply: `Alleggerisco: ${heavy.map((x) => `«${x.title}»`).join(', ')} ${heavy.length === 1 ? 'passa' : 'passano'} a domani. Restano le cose leggere.`, confirm: true };
  }
  if ((m = low.match(/^(?:ho\s+fatto|ho\s+lavorato|ho\s+passato)\s+(.+?)\s+(?:di|del|della|dello|dell'|sul|sulla|sull'|al|alla|all'|a|su)\s*(.+)$/)) && parseDuration(m[1])) {
    const it = find(m[2]);
    const d = parseDuration(m[1]);
    return it ? { ops: [op({ action: 'progress', id: it.id, actual_min: d })], reply: `Segnati ${d} minuti su «${it.title}». Il resto lo rimetto in programma.` } : nf(m[2]);
  }
  if ((m = low.match(/^(?:ho\s+fatto|sono\s+a|ho\s+finito)\s+(?:la\s+|a\s+)?met[aà]\s+(?:di|del|della|dello|dell'|dei|delle)?\s*(.+)$/))) {
    const it = find(m[1]);
    if (!it) return nf(m[1]);
    const half = Math.max(5, Math.round((it.duration - (it.spent || 0)) / 2 / 5) * 5);
    return { ops: [op({ action: 'progress', id: it.id, actual_min: half })], reply: `Segnata metà di «${it.title}» (${half} minuti): il resto lo rimetto in programma.` };
  }
  if ((m = low.match(/^(?:colora|coloro|metti|fai)\s+(.+?)\s+(?:di|in|color[ae]?)\s+(rosa|lilla|viola|salvia|verde|sabbia|beige|crema|cielo|azzurro|blu|bianc[oa]|normale)$/))) {
    const it = find(m[1].replace(/^(?:la\s+carta\s+(?:di|del|della)?\s*)/, ''));
    const c = COLOR_WORDS[m[2]] || null;
    return it ? { ops: [op({ action: 'update', id: it.id, color: c })], reply: c ? `«${it.title}» ora è ${m[2]}. Anche il suo quadrante nel calendario.` : `«${it.title}» torna al colore normale.` } : nf(m[1]);
  }
  // «la palestra è più importante della spesa», «il report è urgente», «la spesa può aspettare»
  if ((m = low.match(/^(.+?)\s+(?:è|e'|e)\s+(?:più\s+)?(?:importante|urgente|prioritari[ao]|la\s+priorità)\b/))) {
    const it = find(m[1]);
    if (it) return { ops: [op({ action: 'update', id: it.id, priority: 3 })], reply: `«${it.title}» ora ha la precedenza.` };
    return nf(m[1]);
  }
  if ((m = low.match(/^(.+?)\s+(?:può\s+aspettare|non\s+è\s+urgente|non\s+è\s+importante|è\s+meno\s+importante)/))) {
    const it = find(m[1]);
    if (it) return { ops: [op({ action: 'update', id: it.id, priority: 1 })], reply: `«${it.title}» passa in fondo: la faccio entrare solo se c'è tempo.` };
  }
  if ((m = low.match(/^(?:ho\s+finito|fatto|finito|completat[oa]|ho\s+fatto|ho\s+già\s+fatto|ho\s+completato)\s+(.+)/))) {
    const dur = parseDuration(m[1]);
    const parts = m[1].replace(DUR_ANY, ' ').split(/\s*,\s*|\s+e\s+(?:anche\s+)?|\s+anche\s+/).map((x) => tidy(x)).filter(Boolean);
    const found = parts.map((p) => [p, find(p)]);
    const ok = found.filter(([, it]) => it);
    if (ok.length) {
      return { ops: ok.map(([, it]) => op({ action: 'complete', id: it.id, actual_min: ok.length === 1 ? dur : null })), reply: `Segnat${ok.length === 1 ? 'o' : 'i'} come fatt${ok.length === 1 ? 'o' : 'i'}: ${ok.map(([, it]) => `«${it.title}»`).join(', ')}.` };
    }
    // una cosa fatta che non era in programma («stamattina ho fatto palestra un'ora»): la segno come fatta
    if (dur && /^ho\s+fatto/.test(low)) {
      const title = cap(tidy(parts.join(' ').replace(TIME_WORDS, ' ').replace(LEAD, ''))) || 'Attività';
      return { ops: [op({ action: 'add', kind: 'task', title, date: today, duration_min: dur }), op({ action: 'complete', id: title, actual_min: dur })], reply: `Segnato: ${lower(title)}, ${durText(dur)}. Conta per quello che imparo sui tuoi tempi.` };
    }
    return nf(m[1]);
  }
  // «non ho fatto la spesa»: resta da fare, la rimetto più avanti
  if ((m = low.match(/^non\s+(?:ho\s+(?:fatto|finito|iniziato)|sono\s+riuscit[oa]\s+a\s+fare|ce\s+l'ho\s+fatta\s+(?:a\s+fare)?)\s+(.+)/))) {
    const it = find(m[1]);
    return it ? { ops: [op({ action: 'skip', id: it.id })], reply: `Ok, «${it.title}» resta da fare: la rimetto più avanti.` } : nf(m[1]);
  }
  if ((m = low.match(/^(?:inizio|sto\s+iniziando|comincio|inizia)\s+(.+)/))) {
    const it = find(m[1]);
    return it ? { ops: [op({ action: 'start', id: it.id })], reply: `Via con «${it.title}».` } : nf(m[1]);
  }
  // «salta il lavoro oggi»: un impegno ricorrente saltato per un giorno
  if ((m = low.match(/^(?:salta|salto|niente|oggi\s+niente|domani\s+niente)\s+(.+)/))) {
    const r = findRec(m[1]);
    const d = dateOf(low, today)?.date || today;
    if (r) return { ops: [op({ action: 'remove_recurring', id: r.id, date: d })], reply: `${r.title}: ${niceDate(d, today)} lo salto.`, confirm: true };
    const it = find(m[1]);
    if (it) return { ops: [op({ action: 'move', id: it.id, date: addDays(today, 1) })], reply: `Spostata «${it.title}» a domani.` };
    return nf(m[1]);
  }
  if ((m = low.match(/^(?:togli|elimina|cancella|rimuovi)\s+(.+)/))) {
    const it = find(m[1]);
    if (it) return { ops: [op({ action: 'delete', id: it.id })], reply: `Tolta «${it.title}».`, confirm: it.kind === 'event' };
    const r = findRec(m[1]);
    if (r) return { ops: [op({ action: 'remove_recurring', id: r.id })], reply: `Tolgo «${r.title}» da tutte le settimane.`, confirm: true };
    return nf(m[1]);
  }
  // «sposta tutto a domani»: quello che resta di oggi passa a domani
  if ((m = low.match(/^(?:sposta|rimanda|rinvia)\s+tutto(?:\s+(?:quello\s+che\s+(?:resta|rimane|manca)))?(?:\s+(?:a|ad|per)\s+(.+))?$/))) {
    const d = (m[1] && dateOf(m[1], today)?.date) || addDays(today, 1);
    const left = state.items.filter((x) => x.kind === 'task' && x.status !== 'done' && !x.habitId && (x.date === today || (!x.date && (!x.earliest || x.earliest <= today))));
    if (!left.length) return { ops: [], reply: 'Oggi non resta niente da spostare.' };
    return { ops: left.map((x) => (x.date ? op({ action: 'move', id: x.id, date: d }) : op({ action: 'update', id: x.id, earliest_date: d }))),
      reply: `Sposto a ${niceDate(d, today)} quello che restava: ${left.map((x) => `«${x.title}»`).join(', ')}.`, confirm: true };
  }
  // «sposta la call di giovedì alle 17», «sposta il beat a domani», «rimanda la spesa», «anticipa la cena di mezz'ora»
  if ((m = low.match(/^(?:sposta(?:mi)?|rimanda|rinvia|posticipa|anticipa|metti)\s+(.+)/))) {
    const body = m[1];
    const shift = body.match(/\s+di\s+(.+)$/);
    const verb = low.split(/\s/)[0];
    if ((verb === 'anticipa' || verb === 'posticipa') && shift && parseDuration(shift[1])) {
      const it = find(body.slice(0, shift.index));
      if (!it) return nf(body.slice(0, shift.index));
      if (it.start == null) return { reply: `«${it.title}» non ha un orario fisso: lo sceglie Tempo.` };
      const ns = it.start + (verb === 'anticipa' ? -1 : 1) * parseDuration(shift[1]);
      return { ops: [op({ action: 'update', id: it.id, start_time: fmtMin(Math.max(0, ns)) })], reply: `«${it.title}» ora è alle ${fmtMin(Math.max(0, ns))}.`, confirm: it.kind === 'event' };
    }
    // cosa, dove: la parte dopo «a/alle/al/per» è il nuovo giorno o orario
    const tgt = body.match(/\s+(?:a|ad|al|alle|per|per\s+le|verso\s+le|alla)\s+((?:domani|dopodomani|oggi|stasera|\d|${WD_WORD}|il\s+\d|la\s+prossima|settimana|mezzogiorno|lunedì|martedì).*)$/i)
      || body.match(new RegExp(`\\s+((?:domani|dopodomani|stasera|${WD_WORD}).*)$`, 'i'));
    const ref = tgt ? body.slice(0, tgt.index) : body;
    const where = tgt ? tgt[1] : '';
    const it = find(ref);
    if (!it) { if (verb !== 'metti') return nf(ref); return null; }
    const tm = timeOf(where.replace(/^(\d)/, 'alle $1'));
    const d = dateOf(where, today)?.date || (/\bsettimana\b/.test(where) ? addDays(today, (7 - weekday(today)) % 7 + 1) : null)
      || (!tm && /^(?:rimanda|rinvia|posticipa)/.test(verb) ? addDays(today, 1) : null);
    if (!tm && !d) return { reply: `A quando sposto «${it.title}»? Dimmi il giorno o l'orario.` };
    const o = op({ action: tm ? 'update' : 'move', id: it.id, date: d, start_time: tm?.start || null });
    return { ops: [o], reply: `«${it.title}» spostata ${[d ? 'a ' + niceDate(d, today) : null, tm ? 'alle ' + tm.start : null].filter(Boolean).join(' ')}.`, confirm: it.kind === 'event' && !!d && d !== it.date };
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
const UNAVAIL = /\b(?:non\s+ci\s+sono|non\s+ci\s+sar[oò]|sono\s+via|sar[oò]\s+via|sono\s+fuori|sar[oò]\s+fuori|non\s+sono\s+disponibil\w*|tutto\s+il\s+giorno\s+(?:a|in|da|fuori)|sono\s+(?:a|in)\s+[a-zà-ù]+\s+tutto\s+il\s+giorno)\b/i;
const PREF = /^(?:non\s+voglio|non\s+mi\s+piace|preferisco|preferirei|mi\s+piace|odio|evito|cerco\s+di|di\s+solito|sono\s+una?\s+person)/i;

/**
 * Modalità base: un messaggio scritto nella barra → { ops?, reply, confirm?, simple? }.
 * simple = un solo comando semplice (fatto, sposta, elimina…): non serve l'AI.
 */
export function localParse(text, state, now) {
  const today = dateKey(new Date(now));
  const d = new Date(now);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const ctx = { projects: [...(state.projects || [])], offDays: [...(state.prefs?.offDays || [])], today };
  const ops = [], said = [], misses = [];
  let confirm = false, goalsMade = 0, clauses = 0, commands = 0, structured = 0;
  const sentences = sentencesOf(text);
  const tired = TIRED.test(lower(text)) ? commandOps('sono stanco', state, today, now) : null;
  if (tired) {
    if (!tired.ops?.length) return { reply: tired.reply };
    return { ops: tired.ops, reply: tired.reply, confirm: true };
  }
  for (const s of sentences) {
    // «mercoledì non ci sono, sono a Milano tutto il giorno»: la giornata è occupata
    const un = UNAVAIL.test(s) && dateOf(s, today);
    if (un && !timeOf(s)) {
      const where = lower(s).match(/\bsono\s+(a|in)\s+([a-zà-ù]+)/);
      const title = where ? `${cap(where[1])} ${cap(where[2])}` : 'Non disponibile';
      ops.push(op({ action: 'add', kind: 'event', title, date: un.date, start_time: fmtMin(state.prefs?.dayStart ?? 480), end_time: fmtMin(state.prefs?.dayEnd ?? 1380) }));
      said.push(`${niceDate(un.date, today)} non ci sei: niente in programma`);
      clauses++;
      continue;
    }
    // «il weekend vado al mare»: sabato e domenica sei via
    if (/\b(?:weekend|week-end|fine\s+settimana)\b/i.test(s) && /\b(?:vado|vado\s+via|sono\s+(?:via|fuori|a|in|al|da)|parto|sar[oò]|staro|starò)\b/i.test(s) && !/\b(?:non\s+lavor|stacc|riposo|progett)/i.test(s) && !timeOf(s)) {
      const sat = addDays(today, (6 - weekday(today) + 7) % 7);
      const where = lower(s).match(/\b(?:vado|sono|starò|staro)\s+((?:al|alla|in|a|da|dai|dalla|dal)\s+[a-zà-ù']+(?:\s+[a-zà-ù']+)?)/);
      const title = where ? cap(where[1]) : 'Via';
      for (const dd of [sat, addDays(sat, 1)]) ops.push(op({ action: 'add', kind: 'event', title, date: dd, start_time: fmtMin(state.prefs?.dayStart ?? 480), end_time: fmtMin(state.prefs?.dayEnd ?? 1380) }));
      said.push(`questo weekend sei via (${lower(title)}): niente in programma sabato e domenica`);
      clauses++;
      continue;
    }
    // la frase intera come vincolo o preferenza (il lavoro, i giorni di stacco, le abitudini…)
    const whole = !/^(?:ho\s+finito|fatto|sposta|togli|elimina|cancella|rimanda)/i.test(s.trim()) ? structuredOps(s, ctx) : null;
    if (whole && clausesOf(s).length === 1) { ops.push(...whole.ops, memoryOp(s, whole.category)); said.push(...whole.said); clauses++; structured++; continue; }
    let carry = { date: null, window: null, asDeadline: false };
    const cl = clausesOf(s);
    for (const [ci, c] of cl.entries()) {
      clauses++;
      // «ho 3 colloqui: lunedì alle 10, mercoledì alle 15»: la prima parte dà il nome alle altre
      const nx = cl[ci + 1];
      if (nx && timeOf(nx) && !timeOf(c) && !cleanTitle(nx, null) && cleanTitle(c, null)) {
        carry = { ...carry, title: singular(cleanTitle(c, null)), nextWeek: carry.nextWeek || /\b(?:settimana\s+prossima|prossima\s+settimana)\b/i.test(c) };
        continue;
      }
      if (/\b(?:settimana\s+prossima|prossima\s+settimana)\b/i.test(c)) carry = { ...carry, nextWeek: true };
      const cmd = commandOps(c, state, today, now);
      if (cmd) {
        if (cmd.notFound) misses.push(cmd.reply);
        else if (cmd.ops?.length) { ops.push(...cmd.ops); said.push(cmd.reply.replace(/[.]$/, '')); commands++; confirm ||= !!cmd.confirm; }
        else said.push(cmd.reply.replace(/[.]$/, ''));
        continue;
      }
      const st = structuredOps(c, ctx);
      if (st) { ops.push(...st.ops, memoryOp(c, st.category)); said.push(...st.said); continue; }
      // un modo di essere, non una cosa da fare: lo ricordo
      if (PREF.test(c.trim())) { ops.push(memoryOp(c, 'preferenza')); said.push(`me lo ricordo: ${lower(c.trim()).replace(/[.]$/, '')}`); continue; }
      const g = goalOps(c, ctx, today);
      if (g) { ops.push(...g.ops); said.push(`obiettivo «${g.title}»${g.due ? ' entro ' + niceDate(g.due, today) : ''}`); goalsMade++; continue; }
      const tk = taskOps(c, state, today, nowMin, ctx, carry);
      ops.push(...tk.ops); said.push(...tk.said);
      carry = { nextWeek: carry.nextWeek, ...(tk.carry || carry) };
    }
  }
  if (goalsMade) confirm = true;
  if (!ops.length) {
    if (misses.length) return { reply: misses.join(' ') };
    return { reply: said.length ? cap(said.join(', ')) + '.' : 'Senza AI capisco frasi semplici: «Domani alle 16 call», «Stasera 2 ore sul beat 02», «Ho fatto 30 minuti del beat», «La domenica stacco». Per il resto scegli un\'AI gratuita in ⋯ → Assistente AI.' };
  }
  const reply = goalsMade ? `Ho preparato un piano per ${said.filter((x) => x.startsWith('obiettivo')).join(' e ')}. Guarda le sessioni e conferma.`
    : cap([...said, ...misses.map((x) => x.replace(/[.]$/, ''))].join(' · ')) + '.';
  // un solo comando o un solo vincolo chiaro: non serve l'AI
  return { ops, reply, confirm, simple: clauses === 1 && (commands === 1 || structured === 1) };
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
