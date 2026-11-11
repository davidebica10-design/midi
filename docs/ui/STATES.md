# Tempo — gli stati del tempo

Specifica del refresh UI. Fa fede insieme a `tempo/DESIGN-API.md` (contratto dati) e a `tempo/js/genui.js` (dove gli stati vivono già come `MOODS`).

## Punto di partenza (verificato nel codice)

Gli stati non si inventano: `genui.js` ha già `moodOf()` e `sceneFor()`, regole deterministiche, catalogo chiuso di widget, pelle dell'AI filtrata da `sanitizeSkin`. Quello che mancava:

1. **«Adesso» non stava fermo.** La carta partiva a 130 px con il saluto, a 205 px con l'icona, a 245 px con l'anello del focus. Era una carta del collage tra le altre, larga mezza schermata.
2. **Nessun limite a ciò che si vede.** Una giornata piena metteva 8+ carte sullo stesso piano; il `+` copriva le carte.
3. **Nessuna azione primaria dichiarata.** Nel vuoto l'unica azione era il `+` in un angolo, e lo stesso invito era scritto due volte.
4. **Il saluto in tema chiaro non si leggeva** (bianco su fondo chiaro) e usciva dal bordo destro.

## La regola

Ogni schermata del giorno ha tre fasce, sempre nello stesso ordine e alla stessa altezza:

| Fascia | Cosa contiene | Regola |
|---|---|---|
| **Cima** (altezza fissa) | riga dell'ora + saluto, oppure icona dell'attività, oppure anello del focus | cambia il contenuto, mai l'altezza |
| **Adesso** (ancora) | la carta «Adesso», a tutta larghezza, con l'unica azione primaria | stessa posizione in ogni stato (± 2 px, misurato da un test nel browser) |
| **Il resto** | widget della scena, osservazioni (max 2), carte sfalsate su due colonne, pila delle concluse | quante carte si vedono lo decide lo stato |

## I sei stati (più tre di servizio)

| Stato (`mood`) | Quando | Cima | Azione primaria (una) | Carte in vista | Movimento | Non si vede |
|---|---|---|---|---|---|---|
| `empty` — vuoto | nessuna attività oggi | saluto | **Aggiungi** (apre la composizione) | 0 | sfondo lento | invito doppio, pila vuota |
| `before` — prima di un impegno | impegno fisso entro 45′ | icona dell'impegno | nessuna (è tempo di preparazione) oppure **Inizia** se c'è un'attività breve che ci sta | l'impegno + 1 | fermo | widget, il resto del giorno (dietro l'appiglio) |
| `doing` — attività in corso | un blocco è iniziato | icona dell'attività | **Fatto** | 2 | barra di avanzamento | widget, osservazioni non urgenti |
| `full` — giornata piena | il piano non ci sta o un obiettivo è in ritardo | saluto | **Inizia** la prossima | 3 | fermo | le altre carte (dietro l'appiglio), widget oltre 1 |
| `evening` — sera libera | dopo le 19, niente rimasto | saluto | nessuna | 0 + pila delle concluse | sfondo più caldo e lento | carte di domani |
| `focus` — focus | timer in corso | anello | **Fatto** | 1 (la prossima) | solo l'anello | tutto il resto |
| `normal` | giornata normale | saluto | **Inizia** la prossima | tutte | sfondo lento | — |
| `first`, `off` | primo avvio, giorno di stacco | saluto | come oggi | come oggi | — | — |

Il contratto è la tabella `STATES` in `genui.js` e la funzione pura `stateSpec(scene, view)`; `app.js` disegna e basta.

## Rivelazione progressiva: cosa cambia rispetto all'idea iniziale

**Decisione: niente pizzico e niente «tocco nel vuoto» come gesto principale.** Motivi:

- su iPhone il pizzico in una PWA è lo zoom di accessibilità del sistema: toglierlo è un danno, tenerlo è un conflitto;
- il tocco nel vuoto non ha nulla che lo annunci e si confonde con lo scorrimento;
- un indizio al primo avvio si dimentica: la scopribilità deve restare sullo schermo.

**Al suo posto, tre livelli con un appiglio sempre visibile:**

1. **Adesso** — l'ancora. C'è sempre.
2. **Il resto di oggi** — quando lo stato nasconde delle carte compare un pulsante vero, con testo: «Altre 5 · dalle 13:00». Un tocco le mostra sul posto; la scelta vale fino a fine giornata (in memoria, non nei dati salvati). È un pulsante: funziona con VoiceOver e tastiera.
3. **Giorni e mese** — il pulsante griglia in alto a sinistra, già esistente.

## Transizioni

- Il cambio di stato avviene solo al ridisegno (azione dell'utente o scatto dell'orologio), mai a metà gesto.
- Tra due stati: la fascia «Cima» sfuma (200 ms), l'ancora non si muove, le carte usano il FLIP esistente.
- Con `prefers-reduced-motion`: nessuna animazione di posizione, solo dissolvenza breve.
- L'orologio ridisegna solo se è cambiato qualcosa di visibile.

## Misure («moderno» vuol dire questo)

| Misura | Prima | Obiettivo |
|---|---|---|
| Posizione di «Adesso» tra gli stati | 130 / 205 / 245 px | uguale, ± 2 px |
| Carte in vista, giornata piena | 8+ | ancora + 3 + appiglio |
| Azioni primarie per stato | 0–2 | 1 al massimo |
| Tocchi: iniziare / finire / spostare a domani | 1 / 1 (3 col timer) / 2 | 1 / 1 / 2 |
| Testi sotto i 12 px | 20 regole | 0 |
| Controlli sotto i 44 px | ~10 | 0 |
| Ridisegni a vuoto dell'orologio | ogni 30 s | 0 |
