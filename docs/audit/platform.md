# Audit tecnico per «Tempo con gli amici» (sola lettura)

Stato del codice al commit c468eb7. Solo fatti tecnici, con file:riga.

## 1. cloud/ (Tempo Cloud)

- **Runtime**: un unico gestore `fetch` standard (`cloud/src/app.js:21` `createApp`), due avvii: Cloudflare Workers (`src/worker.js`, `wrangler.toml:5-12`) e Node (`src/node.js:7-40`, dati in un file JSON con scrittura ritardata 200 ms).
- **DB**: nessun database vero. Interfaccia chiave/valore `{get,put,delete}`: KV di Cloudflare (`worker.js:12`), file su Node, mappa nei test (`app.js:276`). Il README ammette che il KV è «eventualmente consistente» e suggerisce D1 o Durable Objects (`cloud/README.md`, sezione Pubblicarlo). Nessun indice, nessuna query: si legge per chiave.
- **Pubblicato?** No, solo codice. `wrangler.toml:10` ha ancora `INSERISCI_L_ID_DEL_NAMESPACE`; `tempo/js/cloud.js:11` ha `DEFAULT_CLOUD_URL = ''`. Nessuna CI (`.github` assente). Ogni utente dovrebbe scrivere l'URL a mano (`app.js` ~2157).
- **Endpoint** (`app.js:138-232`): `/v1/health`, `signup`, `login`, `logout`, `account` (GET/DELETE), `settings` (PATCH tz/AI), `state` (GET/PUT), `tokens` (GET/POST/DELETE), `now`, `today`, `recap`, `tell`, `/mcp` e `/mcp/t/<codice>`.
- **Identità**: email + password (PBKDF2 100k, `crypto.js:24`), `uid = 'u_'+9 byte casuali` (`app.js:79`, `crypto.js:16`). Un account = un solo blob di stato (`state:<uid>`). Nessun concetto di gruppo, invito, ruolo, profilo pubblico, ricerca utenti o notifica.
- **Auth**: Bearer. Token `tmp_` (dispositivo, scope `full`) e `tmx_` (esterno, solo now/today/recap/tell/MCP) (`app.js:42-47`, `README` API). Lo scope è a livello di account, non di risorsa.
- **Cifratura**: AES-GCM con chiave per utente derivata da `TEMPO_SECRET` (`crypto.js`). Il server può decifrare tutto (non è end-to-end): serve per calcolare now/today/MCP lato server.
- **Sync**: sincronizzazione dell'intero blob con revisione (`app.js:~180-190`). `PUT {rev,state}`: se `rev` non è quella del server, risponde 409 con lo stato attuale. Il merge è **sul client** (`cloud.js:95` `mergeStates`, `:32` `mergeById`): per id, vince la voce con timestamp più alto (`tsOf`, `:25`: max di updatedAt/doneAt/startedAt/createdAt/at/archivedAt); le checklist si uniscono voce per voce (`:58`). **Le cancellazioni non hanno tombstone**: una voce presente da una sola parte si toglie se nata prima dell'ultima sync (`:50-52`, `lastSync`). Si usano gli orologi dei dispositivi (`Date.now()`), senza orologio logico. Limite 4 MB (`app.js:16`). Lettura+scrittura non atomiche sul KV.
- **Limiti di frequenza**: finestra fissa su KV (`app.js:29-37`), 10 login/15 minuti.
- **MCP** (`mcp.js`): Streamable HTTP senza sessione, 4 strumenti: `tempo_adesso`, `tempo_giornata` (entro 14 giorni), `tempo_mese`, `tempo_dimmi` (scrive, ma le modifiche grandi restano in attesa di conferma sul telefono). Sempre e solo i dati dell'utente autenticato.
- **Lato server** (`cloud/src/tempo.js`): importa `store`, `scheduler`, `companion`, `parse`, `recap`, `ai-open`, `decide` da `tempo/js` (righe 3-9). Risolve il fuso con lo spostamento dell'orologio `clockFor` (`:19-24`) perché lo scheduler usa l'ora locale del processo, e `unshift` (`:27`) per riportare i timestamp reali.
- **Client** (`tempo/js/cloud.js`): **facoltativo e opt-in**. Si sincronizza solo se esiste `settings.cloudToken` (`app.js:2089-2094`, avvio `:2895`). Il payload esclude le impostazioni del dispositivo e le chiavi AI (`cloud.js:13-20`). `syncNow` (`:149-175`): GET, poi push o pull o merge su 409 e nuovo PUT. CSP già aperta a `https:` (`index.html:5`).

## 2. Modello dati (tempo/js/store.js)

- **Schema**: `SCHEMA = 5` (`store.js:17`). Chiave `localStorage`: `tempo.v1` (`:12`); annullamento `tempo.undo.v1`. `migrate` (`:166`) + `sanitizeState` (`:95`).
- **Stato** (`emptyState`, `:19-45`): `items, habits, learned, seenObs, welcome, askChat, timeChat, askIntro, focus, prefs, recurring, memory, goals, goalsDone, projects, log, onboarded, anchors, chat, skins, recaps, settings, stats`. Tutto riferito a **un solo utente**: `prefs`, `learned`, `memory`, `settings.name` sono personali.
- **Voce** (`op add`, `:413-431`): `id, title, kind('task'|'event'), date('YYYY-MM-DD'|null), start(minuti da mezzanotte|null), duration(min), durationEstimated, priority 1-3, deadline, earliest, window, energy, status, startedAt, doneAt, actual, dependsOn[], notes, project, theme, goalId, spent, createdAt, updatedAt`. Ricorrenze: `{id,title,start,end,weekdays[],skip[],createdAt}` (`:125`).
- **Id**: `uid = Math.random().toString(36).slice(2,8)` (`:15`): 6 caratteri, circa 2 miliardi di valori, non collision-safe tra dispositivi né tra persone (rischio basso con poche centinaia di voci, ma senza controllo). `SAFE_ID` ammette 64 caratteri (`:59`), quindi si possono usare id più lunghi senza rompere la sanificazione.
- **Timestamp**: createdAt/updatedAt/doneAt sono epoch ms (assoluti). **Nessun campo autore, proprietario, partecipanti o visibilità** su nessun record. `log` e `chat` hanno `at`/`ts`.
- **Date e ore**: stringhe locali `YYYY-MM-DD` + minuti dal mezzanotte locale. **Nessun fuso salvato nello stato**: il fuso sta solo nell'account del server (`app.js:121`, default `Europe/Rome`, `validTz`). `dateKey` usa `getFullYear/getMonth/getDate` (`scheduler.js:21`). Due persone in fusi diversi che condividono «alle 15:00» significherebbero istanti diversi; non esiste conversione né un istante UTC per gli impegni.
- **Cosa si rompe con due persone in un piano**: (a) `mergeById` ordina per timestamp degli orologi dei telefoni: due persone che toccano la stessa voce → vince chi ha l'orologio avanti, senza avviso; (b) le cancellazioni sono dedotte da `lastSync`, che è per dispositivo, non per persona; (c) tutto lo stato è un blob per account, non esiste una risorsa condivisa da sincronizzare; (d) `goalId/project/dependsOn` sono riferimenti locali; (e) lo `status` `done` è unico: chi ha fatto cosa? (f) `learned`, `prefs`, `anchors` e `memory` mescolerebbero le abitudini di due persone; (g) l'annulla (`UNDO_MEM`) è locale e annullerebbe anche modifiche altrui; (h) `sanitizeOps` e `applyOps` non conoscono `author`.

## 3. Scheduler (tempo/js/scheduler.js)

- **Ingressi/uscite**: `planDays(state, now, nDays, {leftovers})` (`:333`) e `planDay(day, items, prefs, now, pool, recurring, anchors)` (`:135`). Uscita per giorno: `{day, blocks, conflicts, unscheduled, deferred, missed, free, gaps, totalFree}` (`:320-329`).
- **Spazi liberi**: **`gaps`** è già nell'uscita di `planDay` come coppie `[inizio, fine]` in minuti (calcolata in `:196` con `subtract` `:62`). Ma è lo spazio **dopo** aver collocato le attività flessibili (`gaps.splice` `:288`), e **dopo** buffer (`P.buffer`, 15 min) e pausa «Cena e pausa» (`:186-193`); non esiste una funzione dedicata «spazi liberi senza le mie attività flessibili». `totalFree` (`:197`) è il valore prima del collocamento, ma senza i singoli intervalli. Non c'è nessuna funzione di intersezione tra persone.
- **Pura?** Quasi. Nessun DOM e nessuna lettura di storage, importa solo helper interni. Ma: (1) stato di modulo mutabile `prefsRef` (`:76`, assegnato in `:137`), usato da funzioni interne: non è rientrante, ma è sincrono, quindi ok per N persone in sequenza; (2) usa l'ora locale del processo (`new Date(now).getHours()`, `minOfTs` `:35`), motivo per cui il server fa il trucco `clockFor`: per N persone in N fusi andrebbe parametrizzato; (3) `planDays` consuma/muta `pool`. È già usato lato server con lo stato di un utente (`tempo.js:50`).
- **Assunzioni single-user**: un solo `prefs`/`availability`/`offDays`, un solo `anchors`, `paceOf` per obiettivo personale, priorità e energia personali.

## 4. native/

- **Reale (scritto, mai compilato)**: widget «Adesso» (`Widgets/TempoWidgets.swift`, WidgetKit), Live Activity (ActivityKit, `Shared/TempoShared.swift:121`), App Intents/Siri (`App/TempoIntents.swift`: `WhatNowIntent`, `TellTempoIntent`, `MonthRecapIntent`, `AppShortcutsProvider`), ponte Capacitor (`TempoBridgePlugin.swift`), promemoria locali (`UNUserNotificationCenter`, `:115`), CarPlay (`CarPlaySceneDelegate.swift`, richiede autorizzazione Apple). Il README dichiara che il Swift **non è mai stato compilato** (`native/README.md`, «Stato onesto»).
- **Assente**: EventKit/accesso al calendario iOS (nessun `import EventKit`); rubrica/contatti; push remoto; CloudKit; Sign in with Apple; deep link per inviti (esiste solo lo schema `tempo://`).
- **Notifiche in PWA**: proposta non implementata (`tempo/NOTIFICHE.md`): su PWA servirebbe Web Push da un server.

## 5. Esportazione e condivisione esistenti

- **Backup JSON**: `exportData` (`app.js:2861`): file `tempo-backup-AAAA-MM-GG.json` con tutto tranne `settings`, via `navigator.share` o download; import in `app.js:~2316` con sanificazione (`store.js:58`). È tutto lo stato di una persona, non una selezione.
- **Condivisione testo**: solo il racconto del mese, `shareRecap` (`app.js:1423`, `navigator.share` o clipboard).
- **.ics**: **non esiste**. Solo citato come idea in `tempo/NOTIFICHE.md:46,55`. Nessuna importazione di calendari, nessun link condivisibile, nessun invito.
- **Accessi da fuori**: token `tmx_` e MCP, ma solo per l'utente stesso.

## 6. Test

Radice: `cd tempo && npm test`, `cd cloud && npm test` (node:test, nessuna dipendenza). Il QA li ripete in due fusi (`TZ=UTC`, `TZ=Asia/Tokyo`). Nessuna CI in `.github`.

**tempo/tests**: `parser` (parser italiano); `understand` (frasi complesse senza AI); `engine` (scheduler: sessioni in corso, scadenze, giorni liberi, fasce, ritmo); `moments` (companion); `observations` (max 2 al giorno); `learn` (durate e fasce imparate); `recap` (mese); `viewmodel` (modelli di vista); `storage` (spazio pieno, archivio, migrazioni); `security` (backup ostile, colori, id); `cloud-client` (merge per voce, payload senza chiavi, due dispositivi contro il server vero); `checklist` e `checklist-difetti`; `goalplan`; `focus`; `genui`; `decide`; `ai`; `bench` e `bench.test.js`; `year` (365 giorni simulati); helper `fake-storage.js`, `helpers.js`, `sim.js`.

**cloud/test**: `cloud.test.js`: crittografia, fuso orario, account, 429 sul login, sync con revisioni e 409, now/today/tell con fuso, modifiche grandi non applicate, AI con chiave utente simulata, MCP, cancellazione account, CORS, stato vuoto. `shift.test.js`: `unshift` dei timestamp.

**Non coperto da nessun test automatico**:
- Tutta l'interfaccia: nessun test di `app.js` (circa 2900 righe), né di DOM, né di rendering (`viewmodel` è l'unica parte testabile).
- Trascinamento delle carte (`touchstart`/`pointer*`, `app.js:1061,1163`), gesti sui fogli (`:1093`), `touch-action`.
- Barra di stato `black-translucent`, safe area (`style.css:27-28`, `viewport-fit=cover`), banda vuota in basso, tastiera (`interactive-widget`), standalone.
- Service worker: installazione, aggiornamento (`sw.js` `VERSION`, `app.js:2912-2919` `controllerchange`), cache offline.
- Installazione PWA su iPhone, comportamento offline reale, quota di `localStorage` su iOS.
- Tutto Swift (widget, Intents, Live Activity, CarPlay, notifiche): non compilato.
- Cloud: concorrenza reale sul KV (consistenza eventuale), scadenza dei token, deploy, `node.js` (serve HTTP), il percorso sicurezza di `/mcp/t/<codice>` oltre i test base.
- Sync tra fusi diversi e cambio ora legale; cancellazioni concorrenti con orologi sfasati.
- Nessuna funzione condivisa esiste, quindi nessun test di accessi tra utenti (isolamento tra account verificato solo implicitamente).
