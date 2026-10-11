# Tempo sull'App Store: cosa lo rende competitivo

Cosa c'è già nel codice, cosa manca e come arrivare all'App Store con le carte giuste. Le scelte seguono i principi di Tempo: l'AI propone, il codice decide; niente gamification; al massimo 2 osservazioni al giorno; ogni modifica si annulla.

## La promessa

**«Parla con il tuo tempo.»** Dici cosa vuoi ottenere; Tempo lo trasforma in sessioni nei buchi liberi della settimana, ti dice una sola cosa da fare adesso e impara quanto ti serve davvero. La schermata cambia forma con quello che stai facendo.

Primo pubblico: chi porta avanti un **progetto creativo accanto a un lavoro** (un EP, un portfolio, una tesi). È la verticale indicata nella critica del 10 ottobre: Apple non farà una pianificazione opinionata su settimane legata a un mestiere.

## Le caratteristiche che contano, e dove sono

| Caratteristica | Perché conta | Dove |
|---|---|---|
| **Stati del tempo (UI generativa controllata)** | La schermata cambia con il momento (libera, prima di un impegno, attività in corso, giornata piena, sera, focus) e con il tipo di obiettivo (uscita musicale, esame, gara, viaggio, trasloco, lancio, evento). Nessun concorrente unisce «cosa fare adesso» e un ambiente che cambia di conseguenza | `js/genui.js`, `DESIGN-API.md` §6 |
| **Il tempo fuori dall'app** | Widget «Adesso» su Home e schermata di blocco, Live Activity del timer nell'isola dinamica: la ragione per cui si guarda Tempo ogni giorno | `native/ios-src/Widgets` |
| **Siri, Comandi rapidi, CarPlay** | «Ehi Siri, cosa faccio adesso con Tempo», «Dì a Tempo…»: anche in auto, anche dal Mac | `native/ios-src/App/TempoIntents.swift`, `cloud/` |
| **Un account, tutti i dispositivi** | iPhone, iPad, Mac (Apple silicon) e web con lo stesso tempo; cancellazione dell'account dall'app | `cloud/`, `js/cloud.js` |
| **Tempo dentro le AI** | Server MCP: Claude e gli altri assistenti leggono il tuo tempo e propongono modifiche, ma decide il motore di Tempo | `cloud/src/mcp.js` |
| **Il tuo mese** | Il racconto del mese, onesto e condivisibile (come i riepiloghi annuali che le persone postano), scritto da Gemini con la chiave dell'utente o dal codice | `js/recap.js` |
| **Chiacchiere col tempo** | Una conversazione con il proprio tempo, con i numeri veri del mese | `js/recap.js`, «Il tuo mese» |
| **Memoria leggibile** | «Cosa ho imparato»: durate vere, fasce in cui rendi; tutto spegnibile | `js/learn.js` |
| **Decisioni verificabili** | Un modello decisionale (CLM-8B, embeddings NVIDIA/Gemini, Nemotron) sceglie solo tra opzioni valide; se non risponde decidono le regole | `js/decide.js` |
| **Funziona senza AI e offline** | Il parser capisce frasi lunghe; scheduler e carte non dipendono dalla rete | `js/parse.js`, `js/scheduler.js` |

Il nucleo difficile da copiare resta quello indicato nei documenti di Tempo: il linguaggio visivo coerente, il focus che impara, i dati accumulati con il consenso. Le singole funzioni si copiano; la grammatica degli stati no.

## Come si conquista l'attenzione di Apple

Apple sceglie le app da mettere in evidenza con una redazione: si propone l'app dalla sezione **Featuring Nominations** di App Store Connect, con almeno 3 settimane di anticipo (meglio 8–12) rispetto al lancio o all'aggiornamento ([AppTweak](https://www.apptweak.com/en/aso-blog/how-to-get-your-app-featured-on-the-app-store)). Le guide di settore citano come criteri esperienza d'uso, design, innovazione, unicità, accessibilità, localizzazione e qualità della pagina dell'app ([App Screenshot Studio](https://appscreenshotstudio.com/blog/get-featured-on-the-app-store-2026-nominations-guide)); sono fonti di terze parti, non documenti Apple.

Tiimo, iPhone App of the Year 2025, è stata premiata per la pianificazione visiva e per gli strumenti AI che trasformano gli obiettivi in passi concreti, partendo da una nicchia e dall'inclusività ([Retail Insider](https://retail-insider.com/retail-insider/2025/12/apple-names-tiimo-detail-and-essayist-among-winners-of-2025-app-store-awards-highlighting-ai-and-accessibility/), [Tiimo](https://www.tiimoapp.com/resource-hub/tiimo-winner-2025-app-store-awards)). La lezione per Tempo: una nicchia chiara, un design riconoscibile, tecnologie Apple usate bene, accessibilità curata.

Cosa presentare nella candidatura:
1. **Tecnologie Apple usate per davvero**: Live Activity, widget sulla schermata di blocco, App Intents (Siri, Spotlight, tasto Azione), CarPlay a voce, iPhone + iPad + Mac.
2. **Design**: gli stati del tempo e le transizioni a molla; un video di 30 secondi che mostra la stessa giornata che cambia forma.
3. **Accessibilità**: VoiceOver con etichette su ogni carta e widget, contrasto AA verificato, «Riduci movimento» rispettato, Dynamic Type da completare (vedi sotto).
4. **Privacy**: dati sul dispositivo, account facoltativo, dati cifrati sul server, nessun tracciamento.
5. **Un momento**: il «Il tuo mese» a inizio mese, o la stagione delle uscite discografiche.

## Coinvolgimento senza trucchi

Le app che trattengono le persone danno valore subito, tolgono attrito e danno una ragione per tornare; le notifiche funzionano solo se legate a quello che l'utente fa ([Braze](https://www.braze.com/resources/articles/mobile-app-retention-10-tip), [Pushwoosh](https://pushwoosh.com/blog/increase-user-retention-rate)). In Tempo:

| Meccanica | Come la fa Tempo | Cosa non fa |
|---|---|---|
| Valore nei primi 2 minuti | Presentazione in 5 domande → piano della settimana subito visibile, prima di confermare | Niente registrazione obbligatoria |
| Un punto di contatto al giorno fuori dall'app | Widget «Adesso», Live Activity, al massimo 1 promemoria (spento finché non lo accendi) | Niente notifiche di richiamo («ti manchiamo») |
| Una ragione per tornare | «Adesso» cambia nel corso della giornata; la scena cambia con il momento | Niente serie di giorni, punti o badge |
| Un momento da condividere | «Il tuo mese»: racconto e barra dei progetti, con «Condividi» | Niente classifiche |
| Tornare dopo una pausa | «Bentornato» archivia ciò che è vecchio, senza colpe | Niente allarmi arretrati |
| Fiducia | Ogni modifica si annulla; «Cosa ho imparato» è visibile e dimenticabile | Niente scatole nere |

## AI e costi

- **All'inizio**: ognuno usa la propria chiave **Gemini** (gratis su aistudio.google.com) o NVIDIA NIM. Le richieste corpose (riassunto del mese, «organizzami la settimana») vanno al modello più capace del servizio (`heavyComplete`); quelle semplici al modello veloce; i comandi semplici al codice.
- **Il limite** (critica del 10 ottobre): una persona normale non inserisce una chiave API. Per il pubblico serve un'AI inclusa con un tetto di costo per utente, da far passare da Tempo Cloud. È il passo successivo, insieme al prezzo.
- **Ipotesi di prezzo da provare**, non decisa: gratis con tutto sul dispositivo; *Tempo Plus* con account, AI inclusa e «Il tuo mese» scritto dall'AI, intorno ai 4,99 € al mese. Il test previsto dai documenti: 10 persone a cui chiedere 5 €; sotto le 3 si rivede verticale o acquirente.

## Prima di inviare all'App Store

- [x] Cancellazione dell'account dall'app (obbligatoria per le app con account): ⋯ → Account e dispositivi → Elimina
- [x] Account proprio (email e password): «Accedi con Apple» non è obbligatorio se non si offrono login di terze parti
- [x] Chiavi AI solo sul dispositivo; avviso che il piano gratuito di Gemini può usare i messaggi per addestrare i modelli
- [ ] Informativa sulla privacy pubblicata (URL) e «etichette privacy» in App Store Connect: email (account), contenuti dell'utente (sincronizzazione), nessun tracciamento
- [ ] Note per la revisione: account di prova, come provare l'AI senza chiave (modalità base), cosa fanno Siri e la Live Activity
- [ ] Compilare il progetto Swift in Xcode 26 e provarlo su iPhone vero (`native/README.md`)
- [ ] Richiesta del permesso CarPlay (app conversazionali a voce) e del permesso Screen Time, subito: i tempi dipendono da Apple
- [ ] Dynamic Type: le carte usano dimensioni fisse in px; serve una scala che segua le impostazioni di testo di iOS
- [ ] Localizzazione inglese (oggi tutto è in italiano)
- [ ] Schermate 6,9" e 13", video di anteprima, candidatura «Featuring Nominations» 3–8 settimane prima
- [ ] Tempo Cloud pubblicato (Cloudflare) e `DEFAULT_CLOUD_URL` impostato

## Ordine consigliato (con criterio per fermarsi)

Il rischio principale indicato dai documenti di Tempo resta lo stesso: continuare a costruire invece di mettere l'app davanti a persone vere.

1. **Settimane 1–2**: compilare l'app nativa, TestFlight con 20 persone che hanno un progetto creativo accanto al lavoro. Pubblicare Tempo Cloud.
2. **Settimane 3–4**: misurare chi apre l'app da solo dopo 14 giorni, chi tiene il widget o la Live Activity, quante sessioni di focus partono. **Stop se meno della metà la apre da sola dopo 14 giorni**: si torna alle interviste.
3. **Settimane 5–6**: test di pagamento (10 persone, 5 €). Solo se passa: AI inclusa, inglese, candidatura per la vetrina.

## Fonti

- [AppTweak — How to get featured on the App Store](https://www.apptweak.com/en/aso-blog/how-to-get-your-app-featured-on-the-app-store)
- [App Screenshot Studio — Get featured 2026](https://appscreenshotstudio.com/blog/get-featured-on-the-app-store-2026-nominations-guide)
- [Retail Insider — App Store Awards 2025](https://retail-insider.com/retail-insider/2025/12/apple-names-tiimo-detail-and-essayist-among-winners-of-2025-app-store-awards-highlighting-ai-and-accessibility/) · [Tiimo](https://www.tiimoapp.com/resource-hub/tiimo-winner-2025-app-store-awards)
- [Braze — Mobile app retention](https://www.braze.com/resources/articles/mobile-app-retention-10-tip) · [Pushwoosh — Retention 2026](https://pushwoosh.com/blog/increase-user-retention-rate)
- [MacRumors — CarPlay e app conversazionali (iOS 26.4)](https://www.macrumors.com/2026/02/18/ios-26-4-carplay-support/) · [AppleInsider](https://appleinsider.com/articles/26/02/18/ai-agents-are-coming-to-carplay-but-theyre-not-getting-the-keys)
- [CLM-8B su Hugging Face](https://huggingface.co/Contrastive-LM/CLM-v0.1-8B) · [GitHub](https://github.com/Contrastive-LM/CLM)
- Documenti interni: «Tempo — descrizione completa», «Tempo — il tempo che si adatta a te», «Tempo — Memoria personale», «Tempo — come funziona l'app».
