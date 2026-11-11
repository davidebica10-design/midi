# Contratto con l'utente: esito, via d'uscita, prossimo passo

Verifica fatta **sul codice** (branch `claude/tempo-app-ui-optimization-i31896`), non sui documenti. Righe `app.js:N` = `tempo/js/app.js`. Sì = rispettata, P = parziale, No = violata. Un toast dura 2,2 s (solo testo), 5 s (con Annulla), 8 s (due pulsanti) `app.js:2398`. La nota della chat sparisce dopo 9 s (12 s se errore) `app.js:446`. Il pulsante tondo in alto (`#undo-btn`, `app.js:2461`) resta finché c'è qualcosa da annullare, ma non dice cosa annulla.

**Come funziona l'annulla (vale per tutte le righe).** `commit()` (`app.js:68`) salva un'istantanea (`pushUndo`, `store.js:268`): 20 in memoria, **3 su disco** e solo se stanno in 300 KB (`store.js:235`), quindi dopo un riavvio restano al massimo le ultime 3. L'istantanea contiene attività, preferenze, ricorrenti, memoria, ancore, obiettivi, progetti, abitudini, appreso (`store.js:266`): **non** impostazioni, chat, timer, statistiche, foto, archivio. `doUndo` (`app.js:307`) dice sempre e solo «Modifica annullata» (`app.js:314`), mai cosa.

## Tabella (32 azioni)

| # | Azione | 1 Esito | 2 Via d'uscita | 3 Prossimo passo | Verdetto |
|---|---|---|---|---|---|
| 1 | Aggiungo dalla barra, parser base | Sì: «Attività · Dentista · giovedì 15 alle 17:00» + «↦ dove è finita» `app.js:274`. P: gli **altri** spostamenti (`moved`) si scartano quando c'è `understood` | Sì: nota con «Non è questo» (9 s) + pulsante in alto; stack sì | Sì: la riga «↦ …» dice dove cade | P (R1) |
| 2 | Aggiungo/modifico via Claude | Come 1 (`understood`, `app.js:205`); le conseguenze sulle altre carte non si vedono | Come 1 | Come 1 | P (R1) |
| 3 | Aggiungo via modello open/locale | Sì: righe del log «+ Titolo · domani 15:00 · 30 min» + `moved` (`app.js:147,274`). Non usa `understood`: pulsante «Annulla», non «Non è questo» (promessa DESIGN-API:166) | Sì | Sì | P (R1, promessa) |
| 4 | «+» → editor → Salva | **Toast «Aggiunto»** `app.js:1820`: niente titolo, giorno, ora, né dove cade | Sì: toast «Annulla» 5 s, stack sì | No: non dice quando è in programma | **No R1**, P R3 |
| 5 | Aggiungo da foto | Come 4 (passa da `sheetSave`); errore foto: toast «Non sono riuscito a salvare la foto» e salva comunque `app.js:1796` | Come 4; la foto non è nell'istantanea | No | P |
| 6 | Sposto a domani (scheda / carta «Sposta a …») | Toast «Spostata: Titolo» `app.js:1835`. `applyOps` ha già «~ Titolo: domani, ore 9:00» (`store.js:463`) ma `quickOp` lo butta | Sì: toast Annulla 5 s | No: non dice a che ora cade domani | P R1, R3 |
| 7 | Sposto ad altra data (editor) | «Salvato» `app.js:1820`: non dice cosa è cambiato | Sì | No | **No R1** |
| 8 | Sposto/cambio orario via chat | Come 1; con conferma se è un impegno che cambia giorno (`parse.js:870`) | Sì | Sì | Sì |
| 9 | Trascino una carta | Il trascinamento (`motion.js`, `bindCards`) è solo grafico: non cambia lo stato, nessuna azione | n/a | n/a | n/a (nessuna violazione) |
| 10 | Segno «fatto» (spunta, «Fatto», timer «Fatta») | Toast «Fatto: Titolo» `app.js:1835`: niente minuti reali né quanto manca | Sì, **tranne** sessioni di un obiettivo: il toast ha «Va bene / Sposta» **senza Annulla** `app.js:1832`; resta il pulsante in alto, non annunciato | Sì per le sessioni (`sessionDoneNote`: «3 di 10 · Prossima: domani alle 19:15»); altrimenti No | P R1; **No R2 su obiettivi** |
| 11 | Missed: «Sì» / «In parte» (`app.js:2499-2500`) | «In parte»: toast «Segnato in parte: Titolo», senza i minuti messi (metà dei minuti, arrotondati) né «ne mancano N» (che `store.js:504` calcola) | Sì | No | P R1 |
| 12 | Missed: «No» → «Rimandata» (`app.js:2501`) | Toast «Rimandata: Titolo»; non dice quando | **Annulla non ripristina l'ancora**: `delete state.anchors[id]` avviene **prima** di `commit` e quindi prima dell'istantanea | No | **No R1, P R2** |
| 13 | Riapro un'attività | «Riaperta: Titolo» | Sì | P | P |
| 14 | Elimino un'attività | `confirm()` nativo «Eliminare questa attività?» (`app.js:2667`) + toast «Eliminata: Titolo» | Toast Annulla, ma `deleteImage` (`app.js:2670`) cancella la foto **subito**: annullare riporta la carta con foto persa | n/a | P R2 |
| 15 | Elimino impegno fisso (scheda / chat) | Scheda: stesso testo generico di 14. Chat: conferma con elenco (`app.js:146`) | Come 14 | P | P |
| 16 | Salto una ricorrenza / la elimino | «Saltato» `app.js:2673`, «Ricorrenza eliminata» `app.js:2677`: senza nome né data. Eliminare ha `confirm()` | Sì (toast Annulla) | No | P R1 |
| 17 | Applico / rifiuto una proposta AI (`finishChange`) | Mostra al massimo **4 righe** + «e altre N modifiche» `app.js:435`: confermi senza vedere il resto. Rifiuto: «Non applicate.» | Rifiuto sì («Lascia com'è»). Dopo «Applica» sì. **Bozza persa** se scrivi un'altra frase (`app.js:122`, silenzioso) o ricarichi (`pending` solo in memoria: restano `applied:null` e nessun pulsante) | Sì | **P R1/R2** |
| 18 | Ripianifico (automatico ogni 30 s; «alleggerisci», «rimanda a domani») | Auto: il piano cambia senza avviso (`app.js:2858-2862`), conta solo nella statistica. Comandi in chat: conferma + elenco | Auto: non è una modifica dello stato, quindi niente annulla | No | **No R1 (auto)**, Sì (chat) |
| 19 | Importo un backup | Toast «Backup ripristinato» `app.js:2365`: niente numeri (quante attività, quando era) | **Nessuna conferma** prima di sostituire tutto; toast senza Annulla; l'archivio IndexedDB **non** si annulla | No: non dice cosa è stato sostituito | **No R1/R2/R3** |
| 20 | Esporto un backup | Nessun toast, solo il foglio di condivisione. `lastExportAt` e `exportedEdits` si scrivono **prima** della condivisione, anche se annulli (`app.js:2923`) | n/a | No | **No R1** (e falso «fatto») |
| 21 | Cambio fornitore AI / salvo la chiave | «Chiave salvata» / «Chiave rimossa» `app.js:2316`; cambio fornitore: nessun messaggio. Non verifica la chiave | Le impostazioni non sono nell'annulla. Togliere la chiave porta in modalità base senza dirlo | P: «Prova» esiste solo per i servizi online | No R1, P R3 |
| 22 | Timer: lavoro → pausa → fine | Toast «Giro 1 finito: 5 minuti di pausa», «Tempo finito: «Titolo»» `app.js:946-948`; pannello «Hai lavorato 25 min su …» `app.js:907`. Nessun suono né vibrazione; la pausa parte **dalla riapertura**, non dalla fine reale (`focus.js:46`) | Il passaggio di fase non è annullabile | Sì: «Fatta / Un altro giro / Non ancora» | P R1 |
| 23 | Timer: «Termina», «Annulla», «Non ancora» | «Termina» e «Annulla»: nessun messaggio. «Non ancora» senza minuti: salva e basta `app.js:980` | **«Annulla»** (setup) e «Non ancora» a 0 min lasciano l'attività «in corso» senza timer (`store.js:469`). Annullare «Fatta» riporta «in corso» senza timer (il timer non è nell'istantanea) | P: «Fatta/Non ancora» dopo Termina | **No R2** |
| 24 | Presentazione completata | Sì: «Ecco cosa ho capito» + 7 giorni, poi nota con «◎ …» e Annulla (`app.js:1957`). Solo ◎ e ⟳ (le altre righe si scartano); senza obiettivi dice «Fatto: ho il tuo contesto…» generico | Sì (nota + stack) | Sì (invito a dire il prossimo passo) | Sì (R1 P) |
| 25 | Presentazione saltata («Salta» / Esc) | Nessun messaggio; `onboarded = true` e basta `app.js:1904` | Rifacibile da Impostazioni | No: schermata vuota senza guida | **No R1/R3** |
| 26 | Spunto/tolgo una voce di lista | Si vede la spunta; nessun toast (`app.js:2481`, `2653`) | Solo con il pulsante in alto, non annunciato | n/a | P R2 |
| 27 | Aggiungo un obiettivo (Impostazioni) | Toast «Aggiunto» `app.js:2384`: niente sessioni, date | Pulsante in alto, non annunciato | No | **No R1** |
| 28 | Rimuovo un obiettivo | Toast «Obiettivo rimosso» `app.js:2703`; chiede se togliere le sessioni, ma non dice quante e quante abitudini spariscono | Sì (Annulla) | P | P |
| 29 | Accesso / crea account | «Accesso fatto» sostituito subito da «Tutto sincronizzato» (`app.js:2208-2209`) | Esci disponibile | No: non dice cosa è stato unito | P |
| 30 | Esco | «Sei uscito: i dati restano qui» `app.js:2223` | Si rientra | Sì | **Sì** |
| 31 | Sincronizzazione: unione | Auto: nessun messaggio. Manuale: «Aggiornato dagli altri dispositivi», senza cosa né quante | **Nessuna istantanea**: `Object.assign(state, …)` `app.js:2143`, non annullabile | No | **No R1/R2** |
| 32 | «Cancella tutto» / «Dimentica richieste» | Cancella: `confirm()` + «Tutto cancellato» (Annulla). Dimentica: «Fatto» generico | Cancella sì (la chat e le foto no) | No | P |

**Conteggio** (P = violazione): R1 violata in 21/32, R2 in 10/32, R3 in 14/32 (stima per riga; 9 e 13 non contano).

## Le sei violazioni peggiori

1. **Conferma con bozza vecchia** (17): `applyPending` fa `Object.assign(state, pick(draft))` (`app.js:293`) su una copia fatta al momento della proposta. Se nel frattempo spunti un'attività o arriva una sincronizzazione, **tutto viene sovrascritto senza dirlo**. Fix: ricalcolare le `ops` sullo stato attuale, oppure bloccare le carte finché la conferma è aperta.
2. **Importa backup** (19): sostituisce tutto senza `confirm()`, toast senza numeri né Annulla. Fix: `confirm('Sostituire le N attività con le M del backup?')` + `toastUndo('Ripristinate M attività')`.
3. **Sincronizzazione senza annulla** (31): sovrascrive lo stato locale senza istantanea né resoconto. Fix: `pushUndo` prima di `Object.assign` (`app.js:2143`) e toast «Dagli altri dispositivi: N nuove, M cambiate».
4. **Esporta segna «fatto» prima di fare** (20): l'avviso di backup sparisce anche se annulli il foglio. Fix: scrivere `lastExportAt` solo dopo che `share()` si risolve.
5. **Timer «Annulla»/«Non ancora»/Fatta annullata** (23): l'attività resta «in corso» (blocca il piano `scheduler.js:161`) senza timer. Fix: «Annulla» deve fare `reopen`; mettere `focus` nell'istantanea.
6. **Toast generici che buttano il log già pronto** (4, 6, 7, 10, 11, 12, 27): `applyOps` produce «~ Titolo: domani, ore 9:00», «◐ fatti 20 min, ne mancano 25» (`store.js:463,504`) e `quickOp` mostra solo «Fatto: Titolo» (`app.js:1835`). Fix: `const r = applyOps(...)`; `toastUndo(r.log[0])`.

Altre: l'annulla da una nota vecchia cancella anche le modifiche successive (`popUndo` fa `undo.slice(0, idx)`, `store.js:286`, e `doUndo` non lo dice); Annulla di «Rimandata» (12) non ripristina l'ancora; sessione di obiettivo completata senza Annulla nel toast (10).

## Design theater

| Promessa | Cosa fa il codice | Gravità |
|---|---|---|
| «Ogni modifica si annulla» (CLAUDE.md:17); «tutte si possono annullare» (README:76) | Non si annullano: sincronizzazione (`app.js:2143`), importazione dell'archivio, impostazioni/chiavi (`app.js:2316`), fine fase del timer, ripianificazione automatica (`app.js:2858`), foto cancellate (`app.js:2670`). Dopo il riavvio restano **3** annulla (`store.js:235`) | **Alta** |
| «quelle grandi chiedono conferma» (CLAUDE.md:17) e «L'AI propone, il codice decide» | La conferma sulla via AI la decide il **modello** (`requires_confirmation`, `ai.js:80`); il codice la forza solo per eliminare impegni fissi (`app.js:146,176`) e, solo sulla via Claude, per `remove_recurring`; la via open non forza `remove_recurring` (`app.js:146`). Importa backup, rimuovi obiettivo con abitudini, sincronizza: nessuna conferma | **Alta** |
| «Ogni risposta che cambia qualcosa elenca cosa è stato capito… Il tasto «Non è questo» annulla» (DESIGN-API:166) | Vale per base e Claude (`said`); la via open mostra il log e «Annulla» (`app.js:147,440`). Con `said`, gli spostamenti sulle altre carte non compaiono (`app.js:274`). Gli «Spostamenti» sono visibili solo senza `understood` | Media |
| «Gli orari non li sposto mai senza chiedertelo» (`app.js:2102`) | Ogni 30 s le attività flessibili si riposizionano da sole (`app.js:2858`) e il companion dice «L'ho rimessa domani» a cose fatte (`companion.js:~192`). Chiede solo per quelle il cui orario è già passato (`scheduler.js:442`) | Media |
| «continua anche ad app chiusa… alla riapertura il timer è già avanzato alla fase giusta» (DESIGN-API:209) | Avanza **una** fase alla volta e la nuova parte da «adesso» (`focus.js:46`): 20 minuti dopo la fine del lavoro compare «Giro 1 finito: 5 minuti di pausa». NOTIFICHE:14 dice che non ci sono notifiche: coerente | Media |
| «massimo 2 osservazioni al giorno, ognuna con il suo perché» (CLAUDE.md:15) | Il tetto c'è (`pickObservations`, `companion.js:227`, max 2). Il «perché»: non per tutte. «Prossima sessione» `goal-…` è solo un dato (`companion.js:~208`), «Le sessioni sono finite» non spiega. Il «Bentornato» e il racconto del mese sono fuori dal tetto | Bassa |
| «Niente dati persi» (CLAUDE.md:17) | Bozza AI sovrascrive lavoro intermedio (17); foto cancellate subito; `popUndo` troncato; annulla di 20 in memoria ma 3 dopo il riavvio | **Alta** |

**Promesse mantenute (controllate nel codice):** funziona senza AI e offline (ripiego `baseTurn` con nota `app.js:227`; `SHELL` in `sw.js:3-11` ha i 22 moduli); niente punteggi né serie (nessun contatore di giorni consecutivi: solo statistiche «% completate»); testi in italiano senza punti esclamativi (campionati); `esc()` su testo AI e backup (`renderReply`, `app.js:433-437`); il tetto 2 osservazioni (codice); l'impegno fisso cancellato da AI chiede conferma (`app.js:146`); la bozza rifiutata è dichiarata «Non applicate.» (`app.js:438`); l'esito del timer finale dice quanto hai lavorato (`app.js:907`); esci dall'account dice cosa resta (`app.js:2223`); le sessioni degli obiettivi dicono quante e la prossima (`companion.js:343`).

## Cosa non ho verificato
Non ho eseguito l'app né i test: tutto da lettura del codice. Non ho aperto `native/` (Siri/widget) né `cloud/` lato server.
