import SwiftUI

// OneShot's content-panel glass (OneShot/Views/Theme.swift), shared look across Krist's apps.
// iOS Liquid Glass (.glassEffect) stays on controls; panels use this: no blur, so the page reads through cleanly.
/// kristpaulstudio.com's `.liquid-glass`: a 3 % fill, edges lit along the top and shaded along the bottom, a soft
/// shadow line, and the rim light (bright at top and bottom, clear across the middle). No blur: the live site computes
/// `backdrop-filter: none`, and a material lifted the panels to (50,49,49) against the site's (31,30,28) (measured 18 Oct).
struct LiquidGlass: ViewModifier {
    var cornerRadius: CGFloat = 24
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        let dark = scheme == .dark
        let ink = Color(red: 0x16 / 255, green: 0x1B / 255, blue: 0x3D / 255)   // Giggles ink, #161B3D
        return content
            .background {
                ZStack {
                    // A plain 2 pt line, not a blurred one: a blur pass under every card slowed each page (22 Oct).
                    shape.stroke(dark ? Color.black.opacity(0.3) : ink.opacity(0.03), lineWidth: 2).offset(y: 1)
                    shape.fill(dark ? Color.white.opacity(0.03) : ink.opacity(0.03))
                }
            }
            .overlay {
                ZStack {
                    edge(shape, dark ? .white.opacity(0.22) : .white.opacity(0.7), .top)
                    edge(shape, dark ? .black.opacity(0.5) : ink.opacity(0.12), .bottom)
                    edge(shape, dark ? .white.opacity(0.06) : ink.opacity(0.05), .leading)
                    edge(shape, dark ? .black.opacity(0.15) : ink.opacity(0.05), .trailing)
                    shape.strokeBorder(Self.rim(dark ? .white : ink, edge: dark ? 0.45 : 0.25, near: dark ? 0.15 : 0.08), lineWidth: 1.4)
                }
                .drawingGroup()   // the edge lines and rim gradient as one GPU layer: drawn on the CPU per card before
                .allowsHitTesting(false)
            }
    }

    /// The site's ring: alpha 45 % → 15 % → 0 → 0 → 15 % → 45 % from top to bottom (the one gradient kept).
    static func rim(_ color: Color, edge: Double, near: Double) -> LinearGradient {
        LinearGradient(stops: [.init(color: color.opacity(edge), location: 0), .init(color: color.opacity(near), location: 0.2),
                               .init(color: color.opacity(0), location: 0.4), .init(color: color.opacity(0), location: 0.6),
                               .init(color: color.opacity(near), location: 0.8), .init(color: color.opacity(edge), location: 1)],
                       startPoint: .top, endPoint: .bottom)
    }

    /// One inset edge line: the panel's outline, kept only within a corner's reach of that side so it follows the curve.
    private func edge(_ shape: RoundedRectangle, _ color: Color, _ side: Edge) -> some View {
        let vertical = side == .top || side == .bottom
        let alignment: Alignment = switch side {
        case .top: .top
        case .bottom: .bottom
        case .leading: .leading
        case .trailing: .trailing
        }
        return shape.inset(by: 0.5).stroke(color, lineWidth: 1)
            .mask(alignment: alignment) {
                Rectangle().frame(width: vertical ? nil : cornerRadius, height: vertical ? cornerRadius : nil)
            }
    }
}

extension View {
    /// A content panel in liquid glass, on the card colour so text keeps its contrast.
    func glassCard(padding: CGFloat = 18, cornerRadius: CGFloat = 24) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card.opacity(0.88), in: .rect(cornerRadius: cornerRadius, style: .continuous))
            .modifier(LiquidGlass(cornerRadius: cornerRadius))
    }
}
