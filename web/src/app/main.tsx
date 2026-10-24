import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/app.css";
import "../styles/cosmetics.css";
import App from "./App";
import Boundary from "./Boundary";
import { installDemoGps } from "../lib/demoGps";
import { installHScroll } from "../lib/hscroll";
import { isNative, openSite } from "../lib/native";
import { installTheme } from "../lib/theme";
import { SplashScreen } from "@capacitor/splash-screen";

if (isNative) {
  document.documentElement.classList.add("native");   // the iOS app: safe-area tweaks in app.css
  // the shop site isn't inside the app: its links open in the in-app browser
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.("a[href^='/shop']");
    if (a) { e.preventDefault(); openSite(a.getAttribute("href")!); }
  });
}
installTheme();     // Settings > Appearance: light, dark or follow the phone
installHScroll();   // mouse users: arrows and wheel for sideways rows
installDemoGps();   // demo mode (Profile) fakes the location for everything that reads it
import Debug from "./Debug";

const debug = import.meta.env.DEV ? new URLSearchParams(location.search).get("debug") : null;
// After a new version goes live, an open copy of the app asks for chunk names that no longer exist: reload once to get the
// new ones (not in a loop, and not offline, where the Boundary card explains instead).
addEventListener("vite:preloadError", (e) => {
  let last = 0;
  try { last = Number(sessionStorage.getItem("gm-reloaded-at")) || 0; sessionStorage.setItem("gm-reloaded-at", String(Date.now())); } catch { /* no storage: still reload once */ }
  if (navigator.onLine && Date.now() - last > 30_000) { e.preventDefault(); location.reload(); }
});
createRoot(document.getElementById("root")!).render(<Boundary page>{debug ? <Debug what={debug} /> : <App />}</Boundary>);
if (isNative) requestAnimationFrame(() => { void SplashScreen.hide(); });   // the first frame is on screen: lift the splash
// offline: keeps the app itself loadable with no signal (saved province maps cover the map)
if (import.meta.env.PROD && !isNative && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch((e) => console.error("service worker", e));
