import { useEffect, useState } from "react";

export type Ring = [number, number][];
export interface ProvinceFeature {
  id: number;
  properties: { id: number; iso: string; name_en: string; name_th: string };
  geometry: { type: string; coordinates: Ring[][] | Ring[] };
}

// fetched once per page load and shared by the province map and the 77 stamps
let cache: Promise<ProvinceFeature[]> | null = null;
export const loadProvinces = () => (cache ??= fetch("/provinces.geojson").then((r) => r.json()).then((fc) => fc.features as ProvinceFeature[])
  .catch((e) => { cache = null; throw e; }));

export function useProvinces() {
  const [features, setFeatures] = useState<ProvinceFeature[]>([]);
  useEffect(() => { loadProvinces().then(setFeatures).catch(() => undefined); }, []);
  return features;
}

/** Outer rings of a province (all its islands), as [lng, lat] lists. */
/** Thailand's bounding box and the 260 x 460 frame both maps draw it in (plain equirectangular: fine at this size). */
export const THAILAND = { lng0: 97.3, lng1: 105.7, lat0: 5.5, lat1: 20.6, w: 260, h: 460 } as const;
/** The Thai province name without its "จังหวัด" (province) prefix. */
export const thName = (f: ProvinceFeature) => f.properties.name_th.replace(/^จังหวัด/, "");

export const ringsOf = (g: ProvinceFeature["geometry"]): Ring[] =>
  ((g.type === "Polygon" ? [g.coordinates] : g.coordinates) as Ring[][]).map((poly) => poly[0]);

export const REGIONS = [
  { id: "central", en: "Central", th: "ภาคกลาง", ink: "#b8322a" },
  { id: "east", en: "East", th: "ภาคตะวันออก", ink: "#1f63a8" },
  { id: "northeast", en: "Northeast", th: "ภาคอีสาน", ink: "#5b3a9e" },
  { id: "north", en: "North", th: "ภาคเหนือ", ink: "#17734a" },
  { id: "west", en: "West", th: "ภาคตะวันตก", ink: "#a8530f" },
  { id: "south", en: "South", th: "ภาคใต้", ink: "#0d6f80" },
] as const;
export type Region = (typeof REGIONS)[number];
// ISO 3166-2:TH numbering follows the regions: 1x central, 2x east, 3x-4x northeast, 5x-6x north, 7x west, 8x-9x south
export const regionOf = (iso: string): Region => {
  const d = Number(iso.slice(3, 4));
  return REGIONS[d === 1 ? 0 : d === 2 ? 1 : d <= 4 ? 2 : d <= 6 ? 3 : d === 7 ? 4 : 5];
};
