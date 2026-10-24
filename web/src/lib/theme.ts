import { useSyncExternalStore } from "react";
import { StatusBar, Style } from "@capacitor/status-bar";
import { isNative } from "./native";

// Appearance (Settings > Appearance): Light, Dark, or Auto, which follows the phone. Saved on this device. The resolved theme
// lives on <html data-theme>, which tokens.css reads; the inline script in app/index.html sets it before the first paint
// (same key, same rule), so a dark phone never flashes a light app.
export type Appearance = "auto" | "light" | "dark";
const KEY = "gm-appearance";
const media = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

export function appearance(): Appearance {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "auto"; } catch { return "auto"; }
}
const resolved = (): "light" | "dark" => {
  const a = appearance();
  return a === "auto" ? (media.matches ? "dark" : "light") : a;
};

function apply() {
  const theme = resolved();
  document.documentElement.dataset.theme = theme;
  // the browser bar and the iPhone status bar match the top bar under them
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111e40" : "#ffffff");
  if (isNative) void StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light }).catch(() => undefined);
  listeners.forEach((f) => f());
}

export function setAppearance(a: Appearance) {
  try { if (a === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, a); } catch { /* this visit only */ }
  apply();
}

/** Once at start: apply, then follow the phone switching between light and dark while Auto is on. */
export function installTheme() {
  apply();
  media.addEventListener("change", apply);
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
/** The theme on screen now ("light" | "dark"); re-renders when it changes. */
export const useTheme = () => useSyncExternalStore(subscribe, resolved);
/** The saved choice ("auto" | "light" | "dark"); re-renders when it changes. */
export const useAppearance = () => useSyncExternalStore(subscribe, appearance);
