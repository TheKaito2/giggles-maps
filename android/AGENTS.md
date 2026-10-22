# android/AGENTS.md: Giggles Maps Android app

Read `/AGENTS.md` first. Build order and acceptance criteria: `docs/ANDROID-ROADMAP.md`. API contract: `docs/API.md`.

## Stack (use these)

| Need | Use |
|---|---|
| Language / UI | Kotlin, Jetpack Compose, Material 3 |
| Architecture | Single-activity, Navigation Compose, one ViewModel per screen, `StateFlow` UI state, Kotlin coroutines. Keep it simple: no DI framework needed at the start (a small `AppContainer` object is fine). |
| Backend client | supabase-kt via its BOM: `implementation(platform("io.github.jan-tennert.supabase:bom:<latest>"))` + `auth-kt`, `postgrest-kt`, `storage-kt`, `functions-kt`; Ktor engine `io.ktor:ktor-client-okhttp`; `kotlinx-serialization-json` |
| Map | MapLibre Native Android (`org.maplibre.gl:android-sdk`) with style `https://tiles.openfreemap.org/styles/liberty` (free, no key). Show attribution. |
| Camera | CameraX (`camera-core`, `camera-camera2`, `camera-lifecycle`, `camera-view`), front lens |
| Face count | ML Kit Face Detection (bundled model `com.google.mlkit:face-detection`) |
| Location | Fused Location Provider (`play-services-location`), `Priority.PRIORITY_HIGH_ACCURACY` |
| Local storage | DataStore Preferences (consent flag, demo toggle) |
| Images | Compress selfie to JPEG, longest side ≤ 720 px, quality ~82, under 3 MB |

Look up current stable versions when adding dependencies; don't guess. `minSdk 26`, `targetSdk`/`compileSdk` = latest stable. Use a version catalog (`gradle/libs.versions.toml`).

## Backend config

```
SUPABASE_URL = https://xrlxfvwrkowaybtkkrdl.supabase.co
SUPABASE_PUBLISHABLE_KEY = sb_publishable_unEtGqM6FDr-HmdfE38TCw_OLM8TfoJ
```
Put both in `android/local.properties` (git-ignored) and expose them via `BuildConfig`. The publishable key is public by design; the secret key must never appear in this folder.

## Suggested structure

```
android/
  app/src/main/java/app/giggles/maps/
    data/      SupabaseProvider.kt, Api.kt (planRoute, verifyCheckin, deleteAccount), Models.kt (@Serializable DTOs matching docs/API.md)
    location/  LocationClient.kt (current fix + accuracy + isMock)
    camera/    SelfieCapture.kt (CameraX), FaceCounter.kt (ML Kit)
    ui/plan/   PlanScreen.kt, PlanViewModel.kt, MapView.kt (MapLibre in AndroidView)
    ui/checkin/ CheckInScreen.kt, CheckInViewModel.kt, ConsentScreen.kt
    ui/passport/ PassportScreen.kt, PassportViewModel.kt
    ui/theme/  Color.kt, Type.kt, Theme.kt
  app/src/main/res/values/strings.xml, values-th/strings.xml
```

## Flows (mirror the web app)

**Session.** On launch: if no session, `auth.signInAnonymously()`. All Edge Function calls send the user's access token (supabase-kt does this when the user is signed in).

**Plan route.** `functions.invoke("plan-route", body)` with `origin`, `dest`, `start_min` (minutes after midnight), `budget_min` (0–120 in the UI), `mode` (`pedestrian` | `auto`). Draw `geometry` (`[lng, lat]` pairs!) as a line, A (green) and B (red) pins, numbered stop pins (marigold for partners). Default points: start Phu Phan Museum 17.17313, 104.14488 → destination Wat Phra That Choeng Chum 17.16445, 104.15345.

**Check in.** Order matters:
1. Consent (first time only).
2. Capture selfie (front camera) → count faces with ML Kit.
3. Get a fresh location fix: lat, lng, `accuracy` (m), `isMock`. In demo mode skip this and use the stop's lat/lng, accuracy 5.
4. Upload JPEG to bucket `selfies` at `"${userId}/${System.currentTimeMillis()}.jpg"`.
5. `functions.invoke("verify-checkin", …)` with `place_id`, `lat`, `lng`, `accuracy_m`, `selfie_path`, `face_count`, `client = { platform: "android", is_mock, attest, demo }`.
6. Show the result.

**Passport.** Read with postgrest (RLS limits to own rows):
- `collections` select `id, slug, name, description, required_count, collection_places(place_id)`
- `checkins` select `id, place_id, status, rewarded, created_at, places(name)` order by `created_at` desc, limit 50
- `user_badges` select `collection_id`
Progress per collection = distinct `place_id`s with `rewarded = true` that are in that collection.

## User-facing text (keep identical to web, add Thai)

Reasons from `verify-checkin`:
| code | English |
|---|---|
| `too_far` | You're more than 60 m from this place. |
| `no_face` | We couldn't see a face in the selfie. |
| `no_selfie` | The selfie didn't upload. |
| `mock_location` | Your location looks simulated. |
| `speed_jump` | You moved faster than a car since your last check-in. |
| `low_accuracy` | GPS was too rough (over 50 m). A person will review it. |
| `already_rewarded_today` | Already stamped here today. Come back tomorrow. |

Categories: `cafe` Café · `food` Food · `craft` Craft shop · `temple` Temple · `park` Park · `museum` Museum · `market` Market · `viewpoint` Viewpoint · `art` Art.

Status: `approved` + `rewarded` → "Checked in!" · `approved` + not rewarded → "Checked in, no new stamp." · `review` → "Sent for review." · `rejected` → "Check-in not accepted."

## Look and feel

Match the web app (`web/src/styles/tokens.css`): indigo `#27348B` (structure, buttons), marigold `#E9A400` (partner, main action), stamp red `#D1452F` (badges, destination pin), good green `#1B7F52` (start pin), paper `#F3F4F9`. Dark theme values are in the same file. Fonts (Google Fonts): Mali (headings), Anuphan (body, supports Thai), IBM Plex Mono (numbers). Stamp animation on a rewarded check-in.

## Commands

```bash
cd android
./gradlew assembleDebug          # build
./gradlew testDebugUnitTest      # unit tests
./gradlew lint                   # lint
```

## Definition of done (every feature)

- Meets its "done when" line in `docs/ANDROID-ROADMAP.md`.
- Builds with no warnings-as-errors failures; lint clean for new code.
- Unit test for any non-trivial logic (DTO parsing, collection progress, error-code mapping).
- Tested on a **physical phone** for camera, location and check-in (emulators fake GPS and cameras).
- Permission-denied paths handled with a clear message, no crashes offline.
- Strings in both `values/` and `values-th/`.
