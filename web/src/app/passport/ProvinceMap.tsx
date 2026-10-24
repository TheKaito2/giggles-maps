import { type ProvinceFeature, ringsOf, THAILAND, useProvinces } from "./useProvinces";

const { lng0, lng1, lat0, lat1, w: W, h: H } = THAILAND;
const x = (lng: number) => ((lng - lng0) / (lng1 - lng0)) * W;
const y = (lat: number) => ((lat1 - lat) / (lat1 - lat0)) * H;
// each outline walks thousands of points: build its path once, not on every page turn
const paths = new Map<number, string>();
const path = (f: ProvinceFeature) => {
  let d = paths.get(f.id);
  if (!d) {
    d = ringsOf(f.geometry).map((r) => "M" + r.map(([lng, lat]) => `${x(lng).toFixed(1)},${y(lat).toFixed(1)}`).join("L") + "Z").join("");
    paths.set(f.id, d);
  }
  return d;
};

/** The 77 provinces; visited ones fill in (darker with more stamps). */
export default function ProvinceMap({ counts }: { counts: Map<number, number> }) {
  const features = useProvinces();
  const visited = [...counts.values()].filter((n) => n > 0).length;
  return (
    <div className="province-map">
      <div className="row between"><b>{visited} of 77 provinces</b></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Map of Thailand, ${visited} provinces visited`}>
        {features.map((f) => {
          const n = counts.get(f.id) ?? 0;
          return (
            <path key={f.id} d={path(f)} className={`prov${n ? " visited" : ""}`} style={n ? { fillOpacity: Math.min(1, 0.45 + n * 0.1) } : undefined}>
              <title>{f.properties.name_en} · {f.properties.name_th}{n ? ` · ${n} stamp${n === 1 ? "" : "s"}` : ""}</title>
            </path>
          );
        })}
      </svg>
    </div>
  );
}
