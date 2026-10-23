import SwiftUI
import UIKit

// Colours from web/src/styles/tokens.css: indigo for structure, marigold for partners/main action, stamp red for badges.
enum Theme {
    static let indigo = dynamic(light: 0x27348B, dark: 0x9EACFF)
    static let onIndigo = dynamic(light: 0xFFFFFF, dark: 0x0F1226)
    static let indigoSoft = dynamic(light: 0xE3E7F8, dark: 0x232A55)
    static let marigold = dynamic(light: 0xE9A400, dark: 0xFFC53D)
    static let marigoldSoft = dynamic(light: 0xFFF3D1, dark: 0x3A2F10)
    static let stamp = dynamic(light: 0xD1452F, dark: 0xFF7A63)
    static let good = dynamic(light: 0x1B7F52, dark: 0x5FD39B)
    static let bad = dynamic(light: 0xB3261E, dark: 0xFF8A80)
    static let paper = dynamic(light: 0xF3F4F9, dark: 0x0F1226)
    static let card = dynamic(light: 0xFFFFFF, dark: 0x181C38)
    static let ink2 = dynamic(light: 0x4A5078, dark: 0xA9AED0)

    static func display(_ size: CGFloat) -> Font { .seed(size: size, .heavy) }
    static let data = Font.system(.body, design: .monospaced).weight(.semibold)

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) })
    }
    private static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

struct Chip: View {
    let text: String
    var partner = false
    var body: some View {
        Text(text)
            .font(.seed(.caption, .bold))
            .padding(.horizontal, 9).padding(.vertical, 2)
            .background(partner ? Theme.marigoldSoft : Theme.indigoSoft, in: Capsule())
            .overlay { if partner { Capsule().stroke(Theme.marigold, lineWidth: 1) } }
            .foregroundStyle(partner ? Color.primary : Theme.indigo)
    }
}

struct Pin: View {
    let text: String
    let color: Color
    var textColor: Color = .white
    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .bold, design: .monospaced))
            .foregroundStyle(textColor)
            .frame(width: 30, height: 30)
            .background(color, in: Circle())
            .overlay(Circle().stroke(.white, lineWidth: 2))
            .shadow(radius: 2, y: 1)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var gold = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.seed(.headline))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(gold ? Theme.marigold : Theme.indigo, in: Capsule())
            .foregroundStyle(gold ? Color(red: 0.14, green: 0.10, blue: 0) : Theme.onIndigo)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
