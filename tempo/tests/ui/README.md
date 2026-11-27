# Prova nel browser degli stati del giorno

`stati.mjs` apre Tempo in un telefono simulato (390x844, chiaro e scuro), con dati inventati e orologio fisso, e controlla i sei stati (vuoto, prima, in corso, piena, sera, focus): posizione di «Adesso», carte in vista, appiglio «Altre N», un solo bottone primario, controlli da 44 px, testi da 12 px, foglio con `inert` e focus, movimento ridotto.

La barra di scrittura (`#composer`) e le tessere compatte (`.pc.compact`) sono provate negli stessi sei stati, in chiaro e scuro: barra visibile senza toccare nulla, con nome accessibile, alta almeno 44 px, che non copre l'ultima tessera, l'appiglio «Altre N» né la pila delle concluse (anche in fondo alla pagina); `inert` con il foglio o la presentazione aperti; raggiungibile a 320 px; invio di una frase con il parser locale e zero richieste di rete. Tessere: altezza al massimo 100 px, «Adesso» la più alta, tipo nel nome accessibile (non solo nel colore), spunta da 44x44 che conclude con un tocco senza aprire il foglio, tocco sul corpo che lo apre, titolo lungo che non esce dai bordi.

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

## Prova delle proposte tra due persone

`inviti.mjs` apre due contesti con archivio separato e fuso diverso: Anna (Europe/Rome) e Bruno (Asia/Tokyo), stesso istante fisso (11 novembre 2026, 10:00 a Roma = 18:00 a Tokyo). `navigator.share` e gli appunti sono finti e catturano il testo; ogni richiesta fuori da 127.0.0.1 è fermata e contata; gli identificatori sono fissi.

Scenari: 1 proporre dalla scheda (messaggio leggibile con codice, piano intatto, «in attesa di risposta»), 2 proporre dalla barra (nel piano solo dopo Condividi/Copia, condivisione annullata, frasi senza giorno o ora), 3 incollare (nome, orario nel fuso di chi riceve, «Ci sta» o la sovrapposizione, `tempo.v1` identico, niente rete), 4 Accetta con Annulla e risposta, 5 «Proponi altro» (fasce libere, ai 15 minuti, nessun titolo degli altri impegni nella risposta), 6 «Non riesco» e «Togli dal piano» (anche con l'impegno cambiato nel frattempo), 7 link `#invito=` anche durante la presentazione, 8 testi ostili o rovinati (codice troncato, versione, data passata, 6 kB, HTML nel titolo, due volte, risposta sconosciuta), 9 archivio (massimo 50 voci, valori rovinati, cosa contiene la copia di sicurezza).

```
cd tempo
node tests/ui/inviti.mjs             # esce con 1 se un controllo fallisce
node tests/ui/inviti.mjs --solo 5    # un solo scenario
```

Come gli altri: fuori da `npm test`, Playwright cercato a runtime, «saltato» con uscita 0 se manca. Il comportamento puro (codifica, fusi, adattamento al piano) è già in `tests/invite.test.js`.
