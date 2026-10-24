import type { CapacitorConfig } from "@capacitor/cli";

// The iOS app: this web app (built by `npm run build:app`) in a native shell. The Xcode project lives in ../ios.
const config: CapacitorConfig = {
  appId: "com.kristpaul.gigglesmaps",
  appName: "Giggles Maps",
  webDir: "dist-app",
  ios: { path: "../ios", contentInset: "never", scheme: "Giggles Maps" },
  plugins: {
    Keyboard: { resize: "native" },   // the web view shrinks above the keyboard instead of the page sliding up
    // the splash stays until the app has drawn its first frame (main.tsx hides it): no white flash on a cold start
    SplashScreen: { launchAutoHide: false, launchFadeOutDuration: 250, backgroundColor: "#7cc6ff", showSpinner: false },
  },
};
export default config;
