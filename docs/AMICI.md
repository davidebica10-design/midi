# Tempo con gli amici — progettazione tecnica

Solo progettazione: nessun codice di questa pagina è in produzione. La parte commerciale (prezzi, concorrenti, tabella di marcia, esperimenti con nomi e numeri) non sta in questo repository pubblico: è consegnata a parte.

Legenda: **[codice]** verificato nel codice · **[opinione]** giudizio di chi scrive.

## Da dove si parte [codice]

- Tutto lo stato è di una persona sola: nessun autore, proprietario o partecipante sui record (`tempo/js/store.js`, `SCHEMA = 5`).
- Id corti e casuali (`store.js:15`), non sicuri tra più persone.
- Date come `AAAA-MM-GG` locali più minuti dalla mezzanotte; il fuso non è nello stato.
- Lo scheduler è puro e gira anche sul server, ma ha stato di modulo (`prefsRef`) e restituisce `gaps` solo dopo aver piazzato le attività flessibili.
- `cloud/` esiste (un blob per account, revisione, 409 e fusione per id) ma non è pubblicato e non conosce gruppi.
- Non esistono `.ics`, link di condivisione, inviti.

## La domanda giusta [opinione]

«Gestire il tempo a te e agli amici» non può voler dire *pianificare la giornata degli altri*: lo scheduler conosce energia, abitudini e durate reali di una persona, e quelle degli altri non le avrà mai. Può voler dire una cosa più piccola e fattibile: **trovare un momento comune e metterlo nel piano di ciascuno come impegno fisso**. Ognuno resta padrone del proprio piano; ciò che si condivide è una *proposta*, non lo stato.

Da qui la regola che vale per tutte le opzioni: **proporre fasce comuni, non ottimizzare tutti insieme.**

```
fasceLibere(persona, giorni)   → [{giorno, inizio, fine}]      // solo «libero/occupato», mai i titoli
interseca(fasce di N persone)  → fasce comuni ≥ durata chiesta
ordina(fasce comuni)           → le 3 migliori, con il perché   // regole, non AI
accetta(fascia)                → un impegno fisso nel piano di ciascuno
```

Lavoro comune alle tre opzioni, tutto in codice puro e provabile con `node:test`:

1. `freeSlots(state, days, opts)` in `scheduler.js`: fasce libere **grezze** (orario di veglia meno impegni fissi meno cuscinetti), senza piazzare le attività flessibili. Oggi manca. Richiede di passare `prefs` come argomento invece di `prefsRef`.
2. Fuso esplicito: ogni fascia esce come istante assoluto (`inizio` in ms UTC + `tz` IANA di chi la offre). Lo stato locale resta com'è; la conversione avviene solo al confine.
3. Formato di scambio piccolo e con versione: `{v:1, id, titolo, durata, da:{nome}, fasce:[[inizioUTC, fineUTC]…], scade}`. Nessun titolo di attività, nessuna nota, nessun obiettivo.
4. Id della proposta con `crypto.randomUUID()`.
5. Tutto ciò che entra da fuori passa da un `sanitizeProposal` gemello di `sanitizeOps`, e l'impegno si crea con un'operazione normale (`add` di un evento), quindi con annulla.

## Opzione 1 — Senza backend: link e `.ics`

| | |
|---|---|
| **Come funziona** | Chi propone sceglie durata e giorni; Tempo calcola le proprie fasce libere e le mette nel **frammento** dell'indirizzo (`…/tempo/#p=<dati compressi, base64url>`): il frammento non arriva mai al server. Chi riceve apre il link: se ha Tempo, l'app interseca con le sue fasce e mostra le 3 comuni; se non ce l'ha, una pagina statica mostra le fasce e lascia scegliere. La risposta torna come un altro link (o un messaggio precompilato). Alla fine ciascuno aggiunge l'impegno; per chi non ha Tempo, un file `.ics`. |
| **Modello dati** | Nessuno nuovo nello stato. Solo il formato di scambio qui sopra. L'impegno accettato è un evento normale con un campo facoltativo `via: <id proposta>` (se lo si vuole, è un cambio di schema: migrazione banale). |
| **Chi modifica cosa** | Ognuno solo il proprio piano. La proposta è immutabile: per cambiarla se ne manda un'altra. |
| **Conflitti** | Non esistono conflitti di dati (niente stato condiviso). Esiste la **stantia**: le fasce sono una foto. Si mitiga con `scade` (48 ore) e ricontrollando la fascia contro il piano al momento dell'accettazione. Con più di 2–3 persone il giro di link diventa scomodo: è il limite naturale dell'opzione. |
| **Privacy** | La migliore delle tre: escono solo fasce libero/occupato, per pochi giorni, verso chi riceve il link. Chi inoltra il link inoltra quelle fasce. |
| **Costo** | Basso: `freeSlots`, formato, due schermate, `.ics` in uscita (testo, nessuna dipendenza). Nessun costo ricorrente. La CSP non cambia. |
| **Rischi** | `?tell=` oggi esegue senza un tocco (vedi `docs/audit/AUDIT.md` 1.3): un link di proposta **non deve mai** creare nulla senza conferma. Lunghezza dell'indirizzo nelle chat (restare sotto ~1,5 kB: 7 giorni di fasce ci stanno). iOS apre i link nel browser, non nella PWA installata: lo stato della PWA installata e quello di Safari sono separati — **questo è il rischio tecnico principale e va provato su un iPhone vero prima di tutto**. |
| **Quando ha senso** | Per capire se la cosa serve a qualcuno. Per 2–3 persone. |

## Opzione 2 — Backend minimo (Workers + Durable Objects)

| | |
|---|---|
| **Come funziona** | Una «stanza» per proposta: un Durable Object che tiene le fasce di ciascuno e calcola l'intersezione a ogni cambio; i telefoni la aggiornano quando il piano cambia. Si entra con un link che contiene un segreto. |
| **Modello dati** | `Stanza{id, titolo, durata, scade, membri[{id, nome, tz, fasce[], aggiornato}], scelta}`. Lo stato personale resta sul telefono (o nel blob di `cloud/`); alla stanza arrivano solo le fasce. |
| **Chi modifica cosa** | Ognuno solo le proprie fasce; chi ha creato la stanza fissa la scelta; chiunque può uscire (le sue fasce si cancellano). |
| **Conflitti** | Un Durable Object è un solo filo: niente scritture concorrenti da ricomporre. La scelta è una sola operazione atomica («fissa se ancora libera per tutti»). Niente fusione, niente CRDT. |
| **Privacy** | Media: un server vede chi è libero quando. Si può cifrare con una chiave nel frammento del link, ma allora l'intersezione va fatta sui telefoni e il server è solo una bacheca. |
| **Costo** | Medio-alto, e non per la stanza: prima vanno chiusi i punti aperti di `cloud/` (letture e scritture non atomiche, cancellazioni dedotte, conferme non forzate: AUDIT 1.4, 2.5, 2.6), va pubblicato, va aggiornata la CSP, servono abuso/limiti, cancellazione dei dati, un'informativa. È un servizio da tenere acceso. |
| **Rischi** | Si costruisce l'infrastruttura prima di sapere se serve. «Ripianificare per tutti» è la parte che suona bene e che conviene **non** fare: toccare il piano di un altro senza che lo chieda rompe «ogni modifica si annulla». |
| **Quando ha senso** | Dopo che l'opzione 1 ha mostrato gruppi che tornano, e solo quando il giro di link è il collo di bottiglia dimostrato (gruppi da 4+, fasce che cambiano spesso). |

## Opzione 3 — Nativo (EventKit, CloudKit Sharing, App Intents)

| | |
|---|---|
| **Come funziona** | L'app legge il calendario di sistema (EventKit) per sapere quando sei davvero occupato; condivide una proposta con CloudKit Sharing; Siri e Comandi rapidi con App Intents. |
| **Modello dati** | `CKShare` su un record `Proposta` con figli `Disponibilità` per partecipante. Identità = account iCloud. |
| **Chi modifica cosa** | Permessi di CloudKit (lettura/scrittura per partecipante). |
| **Conflitti** | Li gestisce CloudKit per record (vince l'ultimo, con token di cambio); la scelta finale va comunque resa atomica. |
| **Privacy** | Buona e delegata ad Apple; nessun server proprio. |
| **Costo** | Alto: `native/` non è mai stato compilato [codice]; servono Xcode, account sviluppatore, revisione dell'App Store, due percorsi di codice (web e nativo). Solo iPhone: chi ha Android resta fuori dal gruppo. |
| **Rischi** | È il terreno di Apple (Calendario condiviso, Inviti): si compete dove Apple è più forte e ci si lega a una piattaforma. |
| **Quando ha senso** | **EventKit in sola lettura vale da solo, senza amici**: sapere gli impegni veri rende il piano più realistico, che è il vantaggio di Tempo. La condivisione nativa solo dopo, se mai. |

## Raccomandazione [opinione]

**Opzione 1, e non subito.** È l'unica che si può provare senza accendere un servizio, non tocca lo schema, rispetta «l'AI propone, il codice decide» (l'intersezione è aritmetica) e lascia a ciascuno il proprio piano. Ma prima di scriverla va provato a mano che qualcuno la voglia: il test e il criterio di stop sono nella parte consegnata fuori dal repository.

Ordine dei lavori, se il test passa:

1. `freeSlots` puro + test (utile anche da solo: «quando sono libero questa settimana?»).
2. Prova su iPhone: un link aperto da WhatsApp finisce nella PWA installata o in Safari?
3. Formato di scambio + `sanitizeProposal` + `.ics` in uscita.
4. Le due schermate (proponi, rispondi), dentro il catalogo esistente.

Cosa **non** fare in nessuna opzione: ripianificare la giornata di un altro; condividere titoli, note o obiettivi; chiedere un account per rispondere.
