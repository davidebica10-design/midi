// Prova nel browser delle proposte (inviti senza server) tra DUE persone: Anna (Europe/Rome) e Bruno (Asia/Tokyo),
// due contesti con archivi separati. NON fa parte di `npm test`.
// Uso: node tests/ui/inviti.mjs [--solo 3]   (vedi README.md)
// Playwright non è una dipendenza: si cerca a runtime, se manca si salta (uscita 0).
// Solo dati inventati; `navigator.share` e gli appunti sono sostituiti da finti che catturano il testo;
// ogni richiesta fuori da 127.0.0.1 è fermata e contata (i caratteri di Google ricevono un foglio vuoto).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function trovaPlaywright() {
  try { return await import('playwright'); } catch {}
  try {
    const g = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return createRequire(path.join(g, '/'))('playwright');
  } catch {}
  return null;
}
const pw = await trovaPlaywright();
const chromium = pw && (pw.chromium || pw.default?.chromium);
if (!chromium) { console.log('saltato: Playwright non è installato (non è una dipendenza del progetto).'); process.exit(0); }

// ---- tempo fisso: 11 novembre 2026, 10:00 a Roma (UTC+1) = 18:00 a Tokyo (UTC+9). Nessun cambio d'ora in vista. ----
const NOW = Date.UTC(2026, 10, 11, 9, 0);
const OGGI = '2026-11-11', DOMANI = '2026-11-12';
const ROMA = 'Europe/Rome', TOKYO = 'Asia/Tokyo';
const UTC_OFF = { [ROMA]: 60, [TOKYO]: 540 };
const base = { priority: 2, energy: 2, durationEstimated: false, dependsOn: [], notes: '', project: null, goalId: null, theme: null, spent: 0, deadline: null, earliest: null, window: null, startedAt: null, doneAt: null, actual: null, createdAt: NOW, updatedAt: NOW };
const task = (id, title, duration, o = {}) => ({ ...base, id, title, kind: 'task', date: null, start: null, duration, status: 'todo', ...o });
const ev = (id, title, date, h, m, duration, o = {}) => ({ ...base, id, title, kind: 'event', date, start: h * 60 + m, duration, status: 'todo', ...o });
const AI = { openPreset: 'custom', openBaseUrl: 'https://ai.example.test/v1', openModel: 'm1', openKey: 'chiave-finta-0000' };
const CENA = 'Cena con Marco';
const SEGRETO = 'SEGRETO-XYZ', DENTISTA = 'Dentista riservato';

// Anna ha la cena oggi alle 19:00 (a Roma): per Bruno è domani alle 03:00–04:00.
const ANNA = () => [task('ta1', 'Scrivere la relazione', 45), ev('ea1', CENA, OGGI, 19, 0, 60)];
// Bruno: libero (solo un'attività flessibile)...
const BRUNO_LIBERO = () => [task('tb1', 'Leggere il manuale', 30)];
// ...oppure con impegni fissi: uno in conflitto con la cena (domani 03:30), uno che occupa le prime fasce libere (08:00).
const BRUNO_PIENO = () => [task('tb1', 'Leggere il manuale', 30), ev('eb1', SEGRETO, DOMANI, 3, 30, 60), ev('eb2', DENTISTA, DOMANI, 8, 0, 60), ev('eb3', 'Corso serale', OGGI, 22, 0, 60)];

const stato = (items, { onboarded = true, settings = {} } = {}) => ({ schema: 5, onboarded, items, focus: null, settings, stats: { createdAt: NOW - 864e5 * 20, lastOpenAt: NOW - 6e4, backupShownOn: OGGI, exportedEdits: 0, edits: 0 } });

// ---- le stesse conversioni, fatte qui a mano (offset fissi), per non dipendere dal codice che si prova ----
const ts = (d, min, tz) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd, 0, min - UTC_OFF[tz]); };
const locale = (t, tz) => { const x = new Date(t + UTC_OFF[tz] * 60000); const p = (n) => String(n).padStart(2, '0'); return { d: `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`, s: x.getUTCHours() * 60 + x.getUTCMinutes() }; };
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
/** «Domani, 09:00–10:00» / «✓ Giovedì 12 novembre, …» -> { d, s, e } nel giorno OGGI. */
function leggiFascia(testo) {
  const t = testo.replace(/^✓\s*/, '').toLowerCase();
  const [giorno, ore] = [t.slice(0, t.lastIndexOf(',')), t.slice(t.lastIndexOf(',') + 1)];
  const o = ore.match(/(\d\d):(\d\d)\s*[–-]\s*(\d\d):(\d\d)/);
  let d = null;
  if (/^oggi/.test(giorno)) d = OGGI; else if (/^domani/.test(giorno)) d = DOMANI;
  else { const m = giorno.match(/(\d{1,2})\s+([a-zì]+)/); if (m && MESI.includes(m[2])) d = `2026-${String(MESI.indexOf(m[2]) + 1).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`; }
  return o && d ? { d, s: +o[1] * 60 + +o[2], e: +o[3] * 60 + +o[4] } : null;
}
// ---- inviti costruiti a mano (anche rovinati): niente passa dal codice dell'app ----
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const gettone = (o) => 'tempo:inv1:' + b64u(JSON.stringify(o));
const PROPOSTA = (o = {}) => ({ v: 1, kind: 'proposta', id: 'ext-1', t: 'Aperitivo da Luca', d: DOMANI, s: 600, e: 660, tz: ROMA, ts: ts(DOMANI, 600, ROMA), from: 'Anna', note: '', ...o });
const messaggio = (tok, riga = 'Ti propongo: qualcosa. Per rispondere apri Tempo e incolla questo messaggio.') => `${riga}\n[${tok}]`;
const gettoneDi = (testo) => (testo.match(/#invito=([A-Za-z0-9_-]+)/) || testo.match(/\[tempo:inv1:([A-Za-z0-9_-]+)\]/) || [])[1] || '';
const decodifica = (tok) => JSON.parse(Buffer.from(tok, 'base64url').toString('utf8'));

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
const solo = process.argv.includes('--solo') ? process.argv[process.argv.indexOf('--solo') + 1] : null;
const browser = await chromium.launch();
const aperti = [];
const scenario = async (nome, fn) => {
  if (solo && !nome.startsWith(solo + '.')) return;
  console.log(nome);
  try { await fn(); } catch (e) { ko++; console.log(`  FALLITO: ${nome}: lo scenario si è interrotto: ${String(e.message).split('\n')[0]}`); }
  while (aperti.length) await aperti.pop().close().catch(() => {});
};

/**
 * Una persona = un contesto con archivio suo. `nome` null = senza firma. `hash` = indirizzo con #invito=…
 * `ls` = altre chiavi di localStorage da scrivere prima dell'avvio (valori grezzi).
 */
async function persona({ chi, tz, items, nome = null, onboarded = true, hash = '', ls = {}, raw = null, width = 390 }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'no-preference', locale: 'it-IT', timezoneId: tz });
  aperti.push(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  const fuori = []; page.fuori = fuori; page.errs = errs;
  await page.route((u) => new URL(u).hostname !== '127.0.0.1', (r) => {
    const u = r.request().url();
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) return r.fulfill({ status: 200, contentType: 'text/css', body: '' });
    fuori.push(u); r.abort();
  });
  await page.clock.install({ time: NOW });
  const seme = raw ?? JSON.stringify(stato(items, { onboarded, settings: AI }));
  await page.addInitScript(({ seme, nome, ls, chi }) => {
    try {
      if (!sessionStorage.getItem('__seme')) {
        sessionStorage.setItem('__seme', '1');
        localStorage.setItem('tempo.v1', seme);
        if (nome != null) localStorage.setItem('tempo.nome', nome);
        for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
      }
    } catch {}
    // identificatori fissi (nessuna casualità), condivisione e appunti finti che catturano il testo
    let n = 0; try { crypto.randomUUID = () => `${chi}-${++n}`; } catch {}
    window.__share = []; window.__copy = []; window.__shareMode = 'ok';
    const def = (o, k, v) => { try { Object.defineProperty(o, k, { configurable: true, value: v }); } catch {} };
    def(navigator, 'share', async (d) => { if (window.__shareMode === 'abort') throw new DOMException('annullato', 'AbortError'); window.__share.push(String(d.text)); });
    def(navigator, 'canShare', () => false);
    def(navigator, 'clipboard', { writeText: async (t) => { window.__copy.push(String(t)); }, readText: async () => '' });
  }, { seme, nome, ls, chi });
  await page.goto(url + hash);
  await page.waitForSelector(onboarded ? '#app[data-mood]' : '#onb:not([hidden])');
  await quieta(page);
  return { ctx, page };
}
async function quieta(page) {
  await page.clock.runFor(1000);
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  await page.clock.runFor(500);
}
const v1 = (page) => page.evaluate(() => localStorage.getItem('tempo.v1'));
const ls = (page, k) => page.evaluate((k) => localStorage.getItem(k), k);
const voci = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tempo.v1')).items);
const inviti = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('tempo.inviti') || '[]'); } catch { return 'ROTTO'; } });
const incolla = async (page, testo) => {
  await page.evaluate((t) => { const i = document.querySelector('#input'); i.focus(); const dt = new DataTransfer(); dt.setData('text', t); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, testo);
  await quieta(page);
};
const scrivi = async (page, testo) => { await page.fill('#input', testo); await page.click('#send'); await quieta(page); };
const carta = (page) => page.evaluate(() => {
  const tutte = [...document.querySelectorAll('[data-notice="invito"]')].filter((e) => e.checkVisibility());
  const el = tutte[0]; if (!el) return null;
  const t = (s) => el.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  return {
    n: tutte.length, what: t('.n-what'), why: t('.n-why'), next: t('.n-next'), verdetto: t('.inv-verdict'), verdettoCls: el.querySelector('.inv-verdict')?.className ?? '',
    azioni: [...el.querySelectorAll('button:not(.r-x)')].map((b) => b.textContent.trim()), chips: [...el.querySelectorAll('.inv-alts .ch')].map((b) => b.textContent.trim()),
    msg: el.querySelector('.inv-msg') ? [...el.querySelectorAll('.inv-msg > div')].map((d) => d.textContent).join('\n') : null,
    testo: el.textContent.replace(/\s+/g, ' ').trim(), immagini: el.querySelectorAll('img').length,
  };
});
const tocca = async (page, etichetta) => { await page.locator('[data-notice="invito"] button', { hasText: etichetta }).first().click(); await quieta(page); };
const toast = (page) => page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? { testo: t.querySelector('span')?.textContent.trim() ?? '', bottoni: [...t.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null; });
const premiToast = async (page, etichetta) => { await page.locator('#toast button', { hasText: etichetta }).first().click(); await quieta(page); };
const ultimo = (page, k) => page.evaluate((k) => window[k].at(-1) ?? null, k);
const titoli = (xs) => xs.map((i) => i.title);

/** Anna propone la cena dalla scheda dell'impegno fisso e condivide. Restituisce il messaggio catturato. */
async function annaProponeDallaScheda(page) {
  await page.locator('#collage .pc[data-item]', { hasText: CENA }).first().locator('.pc-title').click(); await quieta(page);
  await page.locator('[data-sheet="propose"]').click(); await quieta(page);
  await page.locator('[data-inv="share"]').click(); await quieta(page);
  return ultimo(page, '__share');
}

// ============================================================ 1. proporre dalla scheda
await scenario('1. Anna propone dalla scheda di un impegno fisso', async () => {
  const { page } = await persona({ chi: 'a', tz: ROMA, items: ANNA() });
  const prima = await voci(page);
  await page.locator('#collage .pc[data-item]', { hasText: CENA }).first().locator('.pc-title').click(); await quieta(page);
  check(await page.locator('[data-sheet="propose"]').count() === 1, '1: nella scheda dell\'impegno fisso doveva esserci [data-sheet="propose"]');
  await page.locator('[data-sheet="propose"]').click(); await quieta(page);
  // senza firma il tocco su Condividi non manda niente
  check(await page.locator('#inv-name-in').count() === 1, '1: senza firma doveva comparire #inv-name-in');
  await page.locator('[data-inv="share"]').click(); await quieta(page);
  check((await ultimo(page, '__share')) === null, '1: senza firma Condividi non doveva mandare nulla');
  await page.fill('#inv-name-in', 'Anna');
  const anteprima = await page.locator('.inv-msg').innerText();
  await page.locator('[data-inv="share"]').click(); await quieta(page);
  const msg = await ultimo(page, '__share');
  check(!!msg, '1: dopo la firma Condividi doveva passare il testo a navigator.share');
  check(/Ti propongo: Cena con Marco/.test(msg || ''), `1: il messaggio doveva dire «Ti propongo: Cena con Marco», è ${JSON.stringify((msg || '').slice(0, 80))}`);
  check(/mer 11 nov, 19:00–20:00/.test(msg || ''), `1: il messaggio doveva avere giorno e ora leggibili «mer 11 nov, 19:00–20:00», è ${JSON.stringify((msg || '').split('\n')[0])}`);
  check(/Europe\/Rome/.test(msg || ''), '1: il messaggio doveva dire il fuso (Europe/Rome)');
  check(/\[tempo:inv1:[A-Za-z0-9_-]{20,}\]\s*$/.test(msg || ''), '1: l\'ultima riga doveva essere il codice [tempo:inv1:…]');
  check(/#invito=[A-Za-z0-9_-]+/.test(msg || ''), '1: il messaggio doveva avere anche il link …#invito=<codice>');
  const dec = (() => { try { return decodifica(gettoneDi(msg || '')); } catch { return null; } })();
  check(dec && dec.t === CENA && dec.from === 'Anna' && dec.ts === ts(OGGI, 19 * 60, ROMA), `1: il codice doveva contenere titolo, firma e istante giusto (${ts(OGGI, 19 * 60, ROMA)}), contiene ${JSON.stringify(dec)}`);
  check(anteprima.replace(/\s+/g, '') === (msg || '').replace(/\s+/g, ''), '1: l\'anteprima in .inv-msg doveva essere identica al testo mandato');
  const dopo = await voci(page);
  check(JSON.stringify(dopo.map((i) => [i.id, i.title, i.date, i.start])) === JSON.stringify(prima.map((i) => [i.id, i.title, i.date, i.start])), `1: il piano di Anna doveva restare com'era: ${JSON.stringify(titoli(dopo))}`);
  const mark = await page.locator('#collage .pc[data-item]', { hasText: CENA }).first().evaluate((el) => ({ marcatore: el.querySelector('.inv-mark')?.textContent.trim() ?? null, nome: el.getAttribute('aria-label') }));
  check(mark.marcatore === 'in attesa di risposta', `1: la tessera doveva mostrare .inv-mark «in attesa di risposta», mostra ${JSON.stringify(mark.marcatore)}`);
  check(/in attesa di risposta/.test(mark.nome), `1: il nome accessibile della tessera doveva dire «in attesa di risposta»: ${JSON.stringify(mark.nome)}`);
  const lista = await inviti(page);
  check(Array.isArray(lista) && lista.length === 1 && lista[0].role === 'inviata' && lista[0].status === 'attesa' && lista[0].itemId === 'ea1', `1: tempo.inviti doveva avere 1 proposta inviata in attesa legata a ea1, ha ${JSON.stringify(lista)}`);
  check((await ls(page, 'tempo.nome')) === 'Anna', '1: tempo.nome doveva essere «Anna»');
  check(page.fuori.length === 0 && page.errs.length === 0, `1: rete o errori: ${page.fuori.join(',')} ${page.errs.join(' | ')}`);
});

// ============================================================ 2. proporre dalla barra
await scenario('2. Anna propone dalla barra: entra nel piano solo con Condividi/Copia', async () => {
  const { page } = await persona({ chi: 'a', tz: ROMA, items: ANNA(), nome: 'Anna' });
  const prima = await v1(page);
  await scrivi(page, 'proponi a Marco cena oggi alle 19');
  check(await page.evaluate(() => !document.querySelector('#sheet').hidden), '2: «proponi a Marco cena oggi alle 19» doveva aprire la scheda della proposta');
  check((await v1(page)) === prima, '2: aprire la scheda non doveva cambiare tempo.v1');
  check(/Proposta per Marco/.test(await page.locator('#sheet').innerText()), '2: la scheda doveva dire «Proposta per Marco»');
  await page.keyboard.press('Escape'); await quieta(page);
  check((await v1(page)) === prima && (await inviti(page)).length === 0, '2: chiudere la scheda senza mandare non doveva cambiare niente');
  // condivisione annullata dall'utente: niente nel piano, niente registrato
  await scrivi(page, 'proponi a Marco cena oggi alle 19');
  await page.evaluate(() => { window.__shareMode = 'abort'; });
  await page.locator('[data-inv="share"]').click(); await quieta(page);
  check((await voci(page)).length === 2 && (await inviti(page)).length === 0, `2: con la condivisione annullata (AbortError) il piano doveva restare di 2 voci e tempo.inviti vuoto (voci ${(await voci(page)).length}, inviti ${(await inviti(page)).length})`);
  // Copia: ora sì
  await page.locator('[data-inv="copy"]').click(); await quieta(page);
  const copiato = await ultimo(page, '__copy');
  check(!!copiato && /Ti propongo: .*19:00/.test(copiato), `2: Copia doveva mettere negli appunti il messaggio, trovato ${JSON.stringify((copiato || '').slice(0, 60))}`);
  const dopo = await voci(page);
  const nuova = dopo.filter((i) => i.id !== 'ea1' && i.id !== 'ta1');
  check(nuova.length === 1 && nuova[0].kind === 'event' && nuova[0].date === OGGI && nuova[0].start === 19 * 60, `2: dopo Copia doveva esserci 1 impegno fisso oggi alle 19:00, trovati ${JSON.stringify(nuova.map((i) => [i.title, i.kind, i.date, i.start]))}`);
  const lista = await inviti(page);
  check(lista.length === 1 && lista[0].to === 'Marco' && lista[0].status === 'attesa' && lista[0].itemId === nuova[0]?.id, `2: tempo.inviti doveva avere la proposta a Marco in attesa legata al nuovo impegno, ha ${JSON.stringify(lista)}`);
  const t = await toast(page);
  check(t && /Copiato/.test(t.testo) && t.bottoni.includes('Annulla'), `2: attesi toast «Copiato…» con Annulla, trovato ${JSON.stringify(t)}`);
  await premiToast(page, 'Annulla');
  check((await voci(page)).length === 2, '2: Annulla doveva togliere l\'impegno appena aggiunto');
  // frasi senza giorno o senza ora: avviso e niente cambia
  for (const frase of ['proponi a Marco cena', 'proponi a Marco', 'proponi a Marco cena alle 19', 'invita Marco a cena domani']) {
    const p0 = await v1(page), i0 = await ls(page, 'tempo.inviti');
    await scrivi(page, frase);
    const c = await carta(page);
    check(c && /Mi serve il giorno e l'ora/.test(c.what) && c.next.length > 3, `2: «${frase}»: atteso l'avviso «Mi serve il giorno e l'ora» con un esempio, trovato ${JSON.stringify(c && [c.what, c.next])}`);
    check((await v1(page)) === p0 && (await ls(page, 'tempo.inviti')) === i0, `2: «${frase}» non doveva cambiare né tempo.v1 né tempo.inviti`);
    check(await page.evaluate(() => document.querySelector('#sheet').hidden), `2: «${frase}» non doveva aprire la scheda`);
  }
  check(page.fuori.length === 0, `2: richieste di rete: ${page.fuori.join(', ')}`);
});

// ============================================================ 3. Bruno incolla il messaggio
let MSG_CENA = ''; // il messaggio vero di Anna, riusato dagli scenari seguenti
await scenario('3. Bruno incolla la proposta nella barra', async () => {
  const a = await persona({ chi: 'a', tz: ROMA, items: ANNA(), nome: 'Anna' });
  MSG_CENA = await annaProponeDallaScheda(a.page);
  // libero
  const b = await persona({ chi: 'b', tz: TOKYO, items: BRUNO_LIBERO(), nome: 'Bruno' });
  const prima = await v1(b.page), inviPrima = await ls(b.page, 'tempo.inviti');
  await incolla(b.page, MSG_CENA);
  const c = await carta(b.page);
  check(!!c, '3: incollando il messaggio doveva comparire [data-notice="invito"]');
  check(c && /Anna ti propone: Cena con Marco/.test(c.what), `3: la carta doveva dire chi propone e il titolo, dice ${JSON.stringify(c?.what)}`);
  check(c && /domani, 03:00–04:00/.test(c.what), `3: l'orario doveva essere nel fuso di Bruno «domani, 03:00–04:00» (19:00 a Roma), dice ${JSON.stringify(c?.what)}`);
  check(c && /^Ci sta\.?$/.test(c.verdetto) && /\bok\b/.test(c.verdettoCls), `3: con il piano libero il verdetto doveva essere «Ci sta» (.inv-verdict.ok), è ${JSON.stringify(c && [c.verdetto, c.verdettoCls])}`);
  check(c && ['Accetta', 'Proponi altro', 'Non riesco'].every((x) => c.azioni.includes(x)), `3: attesi i tre bottoni Accetta, Proponi altro, Non riesco, trovati ${JSON.stringify(c?.azioni)}`);
  check((await v1(b.page)) === prima, '3: incollare non doveva cambiare di un byte tempo.v1');
  check((await ls(b.page, 'tempo.inviti')) === inviPrima, '3: incollare non doveva scrivere tempo.inviti');
  check((await b.page.inputValue('#input')) === '', '3: il testo incollato non doveva restare nella barra');
  check(b.page.fuori.length === 0, `3: il testo incollato non doveva andare in rete, richieste: ${b.page.fuori.join(', ')}`);
  check(b.page.errs.length === 0, `3: errori in console: ${b.page.errs.join(' | ')}`);
  // scritto a mano e inviato (non incollato): stesso risultato, nessuna richiesta all'AI, nessuna chat
  const c2 = await persona({ chi: 'c', tz: TOKYO, items: BRUNO_LIBERO(), nome: 'Bruno' });
  const p2 = await v1(c2.page);
  await scrivi(c2.page, MSG_CENA);
  check(/Anna ti propone/.test((await carta(c2.page))?.what || ''), '3: il messaggio scritto e inviato doveva mostrare la stessa carta');
  check((await v1(c2.page)) === p2 && c2.page.fuori.length === 0, `3: il messaggio inviato dalla barra non doveva toccare tempo.v1 né la rete (${c2.page.fuori.join(', ')})`);
  // con un impegno in conflitto
  const d = await persona({ chi: 'd', tz: TOKYO, items: BRUNO_PIENO(), nome: 'Bruno' });
  await incolla(d.page, MSG_CENA);
  const cd = await carta(d.page);
  check(cd && /Si sovrappone a SEGRETO-XYZ \(03:30–04:30\)/.test(cd.verdetto) && /\bbad\b/.test(cd.verdettoCls), `3: con un impegno fisso in conflitto il verdetto doveva dire «Si sovrappone a SEGRETO-XYZ (03:30–04:30)», è ${JSON.stringify(cd && [cd.verdetto, cd.verdettoCls])}`);
});

// ============================================================ 4. Accetta
await scenario('4. Bruno accetta; Annulla; la risposta arriva ad Anna', async () => {
  const a = await persona({ chi: 'a', tz: ROMA, items: ANNA(), nome: 'Anna' });
  const msg = await annaProponeDallaScheda(a.page);
  const b = await persona({ chi: 'b', tz: TOKYO, items: BRUNO_LIBERO(), nome: 'Bruno' });
  const prima = await voci(b.page);
  await incolla(b.page, msg);
  await tocca(b.page, /^Accetta$/);
  const dopo = await voci(b.page);
  const nuovi = dopo.filter((i) => !prima.some((p) => p.id === i.id));
  check(nuovi.length === 1, `4: Accetta doveva aggiungere esattamente 1 impegno, ne ha aggiunti ${nuovi.length}`);
  const n = nuovi[0] || {};
  check(n.kind === 'event' && n.title === CENA && n.date === DOMANI && n.start === 180 && n.duration === 60, `4: atteso impegno fisso «${CENA}» il ${DOMANI} alle 03:00 per 60 minuti (ora di Tokyo), trovato ${JSON.stringify([n.kind, n.title, n.date, n.start, n.duration])}`);
  const t = await toast(b.page);
  check(t && /aggiunto/.test(t.testo) && t.bottoni.includes('Annulla'), `4: atteso toast «…aggiunto…» con Annulla, trovato ${JSON.stringify(t)}`);
  const c = await carta(b.page);
  check(c && c.msg && /Va bene: Cena con Marco/.test(c.msg) && c.azioni.includes('Condividi') && c.azioni.includes('Copia'), `4: dopo Accetta doveva offrire la risposta con Condividi/Copia, ha ${JSON.stringify(c && [c.msg, c.azioni])}`);
  // Annulla riporta il piano di prima e la proposta torna nuova
  await premiToast(b.page, 'Annulla');
  check(JSON.stringify(await voci(b.page)) === JSON.stringify(prima), `4: Annulla doveva riportare le voci a com'erano: ${JSON.stringify(titoli(await voci(b.page)))}`);
  check((await inviti(b.page)).length === 0, `4: Annulla doveva togliere la proposta da tempo.inviti, ha ${JSON.stringify(await inviti(b.page))}`);
  await incolla(b.page, msg);
  check(/Anna ti propone/.test((await carta(b.page))?.what || ''), '4: dopo Annulla la stessa proposta doveva tornare nuova');
  // di nuovo Accetta, poi manda la risposta
  await tocca(b.page, /^Accetta$/);
  await b.page.locator('[data-notice="invito"] [data-inv="share"]').click(); await quieta(b.page);
  const risposta = await ultimo(b.page, '__share');
  check(/^Va bene: Cena con Marco/.test(risposta || ''), `4: la risposta doveva iniziare con «Va bene: Cena con Marco», è ${JSON.stringify((risposta || '').slice(0, 50))}`);
  // Anna incolla la risposta
  await incolla(a.page, risposta || '');
  const ca = await carta(a.page);
  check(ca && /Bruno ha accettato/.test(ca.what), `4: Anna doveva vedere «Bruno ha accettato», vede ${JSON.stringify(ca?.what)}`);
  const mark = await a.page.locator('#collage .pc[data-item]', { hasText: CENA }).first().evaluate((el) => el.querySelector('.inv-mark')?.textContent ?? null);
  check(mark === null, `4: dopo la risposta il marcatore «in attesa di risposta» doveva sparire, c'è ancora ${JSON.stringify(mark)}`);
  check((await inviti(a.page))[0]?.status === 'si', `4: la proposta di Anna doveva risultare «si», risulta ${JSON.stringify((await inviti(a.page))[0]?.status)}`);
  check(JSON.stringify(titoli(await voci(a.page))) === JSON.stringify(['Scrivere la relazione', CENA]), '4: la risposta «sì» non doveva cambiare il piano di Anna');
});

// ============================================================ 5. Proponi altro
await scenario('5. Bruno propone altre fasce; Anna sceglie', async () => {
  const a = await persona({ chi: 'a', tz: ROMA, items: ANNA(), nome: 'Anna' });
  const msg = await annaProponeDallaScheda(a.page);
  const b = await persona({ chi: 'b', tz: TOKYO, items: BRUNO_PIENO(), nome: 'Bruno' });
  const prima = await v1(b.page);
  await incolla(b.page, msg);
  await tocca(b.page, /^Proponi altro$/);
  const c = await carta(b.page);
  check(c && c.chips.length >= 1 && c.chips.length <= 3, `5: attese da 1 a 3 fasce in .inv-alts .ch, trovate ${c?.chips.length}: ${JSON.stringify(c?.chips)}`);
  const occupati = [[OGGI, 22 * 60, 23 * 60], [DOMANI, 3 * 60 + 30, 4 * 60 + 30], [DOMANI, 8 * 60, 9 * 60]];
  const fasce = (c?.chips || []).map(leggiFascia);
  check(fasce.every(Boolean), `5: ogni fascia doveva essere leggibile come «giorno, hh:mm–hh:mm», trovate ${JSON.stringify(c?.chips)}`);
  for (const f of fasce.filter(Boolean)) {
    check(f.s % 15 === 0 && f.e % 15 === 0, `5: la fascia ${f.d} ${f.s}-${f.e} doveva essere allineata ai 15 minuti`);
    check(!occupati.some(([d, s, e]) => d === f.d && f.s < e && s < f.e), `5: la fascia ${f.d} ${f.s}-${f.e} si sovrappone a un impegno fisso di Bruno`);
    check(f.e - f.s === 60, `5: la fascia doveva durare quanto la proposta (60 minuti), dura ${f.e - f.s}`);
    check(ts(f.d, f.s, TOKYO) >= NOW, `5: la fascia ${f.d} ${f.s} è nel passato`);
  }
  // scegliere due fasce e preparare la risposta
  const quante = Math.min(2, c?.chips.length || 0);
  for (let i = 0; i < quante; i++) await b.page.locator('[data-notice="invito"] .inv-alts .ch').nth(i).click();
  check((await b.page.locator('[data-notice="invito"] .inv-alts .ch[aria-pressed="true"]').count()) === quante, '5: le fasce toccate dovevano risultare aria-pressed="true"');
  await tocca(b.page, /^Prepara la risposta$/);
  await b.page.locator('[data-notice="invito"] [data-inv="share"]').click(); await quieta(b.page);
  const risposta = await ultimo(b.page, '__share');
  check(/^Non riesco: Cena con Marco/.test(risposta || '') && /Ti propongo invece:/.test(risposta || ''), `5: la risposta doveva dire «Non riesco…Ti propongo invece:», è ${JSON.stringify((risposta || '').slice(0, 120))}`);
  const grezzo = (() => { try { return JSON.stringify(decodifica(gettoneDi(risposta || ''))); } catch { return '<codice illeggibile>'; } })();
  for (const segreto of [SEGRETO, DENTISTA, 'Corso serale', 'Leggere il manuale']) {
    check(!(risposta || '').includes(segreto), `5: il messaggio di risposta non doveva contenere «${segreto}»`);
    check(!grezzo.includes(segreto), `5: il codice della risposta non doveva contenere «${segreto}»: ${grezzo.slice(0, 200)}`);
  }
  check((await v1(b.page)) === prima, '5: proporre altre fasce non doveva cambiare il piano di Bruno');
  // Anna incolla la risposta e sceglie la prima fascia
  await incolla(a.page, risposta || '');
  const ca = await carta(a.page);
  check(ca && /Bruno propone invece/.test(ca.what) && ca.chips.length === quante, `5: Anna doveva vedere «Bruno propone invece» con ${quante} fasce, vede ${JSON.stringify(ca && [ca.what, ca.chips])}`);
  const prima1 = await voci(a.page);
  await a.page.locator('[data-notice="invito"] .inv-alts .ch').first().click(); await quieta(a.page);
  const scelta = fasce[0];
  const att = scelta ? locale(ts(scelta.d, scelta.s, TOKYO), ROMA) : null;
  const cena = (await voci(a.page)).find((i) => i.id === 'ea1');
  check(att && cena && cena.date === att.d && cena.start === att.s, `5: la cena di Anna doveva spostarsi a ${att && att.d + ' ' + att.s} (fascia di Bruno ${scelta && scelta.d + ' ' + scelta.s} a Tokyo), è ${cena && cena.date + ' ' + cena.start}`);
  const t = await toast(a.page);
  check(t && /spostato/.test(t.testo) && t.bottoni.includes('Annulla'), `5: atteso toast «…spostato…» con Annulla, trovato ${JSON.stringify(t)}`);
  await premiToast(a.page, 'Annulla');
  check(JSON.stringify(await voci(a.page)) === JSON.stringify(prima1), '5: Annulla doveva rimettere la cena dov\'era');
});

// ============================================================ 6. Non riesco
await scenario('6. Bruno non riesce; Anna toglie l\'impegno', async () => {
  const a = await persona({ chi: 'a', tz: ROMA, items: ANNA(), nome: 'Anna' });
  const msg = await annaProponeDallaScheda(a.page);
  const b = await persona({ chi: 'b', tz: TOKYO, items: BRUNO_LIBERO(), nome: 'Bruno' });
  await incolla(b.page, msg);
  await tocca(b.page, /^Non riesco$/);
  await b.page.locator('[data-notice="invito"] [data-inv="share"]').click(); await quieta(b.page);
  const risposta = await ultimo(b.page, '__share');
  check(/^Non riesco: Cena con Marco/.test(risposta || ''), `6: la risposta doveva iniziare con «Non riesco: Cena con Marco», è ${JSON.stringify((risposta || '').slice(0, 50))}`);
  check((await inviti(b.page))[0]?.status === 'no', `6: la proposta ricevuta doveva risultare «no», risulta ${JSON.stringify((await inviti(b.page))[0]?.status)}`);
  await incolla(a.page, risposta || '');
  const ca = await carta(a.page);
  check(ca && /Bruno non riesce/.test(ca.what) && ca.azioni.includes('Togli dal piano'), `6: Anna doveva vedere «Bruno non riesce» con «Togli dal piano», vede ${JSON.stringify(ca && [ca.what, ca.azioni])}`);
  check((await voci(a.page)).some((i) => i.id === 'ea1'), '6: la cena doveva restare nel piano finché Anna non decide');
  const prima = await voci(a.page);
  await tocca(a.page, /^Togli dal piano$/);
  check(!(await voci(a.page)).some((i) => i.id === 'ea1'), '6: «Togli dal piano» doveva eliminare la cena');
  const t = await toast(a.page);
  check(t && t.bottoni.includes('Annulla'), `6: atteso un toast con Annulla, trovato ${JSON.stringify(t)}`);
  await premiToast(a.page, 'Annulla');
  check(JSON.stringify(await voci(a.page)) === JSON.stringify(prima), '6: Annulla doveva riportare la cena nel piano');
});

// ============================================================ 7. entrare da un link
await scenario('7. entrare dal link #invito=…', async () => {
  const a = await persona({ chi: 'a', tz: ROMA, items: ANNA(), nome: 'Anna' });
  const msg = await annaProponeDallaScheda(a.page);
  const tok = gettoneDi(msg || '');
  check(tok.length > 20, '7: il messaggio di Anna doveva contenere il link con il codice');
  const b = await persona({ chi: 'b', tz: TOKYO, items: BRUNO_LIBERO(), nome: 'Bruno', hash: `#invito=${tok}` });
  const c = await carta(b.page);
  check(c && /Anna ti propone: Cena con Marco/.test(c.what) && /domani, 03:00–04:00/.test(c.what), `7: aprendo il link doveva comparire la stessa carta, trovata ${JSON.stringify(c?.what)}`);
  check(await b.page.evaluate(() => location.hash === ''), `7: l'indirizzo doveva tornare pulito, è «${await b.page.evaluate(() => location.hash)}»`);
  check(b.page.fuori.length === 0, `7: richieste di rete: ${b.page.fuori.join(', ')}`);
  // durante la presentazione: la carta compare dopo, non si perde
  const o = await persona({ chi: 'o', tz: TOKYO, items: [], onboarded: false, hash: `#invito=${tok}` });
  check(await o.page.evaluate(() => location.hash === ''), '7: anche durante la presentazione l\'indirizzo doveva tornare pulito');
  check((await carta(o.page)) === null, '7: durante la presentazione la carta non doveva comparire sopra le domande');
  await o.page.click('#onb-skip'); await quieta(o.page);
  const co = await carta(o.page);
  check(co && /Anna ti propone: Cena con Marco/.test(co.what), `7: finita la presentazione la carta doveva comparire, trovata ${JSON.stringify(co?.what)}`);
});

// ============================================================ 8. testi ostili e rovinati
/** Incolla `testo` come Bruno: deve comparire un avviso leggibile e non cambiare niente. */
async function ostile(nome, testo, { atteso = /Non riesco a leggere/, tz = TOKYO, items = BRUNO_LIBERO(), ls: extra = {}, controlli = null } = {}) {
  const { page } = await persona({ chi: 'b', tz, items, nome: 'Bruno', ls: extra });
  const p0 = await v1(page), i0 = await ls(page, 'tempo.inviti');
  await incolla(page, testo);
  const c = await carta(page);
  check(c && atteso.test(c.what) && (c.why.length > 3 || c.next.length > 3), `8/${nome}: atteso un avviso leggibile ${atteso}, trovato ${JSON.stringify(c && [c.what, c.why, c.next])}`);
  check((await v1(page)) === p0, `8/${nome}: tempo.v1 è cambiato`);
  check((await ls(page, 'tempo.inviti')) === i0, `8/${nome}: tempo.inviti è cambiato`);
  check(page.fuori.length === 0, `8/${nome}: richieste di rete: ${page.fuori.join(', ')}`);
  check(page.errs.length === 0, `8/${nome}: errori in console: ${page.errs.join(' | ')}`);
  check((await page.inputValue('#input')) === '', `8/${nome}: il testo non doveva restare nella barra`);
  if (controlli) await controlli(page, c);
  return page;
}
await scenario('8. testi ostili e rovinati', async () => {
  const buono = gettone(PROPOSTA());
  await ostile('codice troncato', messaggio(buono.slice(0, buono.length - 25)).replace(/\]$/, ''));
  await ostile('codice troncato (solo il codice)', buono.slice(0, 30));
  await ostile('versione sbagliata', messaggio(gettone(PROPOSTA({ v: 2 }))));
  await ostile('tipo sconosciuto', messaggio(gettone(PROPOSTA({ kind: 'ordine' }))));
  await ostile('fuso inesistente', messaggio(gettone(PROPOSTA({ tz: 'Marte/Olympus' }))));
  await ostile('data impossibile', messaggio(gettone(PROPOSTA({ d: '2026-02-31' }))));
  await ostile('data nel passato (ieri)', messaggio(gettone(PROPOSTA({ d: '2026-11-10', ts: ts('2026-11-10', 600, ROMA) }))), { atteso: /Non riesco a leggere/ });
  await ostile('data nel passato (mesi fa)', messaggio(gettone(PROPOSTA({ d: '2026-03-01', ts: ts('2026-03-01', 600, ROMA) }))));
  await ostile('codice di 6 kB', messaggio(gettone(PROPOSTA({ t: 'Titolo '.repeat(900) }))));
  await ostile('base64 che non è JSON', 'Ti propongo: qualcosa\n[tempo:inv1:' + b64u('questo non è json') + ']');
  await ostile('solo il prefisso', 'tempo:inv1:');
  // titolo con HTML: nessun elemento, testo letterale
  await ostile('titolo con HTML', messaggio(gettone(PROPOSTA({ t: '<img src=x onerror=window.__xss=1> Cena', from: '<b onmouseover=window.__xss=2>Anna</b>' }))), {
    atteso: /ti propone/,
    controlli: async (page, c) => {
      const x = await page.evaluate(() => ({ img: document.querySelectorAll('img[src="x"], [onerror], [onmouseover]').length, xss: window.__xss ?? null, card: document.querySelector('[data-notice="invito"]').innerHTML }));
      check(x.img === 0 && x.xss === null, `8/titolo con HTML: nessun elemento doveva nascere dal titolo (elementi ${x.img}, __xss ${x.xss})`);
      check(/onerror=window\.__xss=1/.test(c.what) && /Cena/.test(c.what), `8/titolo con HTML: il testo doveva comparire letterale nella carta, c'è ${JSON.stringify(c.what)}`);
      check(!/<img/i.test(x.card), `8/titolo con HTML: l'HTML della carta contiene un tag <img>: ${x.card.slice(0, 160)}`);
    },
  });
  // la stessa proposta incollata due volte
  {
    const { page } = await persona({ chi: 'b', tz: TOKYO, items: BRUNO_LIBERO(), nome: 'Bruno' });
    const m = messaggio(gettone(PROPOSTA()));
    await incolla(page, m); await incolla(page, m);
    const c = await carta(page);
    check(c && c.n === 1 && /Anna ti propone/.test(c.what), `8/due volte senza rispondere: doveva restare 1 sola carta, trovate ${c?.n}`);
    await tocca(page, /^Accetta$/);
    const dopoUna = (await voci(page)).filter((i) => i.title === 'Aperitivo da Luca').length;
    await page.locator('[data-notice="invito"] .r-x').click(); await quieta(page);
    const p0 = await v1(page);
    await incolla(page, m);
    const c2 = await carta(page);
    check(dopoUna === 1 && (await voci(page)).filter((i) => i.title === 'Aperitivo da Luca').length === 1, `8/due volte: l'impegno doveva esserci una volta sola (dopo Accetta ${dopoUna})`);
    check(c2 && /già nel piano/i.test(c2.what) && !c2.azioni.includes('Accetta'), `8/due volte: la seconda volta atteso «L'hai già nel piano» senza Accetta, trovato ${JSON.stringify(c2 && [c2.what, c2.azioni])}`);
    check((await v1(page)) === p0, '8/due volte: la seconda incollata non doveva cambiare tempo.v1');
  }
  // una risposta a una proposta sconosciuta
  {
    const rep = { v: 1, kind: 'risposta', id: 'r-1', re: 'fantasma', ans: 'si', alt: [], t: 'Cena', d: DOMANI, s: 600, e: 660, tz: ROMA, ts: ts(DOMANI, 600, ROMA), from: 'Bruno' };
    await ostile('risposta sconosciuta', messaggio(gettone(rep), 'Va bene: Cena.'), { tz: ROMA, items: ANNA(), atteso: /non è per una proposta di questo Tempo/ });
    await ostile('risposta «altro» sconosciuta', messaggio(gettone({ ...rep, ans: 'altro', alt: [{ d: DOMANI, s: 720, e: 780, ts: ts(DOMANI, 720, ROMA) }] }), 'Non riesco.'), { tz: ROMA, items: ANNA(), atteso: /non è per una proposta di questo Tempo/ });
  }
});

// ============================================================ 9. archivio dei dati e copia di sicurezza
await scenario('9. igiene dell\'archivio: limite, dati rovinati, copia di sicurezza', async () => {
  // 60 proposte salvate: alla prima scrittura ne restano al massimo 50, compresa la nuova
  const vecchie = Array.from({ length: 60 }, (_, i) => ({ id: `old-${i}`, role: 'inviata', itemId: null, title: `Vecchia ${i}`, to: 'Marco', from: '', at: NOW - (i + 1) * 3600e3, status: 'attesa' }));
  {
    const { page } = await persona({ chi: 'a', tz: ROMA, items: ANNA(), nome: 'Anna', ls: { 'tempo.inviti': JSON.stringify(vecchie) } });
    await scrivi(page, 'proponi a Marco cena oggi alle 19');
    await page.locator('[data-inv="copy"]').click(); await quieta(page);
    const lista = await inviti(page);
    check(Array.isArray(lista) && lista.length <= 50, `9: tempo.inviti doveva avere al massimo 50 voci dopo una scrittura, ne ha ${Array.isArray(lista) ? lista.length : lista}`);
    check(Array.isArray(lista) && lista.some((r) => r.id === 'a-1' || r.to === 'Marco' && /Cena/i.test(r.title) && r.at >= NOW), '9: la proposta nuova doveva essere tra quelle salvate');
  }
  // 60 giorni: le più vecchie spariscono
  {
    const { page } = await persona({ chi: 'a', tz: ROMA, items: ANNA(), nome: 'Anna', ls: { 'tempo.inviti': JSON.stringify([{ id: 'antica', role: 'inviata', itemId: null, title: 'Antica', to: 'Marco', from: '', at: NOW - 61 * 864e5, status: 'attesa' }]) } });
    await scrivi(page, 'proponi a Marco cena oggi alle 19');
    await page.locator('[data-inv="copy"]').click(); await quieta(page);
    check(!(await inviti(page)).some((r) => r.id === 'antica'), '9: una proposta di 61 giorni fa doveva essere scartata alla scrittura');
  }
  // valori rovinati: l'app parte lo stesso
  const rovinati = [
    ['tempo.inviti non è JSON', { 'tempo.inviti': '{non json' }],
    ['tempo.inviti è una stringa', { 'tempo.inviti': '"ciao"' }],
    ['tempo.inviti ha voci senza senso', { 'tempo.inviti': JSON.stringify([1, null, 'x', { id: 5 }, { id: 'a b', at: NOW }, { id: 'ok1', at: 'ieri' }, { id: 'ok2', at: NOW, status: 'boh', role: 'x', title: '<b>x</b>' }]) }],
    ['tempo.nome enorme con HTML', { 'tempo.nome': '<img src=x onerror=window.__xss=1>'.repeat(200) }],
  ];
  for (const [nome, extra] of rovinati) {
    const { page } = await persona({ chi: 'a', tz: ROMA, items: ANNA(), ls: extra });
    check(await page.evaluate(() => !!document.querySelector('#app[data-mood]')), `9/${nome}: l'app doveva avviarsi`);
    check(page.errs.length === 0, `9/${nome}: errori all'avvio: ${page.errs.join(' | ')}`);
    await scrivi(page, 'proponi a Marco cena oggi alle 19');
    check(await page.evaluate(() => !document.querySelector('#sheet').hidden), `9/${nome}: «proponi a Marco…» doveva comunque aprire la scheda`);
    const nomeCampo = await page.evaluate(() => document.querySelector('#inv-name-in')?.value ?? null);
    check(nomeCampo === null || nomeCampo.length <= 40, `9/${nome}: la firma doveva essere accorciata a 40 caratteri, è di ${nomeCampo?.length}`);
    check(await page.evaluate(() => window.__xss === undefined && !document.querySelector('img[src="x"]')), `9/${nome}: l'HTML della firma ha creato un elemento o eseguito codice`);
    await page.evaluate(() => { window.__shareMode = 'ok'; });
    if (await page.locator('#inv-name-in').count()) await page.fill('#inv-name-in', 'Anna');
    await page.locator('[data-inv="copy"]').click(); await quieta(page);
    const lista = await inviti(page);
    check(Array.isArray(lista) && lista.every((r) => /^[A-Za-z0-9_.:-]{1,64}$/.test(r.id) && ['attesa', 'si', 'no', 'altro', 'spostata'].includes(r.status) && !/[<>]/.test(r.title)), `9/${nome}: dopo la scrittura tempo.inviti doveva contenere solo voci pulite, contiene ${JSON.stringify(lista).slice(0, 200)}`);
  }
  // la copia di sicurezza: caratterizzazione di cosa contiene
  {
    const a = await persona({ chi: 'a', tz: ROMA, items: ANNA(), nome: 'Anna' });
    const msg = await annaProponeDallaScheda(a.page);
    const b = await persona({ chi: 'b', tz: TOKYO, items: BRUNO_LIBERO(), nome: 'Bruno' });
    // una proposta rifiutata (non entra nel piano di Bruno) e una accettata (entra)
    await incolla(b.page, msg);
    await tocca(b.page, /^Non riesco$/);
    await b.page.locator('[data-notice="invito"] [data-inv="copy"]').click(); await quieta(b.page);
    await incolla(b.page, messaggio(gettone(PROPOSTA({ t: 'Aperitivo da Luca' }))));
    await tocca(b.page, /^Accetta$/);
    await b.page.locator('[data-notice="invito"] .r-x').click().catch(() => {}); await quieta(b.page);
    await b.page.click('#open-settings'); await quieta(b.page);
    const [dl] = await Promise.all([b.page.waitForEvent('download', { timeout: 5000 }), b.page.locator('#export').click()]);
    const testo = fs.readFileSync(await dl.path(), 'utf8');
    let json = null; try { json = JSON.parse(testo); } catch {}
    check(!!json, '9/backup: il file esportato doveva essere JSON');
    console.log(`  (caratterizzazione) chiavi della copia di Bruno: ${json ? Object.keys(json).join(', ') : 'n/d'}`);
    check(json && !('inviti' in json) && !/tempo\.inviti/.test(testo), '9/backup: la copia non doveva contenere l\'elenco delle proposte (tempo.inviti)');
    check(!testo.includes(CENA), `9/backup: la cena rifiutata da Bruno («${CENA}») non doveva comparire nella copia`);
    check(!testo.includes('Anna'), '9/backup: la firma di Anna, che ha proposto una cosa rifiutata, non doveva comparire nella copia');
    check(json && json.items.some((i) => i.title === 'Aperitivo da Luca'), '9/backup: l\'impegno accettato doveva essere nella copia, come ogni impegno del piano');
    check(!/Bruno/.test(testo), '9/backup: la firma di Bruno (tempo.nome) non doveva finire nella copia');
  }
});

await browser.close(); server.close();
console.log(ko ? `\n${ko} controlli falliti, ${ok} riusciti.` : `\nTutti i ${ok} controlli riusciti.`);
process.exit(ko ? 1 : 0);
