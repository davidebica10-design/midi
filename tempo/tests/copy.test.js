// Controllo dei testi mostrati all'utente, leggendo il sorgente come testo.
//
// LIMITI dell'estrattore (è pragmatico, non un parser JavaScript completo):
//  - un piccolo tokenizzatore separa commenti, espressioni regolari, stringhe e template; la distinzione
//    «/» divisione o regex è euristica (guarda il carattere precedente);
//  - ogni stringa/template di tempo/js/*.js e ogni testo e attributo (placeholder, aria-label, title, alt)
//    di tempo/index.html è un candidato; conta come «frase per l'utente» se ha almeno due parole
//    (o una parola maiuscola seguita da punteggiatura) e non somiglia a codice (selettori, URL, classi, chiavi);
//  - NON si guardano: parse.js (vocabolario del parser), ai.js e ai-open.js (prompt e schemi, non mostrati),
//    cloud.js e native.js (messaggi tecnici), i test;
//  - le stringhe costruite a pezzi o prese da una variabile non si vedono; il testo del server o
//    del motore (e.message) si cerca con regole statiche sul sorgente;
//  - i punti di chiamata di `notice(` si verificano solo se l'argomento è un oggetto letterale;
//    gli altri vengono elencati nel test «chiamate non verificabili».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALTA = new Set(['parse.js', 'ai.js', 'ai-open.js', 'cloud.js', 'native.js']);
const leggi = (f) => fs.readFileSync(path.join(TEMPO, f), 'utf8');
const files = fs.readdirSync(path.join(TEMPO, 'js')).filter((f) => f.endsWith('.js') && !SALTA.has(f));

// ---------------------------------------------------------------- tokenizzatore
const PREC_REGEX = /[(,=:\[!&|?{};+\-*%<>~^]$|(^|[^\w$.])(return|typeof|case|in|of|else|do|void|delete|throw|new)$/;
/** Restituisce [{ kind:'str'|'tpl', value, line, parts? }] saltando commenti e regex. `parts` per i template: testo senza ${...}. */
function tokens(src) {
  const out = []; let i = 0, line = 1, last = ''; // `last` = codice significativo prima di i
  const n = src.length;
  const nl = (s) => { for (const c of s) if (c === '\n') line++; };
  function tpl(start) { // src[start] === '`'; restituisce { end, text }
    let j = start + 1, text = '';
    while (j < n && src[j] !== '`') {
      if (src[j] === '\\') { text += src[j + 1] ?? ''; j += 2; continue; }
      if (src[j] === '$' && src[j + 1] === '{') {
        let depth = 1; j += 2; text += '§';
        while (j < n && depth) {
          const c = src[j];
          if (c === '{') depth++; else if (c === '}') depth--;
          else if (c === '`') { j = tpl(j).end; continue; }
          else if (c === '"' || c === "'") { j++; while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; } }
          j++;
        }
        continue;
      }
      text += src[j]; j++;
    }
    return { end: j + 1, text };
  }
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; nl(src.slice(i, end)); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, v = '';
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { v += src[j + 1] ?? ''; j += 2; } else v += src[j++]; }
      out.push({ kind: 'str', value: v, line }); i = j + 1; last = '"'; continue;
    }
    if (c === '`') {
      const t = tpl(i); out.push({ kind: 'tpl', value: t.text, line }); nl(src.slice(i, t.end)); i = t.end; last = '"'; continue;
    }
    if (c === '/' && PREC_REGEX.test(last)) { // regex: fino al «/» non escapato fuori dalle classi
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
      i = j + 1; while (/[a-z]/.test(src[i] || '')) i++; last = 'x'; continue;
    }
    last = (last + c).slice(-12); i++;
  }
  return out;
}

// ---------------------------------------------------------------- cosa è una frase per l'utente
const NOME_FILE = (f) => f;
/** Dal valore di un template HTML tiene testo visibile e attributi parlanti. */
function testiDa(valore) {
  const v = valore.replace(/<!--[\s\S]*?-->/g, '').replace(/§/g, ' ');
  if (!/<\w/.test(v)) return [v];
  const res = [];
  for (const m of v.matchAll(/\s(?:placeholder|aria-label|title|alt|aria-description)="([^"]*)"/g)) res.push(m[1]);
  res.push(...v.replace(/<[^>]*>/g, '\n').split('\n'));
  return res;
}
const PAROLE = (s) => (s.match(/[A-Za-zÀ-ÿ]{2,}/g) || []).length;
function sembraFrase(s) {
  const t = s.trim();
  if (t.length < 3) return false;
  if (/^(https?:|\/|\.|#|[\w-]+\.(js|css|json|png|svg)\b|--|data:|@)/.test(t)) return false;
  if (/[{};=]|=>|\)\s*\{|^\w+\(|\bfunction\b|\bconst\b|\breturn\b|\.\w+\(/.test(t)) return false; // codice
  if (/^[a-z][a-z0-9-]*(\s[a-z][a-z0-9-]*)*$/.test(t) && !/\s/.test(t)) return false; // una parola in minuscolo senza spazi: chiave o classe
  return PAROLE(t) >= 2 || /^[A-ZÀ-Ý][a-zà-ÿ]+[.:?!]$/.test(t);
}
/** Tutte le frasi candidate di un file JS: { file, line, text }. */
function frasiJs(f) {
  const out = [];
  for (const tk of tokens(leggi('js/' + f))) for (const t of testiDa(tk.value)) if (sembraFrase(t)) out.push({ file: 'js/' + f, line: tk.line, text: t.trim() });
  return out;
}
function frasiHtml() {
  const html = leggi('index.html').replace(/<script[\s\S]*?<\/script>/g, (m) => m.replace(/[^\n]/g, '')).replace(/<style[\s\S]*?<\/style>/g, (m) => m.replace(/[^\n]/g, ''));
  const out = [];
  html.split('\n').forEach((riga, k) => {
    for (const t of testiDa(riga)) if (sembraFrase(t)) out.push({ file: 'index.html', line: k + 1, text: t.trim().replace(/&[a-z#0-9]+;/g, ' ') });
  });
  return out;
}
const TUTTE = [...files.flatMap(frasiJs), ...frasiHtml()];

const pos = (x) => `${x.file}:${x.line} «${x.text.slice(0, 90)}»`;

test('l\'estrattore trova abbastanza frasi (se è vuoto, i controlli sotto non provano niente)', () => {
  assert.ok(TUTTE.length > 300, `trovate solo ${TUTTE.length} frasi`);
  assert.ok(TUTTE.some((x) => /Oggi è libero/.test(x.text)), 'manca una frase nota di app.js');
  assert.ok(TUTTE.some((x) => x.file === 'index.html'), 'nessuna frase da index.html');
  assert.ok(!TUTTE.some((x) => x.file === 'js/parse.js'), 'parse.js doveva restare fuori');
});

test('il tokenizzatore salta commenti ed espressioni regolari', () => {
  const t = tokens('// «Ciao!» no\nconst a = /ciao! mondo/g.test(x); /* "Oops" */ const b = "Sì, ok" + `a ${"x" + `y`} b`;');
  assert.deepEqual(t.map((x) => x.value), ['Sì, ok', 'a § b']);
});

// ---------------------------------------------------------------- regole di tono
test('nessuna frase per l\'utente contiene il punto esclamativo', () => {
  const male = TUTTE.filter((x) => x.text.replace(/!==?|!important|!\w/g, '').includes('!'));
  assert.deepEqual(male.map(pos), []);
});

test('nessun messaggio generico («Errore», «Qualcosa è andato storto», «Oops», «Error:»)', () => {
  const generico = /^errore[.:!]?$|qualcosa è andato storto|si è verificato un errore|\boops\b|\bError:|\bErrore generico/i;
  const male = TUTTE.filter((x) => generico.test(x.text));
  assert.deepEqual(male.map(pos), []);
});

test('nessun testo del motore o del server come frase principale (e.message in toast, notice, addMsg)', () => {
  const male = [];
  for (const f of files) {
    const src = leggi('js/' + f);
    // nomi a cui si assegna un messaggio grezzo: x = e.message
    const nomi = new Set([...src.matchAll(/([\w$.]+)\s*=\s*[^;\n]*\b(?:e|err|error|ex)\.message\s*;/g)].map((m) => m[1]));
    src.split('\n').forEach((riga, k) => {
      const chiamata = riga.match(/\b(toast|toastUndo|notice|addMsg|alert)\(.*/);
      if (!chiamata) return;
      const resto = chiamata[0];
      if (/\b(?:e|err|error|ex)\.message\b/.test(resto)) male.push(`js/${f}:${k + 1} ${riga.trim().slice(0, 100)}`);
      else for (const nome of nomi) if (new RegExp(`\\b(?:toast|toastUndo)\\(\\s*${nome.replace(/\./g, '\\.')}\\s*[,)]`).test(resto)) male.push(`js/${f}:${k + 1} ${riga.trim().slice(0, 100)} (variabile «${nome}» presa da .message)`);
    });
  }
  assert.deepEqual(male, []);
});

// ---------------------------------------------------------------- contratto di notice
/** Estrae i letterali di errorInfo: ogni `return { code: ..., what: ..., next: ... }`. */
function righeErrorInfo() {
  const src = leggi('js/app.js');
  const a = src.indexOf('function errorInfo(');
  assert.ok(a >= 0, 'non trovo errorInfo in app.js');
  const b = src.indexOf('\n}\n', a);
  const base = src.slice(0, a).split('\n').length;
  return src.slice(a, b).split('\n').map((r, k) => ({ r, line: base + k })).filter((x) => /return \{ code:/.test(x.r));
}
/** Valore (stringa letterale o template) di una chiave dentro una riga `return { ... }`. */
function valoreDi(riga, chiave) {
  const m = riga.match(new RegExp(`\\b${chiave}:\\s*(\`(?:[^\`\\\\]|\\\\.)*\`|'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`));
  return m ? m[1].slice(1, -1).replace(/\\'/g, "'").replace(/\$\{[^}]*\}/g, '0') : null;
}
const AZIONI_OK = new Set(['settings', 'retry', 'set']); // `set` è la costante 'settings' dentro errorInfo
// la seconda persona (imperativo o «puoi…», «scrivi», «riprova»…) o un'etichetta di azione
const ISTRUZIONE = /\b(riprova|ricopia\w*|ricopiala|scrivi|scegli|aggiorna|controlla\w*|crea\w*|aspetta|incolla\w*|apri|esporta|scarica|ripristina|usa|tocca|puoi|prova|riformula|attendi|connettiti|collegati|aggiungi|elimina|torna|passa)\b|\bquando sei online\b/i;

test('errorInfo: ogni voce ha what e next pieni, con il punto finale', () => {
  const voci = righeErrorInfo();
  assert.ok(voci.length >= 10, `attese almeno 10 voci in errorInfo, trovate ${voci.length}`);
  const male = [];
  for (const { r, line } of voci) {
    for (const k of ['what', 'next']) {
      const v = valoreDi(r, k);
      if (!v || !v.trim()) male.push(`js/app.js:${line} manca «${k}»`);
      else if (!/[.]$/.test(v.trim())) male.push(`js/app.js:${line} «${k}» non finisce con il punto: «${v}»`);
    }
    const why = valoreDi(r, 'why');
    if (why !== null && !/[.]$/.test(why.trim())) male.push(`js/app.js:${line} «why» non finisce con il punto: «${why}»`);
    const act = r.match(/action:\s*(\w+|'[^']*')/);
    if (!act) male.push(`js/app.js:${line} manca l'azione`);
    else if (!AZIONI_OK.has(act[1].replace(/'/g, ''))) male.push(`js/app.js:${line} azione sconosciuta ${act[1]}`);
  }
  assert.deepEqual(male, []);
});

test('errorInfo: ogni «next» contiene un\'istruzione per chi legge', () => {
  const male = [];
  for (const { r, line } of righeErrorInfo()) {
    const v = valoreDi(r, 'next');
    if (v && !ISTRUZIONE.test(v)) male.push(`js/app.js:${line} «next» senza istruzione: «${v}»`);
  }
  assert.deepEqual(male, []);
});

test('errorInfo: i codici sono distinti e nessun «what» è uguale a un altro', () => {
  const voci = righeErrorInfo();
  const codici = voci.map(({ r }) => r.match(/code:\s*'([^']*)'/)?.[1]);
  assert.equal(new Set(codici).size, codici.length, `codici ripetuti: ${codici}`);
  const what = voci.map(({ r }) => valoreDi(r, 'what'));
  assert.equal(new Set(what).size, what.length, 'due guasti diversi dicono la stessa frase');
});

test('errorInfo: nessun what, why o next interpola il testo grezzo del motore (msg, message)', () => {
  const male = righeErrorInfo().filter(({ r }) => /\b(?:what|why|next|detail):\s*`[^`]*\$\{[^}]*\b(?:msg|message)\b/.test(r));
  assert.deepEqual(male.map((x) => `js/app.js:${x.line}`), []);
});

/** Chiamate a notice( fuori dalla definizione: { line, corpo } con il letterale tra graffe, oppure null. */
function chiamateNotice() {
  const src = leggi('js/app.js');
  const out = [];
  for (const m of src.matchAll(/\bnotice\(/g)) {
    const idx = m.index;
    if (/function\s+$/.test(src.slice(Math.max(0, idx - 12), idx))) continue;
    if (/\.\s*$|[\w$]$/.test(src.slice(Math.max(0, idx - 1), idx))) continue; // hasNotice(, dismissNotice(, backupNotice(
    const line = src.slice(0, idx).split('\n').length;
    let j = idx + m[0].length; while (/\s/.test(src[j])) j++;
    if (src[j] !== '{') { out.push({ line, corpo: null }); continue; }
    let depth = 0, k = j, q = null;
    for (; k < src.length; k++) {
      const c = src[k];
      if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++; else if (c === '}' && --depth === 0) break;
    }
    out.push({ line, corpo: src.slice(j, k + 1) });
  }
  return out;
}
const haChiave = (corpo, k) => new RegExp(`(^|[{,\\s])${k}\\s*:|(^|[{,\\s])${k}\\s*[,}]`).test(corpo.replace(/\n/g, ' '));

test('ogni chiamata a notice( passa what e next (controllo statico sull\'oggetto letterale)', () => {
  const chiamate = chiamateNotice();
  assert.ok(chiamate.length >= 6, `attese almeno 6 chiamate, trovate ${chiamate.length}`);
  const male = [];
  for (const c of chiamate) {
    if (!c.corpo) continue;
    // via le chiavi annidate (action: { label, fn }): si guardano solo quelle di primo livello
    let piatto = '', depth = 0;
    for (const ch of c.corpo) { if (ch === '{' || ch === '[' || ch === '(') depth++; if (depth <= 1) piatto += ch; if (ch === '}' || ch === ']' || ch === ')') depth--; }
    for (const k of ['what', 'next']) if (!haChiave(piatto, k)) male.push(`js/app.js:${c.line} notice senza «${k}»`);
  }
  assert.deepEqual(male, []);
});

test('le chiamate a notice( che passano what/next da una variabile sono chiuse da una funzione che li ha (backupNotice)', () => {
  const src = leggi('js/app.js');
  const a = src.indexOf('function backupNotice(');
  assert.ok(a >= 0);
  const chi = src.slice(a, src.indexOf('}\n', a));
  assert.match(chi, /\bwhat\b[\s\S]*\bnext\b/);
  const male = [];
  src.split('\n').forEach((r, k) => {
    for (const m of r.matchAll(/\bbackupNotice\(([^;]*)\);/g)) {
      const args = m[1];
      if (/^\s*'/.test(args) || /^\s*`/.test(args)) {
        // tre argomenti: what, why, next (what e next non vuoti)
        const parti = args.split(/'\s*,\s*|`\s*,\s*/);
        if (parti.length < 3 || /^\s*(''|``)\s*$/.test(parti[0]) || /^\s*(''|``)\s*\)?$/.test(parti[2])) male.push(`js/app.js:${k + 1} backupNotice con what o next vuoto`);
      }
    }
  });
  assert.deepEqual(male, []);
});

test('elenco delle chiamate a notice( non verificabili in modo statico (devono essere zero, o spiegate qui)', () => {
  const nonVerificabili = chiamateNotice().filter((c) => !c.corpo).map((c) => `js/app.js:${c.line}`);
  assert.deepEqual(nonVerificabili, []);
});

test('le frasi di notice() nel sorgente finiscono con il punto o con un punto interrogativo', () => {
  const male = [];
  for (const c of chiamateNotice()) {
    if (!c.corpo) continue;
    for (const k of ['what', 'next', 'why']) {
      const m = c.corpo.replace(/\n\s*/g, ' ').match(new RegExp(`\\b${k}:\\s*(\`(?:[^\`\\\\]|\\\\.)*\`|'(?:[^'\\\\]|\\\\.)*')`));
      if (!m) continue;
      const v = m[1].slice(1, -1).trim();
      if (!/[.?]$/.test(v)) male.push(`js/app.js:${c.line} «${k}» non finisce con il punto: «${v}»`);
    }
  }
  assert.deepEqual(male, []);
});
