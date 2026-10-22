import CoreImage
import UIKit
import Vision

/// Counts faces in the selfie. Presence only: no recognition, no face prints, nothing about the face leaves the phone.
enum FaceCounter {
    static func count(in image: UIImage) async -> Int {
        guard let cg = image.cgImage else { return 0 }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)
        do {
            return try await DetectFaceRectanglesRequest().perform(on: cg, orientation: orientation).count
        } catch {
            // Vision has no inference context in the Simulator (and can fail on old devices): use Core Image's CPU detector
            let detector = CIDetector(ofType: CIDetectorTypeFace, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
            let ci = CIImage(cgImage: cg).oriented(orientation)
            return detector?.features(in: ci).count ?? 0
        }
    }

    /// longest side <= 720 px, JPEG ~0.82: well under the 3 MB bucket limit
    static func jpeg(_ image: UIImage) -> Data? {
        let scale = min(1, 720 / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return resized.jpegData(compressionQuality: 0.82)
    }
}

private extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
