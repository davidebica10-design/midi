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
