// Copertine generative: forme piatte e geometriche, sempre uguali per lo stesso brano.
import { seedOf, rng } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#141414';
const PAPER = '#ecebe6';
const SIGNAL = '#ff5b14';
const COBALT = '#2747ff';
const BUTTER = '#ffcf1f';
const STONE = '#8b8a85';
const PALETTES = [
  [PAPER, INK, SIGNAL], [INK, SIGNAL, PAPER], [SIGNAL, INK, PAPER], [COBALT, PAPER, SIGNAL],
  [BUTTER, INK, SIGNAL], [STONE, PAPER, INK], [PAPER, COBALT, SIGNAL], [INK, PAPER, BUTTER],
];

const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

export function cover(key, { size } = {}) {
  const r = rng(seedOf(key));
  const [bg, fg, ac] = PALETTES[Math.floor(r() * PALETTES.length)];
  const svg = el('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true', class: 'cover-svg', preserveAspectRatio: 'xMidYMid slice' });
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  svg.append(el('rect', { width: 100, height: 100, fill: bg }));
  const kind = Math.floor(r() * 5);
  if (kind === 0) {
    // un grande cerchio fuori centro e un punto
    svg.append(el('circle', { cx: 30 + r() * 40, cy: 30 + r() * 40, r: 26 + r() * 14, fill: fg }));
    svg.append(el('circle', { cx: 15 + r() * 70, cy: 15 + r() * 70, r: 5 + r() * 4, fill: ac }));
  } else if (kind === 1) {
    // griglia di punti, uno acceso
    const hot = Math.floor(r() * 16);
    for (let i = 0; i < 16; i++) svg.append(el('circle', { cx: 20 + (i % 4) * 20, cy: 20 + Math.floor(i / 4) * 20, r: 6, fill: i === hot ? ac : fg }));
  } else if (kind === 2) {
    // livelli: barre verticali come un meter
    for (let i = 0; i < 8; i++) {
      const hgt = 15 + r() * 65;
      svg.append(el('rect', { x: 10 + i * 10.5, y: 90 - hgt, width: 7, height: hgt, fill: i === 5 ? ac : fg }));
    }
  } else if (kind === 3) {
    // quarti di cerchio 2x2
    const q = [[0, 0], [50, 0], [0, 50], [50, 50]];
    q.forEach(([x, y], i) => {
      const corner = Math.floor(r() * 4);
      const cx = x + (corner % 2) * 50;
      const cy = y + Math.floor(corner / 2) * 50;
      svg.append(el('path', { d: `M${cx} ${cy} L${cx === x ? x + 50 : x} ${cy} A50 50 0 0 ${corner === 0 || corner === 3 ? 1 : 0} ${cx} ${cy === y ? y + 50 : y} Z`, fill: i === 1 ? ac : fg }));
    });
  } else {
    // una manopola: anello, indicatore, punto
    const a = r() * Math.PI * 1.5 - Math.PI * 1.25;
    svg.append(el('circle', { cx: 50, cy: 50, r: 30, fill: 'none', stroke: fg, 'stroke-width': 9 }));
    svg.append(el('line', { x1: 50, y1: 50, x2: 50 + Math.cos(a) * 30, y2: 50 + Math.sin(a) * 30, stroke: ac, 'stroke-width': 9, 'stroke-linecap': 'round' }));
    svg.append(el('circle', { cx: 50, cy: 50, r: 4, fill: fg }));
  }
  return svg;
}
