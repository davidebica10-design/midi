# Tempo per iPhone, iPad, Mac e CarPlay

L'app web di Tempo (`../tempo`) dentro un guscio nativo [Capacitor](https://capacitorjs.com), più il codice Swift per le cose che una PWA non può fare: widget, Live Activity nell'isola dinamica, Siri e Comandi rapidi, promemoria locali e CarPlay.

> **Stato:** il codice JavaScript è provato (test e browser). Il codice Swift in `ios-src/` è scritto ma **non è stato compilato**: serve un Mac con Xcode. Aspettati qualche errore di compilazione da sistemare al primo avvio.

## Cosa serve

- Un Mac con **Xcode 26** o successivo (da aprile 2026 l'App Store accetta solo build fatte con Xcode 26).
- Un account **Apple Developer** (99 € l'anno) per provare su iPhone vero, TestFlight e App Store.
- Node 20 o successivo.

## Come funziona

```
tempo/ (app web, la stessa della PWA)  ──copy-web──►  native/www  ──cap sync──►  ios/App (Xcode)
                                                                                    │
js/native.js ── plugin TempoBridge (Swift) ──► App Group condiviso ──► widget, Siri, CarPlay
                                                     ▲
                                  Tempo Cloud (facoltativo) ── risposte aggiornate anche ad app chiusa
```

L'app web non cambia: `js/native.js` riconosce di essere dentro l'app nativa e passa a Swift cosa fare adesso (snapshot), i colori della scena, il timer in corso e i promemoria.

## Passi

### 1. Installa e crea il progetto iOS

```sh
cd native
npm install
npm run ios:add      # copia l'app web, crea ios/ e copia i sorgenti Swift
npm run ios:open     # apre Xcode
```

Cambia `appId` in `capacitor.config.json` (es. `com.tuonome.tempo`) **prima** di `ios:add`, e lo stesso valore nel gruppo di app in `ios-src/Shared/TempoShared.swift` (`group.<appId>`).

### 2. Registra il plugin

In `App/App/Base.lproj/Main.storyboard` seleziona il *Bridge View Controller* → Identity inspector → Class: `MainViewController`. Aggiungi al target **App** i file copiati in `App/App/Tempo/` (App, Shared, CarPlay).

### 3. Capacità del target App

*Signing & Capabilities* → **+ Capability**:
- **App Groups**: `group.<appId>`
- **Push Notifications** non serve (i promemoria sono locali).

In `Info.plist` del target App:

| Chiave | Valore |
|---|---|
| `NSSupportsLiveActivities` | YES |
| `NSSpeechRecognitionUsageDescription` | «Per capire cosa dici a Tempo in auto.» |
| `NSMicrophoneUsageDescription` | «Per parlare con Tempo in auto.» |
| `CFBundleURLTypes` | schema `tempo` (per i tocchi su widget e Live Activity) |
| `CFBundleDevelopmentRegion` | `it` (le frasi di Siri sono in italiano) |

### 4. Widget Extension

*File → New → Target → Widget Extension*, nome **TempoWidgets**, spunta *Include Live Activity*, poi cancella i file generati e aggiungi al target quelli in `ios/App/TempoWidgets/` (`TempoWidgets.swift` e `Shared/TempoShared.swift`). Anche qui: capacità **App Groups** con lo stesso gruppo.

`TempoShared.swift` deve stare in **entrambi** i target (App e TempoWidgets): contiene lo snapshot, gli attributi della Live Activity e le chiamate a Tempo Cloud.

### 5. CarPlay (facoltativo, serve il permesso di Apple)

Da iOS 26.4 CarPlay ha la categoria **app conversazionali a voce** ([MacRumors](https://www.macrumors.com/2026/02/18/ios-26-4-carplay-support/)). Si richiede il permesso dal portale sviluppatori (*CarPlay entitlement request*); Apple lo valuta caso per caso. Regole della categoria: voce come interazione principale, schermata di controllo vocale mentre ascolta, al massimo quattro azioni, niente testo o immagini come risposta ([AppleInsider](https://appleinsider.com/articles/26/02/18/ai-agents-are-coming-to-carplay-but-theyre-not-getting-the-keys)).

Quando il permesso arriva:
1. aggiungi l'entitlement CarPlay al file `.entitlements` (il nome esatto lo indica Apple con l'approvazione);
2. in `Info.plist` aggiungi `UIApplicationSceneManifest` con due ruoli:
   - `UIWindowSceneSessionRoleApplication` → classe `$(PRODUCT_MODULE_NAME).SceneDelegate`, storyboard `Main`;
   - `CPTemplateApplicationSceneSessionRoleApplication` → classe `$(PRODUCT_MODULE_NAME).CarPlaySceneDelegate`.
3. controlla con la *CarPlay Developer Guide* aggiornata quali template sono ammessi per la categoria (in `CarPlaySceneDelegate.swift` sono usati `CPListTemplate` e `CPVoiceControlTemplate`).

**Senza permesso funziona comunque**: in auto Siri esegue le App Shortcuts di Tempo («Ehi Siri, cosa faccio adesso con Tempo», «Ehi Siri, dì a Tempo…»). Le definisce `TempoIntents.swift` e non richiedono permessi speciali.

### 6. Mac

- **Subito, senza lavoro in più:** su Mac con Apple silicon l'app per iPhone e iPad gira così com'è. In App Store Connect lascia attiva la disponibilità su Mac.
- **Sul web:** in Safari su macOS, *File → Aggiungi al Dock* installa la PWA.
- **Dagli assistenti AI:** Claude Desktop e gli altri client MCP parlano con Tempo tramite Tempo Cloud (`cloud/README.md`).
- Una versione Mac Catalyst o SwiftUI dedicata (barra dei menu, finestra sempre in primo piano) è un passo successivo: il codice condiviso è già separato.

### 7. Prova e pubblica

```sh
npm run ios:sync     # dopo ogni modifica all'app web
```

Prova su un iPhone vero: Live Activity, widget, Siri e trascinamento delle carte non si verificano bene nel simulatore. Poi *Product → Archive* → TestFlight. Prima dell'App Store vedi `../tempo/APP-STORE.md` (privacy, cancellazione dell'account, schermate).

## File

| File | Target | Cosa fa |
|---|---|---|
| `ios-src/Shared/TempoShared.swift` | App + Widget | Gruppo di app, snapshot, Live Activity, Tempo Cloud, colori, icone |
| `ios-src/App/TempoBridgePlugin.swift` | App | Plugin Capacitor: snapshot, scena, Live Activity, promemoria, richieste in coda |
| `ios-src/App/MainViewController.swift` | App | Registra il plugin |
| `ios-src/App/TempoIntents.swift` | App | Siri e Comandi rapidi: «Cosa faccio adesso», «Dì a Tempo», «Il mio mese» |
| `ios-src/App/SceneDelegate.swift` | App | Finestra principale quando l'app usa le scene (CarPlay) |
| `ios-src/CarPlay/CarPlaySceneDelegate.swift` | App | CarPlay a voce: adesso, la giornata, parla con Tempo |
| `ios-src/Widgets/TempoWidgets.swift` | Widget | Widget «Adesso» (Home e schermata di blocco) e Live Activity del timer |
| `scripts/copy-web.mjs` | — | Copia l'app web in `www/` |
| `scripts/install-swift.mjs` | — | Copia i sorgenti Swift nel progetto Xcode |

## Limiti noti

- **Niente finestra libera sopra le altre app su iPhone**: la strada ufficiale è l'isola dinamica (Live Activity), già usata. Il trucco del Picture in Picture rischia il rifiuto.
- **Focus che blocca le app**: richiede le API Screen Time e un permesso speciale di Apple. Non è incluso: va chiesto subito, i tempi di approvazione non dipendono da voi.
- **WebGPU nel WKWebView**: il modello AI locale (WebLLM) potrebbe non funzionare dentro l'app nativa; Gemini online sì.
- I promemoria restano al massimo uno o due al giorno e sono spenti finché non li accendi nell'app.
