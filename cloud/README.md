# Tempo Cloud

Il server facoltativo di Tempo: **account**, **lo stesso tempo su iPhone, Mac e web**, e un **accesso da fuori dal telefono** per Siri e Comandi rapidi (anche in auto con CarPlay), widget aggiornati ad app chiusa e assistenti AI (Claude, ChatGPT e altri client MCP).

Senza account Tempo funziona come prima: tutto sul dispositivo.

## Principi

- **Stesse regole dell'app.** Il server importa parser, scheduler e companion da `../tempo/js`: Siri e il Mac ricevono le stesse risposte del telefono. L'AI propone, il codice decide.
- **Le modifiche grandi non si fanno da fuori.** Cancellare impegni, svuotare una serata, creare un piano per un obiettivo: arrivano come proposta e si confermano sul telefono.
- **Dati cifrati.** Lo stato di ogni utente è cifrato con AES-GCM (chiave per utente derivata da `TEMPO_SECRET`). Password con PBKDF2. Le chiavi AI e le impostazioni del dispositivo non arrivano mai al server, tranne la chiave AI che l'utente sceglie esplicitamente di usare «anche da fuori» (cifrata).
- **Cancellazione vera.** `DELETE /v1/account` cancella subito account, stato, chiave AI e collegamenti (l'App Store richiede la cancellazione dall'app).

## Pubblicarlo (gratis, Cloudflare Workers)

```sh
cd cloud
npx wrangler login
npx wrangler kv namespace create TEMPO_KV          # copia l'id in wrangler.toml
openssl rand -base64 48 | npx wrangler secret put TEMPO_SECRET
npx wrangler deploy                                 # → https://tempo-cloud.<account>.workers.dev
```

Poi in `tempo/js/cloud.js` imposta `DEFAULT_CLOUD_URL` con quell'indirizzo (oppure ogni utente lo scrive in ⋯ → Account e dispositivi). Il piano gratuito di Workers regge 100.000 richieste al giorno.

Il KV di Cloudflare è «eventualmente consistente»: due salvataggi quasi simultanei da dispositivi diversi possono arrivare in ordine sbagliato per qualche secondo. Il client unisce voce per voce e non perde dati, ma per molti utenti conviene passare a D1 o Durable Objects (basta implementare `get`, `put`, `delete`).

### In locale o su un tuo server

```sh
TEMPO_SECRET=$(openssl rand -base64 48) npm run dev   # http://localhost:8787, dati in data/
npm test
```

## API

Tutte le richieste (tranne registrazione e accesso) vogliono `Authorization: Bearer <codice>`.

| Metodo | Percorso | Chi | Cosa fa |
|---|---|---|---|
| POST | `/v1/signup` | — | `{email, password (≥ 10), tz}` → `{token}` |
| POST | `/v1/login` | — | `{email, password}` → `{token}` (10 tentativi ogni 15 minuti) |
| POST | `/v1/logout` | tutti | revoca il codice usato |
| GET / DELETE | `/v1/account` | dispositivo | dati dell'account / cancellazione con `{password}` |
| PATCH | `/v1/settings` | dispositivo | `{tz}`, `{ai: {key, preset, model}}` oppure `{ai: null}` |
| GET / PUT | `/v1/state` | dispositivo | stato con revisione; `PUT {rev, state}` → 409 con lo stato attuale se la revisione è vecchia |
| GET / POST / DELETE | `/v1/tokens[/id]` | dispositivo | collegamenti esterni (Mac, Siri, assistenti AI), revocabili |
| GET | `/v1/now` | tutti | cosa fare adesso + prossime attività |
| GET | `/v1/today?day=YYYY-MM-DD` | tutti | la giornata |
| GET | `/v1/recap?month=YYYY-MM` | tutti | il racconto del mese |
| POST | `/v1/tell` | tutti | `{text}` (o testo semplice): «Dì a Tempo…» |
| POST | `/mcp` o `/mcp/t/<codice>` | tutti | server MCP (Streamable HTTP) |

Aggiungi `?format=text` a `now`, `today`, `recap` e `tell` per avere solo la frase: è quello che serve ai Comandi rapidi.

I codici dei **dispositivi** (`tmp_…`) leggono e scrivono lo stato completo. I **collegamenti esterni** (`tmx_…`, creati in ⋯ → Account e dispositivi → Collega) possono solo chiedere cosa fare, leggere la giornata e il mese, e dire cose a Tempo.

## Siri, Comandi rapidi e CarPlay (senza app nativa)

Funziona già con la PWA, su iPhone e Mac. Crea un collegamento nell'app, poi nell'app **Comandi**:

**«Cosa faccio adesso»**
1. *Ottieni contenuto di URL* → `https://<server>/v1/now?format=text`, Intestazioni: `Authorization` = `Bearer tmx_…`
2. *Pronuncia testo* (o *Mostra risultato*)

**«Dì a Tempo»**
1. *Dettato testo* (o *Chiedi input*)
2. *Ottieni contenuto di URL* → `https://<server>/v1/tell?format=text`, Metodo `POST`, Corpo *Testo* = testo dettato, stessa intestazione
3. *Pronuncia testo*

Dai al comando il nome «Cosa faccio adesso»: «Ehi Siri, cosa faccio adesso» funziona anche in auto con CarPlay, e sul Mac dalla barra dei menu. Con l'app nativa le stesse frasi sono già pronte (App Shortcuts) e i widget si aggiornano da soli.

## Assistenti AI (MCP)

Strumenti: `tempo_adesso`, `tempo_giornata`, `tempo_mese`, `tempo_dimmi` (modifica, con le stesse conferme dell'app).

**claude.ai / Claude Desktop (connettore personalizzato):** Impostazioni → Connettori → Aggiungi connettore personalizzato → URL `https://<server>/mcp/t/tmx_…`.

**Client che accettano intestazioni (es. con `mcp-remote`):**

```json
{
  "mcpServers": {
    "tempo": {
      "command": "npx",
      "args": ["mcp-remote", "https://<server>/mcp", "--header", "Authorization: Bearer tmx_…"]
    }
  }
}
```

Il codice nell'indirizzo (`/mcp/t/…`) è comodo ma finisce nei log di chi lo vede: usa un collegamento dedicato e revocalo se non serve più. I codici dei dispositivi non sono ammessi nell'indirizzo.

## Il modello decisionale (CLM-8B)

Tempo può far scegliere a un modello decisionale tra opzioni che ha già calcolato. L'app parla direttamente con `clm-serve` (il pacchetto ufficiale di [CLM-8B](https://github.com/Contrastive-LM/CLM)); qui non serve niente. Guida completa, requisiti (GPU, indirizzo https) e formato delle richieste: [`clm/README.md`](clm/README.md).

## File

| File | Cosa fa |
|---|---|
| `src/app.js` | Gestore fetch: account, token, stato, API, limiti di frequenza, CORS |
| `src/tempo.js` | Regole di Tempo lato server: adesso, giornata, mese, «Dì a Tempo», fuso orario |
| `src/mcp.js` | Server MCP |
| `src/crypto.js` | PBKDF2, AES-GCM per utente, token |
| `src/worker.js` / `src/node.js` | Avvio su Cloudflare Workers / su Node |
| `clm/README.md` | Come far girare CLM-8B e collegarlo a Tempo |
| `test/cloud.test.js` | 12 test: account, sync, conflitti, fuso orario, AI simulata, MCP, cancellazione, CORS |
