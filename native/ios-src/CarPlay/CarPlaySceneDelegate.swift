// Tempo in CarPlay: un'app conversazionale a voce (categoria introdotta con iOS 26.4).
// Serve il permesso CarPlay di Apple per questa categoria (si richiede dal portale sviluppatori):
// finché non arriva, in auto funziona comunque Siri con le App Shortcuts (TempoIntents.swift).
// Regole di Apple per la categoria: la voce è l'interazione principale, schermata di controllo vocale
// mentre ascolta, al massimo quattro azioni, niente testi o immagini come risposta: le risposte si ascoltano.
// DA VERIFICARE in Xcode con la CarPlay Developer Guide aggiornata: i template ammessi per la categoria.
import CarPlay
import AVFoundation
import Speech

final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var ui: CPInterfaceController?
    private let voice = AVSpeechSynthesizer()
    private let listener = TempoListener()

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        ui = interfaceController
        let now = CPListItem(text: "Cosa faccio adesso", detailText: nil, image: UIImage(systemName: "sparkles"))
        now.handler = { [weak self] _, done in Task { await self?.sayNow(); done() } }
        let day = CPListItem(text: "Com'è la giornata", detailText: nil, image: UIImage(systemName: "calendar"))
        day.handler = { [weak self] _, done in Task { await self?.sayDay(); done() } }
        let talk = CPListItem(text: "Parla con Tempo", detailText: nil, image: UIImage(systemName: "mic"))
        talk.handler = { [weak self] _, done in self?.listen(); done() }
        let root = CPListTemplate(title: "Tempo", sections: [CPListSection(items: [now, day, talk])])
        interfaceController.setRootTemplate(root, animated: false, completion: nil)
    }

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        listener.stop()
        ui = nil
    }

    // MARK: risposte a voce

    private func say(_ text: String) {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "it-IT")
        voice.stopSpeaking(at: .immediate)
        voice.speak(u)
    }

    private func sayNow() async {
        say(await TempoCloud.now()?.text ?? SharedStore.snapshot()?.spoken ?? "Apri Tempo sul telefono per costruire la giornata.")
    }

    private func sayDay() async {
        let next = await TempoCloud.now()?.next ?? SharedStore.snapshot()?.next ?? []
        if next.isEmpty { return say("Per oggi non hai altro in programma.") }
        say("Oggi: " + next.prefix(4).map { "\($0.start.map { "alle \($0), " } ?? "")\($0.title)" }.joined(separator: "; ") + ".")
    }

    // MARK: ascolto

    private func listen() {
        let listening = CPVoiceControlState(identifier: "ascolto", titleVariants: ["Ti ascolto…"], image: nil, repeats: true)
        let template = CPVoiceControlTemplate(voiceControlStates: [listening])
        ui?.presentTemplate(template, animated: true, completion: nil)
        listener.start { [weak self] text in
            Task { @MainActor in
                self?.ui?.dismissTemplate(animated: true, completion: nil)
                guard let self, let text, !text.isEmpty else { self?.say("Non ho sentito. Riprova quando vuoi."); return }
                if let reply = await TempoCloud.tell(text) { self.say(reply) }
                else { SharedStore.queueIntent(kind: "tell", text: text); self.say("Me lo segno: lo sistemo appena apri Tempo.") }
            }
        }
    }
}

/// Riconoscimento vocale in italiano: si ferma da solo dopo 1,5 secondi di silenzio.
final class TempoListener {
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "it-IT"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silence: Timer?
    private var best = ""

    func start(_ done: @escaping (String?) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else { return done(nil) }
            DispatchQueue.main.async { self.begin(done) }
        }
    }

    private func begin(_ done: @escaping (String?) -> Void) {
        stop()
        best = ""
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .allowBluetooth])
        try? session.setActive(true)
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        request = req
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in req.append(buf) }
        engine.prepare()
        do { try engine.start() } catch { return done(nil) }
        var finished = false
        let finish: () -> Void = { [weak self] in
            guard !finished else { return }
            finished = true
            let text = self?.best
            self?.stop()
            done(text)
        }
        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            if let r = result { self?.best = r.bestTranscription.formattedString }
            DispatchQueue.main.async {
                self?.silence?.invalidate()
                self?.silence = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { _ in finish() }
                if error != nil || result?.isFinal == true { finish() }
            }
        }
    }

    func stop() {
        silence?.invalidate()
        if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
    }
}
