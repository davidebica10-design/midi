// Parole e numeri scritti bene, in un posto solo.

/** "1 impegno", "2 impegni" */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** 45 → "45 min", 90 → "1 h 30'", 120 → "2 h" */
export const durLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + "'" : ''}` : `${m} min`);

/** Fascia con l'articolo giusto: "la mattina", "il pomeriggio", "la sera" */
export const windowLabel = (w) => ({ mattina: 'la mattina', pomeriggio: 'il pomeriggio', sera: 'la sera' }[w] || w);

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const dateOf = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
/** "2026-11-30" → "30 novembre"; un altro anno lo dice: "2029-07-05" → "5 luglio 2029". today: 'YYYY-MM-DD' di riferimento. */
export const dateLong = (k, today = null) => {
  const s = dateOf(k).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  const ref = today ? +String(today).slice(0, 4) : new Date().getFullYear();
  return +k.slice(0, 4) !== ref ? `${s} ${k.slice(0, 4)}` : s;
};
/** "2026-11-30" → "lunedì" */
export const weekdayName = (k) => dateOf(k).toLocaleDateString('it-IT', { weekday: 'long' });
