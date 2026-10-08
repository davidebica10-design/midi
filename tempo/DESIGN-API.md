# Tempo — dati delle schermate (DESIGN-API)

Ogni schermata è disegnata a partire da una funzione pura in `js/viewmodel.js`: stato + piano + ora → dati. Questo file elenca, per ogni schermata, i campi disponibili e tutti gli stati da disegnare. I testi sono già pronti in italiano. Orari `HH:MM`, date `YYYY-MM-DD`.

La barra per parlare con Tempo sta chiusa nel «+» laterale in basso a destra e si apre toccandolo; si richiude da sola quando non serve più. Nel calendario, in basso al centro, c'è il pulsante «Riepilogo»; in alto a sinistra il riquadro di oggi riporta alla giornata.

Nel giorno, sopra il saluto c'è una sola riga: l'ora (o la data, per gli altri giorni) e l'andamento, es. «15:37 · 0 di 3 fatte». Non c'è più una carta che ripete il giorno.

Ambiente comune (`env`, dentro `today()`): `online` (bool) e `ai` (`'base' | 'online' | 'local' | 'claude'`).

---

## 1. Giorno — `today(ctx)`

`ctx = { state, plan, planFor, now, day?, fits, backupDue, env }`

| Campo | Tipo | Note |
| --- | --- | --- |
| `day` | data | giorno mostrato |
| `isToday`, `past` | bool | |
| `header.time` | testo | `18:20` oggi, `7 ottobre` per gli altri giorni |
| `header.greeting` | testo | Buongiorno / Buon pomeriggio / Buonasera / Buonanotte, «Domani», o il giorno della settimana |
| `header.weekday`, `header.date` | testo | «Mercoledì», «7 ottobre» |
| `now` | oggetto o `null` | **una sola** cosa da fare adesso (solo oggi), vedi sotto |
| `observations` | lista (max 2) | `{ id, text, actions?: [{ label, act, arg }] }` |
| `summary` | oggetto | `{ done, total, pct, freeMin, caption }`, es. «0 di 3 fatte · 1 h 5' libere» |
| `cards` | lista | le carte in ordine di orario, vedi sotto |
| `status` | testo | vedi «Stati» |
| `emptyText` | testo o `null` | frase da mostrare quando non ci sono carte |

### `now`

| Campo | Note |
| --- | --- |
| `title` | frase decisa, es. «Hai 47 minuti prima di cena. Finisci il ritornello.» |
| `why` | il perché, ed eventualmente cosa *non* iniziare |
| `mood` | `focus` · `rest` · `busy` · `stop` · `empty` |
| `action` | `{ type: 'start' \| 'complete', id, label }` o `null` |
| `block` | blocco in corso o `null`: `{ id, itemId, kind: 'task' \| 'event' \| 'rest', title, until, left, pct, doing }` |

Il blocco in corso **non** compare anche fra le `cards`.

### `cards`, per `type`

| type | Campi |
| --- | --- |
| `task` | `id, itemId, title, start, end, minutes, done, doneAt, pinned, important, project {id,name,color} \| null, goalId, habit, energy (1–3), estimated, resumed, part, image, color` |
| `event` | `id, itemId (null se ricorrente), title, start, end, recurring, image, color, project` |
| `rest` | `id, title` («Cena / decompressione»), `start, end, note` («Stacca dal lavoro») |
| `pause` | `at, minutes` («20:00 · pausa 15'») |
| `missed` | `id, title, start, minutes`: domanda «Hai fatto…?» con Sì / In parte / No |
| `unscheduled` | `id, title, minutes, reason, moveTo` («domani» / «giorno dopo») |
| `conflict` | `id, a, b` (titoli) |

### Stati

| status | Quando | Cosa mostrare |
| --- | --- | --- |
| `first` | nessuna attività e nessun obiettivo (primo giorno) | `emptyText`: «Raccontami cosa vuoi ottenere…»; la presentazione si apre da sola al primo avvio |
| `empty` | giornata senza niente | `emptyText`: «Giornata libera…» |
| `normal` | giornata con attività e tempo libero | carte |
| `full` | qualcosa non entra o meno di 30 min liberi | carte + carte `unscheduled` |
| `off` | giorno di stacco senza attività | `emptyText`: «Oggi stacchi: niente progetti.» |
| `goal-late` | un obiettivo non entra prima della scadenza da almeno due giorni (oggi) | carte + osservazione `fit-…` con «Sposta al…» / «Solo l'essenziale» |
| `past` | giorno passato | solo carte fatte |

Stati dell'ambiente, da disegnare anche sopra gli altri:

| Stato | Come si riconosce | Comportamento |
| --- | --- | --- |
| Offline | `env.online === false` | tutto funziona tranne l'AI; la barra usa la modalità base |
| Senza AI | `env.ai === 'base'` | la barra capisce frasi semplici; nel riassunto della barra c'è il link «Scegli un'AI gratuita» |
| Errore AI / timeout | nota dopo l'invio con testo «L'AI non risponde: ho usato la modalità base.» | la modifica è comunque fatta in modalità base, se possibile |

### Osservazioni (`observations[].id`)

Al massimo 2 al giorno; quelle già mostrate restano fino a sera.

| id | Testo (esempio) | Azioni (`act`) |
| --- | --- | --- |
| `fit-<goal>` | «Le sessioni per l'EP non entrano tutte entro il 30 novembre…» (solo se il ritardo dura da 2 giorni, mai durante una sessione di quell'obiettivo; «Sposta al…» mai prima di 7 giorni da oggi) | `extend`, `trim` |
| `past-<goal>` | «L'EP doveva uscire il 30 settembre. Lo chiudiamo o scegliamo una nuova data?» | `goal-done`, `goal-date` (apre la scelta della data), `goal-remove` |
| `skip-<project>` | «Questa settimana hai saltato 4 sessioni di EP…» | `recover`, `reduce` |
| `due-<goal>` | «L'EP: entro quando vuoi arrivarci?» | `due` (2 settimane, 1 mese, 3 mesi, nessuna) |
| `learn-<key>` | ««Beat» lo chiudi in circa 70 minuti, non 45: ho aggiornato le stime.» | `learn-off` |
| `slot-<fascia>` | «Le sessioni del mattino le salti spesso (1 su 9)… Le sposto alla sera?» (almeno 8 sessioni nella fascia; la fascia proposta ha dati e non è piena di impegni fissi) | `slot-move`, `slot-keep` |
| `day-<n>` | «Il lunedì salti quasi sempre le sessioni… Lo tengo libero dai progetti?» (almeno 8 sessioni in 4 settimane; mai se restano 3 giorni o meno per i progetti) | `day-off` (per 4 settimane: `prefs.restDays`), `slot-keep` |
| `carry-<item>` / `behind-<item>` | «Hai già fatto 40 minuti, non riparti da zero…» | — |
| `goal-<goal>` | «Far uscire l'EP: tra 8 settimane. 3 sessioni fatte su 22.» | — |
| `done-<goal>` | «Le sessioni per l'EP sono finite. Obiettivo raggiunto?» | `goal-done`, `goal-more` |
| `backup` | «Non esporti un backup da più di due settimane…» | `backup` |

---

## 2. Riepilogo — `summary({ state, plan, longPlan, planFor, now, fits })`

Si apre dal pulsante «Riepilogo» in basso al centro del calendario; la freccia in alto lo chiude. È una chat: in cima i punti chiave, poi le domande dell'utente e le risposte.

| Campo | Contenuto |
| --- | --- |
| `date` | «8 ottobre» |
| `intro` | «Ecco come stai andando, in breve.» |
| `points[]` | punti chiave: la settimana, ogni obiettivo (in linea, in anticipo o in ritardo rispetto alla scadenza), il mese, le sessioni saltate |
| `list` | `{ date, title («I prossimi 7 giorni»), rows[] { id, day, title, sub («Domani alle 19:15 · 1 h 30'»), done } }` (massimo 6 righe) |
| `projects[]` | `{ key, name, color, text, footer («Scadenza 30 novembre»), day }`: le carte orizzontali |
| `monthSessions` | per il pulsante «Vedi tutto il mese (N sessioni)» |

Con un'AI attiva i punti chiave li scrive l'AI (salvati in `state.askIntro`, rifatti quando il piano cambia). Le domande vanno all'AI con questi dati e una risposta a parole; senza AI risponde `answerLocally(question, summary, state)`, che riconosce: come sto andando, la settimana, il mese, le scadenze, le sessioni saltate e i progetti per nome. Da qui il piano non si modifica: le modifiche si chiedono dalla barra del giorno.

Stati: senza AI · AI che scrive (puntini) · AI in errore o in timeout (risposta senza AI con una nota) · nessuna sessione in programma · nessun progetto.

`week()` resta disponibile (fornisce i dati delle carte dei progetti), ma la vista Settimana non c'è più: il pizzico porta solo al calendario, e al giorno si torna toccando un giorno o il riquadro di oggi in alto a sinistra.

## 3. Mese — `month({ state, longPlan, planFor, now, months, selected })`

Una lista di mesi: `{ index, title («Novembre 2026»), short («Nov»), lead (celle vuote prima del primo giorno, settimana da lunedì), cells }`.

Ogni cella: `{ day, n, past, today, selected, off, sessions, density (0–3), deadlines: [{ goalId, title, project }], allDone, pick: { title, image, deadline? } | null, label }`.

- Si vedono **le scadenze degli obiettivi** (`deadlines`, `pick.deadline = true`, titolo «◎ Far uscire l'EP…») e **la densità delle sessioni** (`sessions`, `density`).
- Gli impegni fissi ricorrenti (il lavoro) non contano.
- `label` è il testo per lo screen reader: «30, scadenza: Far uscire l'EP con MIDI, 1 sessione».

Stati della cella: passato · oggi · selezionato · libero · con sessioni (1, 2, 3+) · scadenza · giorno di stacco · tutto fatto.

---

## 4. Il tuo contesto — `context({ state, now, fits })`

| Campo | Contenuto |
| --- | --- |
| `goals[]` | `{ id, title, project, due, dueDate («30 novembre»), dueText («tra 8 settimane», «senza scadenza», «scaduto»), sessions: { done, total }, late, habit }` |
| `projects[]` | `{ id, name, color, due }` |
| `habits[]` | `{ id, title, perWeek, duration, text }` («Palestra: 3 volte a settimana · 1 h») |
| `constraints` | `recurring[] { id, title, start, end, weekdays }`, `offDays`, `freeDays`, `restDays[] { wd, until, text }` (giorni liberati dal companion, si tolgono con `data-restday`), `notes[]` |
| `preferences` | `focusWindow, focusLabel («la sera»), maxBlock, buffer, decompress, dayStart, dayEnd, slack, windows[], notes[]` |
| `learned[]` | `{ key, text, active, toggle, disabled }`: ciò che il companion ha imparato, attivabile e dimenticabile |

Stati: nessun obiettivo · obiettivo senza scadenza · obiettivo in ritardo (`late > 0`) · obiettivo-abitudine · niente di imparato (frase: «Ancora niente…»).

---

## 5. Presentazione — `onboarding()`

Cinque passi: `{ key (null | goals | constraints | projects | prefs), kick, q, sub, placeholder, examples[] }`.

Alla fine viene mostrata una sola nota di riepilogo, con Annulla: «Ho messo 22 sessioni per l'EP da qui al 30 novembre. Si parte stasera alle 19:15 con beat 01.»

---

## Colori delle carte e editor

Le carte colorate hanno una sfumatura (tinta chiara → tinta più profonda); senza colore scelto, un'attività di un progetto prende una tinta leggera del colore del progetto. Lo sfondo prende i colori delle carte più vicine al centro dello schermo e cambia mentre scorri (giorno, calendario, riepilogo).

Ogni attività o impegno può avere `color`: `rose`, `lilac`, `sage`, `sand`, `sky` oppure `null` (carta normale). Il colore vale per la carta del giorno, per l'anteprima nell'editor e per il quadrante del calendario (`month().cells[].pick.color`); il quadrante ha anche una riga sotto nel colore del progetto. Si sceglie toccando la carta oppure scrivendo nella barra «colora la call di rosa».

Tutte le carte si aprono: le attività e gli impegni nell'editor, gli impegni di ogni settimana (il lavoro) in un editor con titolo, orario, giorni e colore (vale per tutte le settimane, con «Salta oggi»), la carta «Cena / decompressione» nella scelta di quanto dura la pausa dopo il lavoro, la carta «Adesso» nell'attività di cui parla.

L'editor (si apre toccando una carta) mostra la carta stessa in anteprima dal vivo, con il titolo modificabile dentro. Sotto ci sono il colore (e la foto), Quando, Ora, Durata e Progetto come scelte da toccare; Tipo, Importanza, Energia, Fascia e Scadenza stanno in «Altro». In fondo ci sono Fatto, Inizia, Domani, Elimina e il pulsante Salva fisso.

## Gesti

| Gesto | Dove | Effetto |
| --- | --- | --- |
| Pizzico verso l'interno | giorno | calendario |
| Pizzico verso l'esterno | calendario | il giorno sotto le dita (o quello di prima) |
| Tocco su un giorno | calendario | apre quel giorno |
| Scorri a sinistra / destra | giorno | giorno dopo / giorno prima |
| Trascina giù | editor, quando è in cima | chiude senza salvare (niente rimbalzo) |
| Dal bordo sinistro verso destra | riepilogo | torna al calendario |
| Tocco sul «+» | giorno | apre la barra per parlare con Tempo |
| Tocco su «Riepilogo» | calendario | apre il riepilogo |
| Tocco su oggi (in alto a sinistra) | calendario | torna alla giornata di oggi |
| Pressione su una carta | giorno | la carta si inclina verso il dito, con un riflesso |
| Tieni premuto e trascina | giorno | la carta si solleva e si sposta; lasciata, torna al suo posto con una molla (non cambia il piano) |

## Attività in corso: icona, timer, pomodoro (`themes.js`, `focus.js`)

Ogni attività ha un tema, deciso dalle parole del titolo (o dal campo `theme` scelto dall'AI tra quelli ammessi): `{ key, label, icon, tool, accent, pal }`. Le icone sono Phosphor «fill» (licenza MIT, `icons/act/`).

| Stato del giorno (oggi) | In alto, mezzo dietro le carte | Sfondo |
| --- | --- | --- |
| niente in corso | il saluto | colori delle carte in vista |
| un'attività in corso | la sua icona grande (toccandola parte il timer) | passa piano ai colori del tema |
| timer in corso (`tool: timer`) | l'orologio a puntini: i puntini trascorsi si accendono, l'anello gira; al centro i minuti che restano | colori del tema |
| pomodoro (`tool: pomodoro`, studio e lavoro) | l'arco del Figma: si sceglie la durata (tocco o trascinando sull'arco), poi il progresso cresce con la tacca e una luce che va avanti e indietro | colori del tema |

«Inizia» (sulla carta «Adesso» o nell'editor) avvia il timer. Toccando il timer si apre il pannello: le carte scendono e compaiono i comandi (Avvia, Pausa, Termina, Salta la pausa, Riduci). Alla fine: «Fatta» (segna i minuti veri), «Altri 10'» o «Un altro giro», «Non ancora» (segna i minuti fatti). Il pomodoro fa giri da 25' con 5' di pausa (15' ogni 4 giri).

Il timer è in `state.focus` e si basa sugli orari: continua anche ad app chiusa. iPhone non garantisce un avviso con l'app chiusa: alla riapertura il timer è già avanzato alla fase giusta.

## Concluse e movimento

- Le carte concluse (attività fatte, impegni di oggi già finiti) non stanno tra le altre: vanno in una pila in fondo, come le notifiche dell'iPhone («3 concluse · Mostra»). Toccandola si apre in due colonne; «Nascondi» la richiude. Nei giorni passati è già aperta.
- Ogni volta che il giorno cambia (spunti, sposti, aggiungi), le carte scivolano al nuovo posto con una molla invece di saltare; quella spuntata vola nella pila, che fa un piccolo rimbalzo. Le carte nuove entrano dal basso.
- Toccando una carta, la carta si solleva e diventa l'anteprima dell'editor.
- Con «Riduci il movimento» attivo su iPhone le animazioni si spengono.
