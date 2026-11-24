# tempo studio

PWA per producer e artisti: per ogni brano mostra **versione approvata, chi deve fare cosa e il prossimo passo**. La chat resta su WhatsApp.

Stesso impianto di Tempo (cartella sopra): JS ES modules puri, nessun build, nessuna dipendenza, dati solo sul dispositivo. Il pattern è lo stesso: chi propone (regole sulla chat, AI) manda operazioni, `store.js` le valida (`sanitizeOps`) e decide.

## Com'è fatta

- **Home (`#/`)**: un carosello di brani. Quello al centro è in primo piano: dietro c'è la sua copertina sfocata, sotto trovi fase, stato, prossimo passo, definitiva e data di uscita. In alto a sinistra ci sei tu, con il collaboratore del brano in piccolo, come nei Messaggi. I nomi sono quelli che scrivi in «con chi»: niente account.
- **Calendario (`#/cal`)**: il mese con le copertine nei giorni di uscita e un puntino sulle scadenze. Sotto ci sono le uscite del mese e i brani ancora senza data.
- **Barra in vetro** in basso: brani, calendario e + per un brano nuovo.
- **Brano (`#/t/…`)**: varianti ascoltabili. A sinistra di ognuna c'è una bandiera che la fissa come **definitiva**. La definitiva la scegli tu e la puoi togliere. L'ok è un'altra cosa: lo dà l'artista ed è legato all'impronta.

## Il giro

1. **+ bounce**: trascini un WAV/AIFF/MP3. Tempo calcola l'impronta SHA-256, la durata e la forma d'onda. Il file resta in IndexedDB. Un file uguale (stessa impronta) viene riconosciuto come duplicato.
2. **chiedi ok**: genera un link con titolo, versione e impronta dentro il frammento `#` (non arriva a nessun server). Lo mandi su WhatsApp.
3. **L'artista** apre il link dal telefono: niente account, niente app. Tocca «approvo» o «servono modifiche» e parte un messaggio WhatsApp con un codice: `tempo ✓ v3 #a1b2c3d4e5f6`.
4. **importa chat**: esporti la chat da WhatsApp (.txt o .zip di iOS) e la dai a Tempo. Il codice diventa un ok legato a *quella* impronta. Il resto della chat diventa proposte (ok a parole, richieste, impegni, scadenze, decisioni) da confermare.
5. **verifica file**: prima della consegna trascini il master: «✓ è lui», «conosciuto, non approvato» o «mai visto».

## AI (facoltativa)

Impostazioni → servizio compatibile OpenAI: Gemini (chiave gratis), Ollama in locale, OpenRouter, Groq. Legge solo il testo della chat, mai l'audio. Senza AI funzionano le regole di `chat.js`. La prima volta per ogni servizio l'app chiede conferma, perché la chat contiene messaggi di altre persone.

## Privacy

- Tutto resta sul dispositivo. Non ci sono server, account o statistiche. L'app chiede al browser di non sfrattare i dati (`navigator.storage.persist`).
- Il font IBM Plex Mono è dentro l'app (`fonts/`, licenza SIL OFL). Non parte nessuna richiesta a Google Fonts.
- I link portano nome e numero WhatsApp di chi li manda. Stanno dopo il `#`, quindi non arrivano a nessun server. L'app lo dice quando li crei.
- «Cancella tutto» elimina anche l'audio. Il backup non contiene la chiave AI.

## File

| File | Ruolo |
|---|---|
| `js/store.js` | stato (SCHEMA 2, `migrate`), validazione, operazioni, definitiva, uscite, collaboratori, annulla, demo |
| `js/chat.js` | parser export WhatsApp iOS/Android, unzip, regole di estrazione, scadenze |
| `js/share.js` | link «chiedi ok», codice di risposta, link wa.me |
| `js/hash.js` | impronta SHA-256 e confronto per prefisso |
| `js/audio.js` | IndexedDB per l'audio, durata e picchi |
| `js/ai.js` | estrazione con AI (JSON validato) |
| `js/covers.js` | copertine generative stabili per brano |
| `js/copy.js` | testi |
| `js/app.js` | interfaccia: carosello, calendario, brano con varianti, pagina artista, fogli, player |

## Sviluppo

```
npx http-server . -p 5288 -c-1
node --test tests/*.test.js
```

`?demo` carica dati finti al primo avvio. Dopo ogni rilascio alza `VERSION` in `sw.js` e aggiungi a `SHELL` i file nuovi.

## Limiti noti

- Nessun backend: l'ok torna solo quando importi la chat. L'artista non vede lo stato. Per ora non ci sono account per i collaboratori.
- L'audio non viaggia nei backup e non si sincronizza tra dispositivi.
- Le regole senza AI sono prudenti: le proposte incerte arrivano non spuntate.
