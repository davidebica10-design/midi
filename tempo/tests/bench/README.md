# Banco di prova dei motori decisionali

Misura quanto un motore (Gemini, NVIDIA, CLM-8B…) si accorda con le regole di Tempo e con dei casi etichettati, e quanto è veloce. **Non è una verità assoluta**: le etichette sono un mio giudizio (`cases.mjs`), sono poche (25 scelte di instradamento, 11 di scena) e si possono cambiare.

## Cosa misura

1. **Che modello serve a un messaggio** — 40 frasi. Se il parser di Tempo le capisce da solo (15 su 40) le fa il codice, gratis e subito: non c'è niente da scegliere e non entrano nella misura. Sulle altre 25 la scelta è tra un modello **veloce** (richiesta normale) e uno **capace** (richiesta aperta o corposa).
2. **Quale obiettivo dà il tono alla schermata** — 11 situazioni. **Attenzione:** qui le regole fanno 11/11 perché ho scritto le etichette con gli stessi criteri delle regole. Serve a controllare che un modello non peggiori e a misurare la latenza, non a dire chi è più bravo.

Per ogni caso: la scelta delle sole regole, quella del **solo modello**, e quella della **combinazione** (come la userebbe l'app: il modello conta solo se è abbastanza sicuro). Poi percentuali di accordo, errori, nuovi tentativi per i limiti del piano gratuito e latenza (p50, p95, quota entro i 2,5 s oltre i quali l'app ripiega sulle regole).

## Come si lancia

```sh
cd tempo
node tests/bench/bench-decider.mjs --kind rules                          # solo regole: nessuna chiave, risposta immediata

GEMINI_API_KEY=…  node tests/bench/bench-decider.mjs --kind llm   --preset gemini   # un modello Gemini sceglie
GEMINI_API_KEY=…  node tests/bench/bench-decider.mjs --kind embed --preset gemini   # somiglianza con gli embeddings Gemini
NVIDIA_API_KEY=…  node tests/bench/bench-decider.mjs --kind llm   --preset nvidia   # Nemotron su NVIDIA NIM
CLM_API_KEY=…     node tests/bench/bench-decider.mjs --kind clm   --url https://il-tuo-clm
```

Opzioni: `--model NOME`, `--tasks route` (o `scene`), `--limit N`, `--delay MS` (pausa tra le chiamate; di partenza 4500 ms per Gemini per stare nei limiti del piano gratuito), `--timeout MS`, `--weight 0.6`. Il dettaglio di ogni caso finisce in `tests/bench/out/` (non entra nel repository).

**La chiave si legge solo dalla variabile d'ambiente: non scriverla nei comandi condivisi e non incollarla in una chat.** Una chiave Gemini gratuita si crea su aistudio.google.com/apikey.

Con il piano gratuito e la pausa di 4,5 s, le 36 chiamate durano circa 3 minuti.

## Come leggere i risultati

- Conta prima di tutto il confronto **sulle stesse frasi**: «regole sugli stessi» contro «combinazione». Se la combinazione non batte le regole, il motore non serve.
- Guarda **p95** e «entro 2,5 s»: oltre quel limite l'app ignora il modello. Per una scelta che si ripete a ogni messaggio, mezzo secondo in più si sente.
- Con 25 casi, uno scarto di 1–2 risposte è rumore, non una differenza.
- I modelli «che ragionano» (Gemini) possono essere lenti: è un dato utile, non un difetto del banco.
