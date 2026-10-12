# Tempo per iPhone: widget, isola dinamica, Siri (e Mac, CarPlay)

L'app web di Tempo (`../tempo`) dentro un guscio nativo [Capacitor](https://capacitorjs.com), più il codice Swift per le cose che una pagina web non può fare: **widget** (Home e schermata di blocco), **Live Activity** nell'isola dinamica, **Siri e Comandi rapidi**, promemoria locali e, quando Apple dà il permesso, **CarPlay**.

> **Stato onesto.** Il progetto Xcode viene generato e configurato da uno script che ho provato su un progetto Capacitor vero (target, file, permessi, livello iOS: tutto verificato rileggendo il file di progetto). Il **codice Swift però non è mai stato compilato**: qui non c'è Xcode. Aspettati qualche errore al primo «Build»; vedi «Se non compila».

## Cosa serve

- Un **Mac con Xcode 26** (da aprile 2026 l'App Store accetta solo build fatte con Xcode 26). Se `git` o `python3` rispondono «accetta la licenza di Xcode», esegui una volta nel Terminale: `sudo xcodebuild -license accept`.
- **Node 22 o successivo** (la versione 8 di Capacitor lo richiede).
- **Ruby** con la gemma `xcodeproj`: `gem install xcodeproj` (se chiede i permessi: `sudo gem install xcodeproj`). Ruby è già su macOS.
- Un **Apple ID**. Per provare l'app sul **tuo iPhone** basta quello gratuito, ma non ho verificato se Xcode accetti la capacità «App Groups» (serve al widget) con l'account gratuito: se la rifiuta, serve l'Apple Developer Program (99 € l'anno), che serve comunque per TestFlight e App Store.
- **iOS 17 o successivo** sul telefono: è il livello minimo che lo script imposta (i widget moderni e l'isola dinamica lo richiedono).

## Come funziona

```
tempo/ (app web, la stessa della PWA) ─copy-web─► native/www ─cap─► ios/App (Xcode)
                                                                       │
js/native.js ── plugin TempoBridge (Swift) ──► gruppo di app condiviso ──► widget · Siri · Live Activity
                                                          ▲
                                       Tempo Cloud (facoltativo): risposte aggiornate ad app chiusa
```

L'app web non cambia: `js/native.js` riconosce di essere dentro l'app nativa e passa a Swift cosa fare adesso, i colori della scena, il timer in corso e i promemoria.

## Passi

```sh
git clone https://github.com/davidebica10-design/midi.git
cd midi/native
npm install
npm run ios:add          # copia l'app web, crea ios/, e configura il progetto (widget, permessi, iOS 17)
npm run ios:open         # apre Xcode
```

Prima di `ios:add` cambia, se vuoi, `appId` in `capacitor.config.json` (di partenza `app.tempo.companion`: deve essere un identificatore tuo e unico, per esempio `com.tuonome.tempo`). Il gruppo di app e il bundle id del widget ne derivano da soli.

In Xcode, **una sola cosa a mano**: per i target **App** e **TempoWidgets**, *Signing & Capabilities* → scegli il tuo **Team**. (Oppure passa il team allo script: `ruby scripts/setup-xcode.rb --team ABCDE12345`.) Poi scegli il tuo iPhone in alto e premi ▶.

### Cosa fa `scripts/setup-xcode.rb` (si può rilanciare quando vuoi)

- copia i sorgenti Swift (`ios-src/`) nel progetto e li aggiunge al target **App**;
- crea il target **TempoWidgets** (Widget Extension con Live Activity), lo incorpora nell'app e gli dà gli stessi sorgenti condivisi;
- imposta il gruppo di app `group.<appId>` (permesso «App Groups») su app e widget;
- scrive in `Info.plist`: Live Activities, microfono e riconoscimento vocale, lo schema `tempo://`, lingua di base italiana (le frasi di Siri sono in italiano);
- alza il livello minimo di iOS a 17;
- fa usare alla finestra il nostro controller, che registra il plugin;
- rilegge il progetto e stampa un riassunto: se un file manca, si ferma.

Dopo ogni modifica all'app web: `npm run ios:sync`.

## Il widget

Dopo il primo avvio dell'app: tieni premuta la Home → **+** → **Tempo** → «Adesso» (piccolo, medio, e in versione schermata di blocco). Mostra una sola cosa da fare, con il perché, nei colori della scena dell'app.

- **Senza account** usa l'ultima fotografia salvata dall'app: si aggiorna quando apri Tempo.
- **Con un account Tempo Cloud** (`../cloud/README.md`) il widget chiede al server il piano aggiornato, anche con l'app chiusa.
- **Live Activity:** premi «Inizia» su un'attività: il timer compare nell'isola dinamica e sulla schermata di blocco.
- **Siri:** «Ehi Siri, cosa faccio adesso con Tempo», «Ehi Siri, dì a Tempo…», «Il mio mese con Tempo».

## CarPlay (facoltativo, serve il permesso di Apple)

Da iOS 26.4 CarPlay ha una categoria per le **app conversazionali a voce** ([MacRumors](https://www.macrumors.com/2026/02/18/ios-26-4-carplay-support/)). Il permesso si chiede ad Apple (portale sviluppatori, richiesta dell'entitlement CarPlay) e lo valuta caso per caso. Le regole: voce come interazione principale, niente testo o immagini come risposta, al massimo quattro azioni ([AppleInsider](https://appleinsider.com/articles/26/02/18/ai-agents-are-coming-to-carplay-but-theyre-not-getting-the-keys)).

Quando arriva: `ruby scripts/setup-xcode.rb --carplay`, poi aggiungi al file `.entitlements` la chiave che Apple indica con l'approvazione. **Senza permesso funziona già Siri**: in auto le App Shortcuts non richiedono niente di speciale.

## Se non compila

Il Swift non è stato mai compilato, quindi è probabile che il primo «Build» dia qualche errore. Il modo più veloce:

1. In Xcode, *Product → Build* (⌘B). Se ci sono errori, aprili nella barra di sinistra (icona ⚠︎/⊗) e copiali.
2. Dalla stessa cartella `midi/native`, apri una sessione di Claude Code sul Mac e incolla: *«Compila con `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' build`, correggi gli errori nei file di `ios-src/` (non toccare `ios/`: lo rigenera lo script), rilancia `ruby scripts/setup-xcode.rb` e ricompila finché passa.»*

Correggere sempre in `ios-src/`, non dentro `ios/`: lo script ricopia i sorgenti a ogni esecuzione.

## File

| File | Target | Cosa fa |
|---|---|---|
| `ios-src/Shared/TempoShared.swift` | App + Widget | Gruppo di app, fotografia del giorno, Live Activity, chiamate a Tempo Cloud, colori, icone |
| `ios-src/App/TempoBridgePlugin.swift` | App | Plugin Capacitor: fotografia, scena, Live Activity, promemoria, richieste in coda |
| `ios-src/App/MainViewController.swift` | App | Registra il plugin |
| `ios-src/App/TempoIntents.swift` | App | Siri e Comandi rapidi |
| `ios-src/Widgets/TempoWidgets.swift` | Widget | Widget «Adesso» e Live Activity del timer |
| `ios-src/CarPlay/CarPlaySceneDelegate.swift` | App (con `--carplay`) | CarPlay a voce |
| `scripts/copy-web.mjs` | — | Copia l'app web in `www/` |
| `scripts/setup-xcode.rb` | — | Configura il progetto Xcode (rilanciabile) |

## Limiti noti

- **Niente finestra libera sopra le altre app su iPhone**: la strada ufficiale è l'isola dinamica, già usata. Il trucco del Picture in Picture rischia il rifiuto dall'App Store.
- **Focus che blocca le app**: richiede le API Screen Time e un permesso speciale di Apple. Non incluso: va chiesto subito, i tempi non dipendono da te.
- **Modello AI sul telefono (WebGPU)**: dentro l'app nativa potrebbe non funzionare; Gemini online sì.
- I promemoria sono spenti finché non li accendi in ⋯ → Aspetto, e sono al massimo uno al giorno.
- **Mac:** su Mac con Apple silicon l'app per iPhone gira così com'è (disponibilità in App Store Connect). In alternativa, in Safari: *File → Aggiungi al Dock* installa la PWA. Una versione Mac dedicata è un passo successivo.
