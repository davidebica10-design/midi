# Tempo — AI Time Manager

Una web app installabile (PWA) che si usa come un'app vera su iPhone: parli con l'assistente,
lui pianifica la giornata e la ripianifica quando qualcosa cambia.

## Installarla su iPhone

1. Apri in **Safari** l'indirizzo dell'app, ad esempio `https://<utente>.github.io/midi/tempo/`.
2. Tocca **Condividi** → **Aggiungi alla schermata Home** → **Aggiungi**.
3. Apri «Tempo» dalla Home: parte a schermo intero, senza barre del browser.
4. In **Memoria → Assistente AI** scegli il motore:
   - **Sul telefono · gratis**: un modello open (Qwen 2.5 / Llama 3.2) gira sull'iPhone con WebGPU (iOS 26+). Il primo avvio scarica ~1 GB, poi funziona anche offline.
   - **Online · gratis** (consigliato): Google Gemini con una chiave gratuita da aistudio.google.com/apikey, senza carta di credito. In alternativa OpenRouter o Groq. Il pulsante «Prova» verifica chiave e modello; con «Automatico» l'app sceglie il modello e passa al successivo se uno non risponde.
   - **Claude · a pagamento**: chiave API da platform.claude.com (non inclusa negli abbonamenti Claude).
   - **Base**: nessuna AI, capisce solo frasi semplici.

I dati restano sul telefono, dentro l'app installata. Da **Memoria → Dati** puoi esportare un backup.

## Com'è fatta

| File | Ruolo |
|---|---|
| `js/scheduler.js` | Motore di pianificazione deterministico: impegni fissi, priorità, scadenze, margine per imprevisti, niente attività pesanti una dopo l'altra, dipendenze, attività che slittano al giorno dopo. |
| `js/store.js` | Stato, salvataggio locale, annullamento, validazione delle modifiche proposte dall'AI. |
| `js/ai.js` | Conversazione con Claude tramite uno strumento con output strutturato (`update_plan`); modalità base senza AI. |
| `js/ai-open.js` | Modelli gratuiti: in locale con WebLLM oppure su servizi compatibili OpenAI (Gemini, OpenRouter, Groq), con scelta automatica del modello; rispondono in JSON validato dal codice. |
| `js/app.js` | Interfaccia: chat, riepilogo, timeline, scheda di modifica, memoria e impostazioni. |
| `sw.js`, `manifest.webmanifest` | Installazione e funzionamento offline. |
| `vendor/anthropic-sdk.mjs` | SDK ufficiale `@anthropic-ai/sdk` (0.131.0) impacchettato per il browser. |
| `vendor/web-llm.mjs` | `@mlc-ai/web-llm` (0.2.85) impacchettato, caricato solo se scegli il modello sul telefono. |

L'AI non è la fonte di verità: propone operazioni strutturate, il codice le valida e il motore decide gli orari.
Le modifiche importanti (cancellare impegni fissi, giornate più leggere…) chiedono conferma; tutte si possono annullare.

Dopo ogni modifica ai file, aumenta `VERSION` in `sw.js` così l'app installata si aggiorna.
