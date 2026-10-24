# Giggles Maps for iOS

The iOS app is the web app (`web/`) running in a [Capacitor 8](https://capacitorjs.com) shell, so every web change
reaches the app with the next build. The parts a web page can't do are native Swift plugins in `App/App/Plugins/`.

| Plugin | What it does | Called from |
|---|---|---|
| `Attest` | App Attest key + assertion over each check-in (`verify-checkin` logs `attest_ok`) | `checkinClient()` in `web/src/lib/native.ts` |
| `Purchases` | StoreKit 2: membership (one-time) and Plus (monthly). JWS goes to the Edge Function `apple-plus` | `purchase()`, `restorePurchases()`, `deliverPurchases()` |
| `LocationFix` | Check-in location with iOS's fake-GPS flag (`is_mock`) | `checkinFix()` |
| `Trip` | Live Activity for a running trip + "you're at a stop" notifications | `liveTrip.*` |

npm plugins: app (deep links), browser (sign-in in the system browser), filesystem + share (share cards),
haptics, keyboard, splash screen, status bar. The `GigglesWidgets` extension (Live Activity UI, Passport widget) and
`Shared/` are plain Swift.

The old SwiftUI app is kept in git under the tag `ios-swiftui-final`.

## Build

```bash
cd web && npm run ios        # builds web/dist-app and copies it into ios/App/App/public
cd ios/App && xcodegen       # only after editing project.yml
open ios/App/App.xcodeproj   # run the App scheme
```

`project.yml` (XcodeGen) is the source of the Xcode project. `npx cap sync ios` only touches `App/App/public`,
`capacitor.config.json` and `CapApp-SPM/Package.swift`.

## How the web code behaves in the app
- `isNative` in `web/src/lib/native.ts` is the one platform check. Screens call the wrappers there and keep the web
  behaviour when not native.
- Sign-in opens the system browser and comes back through `giggles://auth-callback` (allow-listed in Supabase Auth).
- Membership and Plus are bought through the App Store (guideline 3.1.1); the web keeps Stripe. Partner and booking
  money never goes through the app.
- `html.native` in CSS clears the status bar and keeps sheets inside the safe area.
- AdSense isn't allowed in app web views: the app shows house ads until AdMob IDs exist.

## Before the App Store
- Create the products `com.kristpaul.gigglesmaps.membership` and `com.kristpaul.gigglesmaps.plus.monthly` in App
  Store Connect (the local `GigglesPlus.storekit` file mirrors them for testing in Xcode).
- AdMob iOS app ID and banner / rewarded unit IDs.
- Prices on the purchase buttons are still the web's baht prices; App Store prices come from `Purchases.products()`.
