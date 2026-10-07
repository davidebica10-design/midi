// Il timer di un'attività: pomodoro (lavoro + pausa a giri) o timer semplice.
// Si basa sugli orari, non su un conteggio: continua anche ad app chiusa.
// Funzioni pure: lo stato del timer sta in state.focus e si salva come il resto.

export const POMO_BREAK = 5, POMO_LONG_BREAK = 15, POMO_ROUNDS = 4;
const MIN = 60000;

/** Un timer pronto per un'attività (non ancora partito). */
export function focusSetup(item, { theme, minutes, now }) {
  const pomo = theme?.tool === 'pomodoro';
  const left = Math.max(5, (item.duration || 30) - (item.spent || 0));
  return {
    itemId: item.id, title: String(item.title || '').slice(0, 80), theme: theme?.key || 'generic',
    mode: pomo ? 'pomodoro' : 'timer', phase: 'setup',
    minutes: minutes || (pomo ? 25 : Math.min(120, left)),
    startedAt: null, pausedAt: null, paused: 0, worked: 0, round: 1, createdAt: now,
  };
}

/** Parte (o riparte da capo per la fase corrente). */
export function focusStart(f, now) {
  return { ...f, phase: f.phase === 'break' ? 'break' : 'work', startedAt: now, pausedAt: null, paused: 0 };
}
export const focusPause = (f, now) => (f.pausedAt || !f.startedAt ? f : { ...f, pausedAt: now });
export const focusResume = (f, now) => (!f.pausedAt ? f : { ...f, paused: f.paused + (now - f.pausedAt), pausedAt: null });

const lengthOf = (f) => (f.phase === 'break' ? (f.round % POMO_ROUNDS === 0 ? POMO_LONG_BREAK : POMO_BREAK) : f.minutes) * MIN;

/** Come sta andando adesso: { elapsed, left, pct, over, running, paused } (ms; pct 0–1). */
export function focusView(f, now) {
  if (!f) return null;
  const total = lengthOf(f);
  if (!f.startedAt) return { elapsed: 0, left: total, total, pct: 0, over: false, running: false, paused: false };
  const elapsed = Math.max(0, (f.pausedAt || now) - f.startedAt - f.paused);
  return { elapsed, left: Math.max(0, total - elapsed), total, pct: Math.min(1, elapsed / total), over: elapsed >= total, running: !f.pausedAt, paused: !!f.pausedAt };
}

/**
 * Il tempo della fase è finito: si passa alla successiva.
 * pomodoro: lavoro → pausa → lavoro (giro dopo); timer: resta «finito» in attesa di una scelta.
 */
export function focusNext(f, now) {
  const v = focusView(f, now);
  if (f.phase === 'work') {
    const worked = f.worked + Math.min(v.elapsed, v.total);
    if (f.mode === 'pomodoro') return { ...f, worked, phase: 'break', startedAt: now, pausedAt: null, paused: 0 };
    return { ...f, worked, phase: 'done', startedAt: null, pausedAt: null, paused: 0 };
  }
  if (f.phase === 'break') return { ...f, phase: 'ready', round: f.round + 1, startedAt: null, pausedAt: null, paused: 0 };
  return f;
}

/** Minuti lavorati finora (fasi chiuse + quella in corso). */
export function workedMin(f, now) {
  if (!f) return 0;
  const v = focusView(f, now);
  return Math.round((f.worked + (f.phase === 'work' ? Math.min(v.elapsed, v.total) : 0)) / MIN);
}

/** «24:59», «1:05:00» */
export function clock(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** Valida lo stato del timer letto da un backup o dal telefono. */
export function sanitizeFocus(f) {
  if (!f || typeof f !== 'object' || typeof f.itemId !== 'string') return null;
  const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
  const phase = ['setup', 'work', 'break', 'ready', 'done'].includes(f.phase) ? f.phase : 'setup';
  return {
    itemId: f.itemId.slice(0, 40), title: String(f.title || '').slice(0, 80), theme: typeof f.theme === 'string' ? f.theme.slice(0, 20) : 'generic',
    mode: f.mode === 'pomodoro' ? 'pomodoro' : 'timer', phase, minutes: Math.min(240, Math.max(1, Math.round(num(f.minutes, 25)))),
    startedAt: f.startedAt ? num(f.startedAt) : null, pausedAt: f.pausedAt ? num(f.pausedAt) : null, paused: num(f.paused), worked: num(f.worked),
    round: Math.max(1, Math.round(num(f.round, 1))), createdAt: num(f.createdAt),
  };
}

// ---------------------------------------------------------------- l'arco (dal design: 5 segmenti su mezzo cerchio)
const W = 334, H = 207, CX = 167, CY = 188, R = 150, SEG = 5, GAP = 11; // gradi tra un segmento e l'altro
const pt = (deg, r = R) => { const a = (deg * Math.PI) / 180; return [CX + r * Math.cos(a), CY - r * Math.sin(a)]; };
const arc = (from, to, r = R) => {
  const [x0, y0] = pt(from, r), [x1, y1] = pt(to, r);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const SPAN = (180 - GAP * (SEG - 1)) / SEG;
const SEGS = Array.from({ length: SEG }, (_, i) => [180 - i * (SPAN + GAP), 180 - i * (SPAN + GAP) - SPAN]);

/** Angolo (180 = sinistra, 0 = destra) → frazione 0–1 dell'arco. */
export const pctOfAngle = (deg) => Math.min(1, Math.max(0, (180 - deg) / 180));
/** Punto sullo schermo (relativo all'arco) → frazione 0–1, per scegliere la durata trascinando. */
export function pctAt(x, y, rect) {
  const sx = (x - rect.left) * (W / rect.width), sy = (y - rect.top) * (H / rect.height);
  const deg = (Math.atan2(CY - sy, sx - CX) * 180) / Math.PI;
  return pctOfAngle(deg < -90 ? 180 : deg < 0 ? 0 : deg);
}

/**
 * L'arco come SVG: segmenti chiari, progresso colorato, la tacca dove sei arrivato
 * e, mentre il tempo scorre, una luce che gira avanti e indietro sull'arco.
 */
export function gaugeParts(pct) {
  const p = 180 - Math.min(1, Math.max(0, pct)) * 180;
  const fill = SEGS.filter(([a]) => p < a - 0.01).map(([a, b]) => `<path d="${arc(a, Math.max(b, p))}"/>`).join('');
  const [mx0, my0] = pt(p, R - 27), [mx1, my1] = pt(p, R + 27);
  const ln = (c) => `<line x1="${mx0.toFixed(1)}" y1="${my0.toFixed(1)}" x2="${mx1.toFixed(1)}" y2="${my1.toFixed(1)}" class="${c}"/>`;
  const tick = pct > 0.004 && pct < 0.996 ? ln('g-tick-o') + ln('g-tick') : '';
  return `<g class="g-fill">${fill}</g>${tick}`;
}

/**
 * L'arco come SVG: segmenti chiari, progresso colorato, la tacca dove sei arrivato
 * e, mentre il tempo scorre, una luce che va avanti e indietro sull'arco.
 * Il progresso sta in <g class="g-prog">: si aggiorna con gaugeParts() senza fermare la luce.
 */
export function gaugeSvg({ pct = 0, running = false, accent = '#D21E2B', id = 'g' }) {
  const track = SEGS.map(([a, b]) => `<path d="${arc(a, b)}"/>`).join('');
  const comet = running ? `<circle r="5" class="g-comet"><animateMotion dur="5.5s" repeatCount="indefinite" keyPoints="0;1;0" keyTimes="0;0.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" path="${arc(180, 0)}"/></circle>` : '';
  return `<svg class="gauge" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" style="--acc:${accent}">
    <g class="g-track">${track}</g><g class="g-prog">${gaugeParts(pct)}</g>${comet}</svg>`;
}

// ---------------------------------------------------------------- l'orologio a puntini (per il timer)
/**
 * Un anello di puntini colorati attorno al numero: quelli già trascorsi si accendono,
 * l'anello gira piano su se stesso mentre il tempo scorre.
 * colors: i colori del tema; pct: quanto è passato (0–1).
 */
export function dotRingSvg({ pct = 0, colors = ['#F4C542', '#C9B6EE', '#F2A7C3', '#DCDCDC'], running = false }) {
  const N = 84, S = 300, C = S / 2;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lit = Math.round(Math.min(1, Math.max(0, pct)) * N);
  let dots = '';
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2 + (rnd() - 0.5) * 0.06;
    const r = 112 + (rnd() - 0.5) * 30;
    const size = 3 + rnd() * 4.2;
    const col = colors[Math.floor(rnd() * colors.length)];
    const on = i < lit;
    dots += `<circle cx="${(C + r * Math.cos(a)).toFixed(1)}" cy="${(C + r * Math.sin(a)).toFixed(1)}" r="${size.toFixed(1)}" fill="${col}" class="d${on ? ' on' : ''}" style="--k:${(i % 9) * 0.35}s"/>`;
  }
  return `<svg class="dotring${running ? ' run' : ''}" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" aria-hidden="true">
    <defs><radialGradient id="dr-glow"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".55" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <circle cx="${C}" cy="${C}" r="96" fill="url(#dr-glow)" class="dr-glow"/>
    <g class="dr-dots">${dots}</g></svg>`;
}
