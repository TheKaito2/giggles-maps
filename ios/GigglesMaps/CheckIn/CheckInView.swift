import PhotosUI
import SwiftUI

struct CheckInView: View {
    let stop: RouteStop
    var onDone: () -> Void = {}

    private enum Step { case consent, capture, working(String), result(CheckinResult), failed(String) }

    @AppStorage("selfieConsent.v1") private var consented = false
    @State private var step: Step = .capture
    @State private var demo = false
    @State private var qrCode = ""
    @State private var showCamera = false
    @State private var photo: PhotosPickerItem?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) { content }.padding(20)
            }
            .navigationTitle(stop.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .onAppear { if !consented { step = .consent } }
        .fullScreenCover(isPresented: $showCamera) {
            SelfieCamera { image in Task { await submit(image) } }.ignoresSafeArea()
        }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) { await submit(image) }
                photo = nil
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .consent:
            Text("To stamp your passport we take one selfie and your location at this place.")
            VStack(alignment: .leading, spacing: 6) {
                Label("We only check that a face is in the photo. No face recognition.", systemImage: "face.dashed")
                Label("Your selfie is private and deleted automatically after 30 days.", systemImage: "lock")
                Label("You can delete your account and all check-ins any time in Passport.", systemImage: "trash")
            }
            .font(.footnote).foregroundStyle(Theme.ink2)
            Button("I agree, continue") { consented = true; step = .capture }.buttonStyle(PrimaryButtonStyle())

        case .capture:
            if stop.isPartner {
                VStack(alignment: .leading, spacing: 4) {
                    TextField("Counter code (under the QR sticker)", text: $qrCode)
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .padding(10).background(Theme.indigoSoft, in: RoundedRectangle(cornerRadius: 10))
                    Text(stop.isDemo ? "Example shops use the code DEMO." : "Ask the counter or scan the sticker with your camera.")
                        .font(.footnote).foregroundStyle(Theme.ink2)
                }
            }
            Toggle("I'm not in Sakon Nakhon: simulate being here (example places only)", isOn: $demo)
                .font(.subheadline).tint(Theme.indigo)
            if SelfieCamera.isAvailable {
                Button("Take selfie") { showCamera = true }.buttonStyle(PrimaryButtonStyle())
            } else {
                Text("Camera isn't available here. Pick a selfie from Photos instead.").font(.footnote).foregroundStyle(Theme.ink2)
            }
            PhotosPicker(selection: $photo, matching: .images) {
                Text("Choose from Photos").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 12)
                    .overlay(Capsule().stroke(Theme.indigo, lineWidth: 2)).foregroundStyle(Theme.indigo)
            }

        case .working(let status):
            HStack(spacing: 12) { ProgressView(); Text(status).font(.headline) }
                .frame(maxWidth: .infinity).padding(.vertical, 30)
                .accessibilityElement(children: .combine)

        case .result(let r):
            if r.status == "approved" && r.rewarded { StampView(place: stop.name) }
            Text(r.headline).font(Theme.display(24))
                .foregroundStyle(r.status == "approved" ? Theme.good : r.status == "review" ? Theme.marigold : Theme.bad)
            ForEach(r.reasons, id: \.self) { Text(Copy.reason($0)).font(.footnote).foregroundStyle(Theme.ink2) }
            ForEach(r.newBadges ?? [], id: \.slug) { Text("New badge: \($0.name)").font(.headline).foregroundStyle(Theme.stamp) }
            if let spin = r.spin { SpinView(spin: spin) }
            if let billing = r.billing {
                Text("Business view: \(Copy.billing(billing))\(r.billedThb.map { $0 > 0 ? " (฿\(Int($0)))" : "" } ?? "").")
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
            Button("Done") { dismiss() }.buttonStyle(PrimaryButtonStyle())

        case .failed(let message):
            Text(message).font(.headline).foregroundStyle(Theme.bad)
            Button("Try again") { step = .capture }.buttonStyle(PrimaryButtonStyle())
        }
    }

    private func submit(_ image: UIImage) async {
        do {
            step = .working(String(localized: "Looking for a face…"))
            let faces = await FaceCounter.count(in: image)

            var lat = stop.lat, lng = stop.lng, accuracy = 5.0, isMock = false
            if !demo {
                step = .working(String(localized: "Getting your location…"))
                let fix = try await LocationFix.current()
                (lat, lng, accuracy, isMock) = (fix.coordinate.latitude, fix.coordinate.longitude, fix.accuracy, fix.isSimulated)
            }

            step = .working(String(localized: "Uploading selfie…"))
            guard let jpeg = FaceCounter.jpeg(image) else { throw APIError(code: "bad_image") }
            let path = try await Backend.uploadSelfie(jpeg)

            step = .working(String(localized: "Checking…"))
            let result = try await Backend.verifyCheckin(CheckinRequest(
                placeId: stop.id, lat: lat, lng: lng, accuracyM: accuracy, selfiePath: path, faceCount: faces,
                qrCode: qrCode.isEmpty ? nil : qrCode,
                client: CheckinClient(isMock: isMock, attest: nil, demo: demo)))
            step = .result(result)
            onDone()
        } catch {
            step = .failed(error.localizedDescription)
        }
    }
}

private struct SpinView: View {
    let spin: CheckinResult.Spin
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if spin.won, let title = spin.title {
                Text("Free spin: you won \(title)").font(.headline)
                if let place = spin.place { Text("at \(place)").font(.subheadline) }
                if let code = spin.code { Text(code).font(Theme.data).foregroundStyle(Theme.indigo).textSelection(.enabled) }
            } else {
                Text("Free spin: no coupon this time.").font(.headline)
            }
            Text("Chance: \(Int((spin.odds * 100).rounded()))%. Spins are free and can't be bought.").font(.footnote).foregroundStyle(Theme.ink2)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.marigoldSoft, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct StampView: View {
    let place: String
    @State private var landed = false
    var body: some View {
        VStack(spacing: 0) {
            Text("STAMPED").font(Theme.display(26))
            Text(place).font(.caption.weight(.semibold)).lineLimit(1)
        }
        .foregroundStyle(Theme.stamp)
        .padding(.horizontal, 16).padding(.vertical, 8)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.stamp, lineWidth: 4))
        .rotationEffect(.degrees(-6))
        .scaleEffect(landed ? 1 : 1.8).opacity(landed ? 1 : 0)
        .onAppear { withAnimation(.spring(response: 0.35, dampingFraction: 0.55)) { landed = true } }
        .accessibilityLabel("Stamped: \(place)")
    }
}
