import { useEffect, useState } from "react";

type Ring = [number, number][];
interface Feature { id: number; properties: { id: number; name_en: string; name_th: string }; geometry: { type: string; coordinates: Ring[][] | Ring[] } }

// Thailand's bounding box; a plain equirectangular projection is fine at this size
const W = 260, H = 460, LNG0 = 97.3, LNG1 = 105.7, LAT0 = 5.5, LAT1 = 20.6;
const x = (lng: number) => ((lng - LNG0) / (LNG1 - LNG0)) * W;
const y = (lat: number) => ((LAT1 - lat) / (LAT1 - LAT0)) * H;
const path = (g: Feature["geometry"]) => {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as Ring[][];
  return polys.map((rings) => rings.map((r) => "M" + r.map(([lng, lat]) => `${x(lng).toFixed(1)},${y(lat).toFixed(1)}`).join("L") + "Z").join("")).join("");
};

/** The 77 provinces; visited ones fill in (darker with more stamps). Tap one to filter the passport. */
export default function ProvinceMap({ counts, selected, onSelect }: {
  counts: Map<number, number>; selected: number | null; onSelect: (id: number | null) => void;
}) {
  const [features, setFeatures] = useState<Feature[]>([]);
  useEffect(() => { fetch("/provinces.geojson").then((r) => r.json()).then((fc) => setFeatures(fc.features)).catch(() => undefined); }, []);
  const visited = [...counts.values()].filter((n) => n > 0).length;
  const name = features.find((f) => f.id === selected)?.properties.name_en;
  return (
    <div className="province-map">
      <div className="row between">
        <b>{visited} of 77 provinces</b>
        {selected != null && <button type="button" className="link" onClick={() => onSelect(null)}>Show all ({name})</button>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Map of Thailand, ${visited} provinces visited`}>
        {features.map((f) => {
          const n = counts.get(f.id) ?? 0;
          return (
            <path key={f.id} d={path(f.geometry)} className={`prov${n ? " visited" : ""}${selected === f.id ? " sel" : ""}`}
              style={n ? { fillOpacity: Math.min(1, 0.45 + n * 0.1) } : undefined} onClick={() => onSelect(selected === f.id ? null : f.id)}>
              <title>{f.properties.name_en} · {f.properties.name_th}{n ? ` · ${n} stamp${n === 1 ? "" : "s"}` : ""}</title>
            </path>
          );
        })}
      </svg>
    </div>
  );
}
