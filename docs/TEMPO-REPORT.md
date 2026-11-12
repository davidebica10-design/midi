# Tempo — rapporto

Ramo `claude/tempo-app-ui-optimization-i31896` (la sessione non poteva scrivere su `ui-refresh`). Niente è stato unito a `main`.

Ogni affermazione è marcata: **[codice]** verificato nel codice o misurato · **[documenti]** dedotto dai documenti · **[opinione]** giudizio di chi scrive.
I due .docx e i tre PDF del project **non erano leggibili** in questa sessione: nulla qui è dedotto da loro, salvo ciò che era citato nella richiesta.

Prezzi, concorrenti, tabella di marcia con numeri e pre-mortem **non sono in questo repository**, che è pubblico (regola di `.claude/CLAUDE.md`): sono stati consegnati a parte.

## Verdetto in 5 righe

1. La build è sana: nessuna falla sfruttabile, nessuna perdita di dati certa, 228 test verdi in tre fusi orari. **[codice]**
2. «L'AI propone, il codice decide» regge: ogni percorso AI passa da `sanitizeOps`; la UI generativa è un catalogo chiuso. **[codice]**
3. Il codice è più avanti di quanto dicesse la richiesta (cloud, nativo, stati, schema 5) e molto più avanti degli utenti: nessuno dei due servizi è acceso. **[codice]**
4. Il refresh non ha aggiunto stati: ha reso misurabili quelli che c'erano. «Adesso» ora sta fermo, una giornata piena mostra tre carte e non otto. **[codice]**
5. Il rischio vero non è tecnico: è costruire ancora prima di sapere chi paga. «Amici» va provato a mano prima di scriverne una riga. **[opinione]**

## I 5 rischi, in ordine

| # | Rischio | Marca |
|---|---|---|
| 1 | **Si costruisce senza utenti.** Cloud, guscio nativo, più motori AI: tutto scritto, niente pubblicato, nessun modo di sapere se qualcuno riapre l'app. Ogni funzione nuova allunga la distanza. | codice + opinione |
| 2 | **La parte facile è già di Apple.** Scrivere una frase e ottenere un evento non distingue più. Distingue dire che la giornata non ci sta, imparare le durate vere, scegliere una cosa sola. | opinione (fatti di mercato da fonti secondarie) |
| 3 | **Accendere il cloud così com'è.** Scritture non atomiche su uno store a consistenza eventuale, cancellazioni dedotte dall'assenza, conferme non forzate nel percorso `tell`: oggi innocui perché spento, da chiudere prima. `AUDIT.md` 1.4, 2.5, 2.6. | codice |
| 4 | **Il link `?tell=` agisce senza un tocco** e la CSP lascia uscire verso qualunque host `https:`. Nessuno dei due è una falla oggi; entrambi lo diventano con link condivisi tra persone. `AUDIT.md` 1.3, 2.2. | codice |
| 5 | **Non provato su un iPhone vero.** Aree sicure, PWA autonoma, trascinamento, aggiornamento del service worker, costo dello sfondo sfocato: nessuna prova automatica li copre. | codice |

## Cosa è cambiato nella UI

Specifica e misure: `docs/ui/STATES.md`. Contratto dati: `tempo/DESIGN-API.md`, sezione «Stati del tempo».

| Cosa | Prima | Dopo | Marca |
|---|---|---|---|
| Posizione di «Adesso» nei sei stati | 130 / 205 / 245 px | 242 px, sempre | codice |
| «Adesso» | una carta del collage, mezza larghezza | l'ancora, a tutta larghezza, con l'unica azione primaria | codice |
| Giornata piena | 8+ carte sullo stesso piano | ancora + 3 + «Altre N · dalle HH:MM» | codice |
| Giornata vuota | invito scritto due volte, solo il `+` | un invito, un pulsante «Aggiungi» | codice |
| Saluto in tema chiaro | quasi invisibile, tagliato a destra | contrasto ≥ 3:1, intero da 320 a 430 px | codice |
| Testi sotto i 12 px | 20 regole | 0 | codice |
| Controlli sotto i 44 px | ~10 | 0 nelle schermate provate | codice |
| `z-index` | 25 valori sparsi | 14 token `--z-*` | codice |
| Orologio | ridisegno e salvataggio ogni 30 s | solo se cambia qualcosa | codice |
| Sfondo | macchie sempre in movimento | ferme a pagina nascosta e negli stati `before`, `full`, `focus` | codice |
| Fogli | sfondo attivo, fuoco perso | sfondo `inert`, fuoco restituito | codice |

- **Contratto:** `STATES` e `stateSpec()` in `genui.js`, puri. Lo stato decide quante carte si vedono e quale azione è ammessa; l'azione viene sempre dal viewmodel, mai dall'AI. **[codice]**
- **Test:** da 200 a 228 (`statespec.test.js`, `guardie-css.test.js`), più `tempo/tests/ui/stati.mjs`: 82 controlli in un browser vero (posizione dell'ancora, appiglio, 44 px, 12 px, flusso inizia/fatto/annulla, fogli, movimento ridotto). Sta fuori da `npm test` e non aggiunge dipendenze. **[codice]**
- **Revisione:** 0 bloccanti; 3 rischi e 2 debiti corretti, 1 debito lasciato (aree di tocco che sporgono di 2–8 px sui vicini in tre controlli). **[codice]**
- **Non toccati:** `scheduler.js`, `store.js`, `parse.js`, `learn.js`, `companion.js`, `viewmodel.js`, schema dei dati, CSP. Cache del service worker da `tempo-v35` a `tempo-v39`. **[codice]**
- **Scartato:** rivelazione con pizzico e tocco nel vuoto (motivi in `STATES.md`); sfera e tamburo 3D di carte (prototipati fuori dal repository, scartati). Lo stile delle carte resta quello di Tempo.

**Da guardare su un iPhone prima di unire [opinione]:** la fascia in cima ora è alta 188 px in ogni stato, quindi con il saluto «Adesso» parte più in basso di prima (242 contro 130 px). È il prezzo dell'ancora ferma; se sul telefono sembra troppo vuoto, si stringe la fascia riducendo l'anello del focus.

## «Amici»: opzione raccomandata

Progettazione completa: `docs/AMICI.md`.

- **Raccomandata: opzione 1, senza backend** — fasce libero/occupato nel frammento del link, `.ics` per chi non ha l'app. Non tocca lo schema, non accende servizi, l'intersezione è aritmetica. **[opinione]**
- **Ma non adesso.** Prima un test a mano con 5 gruppi, zero codice, con un criterio di stop scritto (nella parte consegnata a parte). **[opinione]**
- **La regola per tutte le opzioni:** proporre fasce comuni, non ottimizzare tutti insieme. Nessuno ripianifica la giornata di un altro. **[opinione]**
- **Manca nel codice:** una funzione `freeSlots` per le fasce libere grezze; autore e fuso sui record; id sicuri tra persone. **[codice]**
- **Rischio tecnico da provare per primo:** su iPhone un link aperto da una chat finisce in Safari, non nella PWA installata, e i due hanno dati separati. **[opinione, da verificare su dispositivo]**
- **Opzione 2** (Workers + Durable Objects) solo dopo gruppi che tornano; **opzione 3** (nativo) vale per EventKit in sola lettura, anche senza amici. **[opinione]**

## Tabella di marcia a 90 giorni (forma; i numeri sono nella parte privata)

| Giorni | Cosa | Si misura |
|---|---|---|
| 0–14 | Unire il refresh. Dare Tempo a persone che non ti conoscono, con un progetto e una scadenza veri. Nessuna funzione nuova. Test a mano dei gruppi in parallelo. | quanti arrivano al secondo giorno |
| 15–45 | Guardare cosa fanno; una chiamata a ciascuno al giorno 14; aggiustare solo ciò che blocca. | quanti riaprono da soli dopo 14 giorni |
| 30–60 | Chiedere soldi prima di avere il pagamento. | quanti dicono sì |
| 60–90 | Solo se i due numeri reggono: **una** tra EventKit in sola lettura, cloud messo in sicurezza, «amici» opzione 1. | una cosa spedita |

**Da congelare [opinione]:** cloud e MCP, modelli AI sul telefono e banco di prova dei decisori, nuovi domini e pelli, altro lavoro sul parser, guscio nativo completo.

## Decisioni che spettano a te

1. **Unire o no questa PR**, dopo averla provata sul telefono (fascia in cima, appiglio «Altre N»).
2. **`?tell=`**: esecuzione immediata (comoda per i Comandi rapidi) o un tocco di conferma (più sicuro). Non l'ho cambiato.
3. **CSP `connect-src https:`**: stringerla ai fornitori noti rompe l'uso di un server AI personalizzato. Non l'ho cambiata.
4. **Trascinamento delle carte**: farlo spostare davvero o toglierlo.
5. **Frasi di «Adesso»** («Fai rispondere alle email»): vengono da moduli fuori perimetro.
6. **Cloud**: congelare, o chiudere i tre rischi e pubblicare.
7. **Pubblico e prezzo di prova**, e se fare ora il test a mano dei gruppi: nella parte privata.
