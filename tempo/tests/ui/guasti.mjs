// Prova nel browser dei momenti peggiori: dati rotti, import, spazio pieno, AI che sbaglia, proposta vecchia,
// azioni rapide, timer finito a app chiusa, aggiornamento, titoli lunghissimi. NON fa parte di `npm test`.
// Uso: node tests/ui/guasti.mjs   (vedi README.md)
// Playwright non è una dipendenza: si cerca a runtime, se manca si salta (uscita 0).
// Solo dati inventati, solo una chiave finta; ogni richiesta verso un servizio AI è intercettata con page.route.
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

// ---- tempo fisso, indipendente dal fuso della macchina ----
const TZ = 'Europe/Rome'; // 11 novembre 2026: ora solare, UTC+1
const DAY = '2026-11-11';
const at = (h, m = 0) => Date.UTC(2026, 10, 11, h - 1, m);
const base = { priority: 2, energy: 2, durationEstimated: false, dependsOn: [], notes: '', project: null, goalId: null, theme: null, spent: 0, deadline: null, earliest: null, window: null, startedAt: null, doneAt: null, actual: null, createdAt: at(7), updatedAt: at(7) };
const task = (id, title, duration, o = {}) => ({ ...base, id, title, kind: 'task', date: null, start: null, duration, status: 'todo', ...o });
const ev = (id, title, h, m, duration, o = {}) => ({ ...base, id, title, kind: 'event', date: DAY, start: h * 60 + m, duration, status: 'todo', ...o });
const stato = (items, extra = {}, time = [10, 0]) => ({ schema: 5, onboarded: true, items, focus: null, stats: { createdAt: at(0) - 864e5 * 20, lastOpenAt: at(...time) - 6e4, backupShownOn: DAY, exportedEdits: 0, edits: 0 }, ...extra });
const GIORNO = () => [task('t1', 'Chiamare il fornitore', 30), task('t2', 'Scrivere la relazione', 45), task('t3', 'Fare la spesa', 30), ev('e1', 'Riunione di team', 15, 0, 60)];
const AI = { openPreset: 'custom', openBaseUrl: 'https://ai.example.test/v1', openModel: 'm1', openKey: 'chiave-finta-0000' };
const FRASE = 'Organizzami la settimana in modo che io respiri';

// ---- server statico locale, solo 127.0.0.1 ----
const TIPI = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let swVersione = 0; // per simulare un aggiornamento: sw.js cambia contenuto
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const head = { 'content-type': TIPI[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' };
  if (p === '/sw.js') { res.writeHead(200, head); return res.end(fs.readFileSync(f, 'utf8') + `\n// prova ${swVersione}\n`); }
  res.writeHead(200, head);
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

// ---- esiti ----
let ok = 0, ko = 0;
const check = (cond, msg) => { if (cond) ok++; else { ko++; console.log('  FALLITO: ' + msg); } };
const solo = process.argv.includes('--solo') ? process.argv[process.argv.indexOf('--solo') + 1] : null; // per le prove: --solo 7
const scenario = async (nome, fn) => {
  if (solo && !nome.startsWith(solo + '.')) return;
  console.log(nome);
  try { await fn(); } catch (e) { ko++; console.log(`  FALLITO: ${nome}: lo scenario si è interrotto: ${String(e.message).split('\n')[0]}`); }
};

const browser = await chromium.launch();

/**
 * Apre l'app. `raw`: contenuto grezzo di tempo.v1 (al posto di `st`). Il seme si scrive una volta sola per scheda
 * (così un ricaricamento vede ciò che l'app ha scritto). `clock: false` per usare il tempo vero (service worker).
 */
async function apri({ st = stato(GIORNO()), raw = null, settings = {}, scheme = 'light', clock = true, sw = false, time = [10, 0], viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: sw ? 'allow' : 'block', colorScheme: scheme, reducedMotion: 'no-preference', locale: 'it-IT', timezoneId: TZ });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  if (clock) await page.clock.install({ time: at(...time) });
  const seme = raw ?? JSON.stringify({ ...st, settings: { ...(st.settings || {}), ...settings } });
  await page.addInitScript((x) => { try { if (!sessionStorage.getItem('__seme')) { sessionStorage.setItem('__seme', '1'); localStorage.setItem('tempo.v1', x); } } catch {} }, seme);
  await page.goto(url);
  await page.waitForSelector('#app[data-mood], #onb:not([hidden])');
  await quieta(page, clock);
  return { ctx, page, errs };
}
async function quieta(page, clock = true) {
  if (clock) { await page.clock.runFor(1000); await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))); await page.clock.runFor(500); }
  else await page.waitForTimeout(400);
}
const salvato = (page) => page.evaluate(() => localStorage.getItem('tempo.v1'));
/** La parte che deve restare uguale quando un'operazione fallisce (le impostazioni cambiano: modelli scartati, ecc.). */
const nucleo = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tempo.v1')); return JSON.stringify({ items: s.items, goals: s.goals, recurring: s.recurring, prefs: s.prefs, memory: s.memory, chat: s.chat }); });
const items = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tempo.v1')).items);
const avvisi = (page) => page.evaluate(() => [...document.querySelectorAll('[data-notice]')].filter((el) => el.checkVisibility()).map((el) => ({
  key: el.dataset.notice, what: el.querySelector('.n-what')?.textContent.trim() ?? '', why: el.querySelector('.n-why')?.textContent.trim() ?? '',
  next: el.querySelector('.n-next')?.textContent.trim() ?? '', azioni: [...el.querySelectorAll('.r-actions .btn')].map((b) => b.textContent.trim()), testo: el.textContent.replace(/\s+/g, ' ').trim(),
})));
const avviso = async (page, key) => (await avvisi(page)).find((a) => a.key === key) || null;
const treParti = (a) => !!a && a.what.length > 3 && a.next.length > 3 && a.azioni.length >= 1;
const toastTesto = (page) => page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? { testo: t.querySelector('span')?.textContent.trim() ?? '', bottoni: [...t.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null; });
const apriBarra = async (page) => { if (!(await page.locator('#input').isVisible())) { await page.click('#plus'); await page.clock?.runFor?.(500).catch(() => {}); } };
const scrivi = async (page, testo) => { await apriBarra(page); await page.fill('#input', testo); await page.click('#send'); };
const vaiImpostazioni = async (page) => { await page.click('#open-settings'); await quieta(page); };

// ============================================================ 1. dati rotti all'avvio
await scenario('1. dati rotti all\'avvio', async () => {
  const rotto = '{"schema":5,"onboarded":true,"items":[{"id":"t1","title":"Chiamare il for';
  const { ctx, page } = await apri({ raw: rotto });
  const copia = await page.evaluate(() => localStorage.getItem('tempo.v1.rotto'));
  check(copia === rotto, `1: la copia in tempo.v1.rotto doveva essere identica al contenuto rotto (${rotto.length} caratteri), trovata ${copia === null ? 'nessuna copia' : copia.length + ' caratteri diversi'}`);
  const a = await avviso(page, 'rotto');
  check(treParti(a) && a.why.length > 3, `1: atteso un avviso [data-notice=rotto] con .n-what, .n-why, .n-next e un bottone, trovato ${JSON.stringify(a)}`);
  check(a && /Scarica|Esporta/i.test(a.azioni.join(' ')), `1: l'avviso doveva avere un'azione per scaricare la copia, ha ${JSON.stringify(a?.azioni)}`);
  if (await page.locator('#onb:not([hidden]) #onb-skip').count()) { await page.click('#onb-skip'); await quieta(page); }
  await scrivi(page, 'aggiungi telefonare a Marta alle 15'); await quieta(page);
  const dopo = await items(page);
  check(dopo.some((i) => /telefonare/i.test(i.title)), `1: l'app doveva restare usabile e aggiungere l'attività, voci: ${JSON.stringify(dopo.map((i) => i.title))}`);
  await page.reload(); await page.waitForSelector('#app[data-mood], #onb:not([hidden])'); await quieta(page);
  check((await page.evaluate(() => localStorage.getItem('tempo.v1.rotto'))) === rotto, '1: dopo il ricaricamento la copia rotta non c\'è più o è cambiata');
  await vaiImpostazioni(page);
  const riga = await page.evaluate(() => { const r = document.querySelector('.broken-row'); return r ? { visibile: r.checkVisibility(), testo: r.textContent.replace(/\s+/g, ' ').trim(), bottoni: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null; });
  check(riga && /Scarica/.test(riga.bottoni.join(' ')), `1: nelle Impostazioni doveva esserci la riga .broken-row con «Scarica», trovato ${JSON.stringify(riga)}`);
  await ctx.close();
});

// ============================================================ 2. import di un backup
await scenario('2. import di un backup', async () => {
  const { ctx, page } = await apri({ st: stato(GIORNO(), { goals: [{ id: 'g1', title: 'Imparare il piano', due: '2026-12-20', projectId: null, note: '' }] }) });
  await vaiImpostazioni(page);
  const importa = async (contenuto) => { await page.setInputFiles('#import-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(contenuto) }); await quieta(page); };
  const prima = await nucleo(page);
  const casi = [
    ['non è JSON', 'questo non è un backup {{{'],
    ['JSON valido ma di forma sbagliata', JSON.stringify({ ciao: 'mondo', items: 'no' })],
    ['schema più nuovo', JSON.stringify({ schema: 99, items: [task('x1', 'Da un futuro', 20)] })],
  ];
  for (const [nome, contenuto] of casi) {
    await importa(contenuto);
    const a = await avviso(page, 'backup');
    check(treParti(a) || (a && a.what && a.next), `2 (${nome}): atteso un avviso [data-notice=backup] con cosa e cosa fare, trovato ${JSON.stringify(a)}`);
    check(a && /Non ho ripristinato|più nuova/.test(a.what), `2 (${nome}): il testo doveva dire che non è stato ripristinato, dice «${a?.what}»`);
    check((await nucleo(page)) === prima, `2 (${nome}): lo stato salvato è cambiato`);
    check(!(await page.locator('#sheet').isVisible()), `2 (${nome}): si è aperto il foglio di conferma`);
  }
  const nuovo = { schema: 5, exportedAt: '2026-11-09T09:00:00.000Z', items: [task('b1', 'Pagare le bollette', 20), task('b2', 'Allenamento', 60), task('b3', 'Studiare', 90), ev('b4', 'Dentista', 12, 0, 60, { date: '2026-11-13' })], goals: [{ id: 'gb', title: 'Correre la mezza', due: '2027-02-01', projectId: null, note: '' }, { id: 'gb2', title: 'Leggere', due: '2027-03-01', projectId: null, note: '' }] };
  await importa(JSON.stringify(nuovo));
  const foglio = await page.evaluate(() => { const s = document.querySelector('#sheet'); return s && !s.hidden ? s.textContent.replace(/\s+/g, ' ').trim() : null; });
  check(foglio && /ora hai 3 attività, 1 impegno, 1 obiettivo/i.test(foglio) && /3 attività, 1 impegno, 2 obiettivi/.test(foglio), `2: la conferma doveva dire i numeri di ora (3, 1, 1) e del backup (3, 1, 2), dice: ${JSON.stringify(foglio)}`);
  // annullare dalla conferma
  await page.click('[data-sheet=close]'); await quieta(page);
  check((await nucleo(page)) === prima, '2: «Lascia com\'è» ha cambiato lo stato');
  // confermare
  await importa(JSON.stringify(nuovo));
  await page.click('[data-sheet=backup-go]'); await quieta(page);
  const dopo = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tempo.v1')); return { titoli: s.items.map((i) => i.title).sort(), goals: s.goals.length }; });
  check(dopo.titoli.length === 4 && dopo.titoli.includes('Pagare le bollette') && dopo.goals === 2, `2: dopo «Ripristina» lo stato doveva essere quello del backup, è ${JSON.stringify(dopo)}`);
  const ok2 = await avviso(page, 'backup');
  check(ok2 && /\d/.test(ok2.what) && /Ripristinat/.test(ok2.what) && ok2.azioni.includes('Annulla'), `2: il testo di riuscita doveva avere numeri e «Annulla», trovato ${JSON.stringify(ok2)}`);
  const antes = JSON.parse(prima);
  await page.getByRole('button', { name: 'Annulla', exact: true }).first().click(); await quieta(page);
  const ripr = JSON.parse(await nucleo(page));
  check(JSON.stringify(ripr.items) === JSON.stringify(antes.items) && JSON.stringify(ripr.goals) === JSON.stringify(antes.goals), `2: «Annulla» doveva riportare esattamente items e goals di prima (prima ${antes.items.length} voci e ${antes.goals.length} obiettivi, ora ${ripr.items.length} e ${ripr.goals.length})`);
  await ctx.close();
});

// ============================================================ 3. spazio pieno
await scenario('3. spazio pieno', async () => {
  const { ctx, page } = await apri();
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    window.__pieno = true;
    Storage.prototype.setItem = function (k, v) { if (window.__pieno && k === 'tempo.v1') throw new DOMException('quota', 'QuotaExceededError'); return orig.call(this, k, v); };
  });
  const fatta = async (id) => { await page.locator(`#collage .pc[data-item="${id}"]`).first().click(); await quieta(page); await page.click('[data-sheet=done]'); await quieta(page); };
  await fatta('t1');
  await fatta('t2');
  const n = await page.evaluate(() => document.querySelectorAll('[data-notice="spazio"]').length);
  check(n === 1, `3: l'avviso di spazio pieno doveva esserci una volta sola, ce ne sono ${n}`);
  const a = await avviso(page, 'spazio');
  check(treParti(a) && /Esporta/i.test(a.azioni.join(' ')), `3: atteso un avviso con cosa, cosa fare e «Esporta…», trovato ${JSON.stringify(a)}`);
  const sticky = await page.evaluate(() => !!document.querySelector('[data-notice="spazio"]'));
  await page.clock.runFor(30000);
  check(sticky && !!(await avviso(page, 'spazio')), '3: l\'avviso doveva restare dopo 30 secondi (è fisso)');
  const inMemoria = await page.evaluate(() => window.__tempo.state.items.filter((i) => i.status === 'done').map((i) => i.id).sort());
  check(inMemoria.join() === 't1,t2', `3: le due modifiche dovevano restare in memoria, fatte: ${JSON.stringify(inMemoria)}`);
  await page.evaluate(() => { window.__pieno = false; });
  await fatta('t3');
  check(!(await avviso(page, 'spazio')), '3: tornato lo spazio, l\'avviso doveva sparire');
  await ctx.close();
});

// ============================================================ 4. l'AI che non va
await scenario('4. l\'AI che non va', async () => {
  const casi = [
    { nome: 'offline', prep: async (ctx, page) => { await ctx.setOffline(true); } },
    { nome: 'timeout', route: () => { /* non risponde mai */ }, passa: 26000 },
    { nome: '401', route: (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"Incorrect API key provided"}}' }) },
    { nome: '429', route: (r) => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":{"message":"Too Many Requests"}}' }) },
    { nome: '500', route: (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' }) },
    { nome: 'JSON malformato', route: (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"reply":"Ok, sposto tutto","ops":[{"action":"mo' } }] }) }) },
  ];
  const frasi = {};
  for (const c of casi) {
    const { ctx, page } = await apri({ settings: { provider: 'online', ...AI } });
    if (c.route) await page.route('https://ai.example.test/**', c.route);
    else await page.route('https://ai.example.test/**', (r) => r.abort());
    if (c.prep) await c.prep(ctx, page);
    const prima = await nucleo(page);
    await scrivi(page, FRASE);
    await page.clock.runFor(c.passa || 2000); await quieta(page);
    await page.waitForTimeout(100);
    await page.clock.runFor(1000);
    const a = await avviso(page, 'ai');
    const dopo = await nucleo(page);
    const nellaBarra = await page.inputValue('#input');
    const rispostaChat = await page.evaluate(() => { const m = window.__tempo.state.chat.filter((x) => x.role === 'assistant').pop(); return m ? m.text : null; });
    frasi[c.nome] = a?.what ?? null;
    check(!!a && treParti(a), `4 (${c.nome}): atteso un avviso [data-notice=ai] con cosa, cosa fare e un bottone, trovato ${JSON.stringify(a)}${a ? '' : `; in chat c'è la risposta «${String(rispostaChat).slice(0, 80)}»`}`);
    check(dopo === prima, `4 (${c.nome}): lo stato salvato è cambiato (chat, attività, ...)`);
    check(nellaBarra === FRASE, `4 (${c.nome}): la frase doveva restare nella barra #input, c'è ${JSON.stringify(nellaBarra)}`);
    check(a && !/failed to fetch|errore \d{3}|internal server|too many|incorrect api|unauthorized|networkerror|aborted|timeout/i.test(a.what), `4 (${c.nome}): il testo principale mostra un testo tecnico: «${a?.what}»`);
    await ctx.close();
  }
  const testi = Object.entries(frasi);
  check(new Set(testi.map(([, w]) => w)).size === casi.length, `4: ogni guasto doveva dire una frase diversa, trovate: ${JSON.stringify(Object.fromEntries(testi))}`);
});

// ============================================================ 5. proposta vecchia
await scenario('5. proposta in attesa e poi non più valida', async () => {
  const { ctx, page } = await apri({ settings: { provider: 'online', ...AI } });
  const proposta = JSON.stringify({ reply: 'Sposto la chiamata a domani.', ops: [{ action: 'move', id: 't1', date: '2026-11-12' }], requires_confirmation: true });
  await page.route('https://ai.example.test/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: proposta } }] }) }));
  await scrivi(page, 'Che ne dici di liberare la giornata, sposta le chiamate a domani?');
  await page.clock.runFor(1500); await quieta(page);
  const applica = page.locator('[data-act=apply]');
  check((await applica.count()) === 1, `5: attesa una proposta con il bottone «Applica», trovati ${await applica.count()}`);
  if (await applica.count() === 1) {
    // cambio un'altra cosa: spunto «Scrivere la relazione» dal foglio
    await page.evaluate(() => document.activeElement?.blur());
    await page.locator('#collage .pc[data-item="t2"]').first().evaluate((el) => el.click()); await quieta(page); // il clic va alla carta anche se la barra la copre
    await page.click('[data-sheet=done]'); await quieta(page);
    const manuale = (await items(page)).find((i) => i.id === 't2');
    await page.locator('[data-act=apply]').evaluate((el) => el.click()); await quieta(page);
    const dopo = await items(page);
    check(dopo.find((i) => i.id === 't1').date !== '2026-11-12', '5: la proposta vecchia è stata applicata (t1 spostata a domani)');
    check(dopo.find((i) => i.id === 't2').status === 'done', '5: la modifica fatta a mano su t2 è andata persa');
    const a = await avviso(page, 'proposta');
    check(a && a.azioni.includes('Rifai'), `5: atteso un avviso con l'azione «Rifai», trovato ${JSON.stringify(a)}`);
    check(manuale?.status === 'done', '5: prova non valida: t2 non era conclusa prima di applicare');
  }
  await ctx.close();
});

// ============================================================ 6. azioni rapide con esito
await scenario('6. azioni rapide: fatta, a domani, elimina', async () => {
  const { ctx, page } = await apri({ st: stato([task('t1', 'Chiamare il fornitore', 30), task('t2', 'Scrivere la relazione', 45), task('t3', 'Fare la spesa', 30)]) });
  for (const [azione, id, titolo] of [['done', 't1', 'Chiamare il fornitore'], ['tomorrow', 't2', 'Scrivere la relazione'], ['delete', 't3', 'Fare la spesa']]) {
    const prima = JSON.stringify(await items(page));
    const carta = page.locator(`#collage .pc[data-item="${id}"]`).first();
    if (!(await carta.count())) { check(false, `6 (${azione}): la carta di «${titolo}» non è tra le carte del giorno`); continue; }
    await carta.click(); await quieta(page);
    const bottone = page.locator(`[data-sheet=${azione}]`);
    if (!(await bottone.count())) { check(false, `6 (${azione}): nel foglio manca il bottone [data-sheet=${azione}]`); await page.keyboard.press('Escape'); continue; }
    await bottone.click();
    const t = await toastTesto(page);
    check(t && t.testo.includes(titolo) && t.bottoni.includes('Annulla'), `6 (${azione}): il toast doveva contenere «${titolo}» e «Annulla», c'è ${JSON.stringify(t)}`);
    const dopoAzione = JSON.stringify(await items(page));
    check(dopoAzione !== prima, `6 (${azione}): l'azione non ha cambiato lo stato`);
    await page.locator('#toast button', { hasText: 'Annulla' }).click(); await quieta(page);
    check(JSON.stringify(await items(page)) === prima, `6 (${azione}): «Annulla» doveva riportare lo stato di prima`);
  }
  await ctx.close();
});

// ============================================================ 7. timer finito a app chiusa
await scenario('7. timer finito mentre l\'app era chiusa', async () => {
  const f = (mode) => ({ itemId: 'tfocus', title: 'Scrivere la relazione', theme: 'generic', mode, phase: 'work', minutes: 25, startedAt: at(10, 0), pausedAt: null, paused: 0, worked: 0, round: 1, createdAt: at(10, 0) });
  for (const mode of ['pomodoro', 'timer']) {
    const items0 = [task('tfocus', 'Scrivere la relazione', 60, { status: 'doing', startedAt: at(10, 0), date: DAY, start: 600 }), task('t2', 'Fare la spesa', 30)];
    const { ctx, page } = await apri({ st: stato(items0, { focus: f(mode) }, [13, 0]), time: [13, 0] });
    await page.clock.runFor(3000);
    // la riga con l'ora vera sta nel pannello del timer (.f-late); un avviso [data-notice=timer] è la forma di prima
    const riga = await page.evaluate(() => { const r = document.querySelector('.f-late') || document.querySelector('[data-notice="timer"] .n-what'); return r ? r.textContent.trim() : null; });
    check(riga && /10:25/.test(riga) && /chius/.test(riga), `7 (${mode}): doveva comparire l'ora vera di fine (10:25) e che Tempo era chiuso, c'è ${JSON.stringify(riga)}`);
    const bottoni = await page.evaluate(() => [...document.querySelectorAll('#focus-ctl button, [data-notice="timer"] .btn')].map((b) => b.textContent.trim()));
    check(bottoni.includes('Fatta') && bottoni.includes('Non ancora'), `7 (${mode}): servivano «Fatta» e «Non ancora», ci sono ${JSON.stringify(bottoni)}`);
    const corpo = await page.evaluate(() => document.body.innerText);
    check(!/Pausa[^\n]{0,20}\d+:\d\d/i.test(corpo) && !/Giro \d+ finito/.test(corpo), `7 (${mode}): non doveva esserci un conto alla rovescia di pausa né «Giro 1 finito»: ${JSON.stringify((corpo.match(/Pausa[^\n]{0,40}/i) || [''])[0])}`);
    const fase = await page.evaluate(() => window.__tempo.state.focus?.phase);
    check(fase !== 'break', `7 (${mode}): la fase salvata è «break» (è partita una pausa nuova)`);
    await ctx.close();
  }
});

// ============================================================ 8. aggiornamento con testo nella barra
await scenario('8. aggiornamento con testo nella barra', async () => {
  const { ctx, page } = await apri({ clock: false, sw: true });
  const controllo = () => page.evaluate(() => navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller));
  await page.waitForTimeout(500);
  await page.reload(); await page.waitForSelector('#app[data-mood]'); await page.waitForTimeout(500);
  if (!(await controllo())) { console.log('  non simulato: il service worker non prende il controllo della pagina in questo browser.'); await ctx.close(); return; }
  await page.evaluate(() => { window.__marcatore = 'stessa-pagina'; });
  await apriBarra(page); await page.fill('#input', 'Domani devo ricordarmi di chiamare');
  swVersione++;
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  let a = null;
  for (let k = 0; k < 40 && !a; k++) { await page.waitForTimeout(150); a = await avviso(page, 'versione').catch(() => null); }
  const m = await page.evaluate(() => window.__marcatore).catch(() => 'ricaricata');
  check(m === 'stessa-pagina', '8: con del testo nella barra la pagina si è ricaricata da sola');
  check(a && a.azioni.some((x) => /Aggiorna/.test(x)), `8: atteso un avviso [data-notice=versione] con «Aggiorna ora», trovato ${JSON.stringify(a)}`);
  check((await page.inputValue('#input').catch(() => '')) === 'Domani devo ricordarmi di chiamare', '8: il testo nella barra non c\'è più');
  if (a) {
    await page.getByRole('button', { name: /Aggiorna ora/ }).click();
    await page.waitForSelector('#app[data-mood]'); await page.waitForTimeout(400);
    check((await page.inputValue('#input')) === 'Domani devo ricordarmi di chiamare', '8: dopo «Aggiorna ora» il testo doveva tornare nella barra');
  }
  await ctx.close();
});

// ============================================================ 9. titolo di 300 caratteri senza spazi
await scenario('9. titolo lunghissimo senza spazi', async () => {
  const lungo = 'W'.repeat(300);
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await apri({ scheme, st: stato([task('tl', lungo, 45, { status: 'doing', startedAt: at(10, 0), date: DAY, start: 600 }), task('t2', 'Fare la spesa', 30)]) });
    const m = await page.evaluate(() => {
      const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { sw: el.scrollWidth, cw: el.clientWidth, right: Math.round(b.right), left: Math.round(b.left) }; };
      return { vw: innerWidth, docSw: document.documentElement.scrollWidth, anchor: r('.now-anchor'), titolo: r('.now-anchor .pc-quote'), carta: r('.now-anchor .pc-body') };
    });
    check(m.docSw <= m.vw, `9 (${scheme}): la pagina scorre in orizzontale (${m.docSw} > ${m.vw})`);
    check(m.titolo && m.titolo.sw <= m.titolo.cw, `9 (${scheme}): il titolo .pc-quote sfora (scrollWidth ${m.titolo?.sw} > clientWidth ${m.titolo?.cw})`);
    check(m.anchor && m.anchor.sw <= m.anchor.cw && m.anchor.right <= m.vw, `9 (${scheme}): la carta «Adesso» .now-anchor sfora (${JSON.stringify(m.anchor)})`);
    // il toast con il titolo lungo (si accorcia a 28, ma non deve uscire)
    await page.locator('#collage .pc[data-item="tl"], .now-anchor').first().click({ force: true }).catch(() => {});
    await quieta(page);
    const bott = page.locator('[data-sheet=tomorrow]');
    if (await bott.count()) {
      await bott.click();
      const t = await page.evaluate(() => { const el = document.querySelector('#toast'); if (!el || el.hidden) return null; const b = el.getBoundingClientRect(); return { sw: el.scrollWidth, cw: el.clientWidth, left: b.left, right: b.right, vw: innerWidth }; });
      check(t && t.sw <= t.cw && t.left >= 0 && t.right <= t.vw, `9 (${scheme}): il toast con il titolo lungo sfora: ${JSON.stringify(t)}`);
    } else check(false, `9 (${scheme}): non riesco ad aprire il foglio dell'attività lunga per provare il toast`);
    await ctx.close();
  }
});

await browser.close(); server.close();
console.log(ko ? `\n${ko} controlli falliti, ${ok} riusciti.` : `\nTutti i ${ok} controlli riusciti.`);
process.exit(ko ? 1 : 0);
