# Audit UI e prestazioni di Tempo (sola lettura, 2026-11-11)

Percorsi relativi a `tempo/`. Righe verificate con grep; i conteggi di elementi interattivi sono stime dal codice, non misure a schermo.

## 1. Schermate e stati: ESISTE GIÀ la nozione di "scena/umore"
Schermate (tutte dentro `index.html`, mostrate/nascoste da `mode` = day | overview, più pannelli):
- Giorno: `renderDayView` (app.js:591), chiamata da `renderAll` (2357), da `tick` ogni 30 s (2803-2818), swipe giorno (1058), `quickOp`/`commit`.
- Calendario/mesi: `renderCalendar` (1012), `setOvMode` (1043), `openOverview` (1110); pizzico = `bindPinch` (1157).
- Riepilogo: `openSummary`/`renderSummary` (1215/1240). Racconto del mese: `openRecap`/`renderRecap` (1331/1361).
- Editor (sheet): `openSheet` (1493), `renderEditor` (1666), `showSheet` (1708); ricorrenza `openRecSheet` (1557); pausa `openRestSheet` (1619).
- Impostazioni `openSettings`/`renderSettings` (1937/1955), contesto `#panel`, onboarding `openOnboarding`/`renderOnb` (1830/1839).
Stati/scene: `genui.js` ha `MOODS` (19-28): first, empty, normal, before, doing, focus, full, evening, off, con layout (calm/standard/dense/focus) e max widget. `moodOf` (genui.js:218) decide; `sceneFor` (241) restituisce {mood, palette, motif, layout, widgets, line}. Sono GIÀ quasi i tuoi 6 stati: empty=`empty`/`first`, prima di impegno=`before` (impegno entro 45'), in corso=`doing`, giornata piena=`full`, sera libera=`evening` (>=19:00 senza task), focus=`focus`. In più: `normal`, `off`.
Cablaggio: `currentScene` (app.js:675) -> `applyScene` (684) scrive `#app[data-layout]`, `data-mood`, `.bg[data-motif]`, palette. Il CSS reagisce solo in modo leggero (style.css:1016-1022, 1108): `calm` sfalsa la 2a colonna, `dense` stringe, `focus` attenua le altre carte. Non cambia struttura né posizione di "Adesso".
Contratto dati `viewmodel.js` (funzioni pure, stato+piano+ora -> dati, già in italiano): `today` (62), `days` (140), `month` (162), `context` (198), `onboarding` (236), `week` (250), `summary` (314), `answerLocally` (386), `greetingFor` (14). Forma di `today()`: `{day,isToday,past,header{time,greeting,weekday,date},now{title,why,mood,action,block},observations[<=2],welcome,summary,cards[],status,emptyText}`; `status` in first|off|empty|past|goal-late|full|normal (viewmodel.js:121-128). Consumatori: solo app.js (11, 564, 1014, 1213, 1309, 1445, 1823, 1957) e `genui.moodOf/sceneFor`.
`genui.js` (311 righe): "UI generativa controllata": palette+motivo+layout+widget scelti dal CATALOGO FISSO `WIDGETS` = pipeline, countdown, deadline, checklist, week (32); domini (`DOMAINS` 35); l'AI propone solo una "pelle" per obiettivo, filtrata da `sanitizeSkin` (83); l'utente può bloccare palette/layout o spegnere (`prefs.ui`). Catalogo chiuso e sanificazione = già fatti.
DESIGN-API.md (313 righe): per ogni schermata campi e stati di `today/summary/month/context/onboarding`; sezione Gesti (180); focus/timer (196); concluse e movimento (211); sez. 6 Scene (220-290: umori->disposizione, catalogo widget, stati pipeline, pelle AI, impostazioni "Aspetto", WCAG); recap mensile (291); liste dentro carta (299). Dice già "«Adesso» resta sempre al primo posto".
`companion.js`: `nowAdvice` (20) = la riga "Adesso"; `briefing`/`pickObservations` (108/227, max 2 al giorno); `welcomeView` (313). Non ha nozione di stato del giorno, solo di consigli.

## 2. L'elemento "Adesso"
Renderizzato in `renderDayView` (app.js:621-633) come carta `.pc.quote.adv.mood-*` con etichetta "Adesso", prima di `put()`: finisce SEMPRE in cima alla colonna sinistra del collage a due colonne (`#collage`), sotto l'hero. Eccezione: `welcome` (bentornato) a tutta larghezza sopra (`.top-wide`, 618). Posizione stabile in DOM tra le situazioni; cambia solo il contenuto (progress bar, checklist, bottone), il `mood-*` e l'hero sopra (`renderHero` 786: saluto -> icona attività -> anello/pomodoro). Con layout `calm` la colonna destra scende di 76 px (style.css:1017), quindi "Adesso" resta in alto a sinistra. Non è una barra fissa: scorre con la pagina. Se `nowAdvice` torna null, la carta non c'è.

## 3. Elementi interattivi per schermata (stime)
- Giorno: fissi in testa 3 (calendario, annulla se c'è, impostazioni) + barra in basso 1 (+) (textarea/mic/invia compaiono aprendo la barra). Poi per carta: task = carta + check (2), evento = 1, osservazione = chiudi + 1-2 azioni, "Adesso" = carta + bottone, hero = 1-2, pila concluse 1-2. Tipico 3 task+1 evento+Adesso+1 osservazione = ~20; giornata piena ~25-30. Azioni primarie: 1 vera (il bottone in "Adesso") ma altre 3-4 equivalenti (check, hero, +).
- Calendario: ~6 chip mese + una cella per giorno (~180 celle `.cd`) + riepilogo + oggi + chiudi: 1 azione primaria (tocca un giorno).
- Editor: molti (titolo, chip durata/giorno/ora/energia/progetto, stepper, lista, foto, Fatto/Avvia/Domani/Elimina): ~15-20, primaria Salva/Fatto/Avvia.
- Riepilogo: ~5 + domanda; Impostazioni: lista lunga (>40 controlli).

## 4. Tocchi per le 3 azioni frequenti
- Avviare: 1 tocco su "Avvia" in "Adesso" (`[data-adv]` -> `startFocusFor`, app.js:2461/927) o sull'icona hero (`data-hero=start`, 986). Dall'altra carta: tocca carta -> sheet -> Avvia = 2 (`data-sheet=start`, 2616). Pomodoro: +1 tocco su "Avvia" in `#focus-ctl` (`focusAction go`, 961).
- Finire: 1 tocco sul check della carta (`data-check`, 2440 -> `quickOp complete`, 1778) o sul bottone "Adesso" tipo complete. Con timer in corso: tocca anello (apre controlli, 988) -> Termina -> Fatta = 3 tocchi (`focusAction end` poi `done`, 966-969). Il passo "Fatta" è l'unico che registra i minuti veri. Annullo via toast (5 s) o `#undo-btn`.
- Spostare: nessun trascinamento (il drag della carta non cambia il piano, motion.js:80). "Sposta a domani": 1 tocco solo per carte "non entra" (`data-act2=move`, 2457); altrimenti carta -> sheet -> "Domani" (`quickOp move`, 2618) = 2 tocchi; altra data: sheet -> chip data -> scelta -> salva = 3-4; oppure scrivere a Tempo (AI/parser) = digitare. Nessun spostamento di orario per trascinamento.

## 5. Gesti
| Gesto | Dove | Affordance / alternativa |
|---|---|---|
| Swipe orizzontale >=70 px | giorno, `#day-scroll` (app.js:1075, `track` 1058) | nessuna affordance visibile; alternativa: calendario -> tocco su giorno |
| Pizzico dentro/fuori | giorno<->calendario (`bindPinch` 1157; blocca `gesturestart`) | nessuna affordance; alternative: bottone calendario in alto (`#to-overview`) e `#ov-today` / tocco giorno |
| Trascina giù | editor (1093-1100; chiude senza salvare) | maniglia/anteprima, ma c'è Esc e pulsante `data-sheet=close` |
| Bordo sinistro -> destra | riepilogo (1103) | c'è `#sum-close` |
| Pressione lunga 300 ms + trascina | carte (motion.js:105-150, `LIFT_MS`) | solo effetto estetico, non cambia il piano; vibrazione 8 ms; nessuna alternativa necessaria ma crea aspettativa di riordino |
| Tilt al tocco | carte (motion.js:62-70) | decorativo |
| Trascina sull'arco | pomodoro (app.js:1000-1004) | alternativa: chip minuti `data-fmin` |
| `contextmenu` bloccato sulle carte | motion.js:160 | - |
| Tastiera: Invio/Spazio sulle carte (2472), Esc a cascata (2478) | | ok |
Rischio: swipe e pizzico sono le uniche vie rapide giorno/mese, senza segnaletica.

## 6. Prestazioni (iPhone di 3 anni)
- Timer: `setInterval(tick,30000)` (app.js:2818) + `setInterval` sync 5 min solo se visibile (2897) + `setTimeout` ricorsivo 1 s SOLO con timer attivo (910), via `visibilitychange` ripreso (1005, 2819). Nessun `requestAnimationFrame` continuo: rAF solo a richiesta (`glowSoon` motion.js:12, scroll hero 2496).
- Ogni 30 s, `tick` fa: `refreshToday` (scheduler.js:383) = ricalcola solo OGGI (planDays 1 giorno) e confronta una firma; se cambia, `replan()` completo; poi `save(state)` (JSON.stringify di tutto lo stato) e `renderDayView` -> `col.innerHTML = html` per l'intero collage (app.js:~672) con FLIP (`flipCapture/flipPlay`) e `fillImages`. È un re-render completo ogni 30 s anche se nulla è cambiato (nessun diff/chiave per saltarlo, a differenza di `sceneKey`). Se in calendario: `renderCalendar` ricostruisce l'intero HTML di ~6 mesi di celle (`MONTHS`).
- `motion.js`: niente blob in JS. Lo sfondo `.bg` ha 3 `<i>` giganti (100-120 vw) con gradiente radiale (non `filter: blur`), `will-change: transform` e animazioni `d1/d2/d3` da 24-32 s `infinite alternate` (style.css:71-75): sempre accese. `updateGlow` (motion.js:40) fa `getComputedStyle` + `getBoundingClientRect` su tutte le `.pc` a ogni `glowSoon` (dopo ogni render). Transizione `--c` 1,6 s (6 s con tema attività, 769/863): richiede `@property`.
- Reduced motion: CSS globale azzera durata/iterazioni (style.css:513-516, 1089); in JS `reduce()` protegge FLIP/bump (motion.js:166-218) e lo zoom dell'editor (app.js:1712). NON protetti: `navigator.vibrate`, `card.animate` del sheet è condizionato da `zoom`; il timeout di rimozione classi resta. Le animazioni `.bg` non sono messe in pausa a pagina nascosta (il browser le sospende da solo in background su iOS, ma nulla le ferma con sheet/riepilogo aperti sopra).
- `backdrop-filter`: 11 occorrenze in style.css (righe 88, 196, 354, 404, 436, 490, 584 (=none), 606, 675, 827, 917) -> ~10 attive, incluse barra in basso (354, blur 24 px), pulsanti `.pill-btn`, `.fbtn`, input, sheet backdrop. `filter: blur`: 13 righe contano il grep, ma reali sono `.blob::after` blur 26 px (211, animata `blob` 7 s infinite) e 2 keyframes di ingresso (102, 871: blur 8/12 px); gli altri match sono `backdrop-filter`. Costo alto su GPU vecchie soprattutto sopra lo sfondo animato.
- Animazioni infinite oltre lo sfondo: `.blob` 7 s (207), `breathe` icona hero 7 s (870), `ring-spin` 120 s (891), `twinkle` anello (897), `gTide` 12 s (339), `.adv-dot` (439), recPulse, bounce.
- localStorage: `save()` store.js:214 ad ogni `commit`, ad ogni `tick` (30 s) e ad ogni cambio di osservazioni; sincrono, stringify dell'intero stato; chat tagliata a 200 messaggi. Quota: try/catch, libera `UNDO_KEY` e riprova, poi evento `tempo:save-failed` (store.js:214-231); annulla su disco solo 3 voci <=300k caratteri (store.js:~238). Archivio >60 giorni in IndexedDB (`maybeArchive`). Nessun debounce: il `save` del tick avviene anche se non cambia nulla.

## 7. Accessibilità
- aria: 94 occorrenze in app.js, 34 in index.html: `aria-label` su quasi tutti i bottoni icona, `aria-pressed` sul check, `role="progressbar"` in "Adesso", `role="radiogroup"/radio` nei chip minuti, `aria-live="polite"` su "Adesso", `aria-expanded` su pila e +, carte `role="button" tabindex=0` con handler Invio/Spazio (2472). Widget con `widgetLabel` (genui.js:302) per screen reader. DESIGN-API.md sez. WCAG 2.1 AA (283).
- Focus nei pannelli: `inert` sul fondo per riepilogo/recap/onboarding (1224, 1344, 1827); editor (`#sheet`, `role=dialog aria-modal`) NON mette `inert` sul fondo e non riporta il focus all'elemento che l'ha aperto alla chiusura (`closeSheet` 1723: nessun restore); il focus iniziale sul titolo c'è solo per le nuove attività (1550). Nessun focus trap esplicito. Esc chiude a cascata (2478).
- Reduced motion: vedi punto 6; copertura CSS buona, JS parziale ma coerente.
- Tema chiaro/scuro: `prefers-color-scheme` + override `document.documentElement.dataset.theme` ('light'; motion.js:37 lo legge). `themes.js` NON gestisce il tema chiaro/scuro: è il catalogo di icone/colori per tipo di attività (`themeOf`, tool timer/pomodoro). Il tema chiaro/scuro sta in CSS (variabili) e nelle impostazioni.

## 8. Struttura di app.js e punto d'innesto
Monolite di 2922 righe, moduli ES, stato in variabili di modulo (`state`, `plan`, `mode`, `selDay`, `focusOpen`, `heroKey`). Cuciture già presenti per "stato -> layout":
1. `dayModel()` (app.js:563) = dati puri; `vm.today(...).status` e `genui.moodOf` = classificazione dello stato.
2. `currentScene(v)` (675) + `applyScene(sc)` (684): UNICO punto in cui lo stato del giorno diventa attributi di layout (`data-layout`, `data-mood`). È il punto naturale dove inserire la mappa 6 stati -> composizione.
3. `renderDayView` (591) è già a sezioni numerate (0 bentornato, 1 Adesso, 1b widget scena, 2 osservazioni, 3 carte): per cambiare l'ordine/presenza basta ricevere una lista ordinata di "slot" da `sceneFor` invece di costruire sempre nella stessa sequenza; `cardHtml` (497) e `sceneCardHtml` (698) sono già il "catalogo" di componenti.
4. `renderHero` (786) = zona sopra "Adesso" già guidata da una modalità (`greet|icon|ring|pomo`).
Mancano: (a) separazione tra costruzione dell'HTML e selezione (tutto in `renderDayView`); (b) un diff/early-exit per non ridisegnare ogni 30 s; (c) la divulgazione progressiva vuoto->adesso->giorno->mese esiste solo come due modi (`mode` day/overview) con pizzico, non come progressione per densità.
Non ricostruire: scene/umori/catalogo widget/sanitizzazione (genui.js), contratto dati (viewmodel.js), tema per attività (themes.js), focus (focus.js).
Ricordare (CLAUDE.md): ogni modifica a `tempo/` richiede di alzare `VERSION` in `sw.js` (ora `tempo-v35`).
