// Labels and date formats shared by the app, the passport and the share cards (en-GB, like the rest of the UI).
export const STAMP_TIER = { 3: "Landmark", 2: "Worth a visit", 1: "Everyday" } as const;
export const ROMAN = ["", "I", "II", "III", "IV", "V"];

/** 14:05 */
export const clockTime = (d: Date | string) => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
/** 23 OCT 2026, the date on a stamp */
export const stampDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
