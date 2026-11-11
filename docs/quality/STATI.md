# Mappa degli stati di Tempo

Verificata sul codice (branch `claude/tempo-app-ui-optimization-i31896`), solo lettura. Percorsi relativi a `tempo/`. Ogni affermazione porta `file:line` ed è stata verificata nel sorgente.
Legenda forma UI: **T** toast (`app.js:2389`) · **C** risposta/messaggio in chat (`app.js:425-446`) · **K** carta nel giorno (`app.js:505-516`) · **I** testo inline / stato nelle impostazioni · **B** banner fisso (`index.html:31`) · **S** schermata/foglio · **no** niente · **n.a.** non applicabile.

## 1. Matrice schermata x stato (cella = UI dedicata sì/no/n.a. · forma; testi e file:line nelle sezioni 2-3)

| # | Schermata / azione | normale | vuoto | caricam. | errore | offline | limite | conflitto | primo avvio | dati vecchi |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Giorno (carte) | sì·K | sì·I | n.a. | n.a. | n.a. | sì·K | sì·K | sì·I | sì·K |
| 2 | Giorni / mese | sì·I | sì·I | n.a. | n.a. | n.a. | no | no | no | n.a. |
| 3 | Barra / chat | sì·C | n.a. | sì·C | sì·C | sì·C | sì·C | n.a. | sì·I | no |
| 4 | Editor (foglio) | sì·S | n.a. | no | sì·T | n.a. | no | no | n.a. | n.a. |
| 5 | Timer focus | sì·I | n.a. | n.a. | no | n.a. | n.a. | no | n.a. | sì·T |
| 6 | Obiettivi | sì·K | no | no | sì·C | n.a. | sì·K | no | no | sì·K |
| 7 | Onboarding | sì·S | sì·I | sì·I | sì·I | no | n.a. | n.a. | n.a. | no |
| 8 | Impostazioni / scelta AI | sì·I | sì·I | sì·I | sì·I | no | sì·I | n.a. | sì·I | no |
| 9 | Backup: esporta | no | n.a. | n.a. | no | n.a. | n.a. | n.a. | n.a. | sì·K |
| 10 | Backup: importa | sì·T | n.a. | no | sì·T | n.a. | no | no | n.a. | n.a. |
| 11 | Salvataggio locale | n.a. | n.a. | n.a. | sì·B | n.a. | sì·B | n.a. | n.a. | no |
| 12 | Riepilogo del mese | sì·K | sì·K | sì·I | sì·T | no | no | n.a. | sì·K | n.a. |
| 13 | Cloud / sincronizzazione | sì·I | sì·I | sì·I | sì·I | sì·T | no | sì·T | sì·S | no |
| 14 | Memoria («Il tuo contesto») | sì·I | sì·I | n.a. | n.a. | n.a. | no | n.a. | n.a. | n.a. |
| 15 | Foto | sì·I | n.a. | no | sì·T | no | n.a. | no | n.a. | no |
| 16 | Aggiornamento dell'app (SW) | n.a. | n.a. | n.a. | no | n.a. | n.a. | n.a. | n.a. | no |

Conteggio (144 celle): vedi riga finale della sezione 4. In ogni cella «sì» la forma è una sola, ma le forme cambiano da schermata a schermata (sezione 5).

## 2. Tracce richieste: cosa vede l'utente

| Caso | Cosa succede e testo esatto | File:line |
|---|---|---|
| AI non risponde | Tempo massimo `AI_TIMEOUT = 25000` ms (online); Claude `AI_TIMEOUT*2` = 50 s; **modello sul telefono: nessun limite**; riepilogo del mese 60 s; piano obiettivo 25 s; cloud 15 s. Per 25 s resta «Sto sistemando la giornata…» senza pulsante Annulla. Poi `baseTurn`: se il parser capisce, messaggio con prefisso «L'AI non risponde: ho usato la modalità base. » + risposta e modifica normale; se non capisce: «L'AI non risponde e senza AI non ho capito la frase. Riprova tra poco, o scrivila più semplice.» (carta d'errore, sparisce dopo 12 s) | `app.js:216,141,203,227,237,446`; `ai.js:332-339`; `app.js:1441-1442` |
| Chiave mancante | Modalità `claude` senza chiave: `aiMode()` ripiega **in silenzio** su base (nessun avviso). Online senza chiave: «Manca la chiave di {servizio}. Creala gratis e incollala in Impostazioni (⋯ in alto) → Assistente AI (lì trovi i passaggi).» Se il parser capisce la frase, invece, solo il prefisso generico «L'AI ha avuto un problema: ho usato la modalità base.» (non dice che manca la chiave) | `app.js:83-86,242,227`; `ai-open.js:340` |
| Chiave non valida 401/403 | Online (401/403 o testo «api key»): «{servizio} non accetta la chiave ({messaggio grezzo del servizio}). Ricopiala per intero … e tocca «Prova».» Claude 401: «La chiave API non è valida. Controllala in Impostazioni (⋯ in alto) → Assistente AI.» **Claude 403: «Qualcosa è andato storto: {messaggio}»** (nessun ramo). «Scaduta» = stesso testo di «non valida» | `app.js:243,246,251`; `ai-open.js:330,376,404` |
| Quota / 429 | Claude: «Troppe richieste in poco tempo. Riprova tra qualche secondo.» (SDK `maxRetries:1`). Online: i modelli sono provati in sequenza, poi «Nessun modello ha risposto. Provati: … Ultimo errore: {testo inglese del servizio}» + «Riprova tra qualche minuto: i modelli gratuiti a volte sono sovraccarichi.» Quota giornaliera e sovraccarico non si distinguono. 503/529: «Il servizio AI è sovraccarico. Riprova tra poco.» | `app.js:244,247,248`; `ai-open.js:410` |
| Modello locale non scaricato / download fallito | Durante il download: «Preparo il modello sul telefono… N%» + «Solo la prima volta: il modello viene scaricato e salvato sul telefono.» (chat); in Impostazioni «Scarico il modello… N%» / «✓ Modello pronto». Errore di rete: «Non riesco a scaricare il modello: controlla la connessione (meglio il Wi-Fi) e riprova. Dopo il primo download funziona anche offline.» Senza WebGPU: «Questo iPhone non può far girare modelli in locale: …». Memoria: «Il modello è troppo pesante per la memoria del telefono. …». **Nessun timeout né annulla: `busy` resta vero e il pulsante invio disabilitato finché il download non finisce o fallisce** | `app.js:125-141,430-433,239-241,462,2732-2736`; `ai-open.js:238-251` |
| Risposta AI malformata | JSON non valido o troncato: l'utente vede **il testo grezzo del modello** (anche mezzo JSON) come risposta, senza modifiche; vuoto: «Non ho capito, puoi riformulare?». Operazioni scartate da `sanitizeOps` (`dropped`) o oltre le 40: **ignorate senza dirlo**, il testo dell'AI può dire «Fatto.» | `ai-open.js:219-224,295-300`; `store.js:775-800` (`.dropped` mai letto: `ai-open.js:223`, `ai.js`) |
| Timer finito ad app chiusa | Nessuna notifica (iPhone, `NOTIFICHE.md` «non implementata»; i promemoria esistono solo nell'app nativa, `app.js:877`). Alla riapertura `updateFocus` vede `over` e chiama `advanceFocus`: toast «Tempo finito: «{titolo}»» (2,2 s) e pannello «Hai lavorato {X} su «{titolo}». Com'è andata?» con Fatta / Altri 10' / Non ancora. Pomodoro: toast «Giro N finito: 5 minuti di pausa» e la pausa **riparte da adesso**, anche se il lavoro era finito ore prima. Nessuna indicazione di «quanto tempo fa» | `app.js:912-919,942-951,905`; `focus.js:44-52` |
| Carta «Non entra» | Carta: «{titolo}» · «Non entra oggi: {motivo}.» (o «in questa giornata») + bottone «Sposta a domani». Motivi: «non c'è abbastanza tempo realistico», «nessuno spazio libero da N min», «dipende da «X»», «non entra nei prossimi giorni». Barra mini: «N attività non entrano» | `app.js:509-512,403`; `scheduler.js:255-358` |
| Sessioni di un obiettivo oltre la scadenza | Alla creazione: «N sessioni non entrano prima della scadenza: ti propongo come rimediare.» Ma la proposta compare **solo dal giorno dopo** (`lateSince < oggi`): «Le sessioni per X non entrano tutte entro il {data}: ne resta fuori una. Sposto la scadenza o tengo solo l'essenziale?» con «Sposta al {data}» / «Solo l'essenziale». Scadenza passata: «La scadenza per X era il {data}. Lo chiudiamo o scegliamo una nuova data?». Stato `goal-late` del giorno senza testo proprio | `goals.js:56-83`; `companion.js:127-155`; `viewmodel.js:126` |
| Impegni fissi che si sovrappongono | Carta «Si sovrappongono» + «A e B.» **senza azioni**; nessun avviso quando li aggiungi | `app.js:514-516`; `scheduler.js:184` |
| Giorno vuoto / pieno / senza obiettivi | Vuoto: «Giornata libera. Scrivi qui sotto cosa vuoi fare, oppure tocca + per aggiungere un'attività.» (altri giorni «Niente in programma.»); stacco: «Oggi stacchi: niente progetti.». Pieno: nessun testo, solo carte «Non entra» e il contatore. Senza obiettivi/attività: «Raccontami cosa vuoi ottenere e costruisco io le giornate.». Elenco Obiettivi in Impostazioni senza obiettivi: **nessun testo vuoto** | `viewmodel.js:121-133`; `app.js:673`; `app.js:2012-2018` |
| Backup non valido / parziale / schema nuovo | Solo `Array.isArray(d.items)`. File rotto: toast «Backup non valido: {messaggio JSON grezzo}»; senza `items`: «Backup non valido: file non valido». **Nessuna conferma prima di sostituire tutto**; nessun controllo di `schema`: uno schema più nuovo viene accettato e riscritto a `SCHEMA` (perdita silenziosa dei campi nuovi); un file parziale azzera le sezioni mancanti (default di `emptyState`). Successo: toast «Backup ripristinato» (senza «Annulla», ma l'undo c'è). Le foto (IndexedDB) non sono nel backup; se la scrittura dell'archivio fallisce: `.catch(() => {})` | `app.js:2356-2366`; `store.js:166-202` |
| `localStorage` pieno | `save()` ha try/catch: 1° tentativo, poi elimina la cronologia annulla e riprova; se fallisce emette `tempo:save-failed` e ritorna `false`. Banner fisso «Lo spazio per Tempo sul telefono è pieno. Le ultime modifiche non sono salvate: esporta subito un backup.» + «Esporta il backup»; sparisce a salvataggio riuscito. La modifica resta **solo in memoria** (si perde alla chiusura). Il valore di ritorno non è controllato da nessun chiamante; `persistUndo` ha `catch` silenzioso | `store.js:214-229,251`; `index.html:31-34`; `app.js:2910-2946` |
| `localStorage` corrotto | `load()`: `catch { return emptyState(); }` senza avviso, e all'avvio `save(state)` **sovrascrive** il dato illeggibile | `store.js:48-55`; `app.js:2942` |
| Promemoria backup | Osservazione (max 2 al giorno): «Non esporti un backup da più di due settimane. I dati stanno solo su questo telefono.» + «Esporta ora»; dopo 14 giorni, mostrata al più ogni 7. L'export non dà nessuna conferma di riuscita (share/download senza toast; `share().catch(() => {})`) | `companion.js:211,280-288`; `app.js:2918-2933` |
| App aggiornata ma in cache | SW: `skipWaiting` + `clients.claim`, rete prima (`no-cache`), cache solo offline. Al `controllerchange` ricarica **da sola** una volta, **tranne se `busy`** (poi mai più in quella sessione). Nessun avviso né invito a chiudere/riaprire; la ricarica può far perdere il testo non inviato. Se `addAll(SHELL)` fallisce l'installazione fallisce senza messaggio; `register().catch(() => {})` | `sw.js:14,20,25-30`; `app.js:2970-2977` |
| Onboarding | Davvero **6 schermate**: 1 introduzione + 4 domande (obiettivi, vincoli, progetti, preferenze) + riepilogo «Ecco cosa ho capito» (poi «Va bene, costruisci le giornate»). «Salta»/«Dopo» sulla domanda N non passa alla successiva: apre il riepilogo con quanto scritto. Risposte e passo solo in memoria: se chiudi l'app a metà, `onboarded` è ancora falso e riparte da 0 senza risposte. Con AI il piano è chiesto all'AI (25 s) e in caso di errore ripiega sul modello solo con `console.warn`. Riepilogo senza capito: «Niente di concreto, per ora.»; frasi non capite: «Non ho capito: «…». Riscrivila, oppure lasciala: resta tra le note.» | `viewmodel.js:236-243`; `app.js:1868-1980,2794-2796,2951` |
| Annulla | Nulla da annullare: il pulsante è nascosto (`#undo-btn hidden`); se arriva comunque il comando: toast «Niente da annullare». Dopo annullo: toast «Modifica annullata». Grande modifica: la conferma «Applica / Lascia com'è» esiste solo se l'AI/parser la chiede o si cancella un impegno fisso, **non in base alla dimensione**. Dopo ricarica: sul disco restano le ultime 3 (max 300 mila caratteri), in memoria 20; il pulsante di chat «Annulla» di un messaggio vecchio sparisce senza spiegazione. Una conferma in sospeso (`pending`) è solo in memoria: dopo la ricarica il messaggio resta senza pulsanti né «Non applicate» | `app.js:307-315,277,437-440`; `store.js:231-266` |
| Offline | Invio all'AI: se il parser non capisce «Sei offline. La giornata resta consultabile; per parlare con l'assistente serve la connessione.» (solo se `navigator.onLine` è falso; con captive portal: «Qualcosa è andato storto: Load failed»). Se capisce: prefisso generico «L'AI ha avuto un problema…», non «sei offline». Sync: automatica salta in silenzio (`!navigator.onLine && !manual`); manuale: toast «Niente connessione con Tempo Cloud.». Riepilogo, pelle obiettivo, scelta scena: `return` silenzioso. Elenco modelli: `.catch(() => {})`, l'etichetta resta «carico l'elenco…». Foto: sono solo locali, non sincronizzate né nel backup: sugli altri dispositivi la carta resta senza immagine, nessun avviso. **Nessun indicatore di offline** nel giorno (`env.online` passato ma non usato) | `app.js:249,2139,1304,782,767,2297,2152`; `cloud.js:130`; `cloud.js:16-21` |
| Sincronizzazione | Auto: errore solo in Impostazioni («✗ {messaggio}»); 401: «Accesso scaduto: entra di nuovo.» e il token viene tolto, nessun avviso fuori dalle impostazioni. Conflitto 409: unione automatica, riprova una volta; toast «Aggiornato dagli altri dispositivi» solo se manuale. «sincronizzato: {data}» / «mai»; nessun avviso se i dati sono vecchi | `app.js:2139-2156,2186`; `cloud.js:165-174` |

## 3. Per schermata: testo esatto del vuoto / primo avvio / errore (le celle non coperte dalla sezione 2)

| Schermata | Testo esatto | File:line |
|---|---|---|
| Giorno, passato | «Niente in programma.» | `viewmodel.js:132-133` |
| Giorni (elenco) | «Giornata libera» / «Giorno di stacco» | `viewmodel.js:151` |
| Settimana / riepilogo | «Niente in programma questa settimana. Dimmi cosa vuoi ottenere e preparo le sessioni.» · «Nessuna sessione questa settimana.» · mini-barra «Nessuna attività» | `viewmodel.js:306,375`; `app.js:407` |
| Barra, primo uso in base | «Modalità base: capisco frasi semplici. Scegli un'AI gratuita» | `app.js:409` |
| Editor | toast «Serve un titolo» · «Un impegno fisso ha bisogno di un orario» · «Scegli almeno un giorno» · «La fine deve venire dopo l'inizio» · foto «Non riesco a leggere questa foto» / «Non sono riuscito a salvare la foto» | `app.js:1636-1638,1782-1783,1513,1796` |
| Riepilogo del mese, vuoto | «Il mese è appena iniziato: quando segni le sessioni come fatte, qui racconto com'è andato.» · errore AI: solo se aperto, toast `errorText`; altrimenti `console.warn` | `recap.js:110`; `app.js:1445` |
| Riepilogo, domanda in base | «Senza AI so rispondere a: come sto andando, … Per tutto il resto scegli un'AI gratuita in ⋯ → Assistente AI.» · errore: «L'AI non risponde/ha avuto un problema: ecco cosa so.» · «Non ho una risposta.» | `app.js:1480-1483` |
| Impostazioni, AI | «inserisci la chiave» · «carico l'elenco…» · «Controlla che chiave e modello funzionino» · «Provo…» · «✗ {errorText}» · «Funziona: {modello}» | `app.js:2072,2082,2727-2729` |
| Cosa ho imparato | «Ancora niente. Quando segni le attività come fatte imparo quanto durano davvero e quando le fai.» | `app.js:2100` |
| Cloud | «Nessun collegamento.» · «Tutto sincronizzato» · «Account creato» / «Accesso fatto» · errori `e.message` grezzi («errore 500», «Tempo Cloud non risponde.», «Niente connessione con Tempo Cloud.») | `app.js:2183,2148,2208,2238`; `cloud.js:122,130-131` |
| Bentornato (dati vecchi) | Carta «Bentornato» dopo 7+ giorni; attività vecchie: «Un'attività di prima è ancora aperta: «X».» + «Archiviala»; carta «Hai fatto «X»?» · «Era previsto alle HH:MM.» per le sessioni saltate | `companion.js:296-318`; `app.js:505-507,521-525` |
| Memoria | elenco vuoto: nessun testo; limite 200 caratteri applicato senza avviso (`slice(0, 200)`); 40 operazioni AI max | `app.js:2048`; `store.js:645,778` |

## 4. Buchi (nessuna gestione o fallimento silenzioso), in ordine di gravità

| # | Buco | File:line |
|---|---|---|
| 1 | Dato locale corrotto: stato vuoto in silenzio, poi sovrascritto dal primo `save` | `store.js:48-55`; `app.js:2942` |
| 2 | Importazione: sostituisce tutto senza conferma, nessun controllo dello schema (accetta e declassa schemi più nuovi), file parziale azzera le sezioni mancanti, errore con messaggio tecnico grezzo, archivio `.catch(() => {})` | `app.js:2356-2366`; `store.js:166-202` |
| 3 | Modello sul telefono senza timeout né annulla: invio disabilitato a oltranza | `app.js:141,462`; `ai-open.js:238-251` |
| 4 | Operazioni AI scartate (`dropped`) o oltre 40: nessun avviso, il testo dell'AI dice «Fatto.» | `ai-open.js:223`; `store.js:778,795-797` |
| 5 | Sync automatica: errore e perdita del token (401) visibili solo aprendo le Impostazioni; nessun indicatore offline/vecchio | `app.js:2149-2156`; `app.js:2139` |
| 6 | Conferma in sospeso persa dopo la ricarica (messaggio senza pulsanti); «Annulla» di chat sparisce; onboarding interrotto riparte da zero | `app.js:437-440,2951,1870` |
| 7 | Prefisso unico «L'AI ha avuto un problema: ho usato la modalità base.» per chiave mancante, chiave errata, quota, offline | `app.js:227` |
| 8 | Aggiornamento app: ricarica automatica silenziosa (mai se `busy`), nessun avviso/pulsante; installazione SW che fallisce senza messaggio | `app.js:2970-2977`; `sw.js:14` |
| 9 | Foto non incluse in backup e sincronizzazione: segnaposto vuoto sugli altri dispositivi | `cloud.js:13-21`; `app.js:2918-2933`; `images.js` |
| 10 | Timer: voce eliminata durante il timer, il timer sparisce senza avviso; pausa del pomodoro riparte da adesso a app chiusa | `app.js:2403`; `focus.js:44-48` |

**Ogni `catch` che inghiotte un errore rilevante** (tutti verificati; il mio controllo è per `catch {}`, `catch (e) {}` e `.catch(() => …)` vuoti):

| File:line | Cosa nasconde |
|---|---|
| `store.js:53` | stato corrotto → vuoto |
| `store.js:219-220,251` | rimozione/scrittura annulla fallita (l'annulla non sopravvive) |
| `store.js:134` | racconto AI salvato non valido → scartato |
| `app.js:175` | `understoodOf` fallito → riepilogo «cosa ho capito» mancante |
| `app.js:353,1726` | foto non letta dal database |
| `app.js:484` | microfono non parte |
| `app.js:791` | pelle AI non valida → ritenta dopo 7 giorni |
| `app.js:1790,1793,2670` | foto non cancellata |
| `app.js:2297` | elenco modelli non scaricato (etichetta «carico l'elenco…» per sempre) |
| `app.js:2364` | archivio del backup non scritto |
| `app.js:2741,1453,2928` | copia/condivisione fallita (2741 senza messaggio; 1454 invece dice «Non riesco a copiare») |
| `app.js:2890` | archivio non caricato → vecchie voci assenti dal riepilogo |
| `app.js:2968,2977` | richiesta di persistenza / registrazione SW |
| `cloud.js:181` | logout lato server fallito |
| solo `console.warn`: `app.js:1310,1445,1976,2906`; `native.js:14,53` | riepilogo AI, racconto, piano obiettivo AI, archiviazione, ponte nativo |

**Conteggio celle** (matrice sezione 1, 144 celle): vedi riga seguente.

Su 144 celle: **57 n.a.**, **87 applicabili**, di cui **53 con UI dedicata** e **34 senza** (buchi). Forme delle 53: inline 23, carta nel giorno 11, toast 8, chat 6, schermata 3, banner 2.

## 5. Forme diverse per la stessa cosa

**Forme visibili usate per errori, limiti e vuoti: 9** (più 2 silenziose: solo `console` e niente).

| # | Forma | Esempio | File:line |
|---|---|---|---|
| 1 | Toast 2,2 s (con azione opzionale) | «Backup non valido: …» | `app.js:2366,2389` |
| 2 | Carta di risposta in chat, sparisce dopo 9/12 s | «Manca la chiave di Gemini…» | `app.js:434-446` |
| 3 | Prefisso nel testo del messaggio | «L'AI non risponde: ho usato la modalità base.» | `app.js:227` |
| 4 | Stato inline nelle impostazioni (✓/✗) | «✗ …» | `app.js:2729,2736` |
| 5 | Banner fisso con azione | «Lo spazio per Tempo sul telefono è pieno.» | `index.html:31` |
| 6 | Carta nel giorno | «Non entra oggi: …», «Si sovrappongono» | `app.js:509-516` |
| 7 | Testo vuoto nel giorno | «Giornata libera. Scrivi qui sotto…» | `app.js:673` |
| 8 | Osservazione (max 2 al giorno) | «Non esporti un backup da più di due settimane.» | `companion.js:211` |
| 9 | Bolla nel riepilogo/riepilogo del mese | «L'AI ha avuto un problema: ecco cosa so.» | `app.js:1483`; `rc-note` `app.js:1404-1407` |

**Messaggi generici o con testo tecnico grezzo**

| Testo | File:line |
|---|---|
| «Qualcosa è andato storto: {e.message}» (inclusi 403 di Claude e «Load failed») | `app.js:251` |
| «Backup non valido: {e.message}» (es. messaggio di `JSON.parse`) | `app.js:2366` |
| `toast(e.message)` e `cloudError = e.message` («errore 500») | `app.js:2238,2150` |
| «…non accetta la chiave ({e.message})» e «…non riconosce il modello indicato ({e.message})» | `app.js:243,245` |
| «Nessun modello ha risposto. … Ultimo errore: {testo inglese del servizio}» | `ai-open.js:410` |
| «Non trovo «{id interno}»» nei messaggi di `applyOps` mostrati in chat | `store.js:441` ss.; `app.js:131` |
| «Non ho capito, puoi riformulare?» / «Non ho una risposta.» / «Nessuna modifica.» (quest'ultimo solo al modello) | `ai-open.js:298,300`; `app.js:1480,191` |
| «Errore» da solo: assente. Messaggi con «!»: **nessuno** (verificato su `js/*.js` e `index.html`; le uniche occorrenze sono regex in `parse.js:302,726,881`) | — |
