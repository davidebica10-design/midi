// Movimento: lo sfondo prende i colori delle carte che hai davanti, le carte reagiscono al dito
// (si inclinano verso il punto toccato) e, tenute premute, si sollevano e si spostano;
// lasciate, tornano al loro posto con una molla.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- sfondo reattivo
let glowRaf = 0;
/** Ricalcola i colori dello sfondo al prossimo fotogramma. */
export function glowSoon() {
  cancelAnimationFrame(glowRaf);
  glowRaf = requestAnimationFrame(updateGlow);
}

// il tema dell'attività in corso: quando c'è, lo sfondo passa piano ai suoi colori
let actPal = null;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return '#' + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, '0')).join(''); };
/** Colori del tema (o null per tornare ai colori delle carte). */
export function setActPalette(pal) {
  const key = pal ? pal.join() : '';
  if (key === (actPal || []).join()) return;
  actPal = pal;
  document.querySelector('.bg')?.classList.toggle('themed', !!pal);
  glowSoon();
}

/** Le carte colorate più vicine al centro dello schermo colorano le tre macchie dello sfondo. */
export function updateGlow() {
  const app = document.getElementById('app');
  if (actPal && !app.classList.contains('mode-overview') && !app.classList.contains('sum-open')) {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
    const bg = dark ? '#171617' : '#ECECEA';
    document.querySelectorAll('.bg i').forEach((b, i) => b.style.setProperty('--c', dark ? mix(actPal[i % actPal.length], bg, 0.42) : actPal[i % actPal.length]));
    return;
  }
  const sel = app.classList.contains('sum-open') ? '#sum-scroll .sm-card'
    : app.classList.contains('mode-overview') ? '#cal-scroll .cd-card' : '#collage .pc';
  const H = innerHeight, mid = H * 0.45;
  const seen = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H || !r.width) continue;
    const g = getComputedStyle(el).getPropertyValue('--glow').trim();
    if (g) seen.push({ g, d: Math.abs((r.top + r.bottom) / 2 - mid) });
  }
  seen.sort((a, b) => a.d - b.d);
  const cols = [...new Set(seen.map((s) => s.g))];
  const pick = [cols[0], cols[1] || cols[0], cols[2]];
  document.querySelectorAll('.bg i').forEach((b, i) => {
    if (pick[i]) b.style.setProperty('--c', pick[i]); else b.style.removeProperty('--c');
  });
}

// ---------------------------------------------------------------- carte che reagiscono
export const drag = { active: false, until: 0 };
/** Vero mentre una carta è sollevata (o appena lasciata): gli altri gesti la ignorano. */
export const dragging = () => drag.active || Date.now() < drag.until;

const LIFT_MS = 300; // tieni premuto così a lungo per sollevare la carta
const SLOP = 9; // spostamento che vuol dire "sto scorrendo", non "sto premendo"

/**
 * Collega le carte di un contenitore: inclinazione verso il dito e riflesso al tocco,
 * sollevamento con pressione lunga, trascinamento libero e ritorno a molla.
 */
export function bindCards(root, { selector = '.pc', canStart = () => true, scroller } = {}) {
  let s = null;
  const set = (el, k, v) => el.style.setProperty(k, v);

  const press = (card, x, y) => {
    const r = card.getBoundingClientRect();
    const px = clamp((x - r.left) / r.width, 0, 1), py = clamp((y - r.top) / r.height, 0, 1);
    set(card, '--mx', `${(px * 100).toFixed(1)}%`);
    set(card, '--my', `${(py * 100).toFixed(1)}%`);
    set(card, '--ry', `${((px - 0.5) * 10).toFixed(2)}deg`);
    set(card, '--rx', `${((0.5 - py) * 10).toFixed(2)}deg`);
    card.classList.add('pressing');
  };
  const release = (card) => {
    card.classList.remove('pressing', 'lifted', 'dragging');
    for (const k of ['--rx', '--ry', '--dx', '--dy', '--rz']) card.style.removeProperty(k);
  };
  const cancel = () => {
    if (!s) return;
    clearTimeout(s.timer);
    release(s.card);
    if (s.lifted) { drag.active = false; drag.until = Date.now() + 80; if (scroller) scroller.style.overflowY = ''; }
    s = null;
  };

  root.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { cancel(); return; }
    const card = e.target.closest(selector);
    if (!card || !root.contains(card) || card.classList.contains('static') || !canStart(e)) return;
    const t = e.touches[0];
    s = { card, x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, lt: performance.now(), vx: 0, vy: 0, lifted: false };
    press(card, t.clientX, t.clientY);
    if (!e.target.closest('button:not([data-item]), a, input, textarea')) {
      s.timer = setTimeout(() => {
        if (!s) return;
        s.lifted = true;
        drag.active = true;
        card.classList.add('lifted');
        set(card, '--rx', '0deg'); set(card, '--ry', '0deg');
        if (scroller) scroller.style.overflowY = 'hidden';
        navigator.vibrate?.(8);
      }, LIFT_MS);
    }
  }, { passive: true });

  root.addEventListener('touchmove', (e) => {
    if (!s) return;
    if (e.touches.length !== 1) { cancel(); return; }
    const t = e.touches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.lifted) {
      if (Math.hypot(dx, dy) > SLOP) cancel(); // sta scorrendo: la carta torna normale
      return;
    }
    if (e.cancelable) e.preventDefault();
    s.card.classList.add('dragging');
    const now = performance.now(), dt = Math.max(1, now - s.lt);
    s.vx = s.vx * 0.6 + ((t.clientX - s.lx) / dt) * 0.4;
    s.vy = s.vy * 0.6 + ((t.clientY - s.ly) / dt) * 0.4;
    s.lx = t.clientX; s.ly = t.clientY; s.lt = now;
    set(s.card, '--dx', `${dx.toFixed(1)}px`);
    set(s.card, '--dy', `${dy.toFixed(1)}px`);
    // si inclina nella direzione in cui la muovi, come un foglio nell'aria
    set(s.card, '--rz', `${clamp(s.vx * 9, -12, 12).toFixed(2)}deg`);
    set(s.card, '--ry', `${clamp(s.vx * 14, -14, 14).toFixed(2)}deg`);
    set(s.card, '--rx', `${clamp(-s.vy * 14, -14, 14).toFixed(2)}deg`);
  }, { passive: false });

  const end = () => {
    if (!s) return;
    if (s.lifted) root.dataset.dragged = Date.now(); // niente "tocco" dopo uno spostamento
    cancel();
  };
  root.addEventListener('touchend', end);
  root.addEventListener('touchcancel', cancel);

  // dopo aver spostato una carta, il dito che si alza non la apre
  root.addEventListener('click', (e) => {
    if (Date.now() - (+root.dataset.dragged || 0) < 450) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  root.addEventListener('contextmenu', (e) => { if (e.target.closest(selector)) e.preventDefault(); });
}

// ---------------------------------------------------------------- transizioni fluide (FLIP)
// Prima di ridisegnare si fotografano le posizioni; dopo, ogni elemento parte da dove era
// e arriva al suo posto con una molla. Così le carte si spostano invece di saltare.
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const SPRING = (() => {
  try { if (CSS.supports('transition-timing-function', 'linear(0, 1)')) return 'linear(0, 0.009, 0.035 2.1%, 0.141 4.4%, 0.723 12.9%, 0.938 16.7%, 1.017 19.4%, 1.067, 1.099 24.3%, 1.108 26%, 1.1, 1.083 30.6%, 1.026 38.2%, 1.003 42.5%, 0.989 47.9%, 0.993 61.4%, 1.001 76.5%, 1)'; } catch {}
  return 'cubic-bezier(.3, 1.4, .5, 1)';
})();
const keyOf = (el) => el.dataset.k || el.dataset.item || el.dataset.bid || (el.dataset.rest ? 'rest' : '');

/** Le posizioni attuali degli elementi con una chiave. */
export function flipCapture(root, selector) {
  const out = new Map();
  if (!root) return out;
  for (const el of root.querySelectorAll(selector)) { const k = keyOf(el); if (k && !out.has(k)) out.set(k, el.getBoundingClientRect()); }
  return out;
}

/** Dopo il nuovo disegno: chi si è mosso scivola al suo posto, chi è nuovo entra con una molla. */
export function flipPlay(root, selector, before, { enter = true } = {}) {
  if (!root || !before || reduce()) return;
  const H = innerHeight;
  let n = 0;
  for (const el of root.querySelectorAll(selector)) {
    const k = keyOf(el);
    if (!k) continue;
    const a = before.get(k), b = el.getBoundingClientRect();
    if (b.bottom < -50 || b.top > H + 50) continue; // fuori dallo schermo: niente lavoro
    if (a) {
      const dx = a.left - b.left, dy = a.top - b.top, s = a.width && b.width ? a.width / b.width : 1;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) continue;
      el.animate([{ translate: `${dx}px ${dy}px`, scale: `${s}` }, { translate: '0 0', scale: '1' }], { duration: 650, easing: SPRING });
    } else if (enter) {
      el.animate([{ opacity: 0, scale: '0.86', translate: '0 18px' }, { opacity: 1, scale: '1', translate: '0 0' }], { duration: 700, easing: SPRING, delay: Math.min(6, n++) * 40, fill: 'backwards' });
    }
  }
}

/** Una copia dell'elemento vola da dove era fino a un altro punto (la pila delle fatte), rimpicciolendo. */
export function flyTo(ghost, from, to, { done } = {}) {
  if (reduce() || !from || !to) { ghost?.remove(); done?.(); return; }
  Object.assign(ghost.style, { position: 'fixed', left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px', margin: 0, zIndex: 40, pointerEvents: 'none' });
  document.body.appendChild(ghost);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const s = Math.max(0.3, Math.min(1, to.width / from.width));
  const a = ghost.animate([
    { translate: '0 0', scale: '1', rotate: '0deg', opacity: 1 },
    { translate: `0 -14px`, scale: '1.04', rotate: '-2deg', opacity: 1, offset: 0.18 },
    { translate: `${dx}px ${dy}px`, scale: `${s}`, rotate: '3deg', opacity: 0.2 },
  ], { duration: 720, easing: 'cubic-bezier(.5, 0, .2, 1)', fill: 'forwards' });
  a.onfinish = () => { ghost.remove(); done?.(); };
}

/** Un piccolo rimbalzo (la pila che riceve una carta, un numero che cambia). */
export function bump(el, amount = 1.06) {
  if (!el || reduce()) return;
  el.animate([{ scale: '1' }, { scale: `${amount}` }, { scale: '1' }], { duration: 520, easing: SPRING });
}
