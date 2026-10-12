# Tempo — come si lavora in questo repository

Repository **pubblico**. `tempo/` è la PWA pubblicata da GitHub Pages **da `main`**: ogni modifica unita su `main` arriva sul telefono dell'utente. Lavora su un branch, apri una pull request, unisci solo quando l'utente lo chiede.

## Struttura

| Cartella | Cos'è | Come si prova |
|---|---|---|
| `tempo/` | App web (JavaScript puro, moduli ES, **nessuna dipendenza, nessuna compilazione**) | `cd tempo && npm test` (node:test) |
| `cloud/` | Tempo Cloud: account, sync, API, MCP. Importa parser e scheduler da `tempo/js` | `cd cloud && npm test` |
| `native/` | Guscio Capacitor + Swift (widget, Siri). **Mai compilato**: serve Xcode | non provabile qui; correggere in `native/ios-src/`, mai in `native/ios/` |
| `index.html` (radice) | Un'altra pagina, non è Tempo: non toccarla | — |

## Principi di prodotto (non negoziabili)

- **L'AI propone, il codice decide.** Orari, durate e vincoli li calcola lo scheduler. Tutto ciò che arriva dall'AI passa da `sanitizeOps` (`tempo/js/store.js`); un'operazione nuova va in `ACTIONS`/`FIELD`, in `applyOps`, in `understoodOf`, nello schema di Claude (`ai.js`) e nel prompt dei modelli open (`ai-open.js`).
- **Ogni modifica si annulla; quelle grandi chiedono conferma.** Niente dati persi: se cambia la forma dei dati, alza `SCHEMA` e scrivi la migrazione.
- **Niente gamification**: né punteggi né serie di giorni. Al massimo 2 osservazioni al giorno, ognuna con il suo perché.
- **Funziona senza AI e offline** (parser in `parse.js`).
- **Testi**: italiano, seconda persona, frasi brevi, senza punti esclamativi.
- **Sicurezza**: ogni testo che viene da fuori (AI, backup, sincronizzazione, input) si scrive nella pagina con `esc()` o come testo; le chiavi API non vanno mai nel repository né nel server (tranne la scelta esplicita «usa la mia chiave anche da fuori», cifrata). La CSP in `tempo/index.html` limita le connessioni: un nuovo servizio esterno la richiede aggiornata.
- **Dopo ogni modifica a file di `tempo/`**: alza `VERSION` in `tempo/sw.js`; un file nuovo va in `SHELL`.
- **Nessuna dipendenza nuova** senza un motivo scritto e l'ok dell'utente.

## Gli agenti (`.claude/agents/`)

| Agente | Fa | Non fa |
|---|---|---|
| `developer` | implementa il lavoro approvato, esegue i test, aggiorna la documentazione | decisioni di prodotto; test «per far passare» il proprio codice |
| `qa-engineer` | scrive test **ripetibili** (node:test) e li esegue; un bug diventa un test rosso | tocca il codice di prodotto |
| `code-reviewer` | rilegge la modifica (`git diff`), massimo 15 punti con gravità | applica correzioni: le propone |
| `product-strategist` | concorrenti, clienti, valore e costo di una funzione, ipotesi vs dati, esperimenti | scrive codice o file |

### Chi interviene, in base a cosa cambia (non servono mai tutti e quattro)

| Livello | Quando | Percorso |
|---|---|---|
| **T0** | testo, stile, documenti, correzione ovvia (≲ 20 righe) | `developer` → `npm test` |
| **T1** | bug o rifacimento di un comportamento esistente | `developer` → `qa-engineer` (prima il test rosso, poi verde) → `code-reviewer` **solo se** tocca `store.js`, `scheduler.js`, `parse.js`, sincronizzazione, `cloud/`, AI, oppure supera ~150 righe |
| **T2** | funzione nuova visibile all'utente | `product-strategist` (cancello, ≤ 300 parole: **GO / VALIDA-PRIMA / NO-GO**) → `developer` → `qa-engineer` → `code-reviewer` |
| **T3** | prezzo, pubblico, canale, posizionamento, tabella di marcia | `product-strategist` → decide l'utente. Nessun codice |

Regole per spendere pochi token:
- **Il lavoro passa con una nota, non con la conversazione**: ogni agente lascia in `.claude/handoff/<nome>.md` (ignorata da git, ≤ 200 parole) cosa ha fatto, cosa ha deciso, cosa resta; il successivo la legge invece di rifare il contesto.
- **Un solo giro di disaccordo**: se due agenti non sono d'accordo, si scrive in due righe a testa e decide l'utente.
- Lo Strategist **non blocca** correzioni di errori né T0/T1; il Reviewer **non riapre** scelte di prodotto.
- Ogni agente legge solo i file che servono (`Grep` prima di `Read`); niente riletture dell'intero repository.
- Il QA ripete i test in due fusi orari: `TZ=UTC npm test` e `TZ=Asia/Tokyo npm test`.

### Cosa si scrive dove (il repository è pubblico)

Il codice e le istruzioni degli agenti vivono qui. **Analisi di mercato, prezzi, ipotesi commerciali, nomi di potenziali clienti non vanno in file del repository**: lo Strategist risponde in chat e l'utente le conserva dove vuole (un repository privato, un documento). Lo stesso per segreti e dati personali.
