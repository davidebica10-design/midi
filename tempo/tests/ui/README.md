# Prova nel browser degli stati del giorno

`stati.mjs` apre Tempo in un telefono simulato (390x844, chiaro e scuro), con dati inventati e orologio fisso, e controlla i sei stati (vuoto, prima, in corso, piena, sera, focus): posizione di «Adesso», carte in vista, appiglio «Altre N», un solo bottone primario, controlli da 44 px, testi da 12 px, foglio con `inert` e focus, movimento ridotto.

Non fa parte di `npm test`: Playwright non è una dipendenza del progetto.

```
cd tempo
node tests/ui/stati.mjs                 # esce con 1 se un controllo fallisce
node tests/ui/stati.mjs --shots /percorso/cartella   # salva anche le immagini
```

Serve Playwright con Chromium, installato per conto tuo (anche globale: `npm i -g playwright`). Se manca, lo script scrive «saltato» ed esce con 0.

Il risultato non dipende dal fuso della macchina (il browser usa Europe/Rome): prova con `TZ=UTC` e `TZ=Asia/Tokyo`.

## Prova dei guasti

`guasti.mjs` prova i momenti peggiori con dati inventati, orologio fisso e una chiave finta (ogni richiesta verso un servizio AI è intercettata): dati rotti all'avvio (copia in `tempo.v1.rotto`), import di un backup (file sbagliati, conferma con i numeri, «Annulla»), spazio pieno, sei guasti dell'AI (offline, timeout, 401, 429, 500, JSON malformato: ognuno con una frase diversa, stato intatto, frase ancora nella barra), proposta non più valida, azioni rapide con «Annulla», timer finito a app chiusa, aggiornamento con testo nella barra (usa un service worker vero e un `sw.js` che cambia), titolo di 300 caratteri in chiaro e scuro.

```
cd tempo
node tests/ui/guasti.mjs             # esce con 1 se un controllo fallisce
node tests/ui/guasti.mjs --solo 4    # un solo scenario
```

Come `stati.mjs`: fuori da `npm test`, Playwright cercato a runtime, «saltato» con uscita 0 se manca. Il controllo dei testi (niente «!», niente messaggi generici, contratto di `notice`) è invece automatico: `tests/copy.test.js`.
