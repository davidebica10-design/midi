// Condiviso tra l'app, i widget (Widget Extension) e CarPlay.
// Aggiungi questo file a ENTRAMBI i target (App e TempoWidgets) e attiva in tutti e due la capacità
// «App Groups» con lo stesso gruppo (TempoShared.appGroup).
import Foundation
import SwiftUI
#if canImport(ActivityKit)
import ActivityKit
#endif

enum TempoShared {
    /// Cambialo con il tuo: group.<il tuo bundle id>
    static let appGroup = "group.app.tempo.companion"
    static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }
}

// MARK: - Snapshot (lo scrive l'app web tramite TempoBridge.setSnapshot)

struct TempoSnapshot: Codable {
    struct Now: Codable { var title: String; var why: String; var mood: String? }
    struct Next: Codable { var title: String; var start: String?; var end: String?; var kind: String? }
    struct Scene: Codable { var mood: String?; var domain: String?; var goal: String?; var accent: String?; var palette: [String]? }
    var v: Int?
    var at: Double?
    var day: String?
    var now: Now?
    var next: [Next]
    var progress: String?
    var scene: Scene?

    /// Quello che Siri e CarPlay dicono ad alta voce.
    var spoken: String {
        if let n = now { return "\(n.title) \(n.why)".trimmingCharacters(in: .whitespaces) }
        if let first = next.first { return "Prossimo: \(first.title)\(first.start.map { " alle \($0)" } ?? "")." }
        return "Oggi non hai altro in programma."
    }
    var updatedAt: Date { Date(timeIntervalSince1970: (at ?? 0) / 1000) }
}

enum SharedStore {
    private static let snapKey = "tempo.snapshot"
    private static let sceneKey = "tempo.scene"
    private static let cloudKey = "tempo.cloud"
    private static let intentsKey = "tempo.pendingIntents"

    static func saveSnapshot(json: String) { TempoShared.defaults.set(json, forKey: snapKey) }
    static func snapshot() -> TempoSnapshot? {
        guard let s = TempoShared.defaults.string(forKey: snapKey), let d = s.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(TempoSnapshot.self, from: d)
    }

    static func saveScene(_ dict: [String: Any]) { TempoShared.defaults.set(dict, forKey: sceneKey) }
    static var sceneAccent: Color {
        (TempoShared.defaults.dictionary(forKey: sceneKey)?["accent"] as? String).flatMap(Color.init(hex:)) ?? Color(red: 0.51, green: 0.38, blue: 0.47)
    }
    static var scenePalette: [Color] {
        ((TempoShared.defaults.dictionary(forKey: sceneKey)?["palette"] as? [String]) ?? []).compactMap(Color.init(hex:))
    }

    /// Tempo Cloud: indirizzo e codice d'accesso (vuoti = senza account).
    static func saveCloud(url: String, token: String) {
        if url.isEmpty || token.isEmpty { TempoShared.defaults.removeObject(forKey: cloudKey) }
        else { TempoShared.defaults.set(["url": url, "token": token], forKey: cloudKey) }
    }
    static var cloud: (url: String, token: String)? {
        guard let d = TempoShared.defaults.dictionary(forKey: cloudKey) as? [String: String],
              let u = d["url"], let t = d["token"], !u.isEmpty, !t.isEmpty else { return nil }
        return (u, t)
    }

    /// Richieste arrivate da Siri o CarPlay mentre l'app era chiusa (senza account): l'app le esegue quando si apre.
    static func queueIntent(kind: String, text: String? = nil) {
        var list = TempoShared.defaults.array(forKey: intentsKey) as? [[String: String]] ?? []
        var e = ["kind": kind]
        if let text { e["text"] = String(text.prefix(500)) }
        list.append(e)
        TempoShared.defaults.set(Array(list.suffix(10)), forKey: intentsKey)
    }
    static func takeIntents() -> [[String: String]] {
        let list = TempoShared.defaults.array(forKey: intentsKey) as? [[String: String]] ?? []
        TempoShared.defaults.removeObject(forKey: intentsKey)
        return list
    }
}

// MARK: - Tempo Cloud (le stesse API dei Comandi rapidi: cloud/README.md)

enum TempoCloud {
    struct NowResponse: Codable { var text: String; var now: TempoSnapshot.Now?; var next: [TempoSnapshot.Next] }
    struct TellResponse: Codable { var reply: String; var applied: Bool; var confirm: Bool }

    private static func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest? {
        guard let c = SharedStore.cloud, let url = URL(string: c.url + path) else { return nil }
        var r = URLRequest(url: url, timeoutInterval: 8)
        r.httpMethod = method
        r.setValue("Bearer \(c.token)", forHTTPHeaderField: "Authorization")
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return r
    }

    /// Cosa fare adesso, calcolato dal server con il piano aggiornato (nil senza account o senza rete).
    static func now() async -> NowResponse? {
        guard let r = request("/v1/now"), let res = try? await URLSession.shared.data(for: r),
              (res.1 as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(NowResponse.self, from: res.0)
    }

    /// «Dì a Tempo…»: la risposta da dire, o nil se non c'è account o rete (allora la richiesta va in coda).
    static func tell(_ text: String) async -> String? {
        guard let r = request("/v1/tell", method: "POST", body: ["text": text]), let res = try? await URLSession.shared.data(for: r),
              (res.1 as? HTTPURLResponse)?.statusCode == 200, let t = try? JSONDecoder().decode(TellResponse.self, from: res.0) else { return nil }
        return t.reply
    }
}

// MARK: - Live Activity del timer

#if canImport(ActivityKit)
struct TempoActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var title: String
        var endsAt: Date
        var paused: Bool
    }
    var accentHex: String
    var symbol: String
    var mode: String   // "pomodoro" | "timer"
}
#endif

// MARK: - Utilità

extension Color {
    /// "#RRGGBB" → Color
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt64(s, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

/// Le icone delle attività di Tempo (Phosphor, nell'app web) → SF Symbols per widget e Live Activity.
enum TempoSymbols {
    static func symbol(_ icon: String?) -> String {
        switch icon ?? "" {
        case "music-notes", "guitar", "headphones": return "music.note"
        case "microphone-stage": return "music.mic"
        case "book-open-text", "book", "exam": return "book"
        case "graduation-cap": return "graduationcap"
        case "barbell": return "dumbbell"
        case "person-simple-run": return "figure.run"
        case "person-simple-swim": return "figure.pool.swim"
        case "person-simple-walk": return "figure.walk"
        case "person-simple-tai-chi", "flower-lotus": return "figure.mind.and.body"
        case "bicycle": return "bicycle"
        case "phone": return "phone"
        case "users-three", "video-camera": return "person.3"
        case "briefcase": return "briefcase"
        case "code": return "chevron.left.forwardslash.chevron.right"
        case "palette", "paint-brush": return "paintpalette"
        case "pencil-simple-line": return "pencil"
        case "camera": return "camera"
        case "airplane-tilt": return "airplane"
        case "island": return "beach.umbrella"
        case "car": return "car"
        case "house", "broom", "washing-machine", "wrench", "plant": return "house"
        case "fork-knife", "coffee": return "fork.knife"
        case "stethoscope", "pill", "tooth": return "cross.case"
        case "shopping-cart", "credit-card": return "cart"
        case "confetti", "cake", "film-slate", "game-controller": return "party.popper"
        case "moon": return "moon"
        case "flag": return "flag"
        default: return "sparkles"
        }
    }
}
