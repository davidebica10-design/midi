# Tempo — conversazione al centro e proposte tra persone

Terzo lavoro sul ramo `claude/tempo-app-ui-optimization-i31896` (stessa PR di audit, refresh UI e controllo di qualità). Niente unito a `main`. Niente provato su un iPhone vero.

Marche: **[codice]** verificato nel codice o dai test · **[schermo]** visto in un browser automatizzato · **[opinione]** giudizio di chi scrive.

## La direzione [opinione]

«L'AI al centro» per Tempo non vuol dire più chat. Vuol dire tre cose:

1. **Si parla o si scrive, sempre dallo stesso punto.** Prima la composizione stava dietro un `+` in un angolo.
2. **Lo schermo mostra solo ciò che serve adesso.** Una cosa grande, il resto piccolo, il resto del resto dietro «Altre N».
3. **Il codice decide, e lo dice.** Orari, conflitti e fasce libere li calcola lo scheduler; l'AI propone parole. Vale anche tra due persone: è il codice di chi riceve a dire «Ci sta».

## Cosa è stato costruito

### La barra sempre presente [codice + schermo]
«Scrivi o parla a Tempo», in basso, in ogni stato del giorno, con il `+` (stesso menu) e il microfono. Toccarla apre la composizione di prima: non esiste un secondo compositore. Non copre l'ultima tessera, l'appiglio «Altre N» né la pila delle concluse; con un foglio o la presentazione aperti è inerte.

### Una carta grande, le altre piccole [codice + schermo]
«Adesso» resta l'ancora. Attività e impegni diventano tessere compatte nello stesso stile di carta (`.pc.compact`): titolo su due righe, una riga di orario, icona, spunta in linea.

| | Prima | Dopo |
|---|---|---|
| Impegno, titolo su due righe | 204 px | 88 px |
| Attività | 161–178 px | 66–70 px |

Un impegno fisso si riconosce senza colore (riga laterale, tipo nel nome accessibile). Restano grandi le carte che portano un messaggio: mancate, «Non entra», osservazioni, widget della scena, carte con foto o lista.

### Difetti chiusi in `store.js` e `parse.js` [codice]
Prima erano fuori perimetro; il proprietario ha chiesto di rimuoverli. Sedici test rossi scritti prima, poi resi verdi senza toccarli.

- Date: solo date vere tra il 2000 e il 2100 (`2026-02-30` e `9999-99-99` scartate).
- Impegni oltre la mezzanotte: tagliati alle 24:00; inizio alle 24:00 o durata sotto i 5 minuti, scartati.
- Oltre 40 operazioni: l'eccesso è contato. Ogni scarto porta un motivo (`why`).
- Parser: una domanda non diventa un'attività, e l'app lo dice («Mi sembra una domanda: non l'ho aggiunta.»). Lettere a caso non diventano un'attività. «obiettivo: …» prende il titolo da dopo i due punti.
- È domanda solo una frase che finisce con «?», la cui ultima parte comincia con un interrogativo, e senza data né ora. «dentista domani alle 10?» resta un impegno.

### Proposte tra persone, senza server [codice + schermo]
Scrivere un impegno nell'agenda di un altro, nella sola forma possibile oggi: **come proposta**.

```
A: «Proponi» sul foglio di un impegno, oppure «proponi a Marco cena oggi alle 19»
   → un messaggio leggibile + un codice. L'impegno resta nel piano di A, «in attesa di risposta».
B: incolla il messaggio nella barra (o tocca il link)
   → «Marco ti propone: Cena · oggi, 19:00–20:00.»  +  «Ci sta.» / «Si sovrappone a Palestra (21:30–22:30).»
   → Accetta · Proponi altro (fino a 3 fasce libere scelte dal codice) · Non riesco
A: incolla la risposta → «ha accettato» / «non riesce» / «propone invece», con spostamento annullabile.
```

Regole, tutte coperte da test:

- **Niente entra in un piano senza un tocco del proprietario.** Incollare o aprire un link non cambia nulla; nemmeno leggere una risposta.
- **Tutto ciò che arriva è ostile.** Passa da `sanitizeInvite` (gemello di `sanitizeOps`) e nella pagina solo come testo. L'impegno si crea con un'operazione normale: `sanitizeOps` → `applyOps`, con annulla.
- **Dal piano di chi risponde escono solo gli orari scelti.** Mai titoli, note, obiettivi.
- **Il testo di una proposta non va a nessuna AI**, né nella sincronizzazione, né nel backup.
- **Fusi orari espliciti**: una proposta scritta a Roma si legge nell'ora locale a Tokyo, anche a cavallo del cambio d'ora.
- Nessun cambio allo schema dei dati: firma e proposte stanno in due chiavi separate (`tempo.nome`, `tempo.inviti`, al massimo 50 voci).

Modulo puro: `tempo/js/invite.js`. Progetto di partenza: `docs/AMICI.md`, opzione 1.

## Prove [codice + schermo]

| | Prima di questo lavoro | Ora |
|---|---|---|
| `npm test` (UTC e Tokyo) | 241 | 371 |
| Stati del giorno nel browser | 82 controlli | 218 |
| Guasti nel browser | 87 | 87 |
| Proposte, due telefoni simulati in due fusi | — | 243 |

Revisione del codice: 0 bloccanti, 5 rischi e 4 debiti, tutti corretti. Il rischio più serio l'aveva introdotto questo stesso lavoro (la regola «è una domanda» era troppo larga).

## Limiti noti

- **iPhone**: un link toccato in una chat si apre in Safari, non nella PWA installata, e i due hanno dati separati. Per questo l'ingresso principale è **incollare il messaggio nella barra**. Da provare su un dispositivo. [opinione, non verificato]
- Il messaggio mostra il fuso come «(Europe/Rome)»; chi riceve in un altro fuso non vede l'ora di chi propone.
- Uno slot che supera la mezzanotte di chi riceve viene tagliato alle 24:00.
- «proponi a Marco cena alle 19», senza giorno, propone per oggi.
- Con più di due persone il giro di messaggi diventa scomodo: è il limite naturale di questa forma.
- Regola sul testo senza senso: una parola come «property», da sola, verrebbe scartata.
- Annullare una modifica scarta ancora le successive (`store.js`); restano 3 annulla dopo un riavvio.

## Cosa non è stato costruito, e perché [opinione]

| Idea | Perché no, per ora |
|---|---|
| Le AI di due persone che si parlano | Servono identità e un servizio acceso. Il cloud del repository ha tre difetti da chiudere prima (`docs/audit/AUDIT.md` 1.4, 2.5, 2.6). Le proposte a messaggio sono lo stesso protocollo a mano: se funzionano, il passo dopo è farle viaggiare da sole. |
| Scrivere direttamente nell'agenda di un altro | Rompe «ogni modifica si annulla» e la fiducia. La proposta con un tocco è il confine giusto anche con un server. |
| Comunità, gruppi, feed | Nessun dato dice che servano. Prima: cinque gruppi veri che usano le proposte per fissare una cosa reale. |
| Avvisi all'altro («sei in ritardo», «tra 10 minuti») | Senza server non c'è modo di raggiungere un telefono chiuso. |

## Come usarlo per capire se serve

Le proposte sono anche lo strumento dell'esperimento già descritto: mandane a cinque gruppi veri per fissare una sessione reale. Si guarda quanti incollano il messaggio, quanti accettano una fascia, quanti lo rifanno da soli entro due settimane. Se pochi lo fanno, il resto di questa strada non va costruito.
