import type maplibregl from "maplibre-gl";
import type { Protocol } from "pmtiles";

// Night map, plus offline province maps (Protomaps packs saved on the device).
export type Night = "auto" | "on" | "off";
export interface MapLook { night: Night }

const KEY = "gm-map-look";
export function loadLook(): MapLook {
  let v: Partial<MapLook> = {};
  try { v = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { /* nothing saved */ }
  return { night: ["on", "off"].includes(v.night as string) ? v.night! : "auto" };
}
export function saveLook(look: MapLook) { try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* private mode: not remembered */ } }

/** Auto: the map is dark exactly when the app is (Settings > Appearance, which can follow the phone). A dark map under a light
 *  app read as broken, so the old 18:30 clock rule is gone; "On" still forces it. */
export const isNight = (night: Night, dark = document.documentElement.dataset.theme === "dark") =>
  night === "on" || (night === "auto" && dark);

/** Online basemap: the coin-shop skin by day, OpenFreeMap's dark style at night. */
export const styleUrl = (skin: string, night: boolean) =>
  `https://tiles.openfreemap.org/styles/${night ? "dark" : ["bright", "positron"].includes(skin) ? skin : "liberty"}`;

// ---------- offline province maps ----------
// ponytail: r2.dev is rate limited; serve from a custom domain if downloads get busy
export const PACKS_URL = "https://pub-33a938fc0962483c8bdce739ffec9e22.r2.dev";
const PACK_CACHE = "gm-packs";
const GLYPHS = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const SPRITE = "https://protomaps.github.io/basemaps-assets/sprites/v4";

export interface Pack { iso: string; bytes: number; bbox: [number, number, number, number] }
const SAVED = "gm-packs-saved";
export function savedPacks(): Pack[] { try { return JSON.parse(localStorage.getItem(SAVED) ?? "[]"); } catch { return []; } }
const setSaved = (list: Pack[]) => { try { localStorage.setItem(SAVED, JSON.stringify(list)); } catch { /* not remembered */ } };

/** Download a province pack into Cache Storage, with the fonts and icons the offline style needs. */
export async function downloadPack(p: Pack, onProgress: (done: number) => void) {
  const res = await fetch(`${PACKS_URL}/${p.iso}.pmtiles`);
  if (!res.ok || !res.body) throw new Error("download failed");
  const reader = res.body.getReader(), parts: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    parts.push(value); done += value.length; onProgress(done);
  }
  // Latin and Thai glyphs in the three fonts the style uses, and the icon sprites (the service worker answers from here)
  const cache = await caches.open(PACK_CACHE);
  const fonts = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
  await cache.addAll([...fonts.flatMap((f) => ["0-255", "3584-3839"].map((r) => GLYPHS.replace("{fontstack}", encodeURIComponent(f)).replace("{range}", r))),
    ...["light", "dark"].flatMap((s) => [".json", ".png", "@2x.json", "@2x.png"].map((x) => `${SPRITE}/${s}${x}`))]);
  await cache.put(`/packs/${p.iso}.pmtiles`, new Response(new Blob(parts as BlobPart[]), { headers: { "Content-Type": "application/octet-stream" } }));
  setSaved([...savedPacks().filter((x) => x.iso !== p.iso), p]);
}

export async function deletePack(iso: string) {
  await (await caches.open(PACK_CACHE)).delete(`/packs/${iso}.pmtiles`);
  setSaved(savedPacks().filter((x) => x.iso !== iso));
}

let protocol: Protocol | null = null;
/** An offline style for the saved pack that covers (lng, lat), or null when there isn't one. */
export async function offlineStyle(lng: number, lat: number, night: boolean): Promise<maplibregl.StyleSpecification | null> {
  const p = savedPacks().find(({ bbox: [w, s, e, n] }) => lng >= w && lng <= e && lat >= s && lat <= n);
  if (!p || !("caches" in window)) return null;
  const hit = await (await caches.open(PACK_CACHE)).match(`/packs/${p.iso}.pmtiles`);
  if (!hit) return null;
  // the Protomaps libraries load only here, the first time a saved map is used
  const [{ default: maplibre }, { layers, namedFlavor }, { FileSource, PMTiles, Protocol }] =
    await Promise.all([import("maplibre-gl"), import("@protomaps/basemaps"), import("pmtiles")]);
  if (!protocol) { protocol = new Protocol(); maplibre.addProtocol("pmtiles", protocol.tile); }
  const name = `${p.iso}.pmtiles`;
  protocol.add(new PMTiles(new FileSource(new File([await hit.blob()], name))));
  const flavor = night ? "dark" : "light";
  return { version: 8, glyphs: GLYPHS, sprite: `${SPRITE}/${flavor}`,
    sources: { protomaps: { type: "vector", url: `pmtiles://${name}`, attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps' } },
    layers: layers("protomaps", namedFlavor(flavor), { lang: navigator.language.startsWith("th") ? "th" : "en" }) };
}
