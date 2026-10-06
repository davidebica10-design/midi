# Notifiche — proposta (non implementata)

Al massimo 2 notifiche al giorno, entrambe facoltative:

- **inizia**: «Alle 19:15 tocca al beat 02»;
- **stop**: «21:40. Stop, hai fatto abbastanza».

Va contro il principio attuale «nessuna notifica»: la decisione è tua.

## Il vincolo dell'iPhone

Su iOS una PWA installata (da iOS 16.4) riceve notifiche **solo tramite Web Push**, cioè inviate da un server.

- Con l'app chiusa non può farlo da sola: niente timer in background e niente notifiche locali programmate.
- Le Notification Triggers sono ferme e non esistono su Safari.
- Il service worker si sveglia solo quando arriva un push.

Quindi serve un piccolo server che, all'orario giusto, mandi il push.

## Opzione minima consigliata

Un worker gratuito (Cloudflare Workers con Cron Triggers, oppure Deno Deploy) con chiavi VAPID.

1. L'utente attiva le notifiche in ⋯ (permesso di iOS, solo dalla PWA installata).
2. L'app invia al worker:
   - l'iscrizione push (endpoint + chiavi);
   - **solo gli orari** delle prossime 48 ore, per esempio `[{ at: "2026-10-06T17:15Z", kind: "start" }, { at: "…", kind: "stop" }]`.

   Niente titoli, progetti o note. La lista si riscrive a ogni ripianificazione.
3. Il cron del worker gira ogni 5 minuti e manda un push vuoto a chi ha un orario scaduto.
4. Il service worker riceve il push e compone il testo **sul telefono**, leggendo il piano salvato in locale. Il testo non passa mai dal server.

| Voce | Valutazione |
| --- | --- |
| Costo | 0 €: il piano gratuito di Cloudflare Workers basta (100.000 richieste al giorno, cron inclusi; KV o D1 gratuiti per poche migliaia di righe). Nessun dominio necessario. |
| Privacy | Il server conosce solo un endpoint push anonimo e degli orari. Nessun contenuto, nessun account. I messaggi push sono cifrati con le chiavi dell'iscrizione. |
| Affidabilità | Ritardo fino a 5 minuti (passo del cron); iOS può raggruppare o ritardare i push con il risparmio energetico. |
| Manutenzione | Un file da circa 100 righe, chiavi VAPID come segreti del worker; va ripubblicato se cambia il formato. |
| Limiti | Funziona solo con la PWA installata nella schermata Home; se l'app non viene aperta per giorni, gli orari salvati sul server scadono e le notifiche si fermano (è voluto). |

## Alternative

| Alternativa | Pro | Contro |
| --- | --- | --- |
| **Nessuna notifica** (com'è ora) | Zero server, zero distrazioni, coerente con «niente AI fatigue» | Se non apri l'app, non sai quando iniziare |
| **Calendario**: esportare le sessioni come file `.ics` o abbonamento a un calendario | Le notifiche le fa il calendario di iOS, senza server | Il file non si aggiorna da solo quando il piano cambia; un abbonamento sempre aggiornato richiede comunque un server |
| **Comandi rapidi di iOS** (automazione all'orario che apre Tempo) | Nessun server | Da configurare a mano, orari fissi, non segue il piano |
| **App nativa** (Swift, notifiche locali) | Notifiche locali senza server, affidabili | Un'altra app da sviluppare e pubblicare; Apple Developer 99 €/anno |
| **Servizio push di terze parti** (OneSignal e simili) | Veloce da collegare | Un'azienda terza vede gli iscritti e i messaggi; contro la privacy di Tempo |

## Raccomandazione

Se vuoi le notifiche: worker gratuito con soli orari e testo composto sul telefono, disattivate di default, massimo 2 al giorno, con un interruttore unico in ⋯.

Se preferisci restare senza server: un pulsante «Aggiungi le sessioni al Calendario» (file `.ics`), da rifare quando il piano cambia.
