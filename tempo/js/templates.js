// Da obiettivo a sessioni, senza AI: un modello per categoria.
// Le stime sono indicative: l'apprendimento delle durate le corregge col tempo.
import { goalCategory } from './parse.js';
import { addDays, daysBetween } from './scheduler.js';

export const MAX_SESSIONS = 30;
const two = (n) => String(n).padStart(2, '0');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const short = (s, n = 28) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/**
 * Sessioni per un obiettivo.
 * Restituisce { category, sessions: [{ key, title, duration, energy, after: [key], deadline?, optional? }] }
 * oppure { category: 'fitness', habit: { title, perWeek, duration } }.
 */
export function sessionsFor(goal, { today, project } = {}) {
  const text = `${goal.title} ${goal.note || ''}`;
  const cat = goalCategory(text);
  const due = goal.due;
  const weeks = due ? clamp(Math.ceil(daysBetween(today, due) / 7), 1, 26) : 6;
  const S = [];
  const add = (key, title, duration, energy, after = [], extra = {}) => S.push({ key, title, duration, energy, after, ...extra });

  if (cat === 'music') {
    const t = text.toLowerCase();
    const m = t.match(/(\d+)\s+(?:brani|tracce|canzoni|pezzi)/);
    const n = m ? clamp(+m[1], 1, 8) : /\bsingol/.test(t) ? 1 : /\balbum\b/.test(t) ? 8 : 4;
    const perTrack = n > 4 ? ['beat', 'voce', 'mix'] : ['beat', 'arr', 'voce', 'mix'];
    for (let i = 1; i <= n; i++) {
      const k = two(i);
      add(`beat${k}`, `Beat ${k}`, 120, 3);
      if (perTrack.includes('arr')) add(`arr${k}`, `Arrangiamento ${k}`, 90, 3, [`beat${k}`]);
      add(`voce${k}`, `Registrazione voce ${k}`, 90, 3, [perTrack.includes('arr') ? `arr${k}` : `beat${k}`]);
      add(`mix${k}`, `Mix ${k}`, 90, 3, [`voce${k}`]);
    }
    const mixes = S.filter((s) => s.key.startsWith('mix')).map((s) => s.key);
    add('master', 'Master', 120, 3, mixes);
    add('cover', 'Copertina', 120, 3);
    // i distributori chiedono l'uscita con qualche settimana di anticipo
    const lead = due ? (daysBetween(today, due) > 35 ? 21 : 7) : 0;
    add('upload', 'Carica sul distributore', 45, 1, ['master', 'cover'], due ? { deadline: addDays(due, -lead) } : {});
    add('promo', 'Piano di promozione', 60, 2, ['cover']);
    add('promo1', 'Contenuti promo · 1', 90, 3, ['promo'], { optional: true });
    add('promo2', 'Contenuti promo · 2', 90, 3, ['promo1'], { optional: true });
    // tutto ciò che viene prima del caricamento deve finire prima del caricamento
    const up = S.find((s) => s.key === 'upload');
    if (up.deadline) {
      const before = new Set();
      const walk = (k) => { const s = S.find((x) => x.key === k); for (const a of s?.after || []) if (!before.has(a)) { before.add(a); walk(a); } };
      walk('upload');
      for (const s of S) if (before.has(s.key)) s.deadline = up.deadline;
    }
  } else if (cat === 'creative') {
    const name = /portfolio/i.test(text) ? 'portfolio' : 'progetto';
    add('scelta', name === 'portfolio' ? 'Scegli i lavori da mostrare' : 'Definisci cosa vuol dire finito', 60, 2);
    const cases = clamp(Math.round(weeks / 2), 2, 4);
    for (let i = 1; i <= cases; i++) add(`caso${i}`, name === 'portfolio' ? `Caso studio ${i}` : `Lavoro sul ${name} · ${i}`, 120, 3, ['scelta']);
    const all = S.filter((s) => s.key.startsWith('caso')).map((s) => s.key);
    add('impagina', name === 'portfolio' ? 'Impagina il portfolio' : 'Metti insieme le parti', 120, 3, all);
    add('feedback', 'Fai vedere a qualcuno e raccogli feedback', 45, 1, ['impagina']);
    add('revisione', 'Revisione finale', 90, 3, ['feedback']);
    add('pubblica', name === 'portfolio' ? 'Pubblica e invia il portfolio' : 'Consegna', 45, 1, ['revisione']);
  } else if (cat === 'fitness') {
    const m = text.toLowerCase().match(/(\d+|due|tre|quattro|cinque)\s+volt/);
    const per = m ? ({ due: 2, tre: 3, quattro: 4, cinque: 5 }[m[1]] || +m[1]) : 3;
    return { category: cat, habit: { title: /palestra/i.test(text) ? 'Palestra' : /cors|correr/i.test(text) ? 'Corsa' : 'Allenamento', perWeek: clamp(per, 1, 7), duration: 60 } };
  } else if (cat === 'study') {
    add('materiale', 'Raccogli il materiale e dividilo in parti', 45, 2);
    const parts = clamp(weeks * 2, 4, 12);
    for (let i = 1; i <= parts; i++) add(`parte${i}`, `Studio · parte ${i} di ${parts}`, 90, 3, [i === 1 ? 'materiale' : `parte${i - 1}`]);
    add('ripasso1', 'Ripasso generale', 90, 3, [`parte${parts}`]);
    add('simulazione', 'Simulazione d\'esame', 120, 3, ['ripasso1']);
    add('ripasso2', 'Ripasso dei punti deboli', 60, 2, ['simulazione']);
  } else {
    const name = short(goal.title.replace(/^(far|fare|finire|completare)\s+/i, ''));
    add('definisci', `${name}: definisci cosa vuol dire finito`, 30, 2);
    const n = clamp(weeks * 2, 3, 10);
    for (let i = 1; i <= n; i++) add(`s${i}`, `${name} · sessione ${i}`, 90, 3, [i === 1 ? 'definisci' : `s${i - 1}`]);
    add('chiudi', `${name}: revisione e chiusura`, 60, 2, [`s${n}`]);
  }
  return { category: cat, sessions: S.slice(0, MAX_SESSIONS) };
}

/** Valida un piano proposto dall'AI: titoli, durate, energia, dipendenze, tetto alle sessioni. */
export function validatePlan(raw) {
  const list = Array.isArray(raw?.sessions) ? raw.sessions : Array.isArray(raw) ? raw : null;
  if (!list || !list.length) return null;
  const out = [];
  for (const [i, s] of list.slice(0, MAX_SESSIONS).entries()) {
    const title = typeof s?.title === 'string' ? s.title.trim().slice(0, 80) : '';
    const duration = Math.round(+s?.duration_min || +s?.duration || 0);
    if (!title || !(duration >= 10 && duration <= 240)) continue;
    const energy = [1, 2, 3].includes(+s.energy) ? +s.energy : 2;
    const after = (Array.isArray(s.after) ? s.after : Array.isArray(s.depends_on) ? s.depends_on : [])
      .map((a) => (typeof a === 'number' ? `s${a}` : String(a))).slice(0, 5);
    out.push({ key: typeof s.key === 'string' ? s.key : `s${i}`, title, duration, energy, after, optional: !!s.optional });
  }
  // solo dipendenze verso sessioni precedenti: niente cicli
  const seen = new Set();
  for (const s of out) { s.after = s.after.filter((a) => seen.has(a)); seen.add(s.key); }
  return out.length ? out : null;
}
