import SwiftUI

/// Giggles Plus looks: passport cover themes and name flair. IDs match the server's set_cosmetics whitelist.
enum PassportTheme: String, CaseIterable, Identifiable {
    case classic, indigo, lotus, nightMarket = "night-market", templeGold = "temple-gold", rain
    var id: String { rawValue }

    var name: String {
        switch self {
        case .classic: String(localized: "Classic")
        case .indigo: String(localized: "Indigo cloth")
        case .lotus: String(localized: "Lotus")
        case .nightMarket: String(localized: "Night market")
        case .templeGold: String(localized: "Temple gold")
        case .rain: String(localized: "Rain")
        }
    }

    /// cover gradient + the ink used for text and stamps on it
    var colors: (top: Color, bottom: Color, ink: Color) {
        switch self {
        case .classic: (Theme.indigoSoft, Theme.card, Theme.indigo)
        case .indigo: (Color(red: 0.13, green: 0.17, blue: 0.45), Color(red: 0.06, green: 0.08, blue: 0.25), .white)
        case .lotus: (Color(red: 0.98, green: 0.80, blue: 0.86), Color(red: 0.93, green: 0.55, blue: 0.68), Color(red: 0.35, green: 0.05, blue: 0.18))
        case .nightMarket: (Color(red: 0.15, green: 0.05, blue: 0.25), Color(red: 0.55, green: 0.12, blue: 0.35), Color(red: 1, green: 0.85, blue: 0.4))
        case .templeGold: (Color(red: 1, green: 0.85, blue: 0.4), Color(red: 0.85, green: 0.55, blue: 0.05), Color(red: 0.3, green: 0.15, blue: 0))
        case .rain: (Color(red: 0.75, green: 0.85, blue: 0.9), Color(red: 0.35, green: 0.5, blue: 0.6), Color(red: 0.05, green: 0.15, blue: 0.25))
        }
    }
}

enum Flair: String, CaseIterable, Identifiable {
    case none, marigold, indigo, lotus, sparkle
    var id: String { rawValue }

    var name: String {
        switch self {
        case .none: String(localized: "None")
        case .marigold: String(localized: "Marigold")
        case .indigo: String(localized: "Indigo")
        case .lotus: String(localized: "Lotus")
        case .sparkle: String(localized: "Sparkle")
        }
    }

    var color: Color? {
        switch self {
        case .none: nil
        case .marigold: Theme.marigold
        case .indigo: Theme.indigo
        case .lotus: Color(red: 0.9, green: 0.4, blue: 0.6)
        case .sparkle: Theme.stamp
        }
    }
}

/// The name with its flair: coloured text, plus an animated badge for "sparkle".
struct FlairName: View {
    let name: String
    let flair: Flair
    var fallback: Color = .primary
    @State private var glow = false

    var body: some View {
        HStack(spacing: 6) {
            Text(name).font(.headline).foregroundStyle(flair.color ?? fallback)
            if flair == .sparkle {
                Image(systemName: "sparkles").foregroundStyle(Theme.marigold)
                    .scaleEffect(glow ? 1.15 : 0.9).opacity(glow ? 1 : 0.7)
                    .onAppear { withAnimation(.easeInOut(duration: 1.2).repeatForever()) { glow = true } }
                    .accessibilityHidden(true)
            } else if flair != .none {
                Image(systemName: "seal.fill").foregroundStyle(flair.color ?? fallback).accessibilityHidden(true)
            }
        }
    }
}
