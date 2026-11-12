# Tempo — controllo di qualità

Ramo `claude/tempo-app-ui-optimization-i31896`, stessa PR dell'audit e del refresh UI. Niente unito a `main`.

Marche: **[codice]** verificato nel codice · **[schermo]** visto in un browser automatizzato (Chromium, 390×844, chiaro e scuro) · **[documenti]** dedotto dai documenti · **[opinione]** giudizio di chi scrive.
I documenti del project non erano leggibili in questa sessione: nessuna affermazione è marcata [documenti]. Niente è stato provato su un iPhone vero.

Dettagli: `STATI.md` (mappa), `CONTRATTO.md` (azioni), `ORA-DI-USO.md` (116 schermate), `GUASTI.md` (prova guasti).

**Sulla tesi di partenza [opinione].** I tre posti indicati (lavoro invisibile, coerenza, momenti peggiori) erano davvero i punti deboli di Tempo: lì stavano tre perdite di dati. Questo lavoro però dimostra solo che l'app ora si comporta meglio quando qualcosa va storto. **Non dimostra che qualcuno pagherà di più**, né che pagherà. Quella domanda si chiude con persone, non con rifiniture.

## Le 5 incoerenze più gravi

| # | Cosa | Stato |
|---|---|---|
| 1 | **Nove forme diverse per dire che qualcosa è andato storto** (toast, bolla, riga rossa, banner, carta, `confirm()` del browser, silenzio…), più testo tecnico in faccia all'utente: senza rete si leggeva «Failed to fetch… modelli gratuiti sovraccarichi». [codice + schermo] | corretto: un solo avviso |
| 2 | **Il pulsante principale cambiava forma**: pillola nella presentazione, rettangolo nei fogli; quattro raggi diversi per i pulsanti in linea. [schermo] | corretto |
| 3 | **«Fatto», «Spostata», «Salvato»**: esiti senza cosa né quando, mentre il codice aveva già la riga concreta e non la mostrava. [codice] | corretto |
| 4 | **Le Impostazioni sono un altro prodotto**: un solo foglio lunghissimo, campi con il bordo grezzo del browser, gergo («Motore», «NVIDIA NIM», «WebGPU», «MCP»), un modulo di accesso a un servizio che non è pubblicato. [schermo] | in parte: campi e contrasti sì, struttura e parole no |
| 5 | **Chiudere e confermare stanno in un posto diverso su ogni superficie**; tre caratteri con le grazie per i titoli. [schermo] | non corretto (le carte tengono il loro carattere per scelta tua) |

## Il contratto delle azioni

Su 32 azioni tracciate nel codice, prima delle correzioni: 21 senza esito concreto, 10 senza via d'uscita chiara, 14 senza prossimo passo. [codice]

**«Design theater» trovato [codice]:**

| Promessa | Realtà | Stato |
|---|---|---|
| «Ogni modifica si annulla» | non valeva per importazione, unione della sincronizzazione, impostazioni, foto; dopo un riavvio restano 3 annulla | importazione corretta; il resto no |
| «Quelle grandi chiedono conferma» | la conferma la decide in parte il modello; l'importazione non la chiedeva | importazione corretta; il resto è in `store.js`/`ai.js` |
| «Gli orari non li sposto mai senza chiederlo» | le attività flessibili si riposizionano da sole a ogni scatto dell'orologio; le Impostazioni mostrano «21.0 ripianificazioni automatiche al giorno» | non corretto: è una scelta di prodotto |

## I guasti peggiori

| Guasto | Prima | Dopo |
|---|---|---|
| Dati salvati illeggibili all'avvio | app vuota come al primo avvio, poi sovrascritti: **perdita di dati** [schermo] | copia messa da parte prima di ogni salvataggio, avviso, scaricabile dalle Impostazioni |
| Importare un backup | sostituiva tutto senza chiedere; accettava una versione più nuova; diceva «ripristinato» anche se il salvataggio falliva: **perdita di dati** [schermo] | controllo, rifiuto motivato, conferma con i numeri, salvataggio verificato, «Annulla» |
| Versione nuova mentre scrivi | ricarica da sola, il testo spariva [codice] | avviso con «Aggiorna ora», il testo resta |
| Proposta dell'AI applicata in ritardo | sovrascriveva in silenzio ciò che avevi fatto nel frattempo [codice] | non si applica: «La proposta non vale più», con «Rifai» |
| Spazio pieno | avviso, ma le modifiche sparivano al riavvio senza dirlo [schermo] | avviso fisso che lo dice, con «Esporta un backup ora» |
| Risposta dell'AI troncata | mostrata grezza nella chat, frase dell'utente persa [schermo] | avviso, niente cambia, la frase resta nella barra |

Gli errori dell'AI (401, 403, 429, 500, id e orari assurdi) non hanno mai portato dati non validi nello stato, con un'eccezione ancora aperta qui sotto. [schermo]

## Cosa è stato corretto (le 10)

1. Dati illeggibili: copia, avviso, riga in Impostazioni (fino a due copie).
2. Importazione: validazione, conferma con numeri, salvataggio verificato, annulla.
3. Un solo componente di avviso, `notice()`: cosa è successo → perché → cosa puoi fare ora, con un'azione.
4. Guasti dell'AI distinti per causa (rete, tempo scaduto, chiave, limite, servizio, risposta rotta): niente cambia e la frase resta.
5. Aggiornamento dell'app e spazio pieno: mai più silenziosi.
6. Esiti concreti («Fare la spesa: spostata a domani, 08:00.») con «Annulla» legato alla propria modifica.
7. Proposta scaduta, modifiche non applicate dichiarate con il numero, mai «Fatto.» se non è cambiato nulla.
8. Timer finito ad app chiusa: l'ora vera («finito alle 07:40»), non un conto alla rovescia finto.
9. Coerenza: pulsanti, campi, contrasto nel tema scuro (da 1,9:1 a oltre 5,9:1), avvisi che non coprono i fogli, titoli lunghi.
10. Controllo automatico dei testi in `npm test`: niente «!», niente messaggi generici, nessun avviso senza prossimo passo.

**Prove [codice + schermo]:** `npm test` 241 su 241 in tre fusi orari (erano 228); `tests/ui/stati.mjs` 82 controlli; `tests/ui/guasti.mjs` 87 controlli su nove guasti. Revisione del codice: 0 bloccanti, 8 punti corretti. Schema dei dati, CSP e i cinque moduli vietati non toccati. Cache `tempo-v46`.

## Cosa non è stato corretto, e perché

| Cosa | Perché |
|---|---|
| Una data come `9999-99-99` proposta dall'AI viene accettata; un impegno può uscire dal giorno | la validazione è in `store.js`, fuori perimetro. **È il primo da correggere.** [schermo] |
| Annullare una modifica scarta anche quelle venute dopo; dopo un riavvio restano 3 annulla | `store.js`. Il pulsante ora sparisce invece di annullare la cosa sbagliata |
| «obiettivo: …» crea un obiettivo chiamato «Obiettivo»; lettere a caso o una domanda diventano un'attività | `parse.js`, fuori perimetro [schermo] |
| Ripianificazione automatica e conferma decisa dal modello | scelte di prodotto, vedi sopra |
| Struttura e gergo delle Impostazioni; posizione di «chiudi» | oltre il tetto delle 10; serve una decisione su cosa mostrare a chi |
| I caratteri arrivano da Google Fonts: al primo avvio senza rete i titoli cambiano faccia | servirebbe ospitare i file nel repository |
| Due schede aperte (vince l'ultima); modello sul telefono senza tempo massimo né annulla; errori di sincronizzazione visibili solo nelle Impostazioni; presentazione interrotta che riparte da zero; foto fuori dal backup | meno frequenti, o legati a servizi non pubblicati |

## Da chiedere a 5 utenti veri

Ipotesi che solo le persone possono confermare o smentire. Dieci minuti a testa, sul loro telefono, senza spiegare nulla prima.

| Ipotesi mia | Compito (10 minuti) | La smentisce |
|---|---|---|
| L'avviso in tre parti si capisce e si legge | Con la rete spenta: «chiedi a Tempo di riorganizzarti il pomeriggio». Poi: «cosa è successo, e cosa faresti?» | non sa dire cosa fare, o non l'ha letto |
| «Annulla» dà fiducia a provare | «Sposta due cose e cancellane una. Ora rimetti tutto com'era.» | cerca un annulla che non trova, o ha paura di toccare |
| «Altre N» non nasconde ciò che serve | Giornata piena: «a che ora sei libero stasera?» | non trova la risposta senza aiuto |
| La conferma con i numeri evita ripristini sbagliati | «Hai cambiato telefono: recupera i tuoi dati da questo file.» (uno dei due è quello sbagliato) | conferma senza leggere i numeri |
| Dopo un timer finito ad app chiusa sa cosa fare | Avvia un timer di 2 minuti, chiudi l'app, riapri dopo 5 | non capisce se l'attività è fatta |
| La qualità percepita cambia la disponibilità a pagare | Alla fine: «quanto varrebbe per te al mese, e perché?» e «cosa ti ha dato fastidio?» | nessuno nomina affidabilità o cura tra i motivi: allora la rifinitura non è ciò che vende |

L'ultima riga è quella che conta: se cinque persone su cinque parlano d'altro, il prossimo lavoro non è altra qualità.
