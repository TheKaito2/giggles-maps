import type { CapacitorConfig } from "@capacitor/cli";

// The iOS app: this web app (built by `npm run build:app`) in a native shell. The Xcode project lives in ../ios.
const config: CapacitorConfig = {
  appId: "com.kristpaul.gigglesmaps",
  appName: "Giggles Maps",
  webDir: "dist-app",
  ios: { path: "../ios", contentInset: "never", scheme: "Giggles Maps" },
  plugins: {
    Keyboard: { resize: "native" },   // the web view shrinks above the keyboard instead of the page sliding up
    SplashScreen: { launchShowDuration: 600, backgroundColor: "#f3f4f9", showSpinner: false },
  },
};
export default config;
