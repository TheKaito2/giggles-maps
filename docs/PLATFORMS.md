# Giggles Maps: iOS vs Android capability guide

For the Android developer mirroring the iOS app. Both apps talk to the same Supabase backend (Postgres + PostGIS, Auth, Storage, Edge Functions), so anything the server decides (routing, ranking, check-in verification, billing, badges) is already shared. This doc covers what each phone can do on its own and which API to reach for.

Parity column:
- **same**: both platforms can do it; build it on both.
- **different**: both can do it, but the API, limits or behaviour differ enough to matter.
- **iOS-only** / **Android-only**: the other platform has no real equivalent; skip it or use the fallback named in the row.

Verification: every API name and version was checked against Apple or Android developer docs on 2026-10-22 unless it carries **⚠ unverified**. Apple facts come from the developer.apple.com documentation JSON; Android facts from developer.android.com, developers.google.com and ai.google.dev.

---

## 1. On-device AI

Rule for both apps: **never depend on on-device AI.** Treat it as an optional speed-up. Every AI feature (stop blurbs, "why this stop" text, trip summary) must work through the server LLM (an Edge Function) first.

| Feature | iOS API | Android API | How Giggles Maps uses it | Parity |
|---|---|---|---|---|
| On-device LLM | Foundation Models framework: `SystemLanguageModel`, `LanguageModelSession` (iOS 26.0+). Apple Intelligence devices only (iPhone 15 Pro and later). | Gemini Nano via ML Kit GenAI **Prompt API** (Beta). Device list is short: Pixel 9/10/11 series, Galaxy S26 series, Z Fold7/Fold8/Flip8, several OnePlus, Xiaomi, OPPO, vivo, Honor flagships. Full list: developers.google.com/ml-kit/genai. | Optional: offline rewrite of stop descriptions. Off by default. | different |
| Availability check | `SystemLanguageModel.default.availability`; unavailable reasons are `.deviceNotEligible`, `.appleIntelligenceNotEnabled`, `.modelNotReady`. | Check feature status through the ML Kit GenAI client before use; the model may need a download. ⚠ unverified: exact status method name, check the GenAI samples on GitHub (googlesamples/mlkit, `android/genai`). | Gate the feature; fall back to server LLM when not available. | different |
| Language support (Thai) | `SystemLanguageModel.supportedLanguages` and `supportsLocale(_:)`. An unsupported language throws `LanguageModelSession.GenerationError.unsupportedLanguageOrLocale`. Thai is **not** on any Apple Intelligence supported-language list we found (latest list we could confirm is from WWDC 2025). | Google's docs give no language list; support "may vary" by device configuration. ⚠ unverified for Thai. | Thai users are the main audience, so both on-device models are effectively English-only extras for us. | same (both unreliable for Thai) |
| Context size | 4096 tokens per session (Apple TN3193); read `SystemLanguageModel.contextSize` at runtime. Overflow throws `exceededContextWindowSize`. | ⚠ unverified: not stated on the GenAI overview page. | Keep prompts short: one stop at a time. | different |
| Structured output | `@Generable` macro + `@Guide` on properties (guided generation). | Prompt API structured output is **Alpha**. | If used, generate a small struct (title, one-line pitch). | different |
| Tool calling | `Tool` protocol (`name`, `description`, `Arguments: Generable`, `call(arguments:)`). | none in Prompt API. | Not used. | iOS-only |
| Image input | none (the system model is text only). | Prompt API accepts image + text. Separate **Image description** API (Beta). | Not used (selfie check does not use an LLM). | Android-only |
| Fallback | Server LLM via Edge Function. | Server LLM via Edge Function. | **The real path on both platforms.** | same |

## 2. Camera and selfie check

Presence only: we count faces to prove a person is at the shop. **No face recognition, no face embeddings, no matching against other photos** (Thailand PDPA). The server only receives the face count and the selfie file.

| Feature | iOS API | Android API | How Giggles Maps uses it | Parity |
|---|---|---|---|---|
| Camera capture | AVFoundation (`AVCaptureSession`, `AVCapturePhotoOutput`), front camera. | CameraX (`Preview`, `ImageCapture`, `ImageAnalysis`), front lens. | Selfie screen at check-in. | same |
| Face detection | Vision: `DetectFaceRectanglesRequest` (Swift API, iOS 18+) or `VNDetectFaceRectanglesRequest` (older API). | ML Kit Face Detection (`FaceDetection.getClient`), on device. | Count faces in the selfie, send `face_count`. Server rejects `face_count < 1`. | same |
| Face capture quality | `DetectFaceCaptureQualityRequest` (iOS 18+) or `VNDetectFaceCaptureQualityRequest` (iOS 13+): 0 to 1, higher = sharper, better lit, more centred. | none as one call; approximate with ML Kit face bounding-box size, head angles (`headEulerAngleY/Z`) and eye-open probability. | Ask for a retake if the face is blurry or tiny. Client-side only. | different |
| Hand pose (liveness gesture, optional) | `DetectHumanHandPoseRequest` (iOS 18+) / `VNDetectHumanHandPoseRequest`. | MediaPipe Hand Landmarker (21 landmarks per hand). | Optional "show a peace sign" prompt to make a printed photo harder to use. | same |
| Upload | Supabase Storage, bucket `selfies`, path `<user_id>/<file>`. | Same. | Bucket is private, max 3 MB, `image/jpeg`, `image/webp` or `image/png`. | same |

## 3. Location

| Feature | iOS API | Android API | How Giggles Maps uses it | Parity |
|---|---|---|---|---|
| Current position | Core Location: `CLLocationManager` / `CLLocationUpdate.liveUpdates()`. | Fused Location Provider (`FusedLocationProviderClient`, `getCurrentLocation`, `requestLocationUpdates`). | Start point of the route; position at check-in. | same |
| Accuracy | `CLLocation.horizontalAccuracy` (metres). | `Location.getAccuracy()` (metres). | Sent as `accuracy`. Server sends check-ins with accuracy > 50 m to manual review. | same |
| Geofences | `CLMonitor` (iOS 17+) with `CLMonitor.CircularGeographicCondition`. Max **20 conditions** per app at once (same 20 limit as the older `CLCircularRegion` monitoring). | Geofencing API (`GeofencingClient`, `Geofence.Builder`, `GeofencingRequest`). Max **100 geofences** per app per device user. | "You're near a stop" nudge for the stops on the current route. iOS must rotate: monitor only the next stops on the route. | different |
| Mock / fake GPS flag | `CLLocation.sourceInformation` → `CLLocationSourceInformation.isSimulatedBySoftware` (iOS 15+). | `Location.isMock()` (API 31+; on older devices use `isFromMockProvider()`, deprecated in API 31). | Sent as `is_mock`. Server rejects the check-in with reason `mock_location`. | same |

## 4. App integrity

| Feature | iOS API | Android API | How Giggles Maps uses it | Parity |
|---|---|---|---|---|
| Prove the request came from our real app on a real device | App Attest: `DCAppAttestService` (iOS 14+): `generateKey`, `attestKey`, then `generateAssertion` per request. Older fallback: DeviceCheck `DCDevice`. | Play Integrity API. **Standard requests** (warm-up, then a few hundred ms per token, bind with `requestHash`) or **classic requests** (seconds, bind with `nonce`). Server checks `requestDetails`, `appIntegrity.appRecognitionVerdict = PLAY_RECOGNIZED`, `deviceIntegrity` labels (`MEETS_DEVICE_INTEGRITY` etc.). | Send an integrity token with every check-in. Use a standard request; set `requestHash` = SHA-256 of the check-in payload. | different (same idea, different flow) |

Note: the server does **not** verify integrity tokens yet. `record_checkin` only stores them in the `client` JSON. Send it anyway so verification can be switched on without an app update.

## 5. Sensors

| Feature | iOS API | Android API | How Giggles Maps uses it | Parity |
|---|---|---|---|---|
| GPS / GNSS | Core Location (no raw GNSS API). | Fused Location; raw GNSS via `LocationManager.registerGnssMeasurementsCallback`. | Position only. | different (Android exposes raw GNSS) |
| Compass / heading | `CLLocationManager.startUpdatingHeading()` → `CLHeading`. | `SensorManager` rotation vector (`TYPE_ROTATION_VECTOR`) → `getOrientation`. | Arrow to the shop on the last 100 m. | same |
| Accelerometer / gyro | Core Motion `CMMotionManager`. | `SensorManager` (`TYPE_ACCELEROMETER`, `TYPE_GYROSCOPE`). | Not used now. | same |
| Barometer / altitude | `CMAltimeter` (relative and absolute altitude; needs `NSMotionUsageDescription`). | `SensorManager` `TYPE_PRESSURE` (only on phones with a barometer). | Not used now. | same (hardware varies on Android) |
| Pedometer | `CMPedometer` (steps, distance, floors). | `TYPE_STEP_COUNTER` / `TYPE_STEP_DETECTOR` (needs `ACTIVITY_RECOGNITION` permission), or Health Connect. | Possible "walked X steps between stops" badge. Not built. | same |
| LiDAR | ARKit scene depth, Pro iPhones only. | none (some phones have ToF sensors; no common API). | Not used. | iOS-only |
| UWB | Nearby Interaction (`NISession`), iPhone 11 and later. | Jetpack UWB (`androidx.core.uwb`) on supported phones. ⚠ unverified: package name not re-checked on the page. | Not used (would need UWB beacons at shops). | same (hardware rare on Android) |
| NFC | Core NFC: read/write NDEF tags, some ISO 7816 / 15693 / FeliCa / MIFARE. Not available in app extensions. | Full NFC (`NfcAdapter`, reader mode, NDEF) plus **HCE** (phone emulates a card). | Option: NFC sticker at the counter as a second check-in signal. Not built. | different (Android can also emulate cards) |

## 6. Maps

| Feature | iOS API | Android API | How Giggles Maps uses it | Parity |
|---|---|---|---|---|
| Map view | MapKit for SwiftUI (`Map`, `Marker`, `MapPolyline`). Free, no key. | Google Maps SDK for Android / **Maps Compose** (`GoogleMap` composable; needs API key + billing account), or **MapLibre Native** (open source, bring your own tiles). | Show route polyline and stop pins. The route geometry comes from our `plan-route` Edge Function (Valhalla), not from the map SDK. | different |
| Directions | MapKit `MKDirections` (not used: our server plans the route). | Google Routes API (not used). | Server-side only. | same (both unused) |

Pick for Android: MapLibre Native if we want no Google billing, Maps Compose if we want Google's Thai POI labels. Either works because the route comes from our server.

## 7. System surfaces

| Feature | iOS API | Android API | How Giggles Maps uses it | Parity |
|---|---|---|---|---|
| Live progress on lock screen | Live Activities (ActivityKit, iOS 16.1+), shown on Lock Screen and **Dynamic Island**. | Android 16 (API 36) **Live Updates**: `Notification.ProgressStyle`, needs `POST_PROMOTED_NOTIFICATIONS` and `setRequestPromotedOngoing`. Google allows them only for activities "actively in progress" such as navigation, rideshare, food delivery; not for promotions. | "Next stop: 4 min, 2 of 3 stops" during an active trip. On Android it counts as navigation; never use it for shop promos. | different (Android stricter) |
| Home-screen widget | WidgetKit. | Jetpack Glance (`GlanceAppWidget`). | Badge count / "nearest partner shop". | same |
| Voice assistant / shortcuts | App Intents (Siri, Spotlight, Shortcuts, Action button). | App Actions (`shortcuts.xml` capabilities with built-in intents). ⚠ unverified: Google is moving assistant integration toward Gemini / AppFunctions; check current status before building. | "Plan a trip to …" shortcut. Not built. | different |
| Instant, no-install experience | **App Clips** (iOS 14+). Opened from a QR code or NFC tag. Great for a shop counter QR: scan → check in without installing. | none. **Android Instant Apps were shut down in December 2025.** Use App Links (verified `https://` deep links) that open the app, or the Play Store page if it is not installed. | Shop QR codes: same URL on both platforms. iOS shows the App Clip card; Android opens the app or Play Store. | iOS-only |

## 8. Sign-in

Backend is Supabase Auth on both platforms. Native sign-in gets an ID token on the phone, then calls `signInWithIdToken` (supabase-kt on Android).

| Feature | iOS API | Android API | How Giggles Maps uses it | Parity |
|---|---|---|---|---|
| Apple | Sign in with Apple (`ASAuthorizationAppleIDProvider`). App Store guideline 4.8: if we offer Google or LINE login, we must also offer a login that limits data to name + email, lets users hide their email and does no ad tracking. Sign in with Apple meets that, so we ship it. | Optional (web OAuth flow). Not needed. | iOS only. | iOS-only |
| Google | Google Sign-In SDK for iOS or web OAuth. | **Credential Manager** with Sign in with Google (`GetGoogleIdOption` / `GetSignInWithGoogleOption`). | Main login on Android. | same |
| LINE | LINE SDK for iOS (Swift). | LINE SDK for Android. | Most Thai users have LINE. Supabase has no built-in LINE provider that we found; plan is a Supabase **custom OAuth/OIDC provider** (`custom:` prefix). ⚠ unverified: whether LINE's ID tokens meet Supabase's custom-OIDC requirements. | same |
| Session storage | Keychain (supabase-swift default). | EncryptedSharedPreferences / DataStore (supabase-kt). | Keep the refresh token. | same |

## 9. Payments

Consumers use the app for free. Shops buy prepaid credit packs on the **web dashboard** through Stripe (card + PromptPay). Each verified visit takes the shop's bid from its wallet. The phone apps do not sell anything, so neither app needs StoreKit or Play Billing now.

| Feature | iOS API | Android API | How Giggles Maps uses it | Parity |
|---|---|---|---|---|
| Shop top-up | none (web only, Stripe). | none (web only, Stripe). | Never link to the shop top-up page from inside the consumer app. | same |
| Future consumer premium (digital goods) | StoreKit 2 (`Product`, `Transaction`). Required for digital goods sold in the app. | Google Play Billing Library. Required for digital goods sold in the app. | Not planned. If we add a premium tier, both stores take a cut and both apps need their own integration. | different |

## 10. Notifications

| Feature | iOS API | Android API | How Giggles Maps uses it | Parity |
|---|---|---|---|---|
| Push | APNs via User Notifications (`UNUserNotificationCenter`). | Firebase Cloud Messaging (FCM); runtime permission `POST_NOTIFICATIONS` on Android 13+. | "New badge", "shop you saved has a deal". Edge Function sends to APNs or FCM by platform. | same |
| Local / geofence notification | `UNLocationNotificationTrigger` or a local notification from `CLMonitor` events. | Notification from the geofence `PendingIntent`. | "You are near <shop>". | same |

---

## What the Android app must send for a check-in

1. Upload the selfie to Storage bucket `selfies` at `<auth user id>/<timestamp>.jpg` (JPEG, max 3 MB).
2. `POST /functions/v1/verify-checkin` with the user's access token as `Authorization: Bearer …`. Full contract: `docs/API.md`.

| Field | Type | Android source | What the server does with it |
|---|---|---|---|
| `place_id` | int | Stop the user tapped (from `plan-route`). | 404 `place_not_found` if it doesn't exist. |
| `lat`, `lng` | float | `Location.getLatitude()` / `getLongitude()` | More than 60 m from the place → `rejected`, reason `too_far`. Faster than 150 km/h since the user's last check-in in 24 h → `speed_jump`. |
| `accuracy_m` | float, metres | `Location.getAccuracy()` | Over 50 m → status `review`, reason `low_accuracy`. |
| `selfie_path` | string | Path from step 1. | Server confirms the file exists in that user's folder, else `no_selfie`. |
| `face_count` | int | Faces ML Kit found in the selfie. | Below 1 → `no_face`. |
| `client.platform` | `"android"` | constant | Stored for debugging. |
| `client.is_mock` | bool | `Location.isMock()` (API 31+) or `isFromMockProvider()`. | `true` → `mock_location`. |
| `client.attest` | string | Play Integrity standard-request token, `requestHash` = SHA-256 of the other fields. | Stored only; verification gets switched on server-side later, so send it now. |
| `client.demo` | bool | Only for demo builds. | Simulated location; only accepted at example places (403 `demo_only_at_example_places` otherwise). |

Response: `{ status, reasons[], rewarded, billed_thb, distance_m, new_badges[] }`. The user ID comes from the JWT, never the body. A shop is billed only when the check-in is `approved`, it is the user's first rewarded visit to that place that Bangkok day, and the shop's wallet covers its bid.

## Still unverified

- Thai on either on-device model (Apple list we found is from 2025; Google publishes none).
- Gemini Nano Prompt API context size and exact availability-check method name.
- Jetpack UWB package name `androidx.core.uwb` (page exists, name not re-read).
- App Actions' future given Gemini / AppFunctions.
- LINE Login as a Supabase custom OIDC provider. Community reports say LINE *web* login ID tokens are HS256 without `kid`, so the web flow likely needs an Edge Function that exchanges the code itself; native SDK tokens (ES256) may work with `signInWithIdToken`.
