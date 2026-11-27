# Controllo bug e funzionamento — prima della schermata Home

Ramo `claude/tempo-app-ui-optimization-i31896` (dopo il merge di main), Chromium con Playwright, iPhone 390x844 e 375x667, chiaro e scuro, orologio fisso, dati inventati. Nessun file di prodotto toccato. Script e immagini: `/tmp/claude-0/-home-user-midi/18e8f1ef-e8ac-59ed-8dc1-c7e71afbe942/scratchpad/bughunt/` (immagini in `shots/`).

## A. Test eseguiti (dopo `node --check` su ogni .js/.mjs di `tempo/js` e `tempo/tests`: nessun errore)

| Comando | Esito |
|---|---|
| `cd tempo && npm test` (UTC) | 371 passati, 0 falliti |
| `TZ=Asia/Tokyo npm test` | 371 passati, 0 falliti |
| `node tests/ui/stati.mjs` | 218 controlli, tutti riusciti |
| `node tests/ui/guasti.mjs` | 87 controlli, tutti riusciti |
| `node tests/ui/inviti.mjs` | 243 controlli, tutti riusciti |
| `cd cloud && npm test` | 13 passati, 0 falliti |
| `cd tempo/studio && npm test` | 69 passati, 0 falliti |

## B. Pronto per la schermata Home di iOS

**Nessun blocco.** Il Service Worker si installa, l'app riparte offline, il manifest è valido. Verificato con un server che serve il repository sotto `/midi/` (come GitHub Pages) e con Service Worker attivi.

- `manifest.webmanifest`: nome «Tempo — AI Time Manager», `short_name` «Tempo» (5 caratteri, ok), `start_url` e `scope` `./` (relativi: corretti sotto `/midi/tempo/`), `display: standalone`, icone 192, 512 e 512 maskable. Dimensioni dichiarate = pixel reali (`identify`: 192x192, 512x512), nessun canale alfa. Mancano `id` (basso).
- `index.html:6` `viewport-fit=cover`, nessun `user-scalable=no` né `maximum-scale`. `:9-10` `theme-color` con media query chiaro/scuro. `:12-15` capable (apple e mobile), status bar `black-translucent`, titolo «Tempo». `:18` `apple-touch-icon` 180x180 presente. La barra in alto usa `env(safe-area-inset-top)` (`style.css:84`, `:96`), la barra di scrittura quella in basso (`:335`).
- `sw.js`: `VERSION` `tempo-v49`; 99 voci in `SHELL`, tutte esistenti su disco, tutti i `js/*.js` presenti. `web-llm.mjs` (6 MB) non è in `SHELL`: voluto, si salva al primo uso. Aggiornamento: `skipWaiting` (`sw.js:14`) e `clients.claim` (`:20`); l'app ricarica da sola o mostra «Aggiorna ora» (`app.js:3903-3923`, provato da `guasti.mjs`).
- Prova offline: prima visita online, `setOffline`, ricarica: l'app si apre con i dati. Cache `tempo-v49` creata (99 voci). Nessuna violazione CSP in console. Manifest e icone rispondono 200.
- CSP (`index.html:5`): consente font di Google, icone, manifest, `blob:`/`data:` per le immagini, `https:` per le AI. Il flusso `#invito=` usa solo `history.replaceState`: nessun problema. Il link generato è `origin + pathname` (`app.js:3411`): su Pages sarà `https://davidebica10-design.github.io/midi/tempo/#invito=…`.
- Nessun conflitto di dati con studio e con la pagina alla radice: chiavi `tempo.v1` / `tempo.studio.v1` / `ws_auth`, database IndexedDB diversi.

**Problemi di installazione (non bloccanti):**
1. Colori incoerenti: manifest `#F5F3EE` (`manifest.webmanifest:9-10`), `theme-color` `#F3E4EE` / `#1B1320` (`index.html:9-10`), pagina `#ECECEA` / `#171617` (`style.css:3`, `:46`). Il manifest non ha una variante scura e non c'è `apple-touch-startup-image`: all'avvio in modo scuro è probabile un lampo chiaro. Solo sull'iPhone.
2. Studio e Tempo condividono il percorso: vedi M1.

## C. Difetti verificati

### Alto

**A1. Dopo mezzanotte con l'app aperta resta il giorno di ieri.** Immagini: `shots/r2-after-midnight.png`, `shots/r-0005.png`.
- Passi: apri Tempo alle 23:50 (giorno di oggi, 3 attività di cui una fatta), lascia aperta, fai passare l'orologio a 00:10 del giorno dopo (anche: torna all'app il mattino, `visibilitychange`).
- Visto: titolo «11 novembre · 1 di 1 fatte / Mercoledì», le attività non fatte non compaiono, niente «Adesso». Il calendario invece segna oggi il 12. Scrivo «Comprare il pane» nella barra: salvata con `date: 2026-11-11` (ieri). Dopo una ricarica tutto torna giusto (`00:10 · 0 di 3 fatte`).
- Atteso: se guardavi «oggi», a mezzanotte passi al nuovo giorno.
- Causa: `selDay` si calcola una volta sola (`app.js:73`); il tick ogni 30 s (`app.js:3262-3280`) e il rientro in primo piano (`:3285`) non lo aggiornano. Il testo all'AI diventa «[Sto guardando mercoledì…]» (`app.js:164`) e le aggiunte senza data prendono `selDay` (`:272`).

### Medio

**M1. L'aggiornamento di Tempo cancella la cache offline di studio, e viceversa lo mescola.** Provato con HTTPS finto (studio registra il suo Service Worker solo su https, `studio/js/app.js:982`).
- Passi: apri Tempo, poi `/midi/tempo/studio/` online; cache = `tempo-v49` (114 voci, di cui 15 file di studio) + `tempo-studio-v7`. Alza `VERSION` di Tempo e aggiorna: resta solo `tempo-v50`; `tempo-studio-v7` è sparita. Studio offline: la ricarica fallisce (`ERR_FAILED`).
- Atteso: Tempo tocca solo le proprie cache.
- Causa: `sw.js:19` (`k !== VERSION` elimina tutto); `sw.js:32` mette in cache anche le richieste di studio (scope `/midi/tempo/` copre `/studio/` finché studio non ha il suo worker).
- Collegato (basso): prima visita a studio offline, senza il suo worker: Tempo risponde con il proprio `index.html` (`sw.js:35`), pagina vuota + errore «MIME text/html» in console.
- Correzione probabile: eliminare solo `k.startsWith('tempo-v')`; non gestire le richieste sotto `/studio/`.

**M2. Le Impostazioni non sono modali.** `#panel` ha `role="dialog"` ma non `aria-modal`, e `#day`/`#composer` non sono `inert` (lo sono con scheda, riepilogo e presentazione). Con le Impostazioni aperte, Tab raggiunge 8 elementi dietro (Calendario, «Avvia il timer…», «+»…). Con VoiceOver si leggono le carte sotto. Anche in calendario il giorno sotto (opacità 0) resta raggiungibile. Probabile: `app.js:2260` (`openSettings`) e `index.html` (`#panel`).

**M3. Il campo «+ progetto» è 14,5 px** (`style.css:470`). Tutti gli altri campi sono 16 px: su iPhone, con zoom consentito, toccandolo la pagina si ingrandisce e può restare così. Impostazioni, sezione Progetti.

### Basso

- **B1.** Dettatura: l'errore `no-speech` (non hai detto nulla) mostra «Dettatura non disponibile: usa il microfono della tastiera» (`app.js:667`). Atteso: nessun messaggio o «Non ho sentito niente». Senza permesso (`not-allowed`) il messaggio è giusto; `service-not-allowed` (dettatura spenta) dice di usare la tastiera, ok. Il pulsante resta com'è, nessun errore in console.
- **B2.** Bersagli sotto 44 px: pulsanti tondi in alto, «+», microfono, «Chiudi» (40x40, `style.css:84`); giorni della settimana (40x34); in calendario «2 settimane / 1 mese / 3 mesi» (38-39 di altezza), mesi (32), «Inizia» (37); «Riepilogo» (115x43). La spunta e «Riapri» si estendono a 44 con un pseudo-elemento: ok.
- **B3.** Domanda libera nel racconto del mese senza AI: «Come è andato il mese?» → «Da qui a fine mese: 2 sessioni.» (risposta fuori tema ma onesta sul fatto che non c'è AI).
- **B4.** Nella proposta registrata, `tempo.inviti[].from` è vuoto anche con il nome impostato (il testo spedito contiene «Anna»). Non visibile all'utente.
- **B5.** Offline a lungo i font di Google non sono nella cache del worker (altra origine): si vedono Georgia/Iowan al posto di Newsreader.

## D. Sospetti non confermati

1. `body { touch-action: pan-y }` (`style.css:63`) può impedire lo zoom a pizzico di accessibilità su iOS. Solo iPhone.
2. La scheda di modifica (`.sheet`, `style.css:394`) è fuori da `#app`: non segue `--vvh`. Con la tastiera, «Salva» potrebbe restare sotto la tastiera finché non la chiudi.
3. `black-translucent` con sfondo chiaro: leggibilità dell'ora in alto. Solo iPhone.
4. Testo scritto nella barra e perso se iOS scarta la pagina (solo con «Aggiorna ora» si salva in `sessionStorage`). Voluto, ma da sapere.

## E. Cosa funziona (provato)

Presentazione completa (6 passi, 375x667 chiaro e scuro, bottone sempre in vista, 16 sessioni dopo «Va bene»). Tastiera simulata (iOS finto con `visualViewport` ridotto a 40 %): barra e testo visibili, `--vvh` applicato. Annulla dopo 13 tipi di azione (barra, scheda, +, obiettivo, memoria, preferenza, giorno libero, progetto): ripristino identico. Impostazioni: ogni voce cambia e sopravvive alla ricarica; valori fuori limite (slack 999, buffer −5) sono corretti. Backup: esporta, reimporta lo stesso file, stato identico, HTML nelle note non eseguito. Timer: avvio, pausa, ripresa, fine giro, pausa e ricarica durante la pausa. 60 attività e 0 attività, titolo senza spazi: nessun overflow orizzontale, «Altre N» e pila delle concluse in vista sopra la barra. Proposta copiata e incollata nella stessa app: «Questa proposta l'hai scritta tu. La riconosco dal codice.» Ricarica con scheda, Impostazioni, calendario, riepilogo, testo nella barra: dati identici, nessun errore. Cambio chiaro/scuro a runtime: segue il sistema.

**Console:** nessun errore né eccezione non gestita di Tempo in tutte le prove; solo l'avviso atteso «Service Worker registration blocked by Playwright». Unici errori: i due di M1 (studio offline).

## F. Solo su un iPhone vero

Aggiungi a Home da Safari e icona/nome; lampo all'avvio (colori); barra di stato in chiaro e scuro; tastiera reale con scheda e barra; dettatura in modalità standalone (di solito `service-not-allowed`); foglio di condivisione e appunti veri; zoom a pizzico; notifiche e widget (Swift, non compilato qui); Service Worker dopo giorni di sospensione; apertura del link `#invito=` (da Messaggi si apre Safari, non l'app: serve incollare).
