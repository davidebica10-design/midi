// Target «TempoWidgets» (Widget Extension): il tempo fuori dall'app.
//  - «Adesso»: una sola frase su cosa fare, nella schermata Home e in quella di blocco, tinta come la scena dell'app;
//  - la Live Activity del timer: isola dinamica e schermata di blocco, con il tempo che resta.
// Con un account Tempo Cloud il widget chiede al server il piano aggiornato; senza, usa l'ultimo snapshot.
import WidgetKit
import SwiftUI
import ActivityKit

@main
struct TempoWidgetBundle: WidgetBundle {
    var body: some Widget {
        NowWidget()
        TempoLiveActivity()
    }
}

// MARK: - «Adesso»

struct NowEntry: TimelineEntry {
    let date: Date
    let title: String
    let why: String
    let next: [TempoSnapshot.Next]
    let accent: Color
    let palette: [Color]
}

struct NowProvider: TimelineProvider {
    func placeholder(in context: Context) -> NowEntry {
        NowEntry(date: .now, title: "Finisci il ritornello.", why: "Hai 47 minuti prima di cena.", next: [], accent: SharedStore.sceneAccent, palette: SharedStore.scenePalette)
    }
    func getSnapshot(in context: Context, completion: @escaping (NowEntry) -> Void) { completion(local()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<NowEntry>) -> Void) {
        Task {
            var entry = local()
            if let r = await TempoCloud.now() {
                entry = NowEntry(date: .now, title: r.now?.title ?? r.text, why: r.now?.why ?? "", next: r.next, accent: entry.accent, palette: entry.palette)
            }
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60))))
        }
    }
    private func local() -> NowEntry {
        let s = SharedStore.snapshot()
        let stale = (s?.day ?? "") != Self.today()
        return NowEntry(date: .now,
                        title: stale ? "Apri Tempo per la giornata di oggi." : (s?.now?.title ?? s?.next.first.map { "Prossimo: \($0.title)." } ?? "Giornata libera."),
                        why: stale ? "" : (s?.now?.why ?? s?.progress ?? ""),
                        next: stale ? [] : (s?.next ?? []), accent: SharedStore.sceneAccent, palette: SharedStore.scenePalette)
    }
    static func today() -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.calendar = Calendar(identifier: .gregorian); return f.string(from: .now)
    }
}

struct NowWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: NowEntry

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(entry.title)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text("Adesso").font(.caption2).foregroundStyle(.secondary)
                Text(entry.title).font(.headline).lineLimit(2)
                if !entry.why.isEmpty { Text(entry.why).font(.caption).lineLimit(1).foregroundStyle(.secondary) }
            }
        default:
            VStack(alignment: .leading, spacing: 6) {
                Text("Adesso").font(.caption).fontWeight(.semibold).foregroundStyle(entry.accent)
                Text(entry.title).font(.system(.title3, design: .serif)).fontWeight(.bold).lineLimit(3).minimumScaleFactor(0.8)
                if !entry.why.isEmpty { Text(entry.why).font(.footnote).foregroundStyle(.secondary).lineLimit(family == .systemSmall ? 2 : 3) }
                Spacer(minLength: 0)
                if family != .systemSmall, !entry.next.isEmpty {
                    ForEach(Array(entry.next.prefix(3).enumerated()), id: \.offset) { _, n in
                        HStack(spacing: 6) {
                            Text(n.start ?? "").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            Text(n.title).font(.caption).lineLimit(1)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

struct NowWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TempoNow", provider: NowProvider()) { entry in
            NowWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    // lo sfondo prende i colori della scena dell'app (il colore non porta mai da solo un'informazione)
                    LinearGradient(colors: entry.palette.isEmpty ? [Color(.systemBackground)] : entry.palette.map { $0.opacity(0.55) }, startPoint: .topLeading, endPoint: .bottomTrailing)
                }
                .widgetURL(URL(string: "tempo://open"))
        }
        .configurationDisplayName("Adesso")
        .description("Una sola cosa da fare adesso, con il perché.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Live Activity del timer

struct TempoLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TempoActivityAttributes.self) { ctx in
            // schermata di blocco
            HStack(spacing: 14) {
                Image(systemName: ctx.attributes.symbol).font(.title2).foregroundStyle(accent(ctx.attributes))
                VStack(alignment: .leading, spacing: 2) {
                    Text(ctx.state.title).font(.headline).lineLimit(1)
                    if ctx.state.paused { Text("In pausa").font(.subheadline).foregroundStyle(.secondary) }
                    else { ProgressView(timerInterval: Date.now...max(Date.now, ctx.state.endsAt), countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }.tint(accent(ctx.attributes)) }
                }
                Spacer()
                if !ctx.state.paused {
                    Text(timerInterval: Date.now...max(Date.now, ctx.state.endsAt), countsDown: true)
                        .font(.system(.title, design: .rounded).monospacedDigit()).fontWeight(.semibold).frame(width: 90, alignment: .trailing)
                }
            }
            .padding(16)
            .activityBackgroundTint(Color(.systemBackground).opacity(0.85))
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Image(systemName: ctx.attributes.symbol).font(.title2).foregroundStyle(accent(ctx.attributes)) }
                DynamicIslandExpandedRegion(.center) { Text(ctx.state.title).font(.headline).lineLimit(1) }
                DynamicIslandExpandedRegion(.trailing) {
                    if !ctx.state.paused { Text(timerInterval: Date.now...max(Date.now, ctx.state.endsAt), countsDown: true).monospacedDigit().frame(width: 64) }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !ctx.state.paused { ProgressView(timerInterval: Date.now...max(Date.now, ctx.state.endsAt), countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }.tint(accent(ctx.attributes)) }
                    else { Text("In pausa").font(.caption).foregroundStyle(.secondary) }
                }
            } compactLeading: {
                Image(systemName: ctx.attributes.symbol).foregroundStyle(accent(ctx.attributes))
            } compactTrailing: {
                if ctx.state.paused { Image(systemName: "pause.fill") }
                else { Text(timerInterval: Date.now...max(Date.now, ctx.state.endsAt), countsDown: true).monospacedDigit().frame(width: 44) }
            } minimal: {
                Image(systemName: ctx.attributes.symbol).foregroundStyle(accent(ctx.attributes))
            }
            .widgetURL(URL(string: "tempo://open"))
        }
    }

    private func accent(_ a: TempoActivityAttributes) -> Color { Color(hex: a.accentHex) ?? .pink }
}
