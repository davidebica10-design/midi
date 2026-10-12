# CLM-8B per Tempo

[CLM-8B](https://huggingface.co/Contrastive-LM/CLM-v0.1-8B) (Stanford e NVIDIA, Apache 2.0) è un modello decisionale: date uno stato e delle azioni possibili, dice quale azione gli somiglia di più, senza scrivere testo. In Tempo sceglie **solo tra opzioni che l'app ha già calcolato e validato** (oggi: quale obiettivo dà il tono alla schermata). Le regole dell'app restano la base: il risultato di CLM si mescola con le regole e conta solo se è abbastanza sicuro; se il server non risponde in 2,5 secondi, decidono le regole.

Non serve scrivere nessun adattatore: `clm-serve` (il pacchetto ufficiale) espone già l'API che Tempo usa, `POST /v1/systemone` con una domanda di tipo `choice`. Fonte: [README del repository](https://github.com/Contrastive-LM/CLM), sezione «API Reference».

## Cosa serve

- Una **GPU** per l'encoder Qwen3-8B (gli autori mostrano un server con una RTX 4090). Per i pesi in bf16 contano circa 16 GB di memoria GPU: è una mia stima, non un dato del README.
- `clm-serve` stesso gira su CPU (la testa di riferimento pesa 75 MB).
- Un indirizzo **`https`**: l'app web gira su https e il browser blocca le chiamate a server `http` (anche il CSP di Tempo lo vieta). Il server `http://IP:8700` va quindi esposto con un tunnel o un proxy HTTPS (per esempio Cloudflare Tunnel o Caddy). Non l'ho provato.

## Avvio (dal README ufficiale)

```sh
pip install contrastive-lm

# 1. l'encoder (Qwen3-8B), sulla GPU
vllm serve Qwen/Qwen3-8B --served-model-name qwen3-8b --runner pooling --max-model-len 2048 --port 8090 &

# 2. l'API di CLM su :8700 (scarica la testa di riferimento al primo avvio)
CLM_API_KEY="una-chiave-lunga-e-casuale" clm-serve --cors
```

`--cors` serve perché la chiamata parte dal browser di Tempo (altrimenti il browser la blocca). Il README avverte che con `--cors` l'API accetta richieste da qualsiasi pagina: per questo metti sempre `CLM_API_KEY`.

## Collegarlo a Tempo

⋯ → **Decisioni** → *Chi sceglie*: **CLM-8B** → indirizzo `https://…` del tuo server → la chiave → **Prova**. Se funziona vedi «✓ clm: …» con la percentuale; se no, il motivo (per esempio «timeout»), e nel frattempo decidono le regole.

## Cosa manda Tempo

```json
POST /v1/systemone
{
  "state": "Adesso: 2026-10-12 21:40\nOggi: Beat 02, Mix 01 · liberi 95 min",
  "model": "clm-latest",
  "questions": {
    "decisione": {
      "type": "choice",
      "instructions": "Quale obiettivo deve dare il tono alla schermata adesso?",
      "criteria": { "g_ep": "Far uscire l'EP (scadenza 2026-11-30): 1 di 19 sessioni fatte, 2 oggi",
                    "g_esame": "Esame di diritto (scadenza 2026-10-20): 0 di 6 sessioni fatte" }
    }
  }
}
```

La risposta contiene `answers.decisione.probabilities`, una probabilità per ogni id. Nello stato va solo il titolo delle attività e l'orario, mai note o dati personali.

## Alternative senza GPU

In ⋯ → Decisioni ci sono due motori già pronti che non richiedono di gestire un server: gli **embeddings di NVIDIA NIM o di Gemini** (stessa idea con un modello generico) e un **modello di chat** (Nemotron su NIM, Gemini) a cui si chiede di scegliere un id tra quelli dati. Per questo tipo di scelta, con poche opzioni, la differenza con CLM è probabilmente piccola: CLM è addestrato su domande-risposte e traiettorie di agenti, e il vantaggio dichiarato è la velocità con molte azioni candidate. Non l'ho misurato su Tempo.
