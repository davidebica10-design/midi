# Tempo — audit della build

Sola lettura, sul ramo `claude/tempo-app-ui-optimization-i31896` a partire da `main` (c468eb7). Gravità: **blocca** / **rischio** / **debito**. Tutto ciò che segue è *verificato nel codice* salvo dove è scritto *dedotto*. Dettagli e prove complete: `security-ai.md`, `ui-perf.md`, `platform.md`, `inventory.md`.

**Esito: nessun punto «blocca».** Nessuna falla sfruttabile, nessuna perdita di dati certa, test verdi (200 in `tempo/`, anche con `TZ=Asia/Tokyo`; 13 in `cloud/`). Il piano non cambia.

## 0. Il contesto dato era indietro rispetto al codice

| Si diceva | Nel codice |
|---|---|
| 61 test | 200 (`tempo/`) + 13 (`cloud/`) |
| schema 2 | `SCHEMA = 5` (`tempo/js/store.js`) |
| nessun server né account | `cloud/` esiste: account email+password, sync, API, MCP — **non pubblicato** (`cloud/wrangler.toml:10` ha un id segnaposto, `tempo/js/cloud.js:11` `DEFAULT_CLOUD_URL = ''`) |
| nessuna app nativa | `native/` esiste (Capacitor + Swift), mai compilato |
| i 6 stati sono da costruire | esistono già come `MOODS` in `tempo/js/genui.js:19`, con catalogo chiuso |

## 1. «L'AI propone, il codice decide»

| # | Gravità | Fatto | Prova |
|---|---|---|---|
| 1.1 | — | Tutti i percorsi AI passano da `sanitizeOps` prima di `applyOps`. Nessun aggiramento trovato. | `security-ai.md` §A |
| 1.2 | rischio | La richiesta di conferma arriva in parte dall'AI (`out.confirm`). Il codice la forza solo per la cancellazione di impegni fissi; nel percorso locale copre anche `remove_recurring`, in quello AI no. | `app.js:146` contro `app.js:176` |
| 1.3 | rischio | `?tell=` nell'indirizzo esegue `send()` senza un tocco: un link preparato da altri fa agire Tempo con il testo di chi l'ha scritto. Le operazioni restano validate e annullabili. | `app.js:2899-2904` |
| 1.4 | rischio | Il percorso `tell` del cloud non forza conferme. | `cloud/src/tempo.js:104-115` |
| 1.5 | — | UI generativa: catalogo chiuso (`LAYOUTS`, `MOTIFS`, `WIDGETS`), pelle dell'AI filtrata da `sanitizeSkin` alla ricezione, al disegno e al caricamento. | `genui.js:30-32, 255` |

## 2. Sicurezza

| # | Gravità | Fatto | Prova |
|---|---|---|---|
| 2.1 | — | 27 `innerHTML`, tutti in `app.js`, tutti con `esc()` sui testi di utente, AI, backup e sync. Nessun XSS trovato. | `security-ai.md` §B1 |
| 2.2 | rischio | CSP: `connect-src` contiene `https:`, cioè qualunque host. La CSP oggi non limita dove possono uscire i dati. | `tempo/index.html:5` |
| 2.3 | rischio | La chiave Gemini/NVIDIA viene mandata a qualunque indirizzo che contenga il nome del fornitore. | `app.js:733` |
| 2.4 | — | Le chiavi restano fuori da backup, sync, repository e indirizzi. | `security-ai.md` §B3 |
| 2.5 | rischio | Sync: un elemento assente da un lato vale come cancellato. Ripristinare un backup vecchio può cancellare elementi sugli altri dispositivi (*dedotto dalla lettura, non provato con un test*). | `tempo/js/cloud.js:34-52` |
| 2.6 | rischio | Cloud: lettura, controllo e scrittura in passi separati su uno store a consistenza eventuale; un `tell` da Siri/MCP può sovrascrivere ciò che il telefono ha appena inviato. | `cloud/src/app.js:127-135, 196-200` |
| 2.7 | debito | Il server può leggere lo stato: nessuna cifratura da capo a capo. | `platform.md` §1 |

2.5 e 2.6 oggi non toccano nessuno perché il cloud non è pubblicato. **Vanno chiusi prima di accenderlo.**

## 3. Prestazioni su iPhone

| # | Gravità | Fatto | Prova |
|---|---|---|---|
| 3.1 | rischio | `tick` ogni 30 s ridisegna tutto il collage con `innerHTML` e chiama `save()`, anche se non è cambiato nulla. | `ui-perf.md` §6 |
| 3.2 | rischio | Sfondo: tre macchie da 100–120 vw animate senza fine (24–32 s) più 11 `backdrop-filter`. Su un iPhone di tre anni fa è il costo grafico maggiore (*dedotto: non misurato su dispositivo*). | `style.css`, `ui-perf.md` §6 |
| 3.3 | debito | `app.js` è un monolite di 2 922 righe; `vendor/web-llm.mjs` (6 MB) non è in `SHELL`, quindi il modello locale non parte offline al primo uso. | `inventory.md` §3 |
| 3.4 | debito | Tutto lo stato sta in una sola chiave di `localStorage` (~5 MB di tetto su Safari), riscritta a ogni salvataggio. | `store.js` |

## 4. Debito UI

| # | Gravità | Fatto | Prova |
|---|---|---|---|
| 4.1 | rischio | «Adesso» cambia altezza tra gli stati (130 / 205 / 245 px a 390 px di larghezza). | screenshot di partenza |
| 4.2 | rischio | Saluto in tema chiaro quasi invisibile e tagliato a destra. | screenshot di partenza |
| 4.3 | debito | 20 regole con testo sotto i 12 px (minimo 9 px); ~10 controlli sotto i 44 px (`.ed-rm` 30×30). | `inventory.md` §4 |
| 4.4 | debito | 25 `z-index` senza scala (da −1 a 60); ~112 colori fuori dai token; 20 variabili `:root` definite due volte; CSS morto (`.tile`, `--veil`). | `inventory.md` §4 |
| 4.5 | debito | Trascinare una carta non cambia il piano: un gesto che promette e non mantiene. | `ui-perf.md` §4-5 |
| 4.6 | debito | Il foglio di modifica non rende inerte lo sfondo e non restituisce il fuoco alla chiusura. | `ui-perf.md` §7 |
| 4.7 | debito | Giornata piena: 8+ carte sullo stesso piano, nessuna azione primaria dichiarata; nel vuoto lo stesso invito è scritto due volte. | screenshot di partenza |

## 5. Cosa si rompe con amici, sincronizzazione e nativo

| # | Gravità | Fatto | Prova |
|---|---|---|---|
| 5.1 | blocca *(per gli amici, non per oggi)* | Nessun autore, proprietario o partecipante sui record; un blob per account, nessun gruppo o invito. | `platform.md` §1-2 |
| 5.2 | rischio | Id da `Math.random().toString(36).slice(2,8)`: circa 2 miliardi di valori, non sicuri tra più persone. | `store.js:15` |
| 5.3 | rischio | Date come stringhe locali `AAAA-MM-GG` più minuti dalla mezzanotte, senza fuso nello stato: due persone in fusi diversi non hanno un «alle 15» comune. | `platform.md` §2 |
| 5.4 | rischio | Conflitti risolti dall'orologio del dispositivo; nessuna lapide per le cancellazioni. | `cloud.js:34-52` |
| 5.5 | debito | Lo scheduler è puro e gira già sul server, ma ha stato di modulo (`prefsRef`) e usa il fuso del processo. Espone `gaps` solo dopo aver piazzato le attività flessibili: manca una funzione «fasce libere grezze». | `scheduler.js`, `platform.md` §3 |
| 5.6 | debito | Nessun `.ics`, nessun link di condivisione, nessun invito. Esistono solo il backup JSON e il riepilogo mensile come testo. | `app.js:2861` |

## 6. Copertura dei test

Coperti: parser, scheduler, store e migrazioni, viewmodel, genui, companion, learn, sync (logica). **Non coperto da nulla di automatico** — e provabile solo su un iPhone vero: trascinamento delle carte, barra di stato e aree sicure, fascia vuota in basso, PWA in modalità autonoma, aggiornamento del service worker, tastiera che copre la composizione, tutto `native/`. Nessun test nel browser prima di questo lavoro; nessuna CI.
