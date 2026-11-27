# Audit: «L'AI propone, il codice decide» e sicurezza

Sola lettura, nessun file di prodotto toccato. Gravità: **blocca** (buco sfruttabile o perdita di dati certa), **rischio** (da correggere presto), **debito** (fragilità o incoerenza). Per le classi sfruttabili sono indicati classe e posizione, non payload.

**Esito in breve:** nessun buco XSS né fuga di chiavi trovati; 0 blocca, 10 rischio, 11 debito. Le due cose più concrete: l'apertura automatica di `?tell=` (A2) e la scrittura non atomica sul cloud (B5.1).

## A. «L'AI propone, il codice decide»

### A.0 Mappa dei punti in cui si chiama `applyOps`

| Chiamante | Origine delle operazioni | Passa da `sanitizeOps`? |
|---|---|---|
| `app.js:173` (Claude, hook `apply`) | AI | Sì, in `ai.js:255` |
| `app.js:145` (modelli open) | AI | Sì, in `ai-open.js:225` (`parseJson`) |
| `cloud/src/tempo.js:104,115` (`tell`, MCP e `/v1/tell`) | AI con chiave dell'utente | Sì |
| `app.js:229` (`baseTurn`), `tempo.js:95` | parser `parse.js` | Non serve: le crea il codice |
| `companion.js:372-438` (`answerObservation`), `app.js:938-2671` (pulsanti), `store.js:179` (migrazione), `contextOps` | codice, argomenti dai data-attribute | No, per progetto |
| `decide.js:146-149` | AI sceglie un id tra le opzioni date | Controllo `opts.some(id)`: catalogo chiuso |
| `app.js:763`, `recap.js:171`, `templates.js:85` | pelle, racconto, piano sessioni | `sanitizeSkin`, `sanitizeRecapAi`, `validatePlan`: conformi |

Nessun percorso AI aggira `sanitizeOps`. Le deviazioni stanno nelle conseguenze (sotto).

### A.1 Findings

| # | Gravità | Finding | Evidenza |
|---|---|---|---|
| A1 | rischio | **La conferma dipende da un flag dell'AI.** `requires_confirmation` lo scrive il modello; il codice forza la conferma solo per cancellazione di impegni fissi (e `remove_recurring` solo nel percorso Claude). Fino a 40 operazioni (`delete` di attività, `remove_goal`, `remove_habit`, `plan_goal`) si applicano subito senza soglia di codice. Resta l'annulla. Nel percorso modelli open manca anche `remove_recurring`. | `app.js:146` vs `app.js:176`; `store.js:778` (limite 40); `cloud/src/tempo.js:104-115` (da fuori nessuna conferma forzata) |
| A2 | rischio | **Link che esegue comandi.** `?tell=` (e l'intent nativo) chiama `send()` senza gesto né conferma: un link in una pagina, un QR o un messaggio fa interpretare a Tempo un testo scelto da chi lo scrive (con AI attiva consuma anche la chiave). Classe: azione avviata da input esterno non autenticato. | `app.js:2899-2904` |
| A3 | rischio | **L'AI può fissare orari e stime.** `start_time`/`date` sono accettati per qualunque attività e la fissano (`start`), senza distinguere «lo ha detto l'utente» da «lo ha inventato il modello». `duration_is_estimate` lo decide l'AI e, se falso, salta la stima appresa. Lo scheduler poi gestisce i conflitti, ma l'orario resta scelto dal modello. | `store.js:400-401,414-417,446,448`; schema in `ai.js` e prompt in `ai-open.js` |
| A4 | debito | `sanitizeOps` non limita gli interi (solo `Math.round`): i limiti reali stanno in `applyOps` (`clampInt` 5-960 ecc.). Ogni azione nuova deve ricordarsi il clamp; `id` e `project` sono solo stringhe da 200 caratteri. | `store.js:786,407,448,474,498`; `set_goal` assegna `title` senza `slice(0,120)` a `store.js:521` (lo taglia poi `sanitizeState`) |
| A5 | debito | Le osservazioni del companion (`act`/`arg`) vivono in `seenObs.snap`, che si importa e si sincronizza, e `data-arg` arriva dal DOM. Un backup o uno stato sincronizzato alterato può mettere un pulsante con azione distruttiva (`goal-remove`, `item-remove`, `trim`); serve un tocco dell'utente e si annulla. | `store.js:117-122`; `app.js:522,527,1802`; `companion.js:363-438` |
| A6 | debito | `validatePlan` non limita la lunghezza di `key` e `after` (usate solo come chiavi interne). Trascurabile ma incoerente con il resto. | `templates.js:96` |

### A.2 genui.js: catalogo chiuso

Conforme. L'AI può proporre solo `{domain, pal, motif, widgets, line}` e `sanitizeSkin` tiene soltanto: `domain` in `DOMAIN_KEYS`, `motif` in `MOTIFS`, `widgets` in `WIDGETS` (max 3, senza duplicati), tre colori `#rrggbb` (rischiariti da `softTint`), una frase ≤ 90 caratteri senza `!`, `<`, `>` (`genui.js:83-98`). Layout, umore e dati dei widget li calcola il codice (`moodOf`, `sceneFor`). La validazione si ripete in tre punti: alla ricezione (`app.js:763`), nel rendering (`genui.js:255`) e a ogni caricamento o sync (`store.js:129-130`, con `slice(0,50)` sulle pelle). Nessun layout o markup inventato dall'AI. Unica nota: la frase `line` è testo libero dell'AI, quindi dove si mostra va sempre con `esc()` o testo (non trovata nessuna interpolazione grezza).

## B. Sicurezza

### B.1 `innerHTML` (27 punti, tutti in `app.js`; nessuno negli altri moduli)

Verificate le 27 assegnazioni e ogni `${...}` che non passa da `esc()`. **Nessuna interpolazione non escapata contiene testo di utente, AI, backup o sync.** Quelle senza `esc()` sono: numeri (`P.buffer`, `P.decompress`, `p.pct`, `c.n`, `w.days`: `app.js:1998-2002,1024,717,714`), enumerazioni chiuse (`a.mood`, `a.action.type`, `th.icon`, `sc.icon`, `LAYOUTS`, `MODELS`, `LOCAL_MODELS`, `ONLINE_PRESETS.label`: `app.js:631,2015-2024,2214`), colori filtrati da `safeColor()` (`app.js:496,699,1023,1530`), stringhe prodotte dal codice (`g.dueText`, `c.moveTo`, `c.at`: `app.js:1969,513,520`), URL `blob:` (`app.js:356`). Gli attributi con dati esterni (`data-item`, `data-arg`, `data-img`, `aria-label`) usano `esc()` (che copre `" ' < > &`).

| # | Gravità | Finding | Evidenza |
|---|---|---|---|
| B1 | debito | La sicurezza regge perché `sanitizeState` forza i tipi, ma le voci si copiano con `...x` e **i campi non elencati sopravvivono senza controllo** (`priority`, `energy`, `actual`, `spent`, `baseDuration`, `learned.slots`, `prefs.availability`). Oggi sono usati solo in confronti; se un domani uno finisse in un template senza `esc()`, un backup alterato diventerebbe XSS. Manca una regola o un test automatico «niente `${}` grezzo con dati non numerici». | `store.js:99,108-109,123-126,142,156`; `app.js:1998` |

### B.2 CSP (`tempo/index.html:5`)

| # | Gravità | Finding | Evidenza |
|---|---|---|---|
| B2 | rischio | `connect-src 'self' https: ...` ammette **qualunque host https**: la CSP non limita dove può finire un dato o una chiave (contraddice «limita le connessioni» di CLAUDE.md). È la conseguenza di URL personalizzati (servizio open, cloud, decisore), ma resta una difesa in profondità persa se mai ci fosse un XSS. Documentare la scelta o usare un elenco per i servizi noti. | `index.html:5`; `ai-open.js:343`; `cloud.js:115` |
| B3 | debito | `http://` verso un host di rete locale (es. `clm-serve` su `http://host:8700`, descritto in `decide.js:101`) è bloccato dalla CSP: passa solo `localhost`/`127.0.0.1`. Funzione dichiarata ma non raggiungibile da telefono. | `index.html:5`; `decide.js:101`; `app.js:2232` |
| B4 | debito | `style-src 'unsafe-inline'` (serve per gli `style=""`; i valori sono tutti numeri o `safeColor`) e Google Fonts da `fonts.googleapis.com`/`gstatic` (`index.html:21-23`): invia l'IP a terzi e non funziona offline alla prima apertura (il service worker ignora le origini esterne, `sw.js`). `script-src 'self' 'wasm-unsafe-eval'` è pulito: nessuno script inline né `eval`. Reti coerenti con le chiamate reali: `fetch` solo verso `base` dei preset (`ai-open.js:52,343`), `decide.js`, `cloudCall`, SDK Anthropic. Immagini: `blob:`/`data:`/`self`, coerente. | `index.html:5,21-23` |

### B.3 Chiavi API

Conformi: nessuna chiave nel repository (cercati `sk-ant-`, `AIza…`, `nvapi-`: solo segnaposto nei test), nessun `console.log` con dati, nessuna chiave in URL (sempre intestazione `Authorization`). Il backup esclude `settings` (`app.js:2863`); la sync manda solo `settings.name` (`cloud.js:20-25`); il server rimuove `settings` anche se arriva (`tempo.js:124-128`). Eccezione dichiarata «usa la mia chiave anche da fuori»: cifrata AES-GCM per utente (`cloud/src/app.js:187`, `crypto.js:41-53`).

| # | Gravità | Finding | Evidenza |
|---|---|---|---|
| B5 | rischio | La chiave del decisore si prende dalla chiave Gemini/NVIDIA dell'assistente **se l'URL contiene la parola** `generativelanguage` o `nvidia.com`, senza controllare l'host: un indirizzo scritto dall'utente (o copiato da una guida) come `https://altro.host/generativelanguage` riceve la chiave. | `app.js:733` |
| B6 | debito | Le chiavi (`apiKey`, `openKey`, `decider.key`, `cloudToken`) stanno in `localStorage` in chiaro; il token cloud va anche in `UserDefaults` dell'App Group, non in Keychain. Accettabile per una PWA, da dichiarare. Gli URL del servizio e del cloud non impongono `https` (token e chiave in chiaro se si scrive `http://`). | `store.js:43`; `app.js:2269,2288,2306`; `TempoShared.swift:60-62`; `cloud.js:115-123` |

### B.4 Import backup e merge della sync

Percorso: `JSON.parse` → controllo `Array.isArray(items)` → `migrate` → `sanitizeState` (identificativi `SAFE_ID`, colori, date, orari, stringhe troncate, checklist ≤ 30, pelle ≤ 50, tipi forzati). Stessa pipeline per lo stato che arriva dalla sync (`app.js:2098`) e per l'archivio (`app.js:2318`). Le impostazioni correnti non vengono sovrascritte (`settings: state.settings`).

| # | Gravità | Finding | Evidenza |
|---|---|---|---|
| B7 | rischio | **Un backup vecchio può cancellare dati sugli altri dispositivi.** Il merge toglie le voci presenti da una sola parte se nate prima dell'ultima sincronizzazione (assenza = cancellazione, nessuna lapide). Ripristinare un backup vecchio (o «Cancella tutto») su un dispositivo e poi sincronizzare propaga la perdita; l'annulla è solo locale e non si sincronizza. Da confermare con un test dedicato. | `cloud.js:34-52` (`mergeById`); `app.js:2316,2727` |
| B8 | rischio | Nessun tetto a dimensione del file e numero di voci (`items`, `log`, `chat`, `goals` senza `slice`): un file enorme blocca la pagina o satura la quota di `localStorage`. Solo autolesionismo (il file lo sceglie l'utente), ma il messaggio d'errore non è dato. | `app.js:2310-2316`; `store.js:98,140` |
| B9 | debito | Prototype pollution limitata: una chiave `__proto__` nel JSON sopravvive alle copie con spread e `Object.assign(state, …)` la imposta come prototipo dell'oggetto stato (non globale, ma lo stato eredita proprietà scelte dal file). Nessun filtro delle chiavi. Nessun controllo di `schema` maggiore di quello noto (backup di una versione futura importato senza avviso). | `app.js:2315-2316`; `store.js:170` |

### B.5 `cloud/`

Punti solidi: ogni rotta ricava `uid` dal token (nessun id dell'utente nel percorso, revoca dei token solo dalla propria lista: nessun IDOR), token salvati come hash SHA-256, password PBKDF2-SHA256 con sale e confronto a tempo costante, stato e chiave AI cifrati per utente (HKDF + AES-GCM), segreto ≥ 32 caratteri obbligatorio, limiti di frequenza su registrazione/accesso/`tell`, corpo ≤ 4 MB, CORS con elenco di origini, `no-store` e `nosniff`, errori 500 senza dettagli, cancellazione account completa. Nessun SSRF: la chiave AI va solo ai `baseUrl` dei preset (`tempo.js:97-98`).

| # | Gravità | Finding | Evidenza |
|---|---|---|---|
| C1 | rischio | **Scrittura non atomica = perdita di dati.** `PUT /v1/state` confronta `rev` e scrive in due passi su KV (eventualmente consistente); `doTell` legge, modifica e scrive `cur.rev+1` senza controllo: una frase da Siri/MCP può sovrascrivere ciò che il telefono ha appena inviato. | `cloud/src/app.js:196-200,127-135` |
| C2 | rischio | Il limite di frequenza usa l'IP da intestazioni modificabili: su Node (`node.js:26`) `x-forwarded-for` del client è accettato così com'è, quindi accesso e registrazione si aggirano cambiando valore (su Cloudflare `cf-connecting-ip` è affidabile). Il contatore non è atomico. La chiave di login è `ip:email`: ruotando l'IP non c'è tetto per account. | `cloud/src/app.js:87,256`; `node.js:26` |
| C3 | rischio | `tempo_dimmi` / `/v1/tell` con token «esterno» (anche in URL `/mcp/t/<token>`, che finisce nei log dei proxy) applica modifiche; con la chiave AI dell'utente salvata vale A1 (cancellazioni senza conferma forzata) e un assistente esterno può essere ingannato da testo di terzi (prompt injection). Mitigati da limite 60/h e revoca. | `cloud/src/app.js:58,127-135`; `tempo.js:96-115`; `mcp.js:68-72` |
| C4 | debito | Elenco token tagliato a 50 (`slice(-50)`): i token più vecchi restano validi ma spariscono dall'elenco e non si possono più revocare (se non cancellando l'account). | `cloud/src/app.js:51` |
| C5 | debito | Nessun cambio password né recupero (password dimenticata = dati persi); password senza lunghezza massima (hash PBKDF2 su corpo fino a 4 MB); `409` alla registrazione rivela quali email esistono; PBKDF2 a 100.000 iterazioni (limite Workers). | `app.js:73-78,101-108`; `crypto.js:24` |
| C6 | debito | Il formato cifrato `v1:` non ha identificativo di chiave: ruotare `TEMPO_SECRET` rende illeggibili tutti gli stati e le chiavi AI. Backup del solo KV non basta. | `crypto.js:41-59` |

## Conteggio

| Gravità | N | Voci |
|---|---|---|
| blocca | 0 | — |
| rischio | 10 | A1, A2, A3, B2, B5, B7, B8, C1, C2, C3 |
| debito | 11 | A4, A5, A6, B1, B3, B4, B6, B9, C4, C5, C6 |
