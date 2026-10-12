// Siri, Comandi rapidi, Spotlight e il tasto Azione: parlare con Tempo senza aprire l'app.
// Funzionano anche in auto: in CarPlay Siri esegue le App Shortcuts senza bisogno di permessi speciali.
// Con un account Tempo Cloud rispondono con il piano aggiornato; senza, usano l'ultimo snapshot
// dell'app e mettono in coda le richieste, che l'app esegue appena si apre.
import AppIntents

struct WhatNowIntent: AppIntent {
    static let title: LocalizedStringResource = "Cosa faccio adesso"
    static let description = IntentDescription("Tempo ti dice una sola cosa da fare adesso, con il perché.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = await TempoCloud.now()?.text ?? SharedStore.snapshot()?.spoken ?? "Apri Tempo e raccontami cosa vuoi ottenere: costruisco io la giornata."
        return .result(dialog: "\(text)")
    }
}

struct TellTempoIntent: AppIntent {
    static let title: LocalizedStringResource = "Dì a Tempo"
    static let description = IntentDescription("Aggiungi o cambia qualcosa con una frase: «domani alle 16 call con Marco», «ho finito il beat 02».")
    static let openAppWhenRun = false

    @Parameter(title: "Cosa vuoi dire", requestValueDialog: IntentDialog("Cosa vuoi dire a Tempo?"))
    var text: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        if let reply = await TempoCloud.tell(text) { return .result(dialog: "\(reply)") }
        SharedStore.queueIntent(kind: "tell", text: text)
        return .result(dialog: "Me lo segno: lo sistemo appena apri Tempo.")
    }
}

struct MonthRecapIntent: AppIntent {
    static let title: LocalizedStringResource = "Il mio mese con Tempo"
    static let description = IntentDescription("Apre il racconto del mese.")
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        SharedStore.queueIntent(kind: "recap")
        return .result()
    }
}

struct TempoShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: WhatNowIntent(), phrases: [
            "Cosa faccio adesso con \(.applicationName)",
            "\(.applicationName), cosa faccio adesso",
            "Chiedi a \(.applicationName) cosa fare",
        ], shortTitle: "Cosa faccio adesso", systemImageName: "sparkles")
        AppShortcut(intent: TellTempoIntent(), phrases: [
            "Dì a \(.applicationName)",
            "Aggiungi a \(.applicationName)",
            "Parla con \(.applicationName)",
        ], shortTitle: "Dì a Tempo", systemImageName: "text.bubble")
        AppShortcut(intent: MonthRecapIntent(), phrases: [
            "Il mio mese con \(.applicationName)",
        ], shortTitle: "Il mio mese", systemImageName: "calendar")
    }
}
