import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

// Face *presence* only (count faces). No recognition, no face templates stored.
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

let detector: Promise<FaceDetector> | null = null;

export function countFaces(image: HTMLCanvasElement): Promise<number> {
  detector ??= FilesetResolver.forVisionTasks(WASM).then((files) =>
    FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL }, runningMode: "IMAGE", minDetectionConfidence: 0.6 }));
  return detector.then((d) => d.detect(image).detections.length);
}
