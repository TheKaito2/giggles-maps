import SwiftUI

/// Image people post after a check-in. Everyone gets "Classic"; Giggles Plus adds three premium designs.
enum ShareDesign: String, CaseIterable, Identifiable {
    case classic, postcard, neon, indigo
    var id: String { rawValue }
    var isPremium: Bool { self != .classic }
    var name: String {
        switch self {
        case .classic: String(localized: "Classic")
        case .postcard: String(localized: "Postcard")
        case .neon: String(localized: "Night neon")
        case .indigo: String(localized: "Indigo cloth")
        }
    }
}

struct ShareCardView: View {
    let place: String
    let level: Int?
    let design: ShareDesign

    var body: some View {
        let (bg, ink, accent): (LinearGradient, Color, Color) = switch design {
        case .classic: (LinearGradient(colors: [Theme.indigoSoft, .white], startPoint: .top, endPoint: .bottom), Theme.indigo, Theme.stamp)
        case .postcard: (LinearGradient(colors: [Color(red: 1, green: 0.95, blue: 0.85), Color(red: 0.98, green: 0.85, blue: 0.7)], startPoint: .top, endPoint: .bottom),
                         Color(red: 0.3, green: 0.15, blue: 0.05), Color(red: 0.75, green: 0.25, blue: 0.1))
        case .neon: (LinearGradient(colors: [Color(red: 0.08, green: 0.02, blue: 0.18), Color(red: 0.3, green: 0.05, blue: 0.35)], startPoint: .top, endPoint: .bottom),
                     .white, Color(red: 1, green: 0.3, blue: 0.75))
        case .indigo: (LinearGradient(colors: [Color(red: 0.13, green: 0.17, blue: 0.45), Color(red: 0.05, green: 0.07, blue: 0.22)], startPoint: .top, endPoint: .bottom),
                       .white, Theme.marigold)
        }
        VStack(spacing: 22) {
            Text("Giggles Maps").font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(ink.opacity(0.8))
            VStack(spacing: 4) {
                Text("STAMPED").font(.system(size: 54, weight: .heavy, design: .rounded))
                Text(place).font(.system(size: 24, weight: .semibold, design: .rounded)).multilineTextAlignment(.center).lineLimit(2)
            }
            .foregroundStyle(accent)
            .padding(.horizontal, 28).padding(.vertical, 18)
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(accent, lineWidth: 8))
            .rotationEffect(.degrees(-6))
            if let level, level > 0 {
                Text("Level \(level) explorer").font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(ink)
            }
            Text("Sakon Nakhon · สกลนคร").font(.system(size: 18, weight: .medium, design: .rounded)).foregroundStyle(ink.opacity(0.7))
        }
        .padding(40)
        .frame(width: 1080 / 3, height: 1920 / 3)   // 9:16 story, rendered at 3x
        .background(bg)
    }

    /// PNG-ready image for ShareLink
    @MainActor
    func image() -> Image? {
        let renderer = ImageRenderer(content: self)
        renderer.scale = 3
        return renderer.uiImage.map { Image(uiImage: $0) }
    }
}

/// Share sheet with the design picker (premium designs need Plus).
struct ShareCardPicker: View {
    let place: String
    let level: Int?
    let hasPlus: Bool
    @State private var design: ShareDesign = .classic

    var body: some View {
        VStack(spacing: 12) {
            Picker("Design", selection: $design) {
                ForEach(ShareDesign.allCases) { d in
                    Label(d.name, systemImage: d.isPremium && !hasPlus ? "lock.fill" : "photo").tag(d)
                }
            }
            .pickerStyle(.menu)
            let card = ShareCardView(place: place, level: level, design: design.isPremium && !hasPlus ? .classic : design)
            card.scaleEffect(0.42).frame(width: 360 * 0.42, height: 640 * 0.42)
            if design.isPremium && !hasPlus {
                Text("Premium designs come with Giggles Plus.").font(.footnote).foregroundStyle(Theme.ink2)
            }
            if let image = card.image() {
                ShareLink(item: image, preview: SharePreview("Stamped at \(place)", image: image)) {
                    Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
    }
}
