// Il ponte tra l'app web (js/native.js) e iOS: widget, Live Activity, promemoria, Siri e CarPlay.
// Registrato da MainViewController (plugin locale dell'app, niente pacchetto npm).
import Foundation
import UIKit
import Capacitor
import WidgetKit
import UserNotifications
#if canImport(ActivityKit)
import ActivityKit
#endif

@objc(TempoBridgePlugin)
public class TempoBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TempoBridgePlugin"
    public let jsName = "TempoBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setScene", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCloud", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setReminders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pendingIntents", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        // richieste arrivate da Siri / CarPlay mentre l'app era in background: le passa all'app web
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            for e in SharedStore.takeIntents() { self?.notifyListeners("intent", data: e) }
        }
    }

    // MARK: widget e Siri

    @objc func setSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), json.count < 64_000 else { return call.reject("snapshot non valido") }
        SharedStore.saveSnapshot(json: json)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func setScene(_ call: CAPPluginCall) {
        SharedStore.saveScene([
            "accent": call.getString("accent") ?? "",
            "palette": (call.getArray("palette") as? [String]) ?? [],
            "mood": call.getString("mood") ?? "",
            "domain": call.getString("domain") ?? "",
        ])
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func setCloud(_ call: CAPPluginCall) {
        SharedStore.saveCloud(url: call.getString("url") ?? "", token: call.getString("token") ?? "")
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func pendingIntents(_ call: CAPPluginCall) {
        call.resolve(["list": SharedStore.takeIntents()])
    }

    // MARK: Live Activity (isola dinamica e schermata di blocco)

    @objc func startActivity(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return call.resolve(["started": false]) }
        let ends = Date(timeIntervalSince1970: (call.getDouble("endsAt") ?? 0) / 1000)
        let attrs = TempoActivityAttributes(accentHex: call.getString("accent") ?? "", symbol: TempoSymbols.symbol(call.getString("icon")), mode: call.getString("mode") ?? "timer")
        let state = TempoActivityAttributes.ContentState(title: call.getString("title") ?? "Tempo", endsAt: ends, paused: call.getBool("paused") ?? false)
        Task {
            // una sola alla volta: Tempo occupa al massimo un posto nell'isola dinamica
            for a in Activity<TempoActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
            do {
                _ = try Activity.request(attributes: attrs, content: .init(state: state, staleDate: ends.addingTimeInterval(15 * 60)), pushType: nil)
                call.resolve(["started": true])
            } catch {
                call.reject("Live Activity non disponibile: \(error.localizedDescription)")
            }
        }
        #else
        call.resolve(["started": false])
        #endif
    }

    @objc func updateActivity(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        let ends = Date(timeIntervalSince1970: (call.getDouble("endsAt") ?? 0) / 1000)
        let state = TempoActivityAttributes.ContentState(title: call.getString("title") ?? "Tempo", endsAt: ends, paused: call.getBool("paused") ?? false)
        Task {
            for a in Activity<TempoActivityAttributes>.activities { await a.update(.init(state: state, staleDate: ends.addingTimeInterval(15 * 60))) }
            call.resolve()
        }
        #else
        call.resolve()
        #endif
    }

    @objc func endActivity(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        Task {
            for a in Activity<TempoActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
            call.resolve()
        }
        #else
        call.resolve()
        #endif
    }

    // MARK: promemoria locali (al massimo 2 al giorno, li sceglie l'app web)

    @objc func setReminders(_ call: CAPPluginCall) {
        let list = (call.getArray("list") as? [[String: Any]]) ?? []
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            center.getPendingNotificationRequests { pending in
                center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix("tempo-") })
                guard granted else { return call.resolve(["scheduled": 0]) }
                var n = 0
                for r in list.prefix(4) {
                    guard let id = r["id"] as? String, let at = r["at"] as? Double, let title = r["title"] as? String else { continue }
                    let when = Date(timeIntervalSince1970: at / 1000)
                    guard when > Date() else { continue }
                    let content = UNMutableNotificationContent()
                    content.title = title
                    content.body = (r["body"] as? String) ?? ""
                    let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: when)
                    center.add(UNNotificationRequest(identifier: "tempo-\(id)", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
                    n += 1
                }
                call.resolve(["scheduled": n])
            }
        }
    }
}
