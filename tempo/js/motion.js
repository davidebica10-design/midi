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

/** Le carte colorate più vicine al centro dello schermo colorano le tre macchie dello sfondo. */
export function updateGlow() {
  const app = document.getElementById('app');
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
