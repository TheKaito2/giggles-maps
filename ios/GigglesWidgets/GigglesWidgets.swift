import ActivityKit
import SwiftUI
import WidgetKit

@main
struct GigglesWidgets: WidgetBundle {
    var body: some Widget {
        TripLiveActivity()
        PassportWidget()
    }
}

private let indigo = Color(red: 0.15, green: 0.20, blue: 0.55)
private let marigold = Color(red: 0.91, green: 0.64, blue: 0.0)

// MARK: Live Activity

struct TripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripAttributes.self) { context in
            TripLockScreen(state: context.state, destination: context.attributes.destination)
                .padding(16)
                .activityBackgroundTint(Color(.systemBackground))
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("\(s.stopsDone)/\(s.stopsTotal)", systemImage: "map").font(.headline).foregroundStyle(marigold)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let eta = s.nextEta { Text(eta, style: .time).font(.headline.monospacedDigit()) }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(s.nextStop.map { "Next: \($0)" } ?? "Heading to \(context.attributes.destination)").font(.subheadline).lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "map.fill").foregroundStyle(marigold)
            } compactTrailing: {
                Text("\(s.stopsDone)/\(s.stopsTotal)").font(.caption.monospacedDigit())
            } minimal: {
                Text("\(s.stopsDone)").font(.caption.monospacedDigit()).foregroundStyle(marigold)
            }
        }
    }
}

private struct TripLockScreen: View {
    let state: TripAttributes.ContentState
    let destination: String
    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().stroke(indigo.opacity(0.2), lineWidth: 5)
                Circle().trim(from: 0, to: state.stopsTotal == 0 ? 0 : CGFloat(state.stopsDone) / CGFloat(state.stopsTotal))
                    .stroke(marigold, style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(-90))
                Text("\(state.stopsDone)/\(state.stopsTotal)").font(.caption.bold().monospacedDigit())
            }
            .frame(width: 48, height: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(state.nextStop.map { "Next: \($0)" } ?? "Heading to \(destination)").font(.headline).lineLimit(1)
                if let eta = state.nextEta { Text("Around \(eta, style: .time)").font(.subheadline).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
            Text("Giggles").font(.caption.bold()).foregroundStyle(indigo)
        }
    }
}

// MARK: Home-screen Passport widget

struct PassportEntry: TimelineEntry {
    let date: Date
    let snapshot: PassportSnapshot?
}

struct PassportProvider: TimelineProvider {
    func placeholder(in context: Context) -> PassportEntry {
        PassportEntry(date: .now, snapshot: PassportSnapshot(stamps: 3, trailName: "Indigo & Silk", trailHave: 1, trailNeed: 2))
    }
    func getSnapshot(in context: Context, completion: @escaping (PassportEntry) -> Void) {
        completion(PassportEntry(date: .now, snapshot: PassportSnapshot.load() ?? placeholder(in: context).snapshot))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<PassportEntry>) -> Void) {
        completion(Timeline(entries: [PassportEntry(date: .now, snapshot: PassportSnapshot.load())], policy: .never))
    }
}

struct PassportWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PassportWidget", provider: PassportProvider()) { entry in
            VStack(alignment: .leading, spacing: 6) {
                Text("Passport").font(.caption.bold()).foregroundStyle(indigo)
                Text("\(entry.snapshot?.stamps ?? 0)").font(.system(size: 40, weight: .bold, design: .rounded)).foregroundStyle(marigold)
                Text("stamps").font(.caption).foregroundStyle(.secondary)
                if let s = entry.snapshot, let trail = s.trailName {
                    Text("\(trail) \(s.trailHave)/\(s.trailNeed)").font(.caption2).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(for: .widget) { Color(.systemBackground) }
        }
        .configurationDisplayName("Passport")
        .description("Your stamps and the trail you're closest to finishing.")
        .supportedFamilies([.systemSmall])
    }
}
