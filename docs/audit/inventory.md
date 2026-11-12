# Inventario e audit meccanico di Tempo

Data: 2026-11-11 · Commit: `c468eb7` · Albero di lavoro: pulito. Nessun file di prodotto modificato, nessun commit. Unico file creato: questo.

## 1. Test

| Suite | Comando | Test | Pass | Fail | Durata test | Tempo reale |
|---|---|---|---|---|---|---|
| tempo | `npm test` (TZ di sistema, UTC) | 200 | 200 | 0 | 9,55 s | 10,25 s |
| tempo | `TZ=Asia/Tokyo npm test` | 200 | 200 | 0 | 9,06 s | 9,22 s |
| cloud | `npm test` | 13 | 13 | 0 | 0,64 s | 0,79 s |

Nessun test saltato, marcato `todo` o annullato. Il test più lento è «un anno d'uso: spazio, giorni per i progetti, date, allarmi e titoli» (circa 8,1 s). Da solo pesa quasi tutta la durata della suite tempo.

## 2. Inventario

### 2.1 `tempo/` (esclusa `icons/`)

| File | Byte | Righe |
|---|---|---|
| `index.html` | 9.661 | 159 |
| `style.css` | 98.340 | 1.123 |
| `sw.js` | 3.539 | 37 |
| `manifest.webmanifest` | 615 | 17 |
| `package.json` | 117 | 6 |
| `README.md` | 8.383 | 87 |
| `DESIGN-API.md` | 26.253 | 313 |
| `NOTIFICHE.md` | 3.553 | 55 |

### 2.2 `tempo/js/` (22 moduli, totale 564.744 byte, 9.152 righe)

| File | Byte | Righe |
|---|---|---|
| `app.js` | 181.500 | 2.922 |
| `parse.js` | 84.123 | 1.206 |
| `store.js` | 52.810 | 847 |
| `scheduler.js` | 20.979 | 446 |
| `companion.js` | 31.966 | 548 |
| `ai-open.js` | 26.957 | 433 |
| `viewmodel.js` | 27.006 | 405 |
| `ai.js` | 23.136 | 345 |
| `genui.js` | 18.611 | 311 |
| `decide.js` | 15.465 | 266 |
| `recap.js` | 14.860 | 199 |
| `learn.js` | 11.733 | 211 |
| `motion.js` | 10.983 | 220 |
| `cloud.js` | 10.012 | 183 |
| `focus.js` | 8.625 | 150 |
| `themes.js` | 7.172 | 96 |
| `templates.js` | 6.226 | 102 |
| `goals.js` | 4.394 | 83 |
| `native.js` | 3.484 | 62 |
| `images.js` | 2.216 | 65 |
| `archive.js` | 1.242 | 30 |
| `format.js` | 1.244 | 22 |

### 2.3 `tempo/tests/` (20 suite `*.test.js` più helper)

| File | Byte | Righe |
|---|---|---|
| `engine.test.js` | 17.776 | 342 |
| `understand.test.js` | 13.647 | 273 |
| `checklist-difetti.test.js` | 11.049 | 194 |
| `moments.test.js` | 11.101 | 209 |
| `checklist.test.js` | 10.327 | 186 |
| `genui.test.js` | 7.829 | 158 |
| `parser.test.js` | 7.152 | 177 |
| `storage.test.js` | 7.091 | 136 |
| `decide.test.js` | 7.200 | 124 |
| `sim.js` (helper) | 6.735 | 125 |
| `viewmodel.test.js` | 6.147 | 112 |
| `goalplan.test.js` | 5.102 | 106 |
| `recap.test.js` | 5.389 | 102 |
| `year.test.js` | 5.322 | 83 |
| `bench.test.js` | 5.255 | 94 |
| `ai.test.js` | 5.495 | 111 |
| `cloud-client.test.js` | 4.053 | 76 |
| `learn.test.js` | 2.986 | 64 |
| `observations.test.js` | 2.154 | 47 |
| `security.test.js` | 2.216 | 49 |
| `focus.test.js` | 2.557 | 51 |
| `helpers.js` | 1.290 | 33 |
| `fake-storage.js` | 934 | 18 |

Totale file di test: circa 148,8 KB, 2.870 righe. In `tests/bench/` ci sono `README.md`, `bench-decider.mjs`, `cases.mjs`, `run.mjs` e `.gitignore`, che non sono eseguiti da `npm test` (lo fa solo `bench.test.js`).

### 2.4 `tempo/vendor/`

| File | Byte | Righe | In SHELL |
|---|---|---|---|
| `anthropic-sdk.mjs` | 212.208 | 19 | sì |
| `web-llm.mjs` | 6.031.731 (circa 6 MB) | 91 | **no** |

`web-llm.mjs` (`@mlc-ai/web-llm` 0.2.85) viene caricato solo quando l'utente sceglie il modello sul telefono (`js/ai-open.js:232`, `README.md:73`).

### 2.5 `cloud/` (struttura di primo livello)

```
cloud/
├── .gitignore
├── README.md
├── clm/README.md
├── package.json
├── wrangler.toml
├── src/   app.js, crypto.js, mcp.js, node.js, tempo.js, worker.js
└── test/  cloud.test.js, shift.test.js
```

## 3. `tempo/sw.js`

- **VERSION**: `'tempo-v35'` (riga 2).
- **SHELL**: 98 voci (righe 3–11). Contiene `./`, `index.html`, `style.css`, `manifest.webmanifest`, 22 moduli `js/`, `vendor/anthropic-sdk.mjs`, icone `ui/`, `act/` e 3 PNG.
- Tutti i 22 file `js/*.js` sono in SHELL. Nessuna voce di SHELL manca sul disco.
- **Fuori da SHELL**:
  - `vendor/web-llm.mjs` (circa 6 MB). Sw.js alla riga 32 mette in cache le risposte riuscite a runtime, quindi il file entra in cache solo dopo il primo caricamento. L'uso offline del modello locale prima di quel momento non funziona. Da verificare.
  - `icons/icon.svg` e `icons/act/LICENSE`: non in SHELL. Verificare se `icon.svg` è referenziato da `manifest.webmanifest`. La LICENSE non serve alla PWA.

## 4. `tempo/style.css` (1.123 righe, 98.340 byte)

### 4.a Variabili CSS

- 59 nomi distinti, 196 dichiarazioni.
- **Definite più volte nello stesso scope `:root`**:
  - Righe 3–23 e righe 522–527 (e 528): 20 nomi, tra cui `--bg`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--paper`, `--paper-2`, `--paper-ink`, `--accent`, `--accent-2`, `--lilac`, `--warn-paper`, `--hero`, `--glass`, `--glass-bd`, `--b1`, `--b2`, `--b3`, `--shadow`, `--shadow-lg`. Il secondo blocco vince per cascata. Il blocco alle righe 3–51 è quindi o morto o una seconda palette da confermare.
  - Righe 774–778 e 681: `--cc-rose`, `--cc-lilac`, `--cc-sage`, `--cc-sand`, `--cc-sky`. Il blocco dark alle righe 682 e 786–790 sovrascrive intenzionalmente.
  - `--card` per `[data-c=…]` alle righe 683–684 e 794–798: il parser le segnala come duplicate. Probabilmente sono override dark, da verificare.
- **Definite e mai usate**: `--veil` (righe 17 e 45).
- **Non morta**: `--glow` non ha `var()`, ma viene letta con `getPropertyValue('--glow')` in `js/motion.js:55`.
- **Usate ma non definite nel CSS**: 22 nomi. Quasi tutti vengono impostati da JS: `--vvt`, `--vvh` (`app.js:2785–2786`), `--p` (`app.js:1130`), `--scene-accent` (`app.js:689`), `--c` (`motion.js:45,64`), e altri. Quattro nomi non hanno nessun riferimento in `js/` né in `index.html`:
  - `--x` e `--z`: hanno un fallback nel `var()`, quindi non si rompono.
  - `--y`: nessun uso verificato.
  - `--h`: usata in `.tile` (riga 238) senza fallback. Il selettore `.tile` non ha nessun riferimento in `js/` né in `index.html` (vedi 4.g).

### 4.b `z-index` (25 dichiarazioni)

| Riga | Valore | Selettore |
|---|---|---|
| 84 | 5 | `.topbar` |
| 96 | 0 | `.hero` |
| 104 | 1 | `.collage` |
| 105 | `var(--z, 1)` | `.pc` |
| 181 | 2 | `#overview` |
| 182 | 3 | `.ov-head` |
| 211 | -1 | `.blob::after` |
| 277 | 1 | `.cd.has b` |
| 336 | 7 | `.glow` |
| 352 | 8 | `.bar` |
| 372 | 9 | `#panel` |
| 404 | 20 | `.sheet-backdrop` |
| 406 | 21 | `.sheet` |
| 427 | 30 | `.toast` |
| 459 | 0 | `.pause` |
| 490 | 20 | `#onb` |
| 632 | 6 | `#summary` |
| 817 | 3 | `.pc::after` |
| 820 | 30 | `.pc.lifted` |
| 826 | 8 | `.sum-fab` |
| 913 | 2 | `.focus-ctl` |
| 935 | `calc(3 - var(--j))` | `.ds-card` |
| 961 | 60 | `.save-alert` |
| 984 | 2 | `.obs-x` |
| 1065 | 6 | `#recap` |

Nessuna scala. Valori da -1 a 60. Due coppie condividono il valore (20 per `.sheet-backdrop` e `#onb`; 30 per `.toast` e `.pc.lifted`). Il 60 di `.save-alert` è un outlier.

### 4.c `font-size` sotto 12px

Sulle 184 dichiarazioni `font-size`, 20 sono sotto 12px:

| Riga | Valore | Selettore |
|---|---|---|
| 146 | 11.5px | `.pc.now .pc-time` |
| 225 | 11.5px | `.tk b` |
| 226 | 9.5px | `.tk u` |
| 234 | 11px | `.tk em` |
| 248 | 10.5px | `.mini small` |
| 265 | 11.5px | `.wk span` |
| 276 | 10.5px | `.cd-t` |
| 277 | 11.5px | `.cd.has b` |
| 438 | 11.5px | `.adv-k` |
| 458 | 10.5px | `.pc-pause` |
| 580 | 9px | `.pc-mark` |
| 667 | 11px | `.sc-foot` |
| 704 | 10px | `.cd-t` |
| 838 | 9.5px | `.today-btn small` |
| 980 | 11.5px | `.r-k` |
| 1031 | 10px | `.sw-col` |
| 1032 | 10px | `.sw-row` |
| 1039 | 11px | `.sw-tail span` |
| 1051 | 10px | `.sw-days span` |
| 1104 | 11px | `.sw-col, .sw-row` |

Altre 7 dichiarazioni usano `clamp()` per i titoli fluidi (righe 99, 559, 588, 589, 884, 902, 1018), con minimo tra 29 e 58 px. Non sono un problema.

### 4.d Colori hard-coded fuori dai token

Circa 112 occorrenze su 74 righe. Il conteggio è approssimato e include qualche falso positivo tipo `hsl(var(...))`. Le più frequenti sono `rgba()` in ombre e gradienti (righe 89–360, 404–427, 627–710). Colori fissi nel blocco «ora corrente» e nelle icone: `#fff`, `#F27BA1`, `#E0457B`, `#C9346B`, `#A894D8`, `#8466C8`, `#6C4FB3`, `#DCF35B`, `#1F2A00` (righe 128–166, 206–216, 228). Le palette in variabili (righe 681–682, 774–790) sono corrette. Riga 557 contiene `#777277` fuori dai token.

### 4.e Media query

- `prefers-reduced-motion: reduce`: presente alla riga 513 (globale: durate a 0.01 ms su `*`) e alla riga 1089 (`.bg::after`, `.rc-cards`).
- `prefers-color-scheme: dark`: 13 blocchi (righe 32, 176, 238, 329, 531, 558, 682, 689, 710, 784, 822, 907, 948).
- Selettore esplicito `:root[data-theme="dark"]`: assente. Il tema scuro usa `:root:not([data-theme="light"])`. `js/motion.js:37,43` decide il tema con `dataset.theme !== 'light'`.

### 4.f Elementi interattivi sotto 44px

Il parser ha segnalato 37 dichiarazioni sotto 44px. Molte riguardano SVG decorativi e barre (`.ov-bar`, `.tk i`, `.onb-dots i`). Questi sono i controlli interattivi:

| Riga | Selettore | Dimensione |
|---|---|---|
| 188 | `.ov-nav button` | 38 × 38 |
| 392 | `.row input[type=date]` | min-h 34 |
| 422 | `.photo-field .rm` | 32 × 32 |
| 484 | `.dchip` | 40 × 34 |
| 492 | `.onb-top` | min-h 36 |
| 723 | `.ed-rm` | 30 × 30 |
| 747 | `.stepper button` | 38 × 38 |
| 963 | `.save-alert .btn.primary` | h 42 |
| 984 | `.obs-x` | 32 × 32 |
| 1061 | `.chip-btn` | min-h 34 |

Il riferimento WCAG 2.5.8 (AA) richiede 24 px. La raccomandazione 44 px è di WCAG 2.5.5 (AAA). Il parser lavora sui selettori, non sul rendering: le misure reali possono cambiare con padding o con `min-*`.

### 4.g Selettori morti

`.tile` (righe 236–252): nessun riferimento in `js/` né in `index.html`. Probabilmente CSS morto.

## 5. `tempo/index.html`: CSP (riga 5)

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
```

## 6. Problemi principali (in ordine di peso)

1. **CSP troppo larga**: `connect-src` contiene `https:`, quindi permette connessioni verso qualsiasi host HTTPS. Il principio di prodotto dice che un nuovo servizio esterno richiede la CSP aggiornata. Con `https:` questo controllo non esiste.
2. **Modello locale fuori dalla cache installata**: `vendor/web-llm.mjs` (circa 6 MB) non è in SHELL. Il primo uso offline non funziona.
3. **Palette `:root` duplicata**: 20 variabili vengono definite alle righe 3–23 e riscritte alle righe 522–527. Serve verificare quale palette è quella attiva, o se il blocco 3–51 è morto.
4. **CSS morto e variabili orfane**: `.tile` (righe 236–252) non è usato; `--veil` è definita e non usata; `--h` non è definita e il suo unico uso è in quel `.tile`.
5. **Testo sotto 12px**: 20 dichiarazioni tra 9 e 11,5 px, incluso il `.pc-mark` a 9 px (riga 580).
6. **Controlli sotto 44px**: 10 controlli interattivi, per esempio `.ed-rm` 30×30 e `.obs-x` 32×32.
7. **Z-index senza scala**: 25 valori, da -1 a 60, con coppie che condividono il valore (20, 30).
8. **Colori fissi**: circa 112 occorrenze fuori dai token, soprattutto ombre e i colori del blocco «ora corrente».

Nota: nessuna modifica al prodotto. Il VERSION di `sw.js` (`tempo-v35`) resta invariato, perché non sono stati toccati file di `tempo/`.
