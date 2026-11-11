// Prova nel browser degli stati del giorno (390x844). NON fa parte di `npm test`.
// Uso: node tests/ui/stati.mjs [--shots <cartella>]   (vedi README.md)
// Playwright non è una dipendenza: si cerca a runtime, se manca si salta (uscita 0).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shotsDir = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1] || 'shots') : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

async function trovaPlaywright() {
  try { return await import('playwright'); } catch {}
  try {
    const g = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return createRequire(path.join(g, '/')) ('playwright');
  } catch {}
  return null;
}
const pw = await trovaPlaywright();
const chromium = pw && (pw.chromium || pw.default?.chromium);
if (!chromium) { console.log('saltato: Playwright non è installato (non è una dipendenza del progetto).'); process.exit(0); }

// ---- tempo fisso, indipendente dal fuso della macchina ----
const TZ = 'Europe/Rome'; // 11 novembre 2026: ora solare, UTC+1
const DAY = '2026-11-11';
const at = (h, m = 0) => Date.UTC(2026, 10, 11, h - 1, m);
const base = { priority: 2, energy: 2, durationEstimated: false, dependsOn: [], notes: '', project: null, goalId: null, theme: null, spent: 0, deadline: null, earliest: null, window: null, startedAt: null, doneAt: null, actual: null, createdAt: at(7), updatedAt: at(7) };
let n = 0;
const task = (title, duration, o = {}) => ({ ...base, id: 't' + ++n, title, kind: 'task', date: null, start: null, duration, status: 'todo', ...o });
const ev = (title, h, m, duration, o = {}) => ({ ...base, id: 'e' + ++n, title, kind: 'event', date: DAY, start: h * 60 + m, duration, status: 'todo', ...o });
const done = (title, h, m, duration) => task(title, duration, { date: DAY, status: 'done', doneAt: at(h, m), actual: duration });

const SCEN = {
  empty: { time: [10, 0], items: () => [task('Chiamare il dentista', 20, { date: '2026-11-12' })] },
  before: { time: [10, 20], items: () => [ev('Riunione di team', 11, 0, 60), task('Rispondere alle email', 30), task('Preparare la presentazione', 45)] },
  doing: { time: [10, 20], items: () => [task('Scrivere la relazione', 60, { status: 'doing', startedAt: at(10, 0), date: DAY, start: 600 }), ev('Pranzo con Marta', 13, 0, 60), task('Fare la spesa', 30)] },
  full: { time: [7, 0], items: () => [
    ev('Riunione settimanale', 9, 30, 60), ev('Dentista', 12, 0, 60), ev('Chiamata con il fornitore', 15, 0, 45), ev('Corso di inglese', 18, 30, 90),
    ...['Scrivere il report:120', 'Rivedere il budget:90', 'Fare la spesa:45', 'Pulire la casa:90', 'Studiare per l\'esame:120', 'Allenamento:60', 'Pagare le bollette:20', 'Preparare il viaggio:120', 'Sistemare l\'archivio:120']
      .map((s) => task(s.split(':')[0], +s.split(':')[1], { date: DAY, priority: 3 }))] },
  evening: { time: [20, 30], items: () => [done('Rispondere alle email', 9, 30, 30), done('Scrivere il report', 12, 0, 90), done('Fare la spesa', 17, 30, 45), { ...ev('Riunione di team', 11, 0, 60), status: 'done', doneAt: at(12) }] },
  focus: { time: [10, 20], items: () => [task('Scrivere la relazione', 60, { id: 'tfocus', status: 'doing', startedAt: at(10, 0), date: DAY, start: 600 }), task('Rispondere alle email', 30)],
    focus: { itemId: 'tfocus', title: 'Scrivere la relazione', theme: 'generic', mode: 'timer', phase: 'work', minutes: 60, startedAt: at(10, 0), pausedAt: null, paused: 0, worked: 0, round: 1, createdAt: at(10, 0) } },
};

// ---- server statico locale, solo 127.0.0.1 ----
const TIPI = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TIPI[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

// ---- esiti ----
let ok = 0, ko = 0;
const check = (cond, msg) => { if (cond) ok++; else { ko++; console.log('  FALLITO: ' + msg); } };

const browser = await chromium.launch();

async function apri(nome, scheme, { reduced = false } = {}) {
  const s = SCEN[nome]; n = 0;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference', locale: 'it-IT', timezoneId: TZ });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const items = s.items();
  const st = { schema: 5, onboarded: true, items, focus: s.focus || null, stats: { createdAt: at(0) - 864e5 * 20, lastOpenAt: at(...s.time) - 6e4, backupShownOn: DAY, exportedEdits: 0, edits: 0 } };
  await page.clock.install({ time: at(...s.time) });
  await page.addInitScript((x) => { try { localStorage.setItem('tempo.v1', JSON.stringify(x)); } catch {} }, st);
  await page.goto(url);
  await page.waitForSelector('#app[data-mood]');
  await quieta(page);
  return { ctx, page, errs };
}
// fa scorrere l'orologio finto e aspetta la fine delle animazioni finite
async function quieta(page) {
  await page.clock.runFor(1000);
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  await page.clock.runFor(500);
}
const stato = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tempo.v1')).items.map((i) => [i.title, i.status]));

// misure dentro la pagina
const misure = (page) => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight;
  const vis = (el) => { if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh ? r : null; };
  const sel = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].map((c) => '.' + c).join('');
  const a = document.querySelector('.now-anchor')?.getBoundingClientRect();
  const q = (s) => document.querySelector(s)?.textContent.trim().replace(/\s+/g, ' ') ?? null;
  const cards = [...document.querySelectorAll('#collage > .col .pc')];
  const piccoli = [];
  for (const el of document.querySelectorAll('button, [role=button], a, input, select')) {
    const r = vis(el); if (!r) continue;
    let w = r.width, h = r.height;
    if (w < 43.5 || h < 43.5) {
      const cs = getComputedStyle(el, '::after');
      if (cs.content !== 'none') { const pw = parseFloat(cs.width), ph = parseFloat(cs.height); if (pw > 0) w = Math.max(w, pw); if (ph > 0) h = Math.max(h, ph); }
    }
    if (w < 43.5 || h < 43.5) piccoli.push(`${sel(el)} ${Math.round(r.width)}x${Math.round(r.height)}${w !== r.width || h !== r.height ? ` (con ::after ${Math.round(w)}x${Math.round(h)})` : ''}`);
  }
  const testi = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t; (t = tw.nextNode());) {
    if (!t.nodeValue.trim() || !t.parentElement || !vis(t.parentElement)) continue;
    const fs = parseFloat(getComputedStyle(t.parentElement).fontSize);
    if (fs < 12) testi.push(`${sel(t.parentElement)} ${fs}px «${t.nodeValue.trim().slice(0, 24)}»`);
  }
  return {
    mood: document.querySelector('#app').dataset.mood,
    y: a ? a.top : null,
    cards: cards.length, nonMissed: cards.filter((c) => !c.classList.contains('missed')).length,
    handle: q('.more-handle'), primaries: [...document.querySelectorAll('.adv-go')].map((b) => b.textContent.trim()),
    hint: !!document.querySelector('.empty-hint'), piccoli: [...new Set(piccoli)], testi: [...new Set(testi)],
  };
});

// ---- 1. sei stati x due schemi ----
const ATTESO = { empty: 'empty', before: 'before', doing: 'doing', full: 'full', evening: 'evening', focus: 'focus' };
for (const scheme of ['light', 'dark']) {
  const ys = {};
  for (const nome of Object.keys(SCEN)) {
    const sigla = `${nome}/${scheme}`;
    console.log(sigla);
    const { ctx, page, errs } = await apri(nome, scheme);
    const m = await misure(page);
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${nome}-${scheme}.png`) });
    check(errs.length === 0, `${sigla}: errori in console o nella pagina: ${errs.join(' | ')}`);
    check(m.mood === ATTESO[nome], `${sigla}: mood atteso «${ATTESO[nome]}», trovato «${m.mood}»`);
    ys[nome] = m.y;
    check(m.piccoli.length === 0, `${sigla}: controlli sotto 44x44: ${m.piccoli.join('; ')}`);
    check(m.testi.length === 0, `${sigla}: testi sotto 12px: ${m.testi.join('; ')}`);
    if (nome === 'empty') {
      check(m.primaries.length === 1 && /^Aggiungi/.test(m.primaries[0]), `${sigla}: atteso un solo bottone primario «Aggiungi», trovati ${JSON.stringify(m.primaries)}`);
      check(!m.hint, `${sigla}: c'è ancora un .empty-hint`);
    }
    if (nome === 'evening') check(m.primaries.length === 0, `${sigla}: la sera non deve avere bottone primario, trovati ${JSON.stringify(m.primaries)}`);
    if (nome === 'full') {
      check(m.nonMissed <= 3, `${sigla}: attese al massimo 3 carte non perse, trovate ${m.nonMissed}`);
      check(/^Altre \d+/.test(m.handle || ''), `${sigla}: testo dell'appiglio atteso /^Altre \\d+/, trovato ${JSON.stringify(m.handle)}`);
      await page.click('.more-handle'); await quieta(page);
      const aperto = await page.evaluate(() => ({ carte: document.querySelectorAll('#collage > .col .pc').length, meno: document.querySelector('.more-handle')?.textContent.trim() }));
      check(aperto.carte > m.cards, `${sigla}: dopo il clic sull'appiglio le carte dovevano aumentare (${m.cards} -> ${aperto.carte})`);
      check(/Mostra meno/.test(aperto.meno || ''), `${sigla}: dopo il clic atteso «Mostra meno», trovato ${JSON.stringify(aperto.meno)}`);
      await page.click('.more-handle'); await quieta(page);
      const chiuso = await page.evaluate(() => ({ carte: document.querySelectorAll('#collage > .col .pc').length, h: document.querySelector('.more-handle')?.textContent.trim() }));
      check(chiuso.carte === m.cards, `${sigla}: dopo «Mostra meno» attese ${m.cards} carte, trovate ${chiuso.carte}`);
      check(/^Altre \d+/.test(chiuso.h || ''), `${sigla}: dopo «Mostra meno» l'appiglio doveva tornare «Altre N», trovato ${JSON.stringify(chiuso.h)}`);
    }
    await ctx.close();
  }
  const vals = Object.entries(ys);
  const min = Math.min(...vals.map(([, v]) => v)), max = Math.max(...vals.map(([, v]) => v));
  check(vals.every(([, v]) => v != null) && max - min <= 2, `${scheme}: «Adesso» non sta fermo, y per stato ${JSON.stringify(Object.fromEntries(vals.map(([k, v]) => [k, v == null ? null : Math.round(v * 10) / 10])))}`);
}

// ---- 2. flusso: Inizia -> Fatto -> annulla; foglio e focus ----
console.log('flusso/before');
{
  const { ctx, page, errs } = await apri('before', 'light');
  const prima = await stato(page);
  check(/^Inizia/.test(await page.textContent('.now-anchor .adv-go')), 'flusso: nello stato «before» il bottone primario doveva essere «Inizia»');
  await page.click('.now-anchor .adv-go'); await quieta(page);
  const inCorso = (await stato(page)).filter(([, s]) => s === 'doing');
  check(inCorso.length === 1, `flusso: dopo «Inizia» attesa 1 attività in corso, trovate ${inCorso.length}`);
  check(/^Fatto/.test(await page.textContent('.now-anchor .adv-go').catch(() => '')), 'flusso: dopo «Inizia» il bottone primario doveva diventare «Fatto»');
  const titolo = inCorso[0]?.[0];
  await page.click('.now-anchor .adv-go'); await quieta(page);
  const dopo = await stato(page);
  check(dopo.some(([t, s]) => t === titolo && s === 'done'), `flusso: dopo «Fatto» «${titolo}» doveva essere conclusa`);
  const pila = await page.evaluate(() => document.querySelector('.done-stack .ds-n')?.textContent.trim() ?? null);
  check(pila === '1', `flusso: la pila delle concluse doveva mostrare 1, mostra ${JSON.stringify(pila)}`);
  const inCollage = await page.evaluate((t) => [...document.querySelectorAll('#collage .pc')].some((c) => c.textContent.includes(t)), titolo);
  check(!inCollage, `flusso: «${titolo}» è ancora tra le carte dopo «Fatto»`);
  await page.click('#undo-btn'); await quieta(page);
  const annullato = await stato(page);
  check(annullato.find(([t]) => t === titolo)?.[1] === 'doing', `flusso: dopo l'annulla «${titolo}» doveva tornare in corso, è ${annullato.find(([t]) => t === titolo)?.[1]}`);
  check(JSON.stringify(prima.map(([t]) => t)) === JSON.stringify(annullato.map(([t]) => t)), 'flusso: l\'annulla ha cambiato l\'elenco delle attività');
  check(errs.length === 0, `flusso: errori in console: ${errs.join(' | ')}`);

  // foglio: inert sullo sfondo e focus all'apertore
  const carta = page.locator('#collage .col .pc[data-item]').first();
  await carta.focus().catch(() => {});
  const id = await carta.getAttribute('data-item');
  await carta.click(); await quieta(page);
  const aperto = await page.evaluate(() => ({ inert: document.querySelector('#app').inert, sheet: !document.querySelector('#sheet').hidden }));
  check(aperto.sheet && aperto.inert, `flusso: con il foglio aperto #app doveva essere inert (foglio aperto: ${aperto.sheet}, inert: ${aperto.inert})`);
  await page.keyboard.press('Escape'); await quieta(page);
  const chiuso = await page.evaluate(() => { const a = document.activeElement; return { inert: document.querySelector('#app').inert, item: a?.closest?.('[data-item]')?.dataset.item ?? null, tag: a ? a.tagName + (a.className ? '.' + String(a.className).split(' ')[0] : '') : null }; });
  check(!chiuso.inert, 'flusso: chiuso il foglio #app è ancora inert');
  check(chiuso.item === id, `flusso: chiuso il foglio il focus doveva tornare alla carta ${id}, è su ${chiuso.tag} (carta ${chiuso.item})`);
  await ctx.close();
}

// ---- 3. movimento ridotto ----
console.log('movimento-ridotto/empty');
{
  const { ctx, page } = await apri('empty', 'light', { reduced: true });
  const r = await page.evaluate(() => [...document.querySelectorAll('.bg i')].map((el) => {
    const cs = getComputedStyle(el);
    const inCorso = el.getAnimations().filter((a) => a.playState === 'running' && a.effect.getTiming().iterations === Infinity).length;
    return { name: cs.animationName, state: cs.animationPlayState, dur: cs.animationDuration, iter: cs.animationIterationCount, inCorso };
  }));
  check(r.length > 0, 'movimento ridotto: nessun .bg i trovato');
  check(r.every((x) => x.inCorso === 0), `movimento ridotto: animazioni infinite ancora in corso sullo sfondo: ${JSON.stringify(r.filter((x) => x.inCorso))}`);
  await ctx.close();
}

await browser.close(); server.close();
console.log(ko ? `\n${ko} controlli falliti, ${ok} riusciti.` : `\nTutti i ${ok} controlli riusciti.`);
process.exit(ko ? 1 : 0);
