# Guasti provocati su Tempo

Prova nel browser (Chromium, 390×844, orologio fisso, chiave finta, ogni richiesta AI intercettata). Nessun dato reale.
Gli script e gli screenshot non sono nel repository. `file:riga` si riferisce a `tempo/` al momento della prova.

## 1. Classifica (prima la perdita di dati)

| # | Guasto | Cosa vede l'utente | Dati persi? | Codice |
|---|---|---|---|---|
| 1 | `tempo.v1` illeggibile all'avvio (JSON troncato, `null`, array, testo) | niente: parte come primo avvio («Oggi è libero») | **Sì**: all'avvio `save()` sovrascrive il file rotto, nessuna copia | store.js:48-55, app.js:2941-2942 |
| 2 | Arriva una versione nuova mentre l'app è aperta | niente: la pagina si ricarica da sola | **Sì**: il testo scritto e non inviato sparisce | app.js:2974-2977, sw.js:19-24 |
| 3 | Import di un backup | «Backup ripristinato» | **Sì**: sostituisce tutto senza conferma; voci con id non valido scartate senza dirlo | app.js:2355-2366 |
| 3b | Import di un file da 6 MB | «Backup ripristinato» (falso) + avviso spazio | In memoria 20000 voci; dopo il riavvio tornano le 2 di prima | app.js:2365, store.js:214-231 |
| 4 | Spazio pieno e nuova attività | avviso fisso «Lo spazio… è pieno… esporta» | Modifiche solo in memoria; **dopo il riavvio spariscono** | store.js:214-231, index.html:31 |
| 5 | Due schede aperte | niente | **Sì**: vince l'ultima scrittura (una attività aggiunta nell'altra scheda sparisce) | store.js:216; nessun listener `storage` |
| 6 | AI propone una data inesistente (`9999-99-99`) o un impegno 23:50 per 5 ore | l'attività compare («giovedì 7 giu»); l'evento esce dal giorno | No, ma stato non valido | store.js:354, 407-416 |
| 7 | Rete assente o richiesta interrotta | «Nessun modello ha risposto. Provati: m1. Ultimo errore: Failed to fetch Riprova tra qualche minuto: i modelli gratuiti a volte sono sovraccarichi.» | No | app.js:244 (prima del controllo offline a :249), ai-open.js:410 |
| 8 | Timer pomodoro riaperto dopo 3 ore | «Pausa · respira 4:59» e toast «Giro 1 finito» come se fosse appena successo | No | app.js:942-947, focus.js:42-47 |
| 9 | Titolo lungo 300 caratteri senza spazi | la carta «Adesso» taglia il testo a destra | No | style.css:418 (`.adv-t` senza `overflow-wrap`) |

## 2. Esiti per guasto

**1. Rete.** `route.abort()`, offline prima dell'invio, offline durante: stesso testo del punto 7. Dati identici prima, dopo e dopo il riavvio.
La frase resta nella chat ma la barra si svuota: per riprovare va riscritta (app.js:104-121). Con una frase che il parser capisce
(«aggiungi telefonare a Marta alle 15») offline funziona, ma la nota dice «L'AI ha avuto un problema» invece di «sei offline» (app.js:227).
Avvio offline: l'app parte dalla cache con le 3 carte, nessuna nota di stato (corretto, ma muto).

**2. L'AI non risponde.** Timeout reale: 25 s con provider online (app.js:141), 50 s con Claude (app.js:203), nessuno in locale.
Per 25 s resta «Sto sistemando la giornata…», senza tasto per fermare. Poi: «L'AI non risponde e senza AI non ho capito la frase. Riprova tra poco, o scrivila più semplice.»
(app.js:237) per una frase aperta; se il parser la capisce, la applica con il prefisso «L'AI non risponde: ho usato la modalità base.» La scheda di errore sparisce dopo 12 s (app.js:446).
Dati intatti.

**3. Errori AI** (nessuno cambia lo stato, verificato):
- 401 e 403: «<servizio> non accetta la chiave (<testo del server>). Ricopiala…» (app.js:239). Il 403 viene trattato come chiave sbagliata.
- 429, 500, 503, 502 con HTML: tutti «Nessun modello ha risposto… Riprova tra qualche minuto: i modelli gratuiti a volte sono sovraccarichi.» Il 429 non è distinto, e con un servizio non gratuito la frase è sbagliata.
- JSON troncato o prosa: la scheda mostra il testo grezzo del modello (anche mezzo JSON), ai-open.js:295-298.
- Schema sbagliato: «Non ho capito, puoi riformulare?». `ops` non array: mostra solo la risposta, nessuna modifica.
- Id inesistenti: «Fatto (Non trovo «nonesiste»; …)»: il «Fatto» è falso, nessuna modifica. Azioni sconosciute scartate.
- Orari assurdi: `25:00`/`99:99` rifiutati («manca l'orario»); durate fermate a 5–960 min; titolo tagliato a 80; testo con tag reso come testo.
  **Passano**: data con forma giusta ma impossibile (store.js:354 controlla solo `\d{4}-\d{2}-\d{2}`) e impegno che supera la mezzanotte (23:50 + 300 min = 1730).

**4. Backup e dati all'avvio.**
- Non JSON, vuoto, `null`, `[]`, `{}`, `items` non array, troncato: tutti respinti con toast «Backup non valido: <messaggio del motore>»
  (es. «Cannot read properties of null (reading 'items')», «Unterminated string in JSON…»: inglese tecnico). Dati intatti.
- `schema` 99: accettato come se niente fosse, riscritto a 5 (un backup di una versione più nuova perde il suo `schema` e passa per vecchio).
- Stringhe da 2 MB: tagliate a 80/500 caratteri senza dirlo. Tag HTML nei titoli: resi come testo, nessuno script eseguito.
  Chiavi riservate (`__proto__`, `constructor`): nessun effetto osservato su `Object.prototype`.
- Voci `null`, id con caratteri vietati, id doppi: scartate o rinumerate, toast «Backup ripristinato» senza il conteggio.
- Avvio con `tempo.v1` rotto: nessun toast, nessuna copia (nel `localStorage` resta solo `tempo.v1`). Schema 1: migrato bene. Schema 99: riscritto a 5.

**5. Spazio pieno.** `save()` libera l'annulla e riprova, poi emette `tempo:save-failed` (store.js:219-225). L'avviso è chiaro e l'export funziona, ma non dice
quante modifiche sono a rischio. La modifica resta in memoria e il toast/scheda di conferma si comporta come se fosse salvata.

**6. Orologio e fuso.** Date e orari sono «da muro» (`YYYY-MM-DD`, minuti dalla mezzanotte): ruotando Roma → Tokyo → Los Angeles con lo stesso istante, nessuna attività cambia giorno,
si duplica o sparisce nei dati. Cambia solo cosa è «passato»: a Tokyo (18:20) le attività delle 12:15 e 14:15 diventano «Hai fatto…?». Volo a mezzanotte: la mattina dopo
«rimasta indietro. L'ho rimessa oggi», ma nei dati la data resta quella di ieri (lo spostamento è calcolato, non salvato). Orologio indietro di un giorno: un'attività «in corso» avviata
«domani» è mostrata con 40 min rimasti, senza avviso.

**7. Cache e aggiornamento.** `sw.js` fa `skipWaiting` + `clients.claim`, rete prima. All'avvio `register().update()` (app.js:2977), mai più dopo: un'app aperta per giorni non controlla.
Simulato su una copia (VERSION cambiata a caldo): al `controllerchange` la pagina si ricarica (app.js:2974-2976), se non è `busy`, senza messaggio; il testo nella barra è perso.

**8. Focus.** Timer semplice avviato 20 min fa: 40 min rimasti, corretto. Timer finito 3 ore fa: «✓ fatto», «Hai lavorato 25 min… Com'è andata?» e toast «Tempo finito»
(non dice quando). Pomodoro finito 3 ore fa: parte una pausa nuova da 4:59 (`startedAt` = adesso). Pausa finita da 2 ore: «Pronto per il giro 2».

**9. Due schede.** Scheda A aggiunge «Anna» e «pane», B aggiunge «Bruno»: sul disco restano le voci di A, B continua a vedere la sua copia. Nessun avviso in nessuna delle due.

**10. Casi limite.** Emoji ed ebraico/arabo: resa corretta, nessun overflow. 300 caratteri: ok nelle carte (`.pc-title` ha `overflow-wrap`), tagliato nel titolo «Adesso». 200 attività in un giorno
(86 KB di dati): caricamento 312 ms, `replan` 1 ms, `renderAll` 3 ms, una frase 23 ms; mostra 3 carte e «Altre 197 · dalle 12:20».

## 3. Le forme di errore, limite e stato vuoto oggi

| Forma | Selettore | Esempio |
|---|---|---|
| Toast | `#toast.toast` (app.js:2389) | «Backup non valido: file non valido» |
| Scheda risposta d'errore | `#reply .reply-card.error` (app.js:443) | «Nessun modello ha risposto…» (sparisce in 12 s) |
| Bolla nel riepilogo | `.sm-ai.err` (app.js:1289) | «L'AI non risponde e senza AI…» |
| Avviso fisso | `#save-alert.save-alert[role=alert]` | «Lo spazio per Tempo sul telefono è pieno.» |
| Riga di impostazioni | `.lbl[role=alert]`, `#dec-status`, `#local-status` | «✗ Accesso scaduto: entra di nuovo.» |
| Carta nota | `.pc.note-card` (app.js:505-515) | «Si sovrappongono: A e B.» |
| Riga del riepilogo | `.ms-lines .warn` (app.js:403) | «3 attività non entrano» |
| Suggerimento | `.ms-hint`, `.note`, `.r-note` | «Modalità base: capisco frasi semplici.» |
| Stato vuoto | `.empty-hint`, carta «Oggi è libero.» | «Niente in programma questa settimana…» |
| Finestra nativa | `confirm()` (app.js:2667) | «Eliminare questa attività?» (solo conferme) |
| Niente | — | dati rotti all'avvio, voci scartate, fuso cambiato, due schede |

Nove forme visibili più il silenzio. Nessuna ha la stessa struttura; solo l'avviso fisso e il toast hanno un'azione.

## 4. Proposta: un solo componente `notice`

Forma fissa: **cosa è successo → perché → cosa puoi fare ora**, un dato concreto dove esiste, al massimo un bottone. Riusa `.reply-card.error`, `.r-x`, `.r-actions`, `.btn`.

```html
<div class="reply-card error notice" role="alert" data-notice="spazio">
  <button type="button" class="r-x" data-act="dismiss" aria-label="Chiudi">×</button>
  <p class="n-what">Le ultime 3 modifiche non sono salvate.</p>
  <p class="n-why">Lo spazio di Tempo sul telefono è pieno.</p>
  <p class="n-next">Esporta un backup adesso: se chiudi l'app, si perdono.</p>
  <div class="r-actions"><button type="button" class="btn primary" data-act="notice-go">Esporta il backup</button></div>
</div>
```

```js
/** Mostra un avviso. Tutto passa da esc(). `sticky`: resta finché non è risolto o chiuso. */
function notice({ what, why, next, action = null /* { label, fn } */, sticky = false, host = 'reply' /* 'reply' | 'top' */ })
```

Regole: `what` e `next` obbligatori, `why` solo se aggiunge informazione; con un'azione o `sticky` niente chiusura automatica (oggi 12 s, app.js:446); i codici d'errore diventano una tabella
`{ code → { what, why, next } }` al posto di `errorText()`; mai testo del motore o del server nel `what`. CSS minimo: `.n-what{font-weight:700}`, `.n-why{color:var(--ink-2)}`, margini a 4 px.
Il `toast` resta per le conferme riuscite («Salvato»).

| Guasto | Cosa è successo | Perché | Cosa puoi fare ora | Azione |
|---|---|---|---|---|
| Rete assente | Non ho raggiunto l'assistente. | Non c'è connessione. | Il giorno è com'era. Riprova quando sei online. | Riprova |
| Nessuna risposta | L'assistente non ha risposto in 25 secondi. | Il servizio è lento o la rete è debole. | Non ho cambiato niente. Riprova o scrivi la frase più semplice. | Riprova |
| 401 / 403 | Il servizio non accetta la chiave. | Ha risposto 401: è sbagliata o scaduta. | Ricopiala in Impostazioni e tocca «Prova». | Apri le impostazioni |
| 429 | Il servizio ti ha fermato per un po'. | Troppe richieste in poco tempo. | Aspetta un minuto. Intanto capisco le frasi semplici. | Riprova |
| 500 / 503 | Il servizio non funziona ora. | Ha risposto con un suo problema (500). | Non ho cambiato niente. Riprova tra qualche minuto. | Riprova |
| Risposta non valida | Non ho capito la risposta dell'assistente. | Non era in un formato che posso applicare. | Non ho cambiato niente. Riprova o riformula. | Riprova |
| Modifiche scartate | Ho applicato 2 modifiche su 5. | Le altre citavano attività che non trovo. | Controlla il giorno. Puoi annullare tutto. | Annulla |
| Data o orario impossibili | Ho scartato una modifica. | La data 9999-99-99 non esiste. | Dimmi il giorno giusto. | — |
| Backup illeggibile | Non ho ripristinato il backup. | Il file non è un backup di Tempo. | Le tue 12 attività sono com'erano. Scegli un altro file. | Scegli un file |
| Backup più nuovo | Questo backup è di una versione più nuova. | Ha il formato 7, qui arriva il 5. | Aggiorna l'app e riprova. Non ho toccato niente. | — |
| Backup con voci rotte | Ho ripristinato 118 attività su 120. | 2 voci erano danneggiate. | Controlla la giornata. | Annulla |
| Backup troppo grande | Il backup non è stato salvato. | Occupa 6 MB e lo spazio non basta. | Le tue 12 attività sono salve. Togli il vecchio archivio e riprova. | — |
| Dati danneggiati all'avvio | Non riesco a leggere i dati salvati. | Il file sul telefono è danneggiato (4 KB). | L'ho messo da parte. Puoi esportarlo o ripartire da zero. | Esporta il file |
| Spazio pieno | Le ultime 3 modifiche non sono salvate. | Lo spazio di Tempo sul telefono è pieno. | Esporta un backup adesso: se chiudi l'app si perdono. | Esporta il backup |
| Fuso cambiato | Il fuso ora è Tokyo (UTC+9). | Gli orari restano quelli scritti: le 11:00 sono le 11:00 dove sei. | Se erano orari di Roma, spostali. | Vedi gli orari |
| Orologio indietro | Il telefono dice 10 novembre. | Hai un'attività iniziata l'11 novembre. | Controlla data e ora in Impostazioni di iOS. | — |
| Nuova versione | Tempo è stato aggiornato alla 40. | Ho ricaricato la pagina per usarla. | La frase che scrivevi è di nuovo nella barra. | — |
| Timer scaduto da fuori | Il timer di «Scrivere la relazione» è finito alle 10:05. | Eri fuori dall'app da 3 ore. | Dimmi se l'hai fatta o se serve altro tempo. | Fatta |
| Due schede | Hai aperto Tempo in un'altra scheda. | Là hai aggiunto 2 attività che qui non vedi. | Ricarica prima di modificare: così non le cancelli. | Ricarica |
| Titolo troppo lungo | Ho accorciato il titolo a 80 caratteri. | Ne avevi scritti 300. | Il testo intero è nelle note. | — |
| 200 attività oggi | Oggi non entrano tutte le attività. | Servirebbero 100 ore. | Ne ho spostate 197 a domani dalle 08:00. Scegli quali tenere. | Vedi le 197 |

Costo stimato: un componente, una tabella di testi, nessuna dipendenza; richiede inoltre (fuori dal componente) una copia di `tempo.v1` rotto, il rifiuto di `schema` più nuovo,
il controllo reale delle date e il salvataggio della bozza prima del ricaricamento.

## 5. Non simulato

Eviction dello storage di iOS dopo giorni senza aprire l'app; sync cloud (`cloud.js`) e modelli locali WebGPU; errori HTTP del provider Claude (provato solo il timeout);
il service worker reale su GitHub Pages (provato su copia locale); microfono e foto.
