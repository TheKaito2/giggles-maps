import { useId } from "react";
import { type ProvinceFeature, regionOf, ringsOf } from "./useProvinces";

// provinces with illustrated art in /stamps/<iso>.webp replace the drawn stamp (none yet)
const ART = new Set<string>();
const SHAPES = ["circle", "rect", "octagon", "oval", "scallop"] as const;

/** The province outline fitted into a box, as one SVG path (longitude scaled by latitude so shapes aren't stretched).
 *  Cached: a passport draws all 77 stamps on every render, and each outline walks thousands of points. */
const outlines = new Map<string, string>();
function outline(f: ProvinceFeature, x: number, y: number, w: number, h: number) {
  const key = `${f.id}:${x},${y},${w},${h}`;
  const hit = outlines.get(key);
  if (hit) return hit;
  const d = drawOutline(f, x, y, w, h);
  outlines.set(key, d);
  return d;
}
function drawOutline(f: ProvinceFeature, x: number, y: number, w: number, h: number) {
  const rings = ringsOf(f.geometry);
  const pts = rings.flat();
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * k), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1));
  const ox = x + (w - (maxX - minX) * s) / 2, oy = y + (h - (maxY - minY) * s) / 2;
  return rings.map((r) => "M" + r.map(([lng, lat]) => `${(ox + (lng * k - minX) * s).toFixed(1)},${(oy + (maxY - lat) * s).toFixed(1)}`).join("L") + "Z").join("");
}

const fit = (text: string, max: number, room: number) => Math.min(max, room / Math.max(text.length, 1));
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();

/**
 * A rubber-stamp for one province: its real silhouette, English and Thai names, region ink, one of five stamp shapes
 * (picked by province id), an ENTRY date band and a rough-ink filter. Locked = faint dashed outline, no date.
 */
export default function ProvinceStamp({ f, earnedAt, size = 120, tilt = true }: {
  f: ProvinceFeature; earnedAt?: string | null; size?: number; tilt?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const { id, iso, name_en } = f.properties;
  const name_th = f.properties.name_th.replace(/^จังหวัด/, "");
  const region = regionOf(iso);
  const locked = !earnedAt;
  const ink = locked ? "#9aa0b4" : region.ink;
  const shape = SHAPES[id % SHAPES.length];
  const rot = tilt ? ((id * 37) % 17) - 8 : 0;
  const label = locked ? `${name_en} stamp, not collected yet` : `${name_en} stamp, entered ${fmt(earnedAt!)}`;

  if (!locked && ART.has(iso)) {
    return <img src={`/stamps/${iso}.webp`} width={size} height={size} alt={label} style={{ rotate: `${rot}deg` }} className="province-stamp" />;
  }

  const arc = shape === "circle" || shape === "scallop";
  const en = name_en.toUpperCase();
  const stroke = { stroke: ink, fill: "none" };
  const border = (() => {
    switch (shape) {
      case "rect": return <><rect x="14" y="30" width="172" height="140" rx="18" strokeWidth="6" {...stroke} /><rect x="24" y="40" width="152" height="120" rx="10" strokeWidth="1.6" {...stroke} /></>;
      case "octagon": return <><path d="M66 10 L134 10 L190 66 L190 134 L134 190 L66 190 L10 134 L10 66 Z" strokeWidth="6" {...stroke} />
        <path d="M70 21 L130 21 L179 70 L179 130 L130 179 L70 179 L21 130 L21 70 Z" strokeWidth="1.6" {...stroke} /></>;
      case "oval": return <><ellipse cx="100" cy="100" rx="92" ry="74" strokeWidth="6" {...stroke} /><ellipse cx="100" cy="100" rx="82" ry="64" strokeWidth="1.6" {...stroke} /></>;
      case "scallop": {
        const pt = (r: number, i: number) => `${(100 + r * Math.cos((i / 28) * Math.PI * 2)).toFixed(1)},${(100 + r * Math.sin((i / 28) * Math.PI * 2)).toFixed(1)}`;
        const d = `M${pt(93, 0)}` + Array.from({ length: 28 }, (_, i) => ` Q${pt(101, i + 0.5)} ${pt(93, i + 1)}`).join("") + " Z";
        return <><path d={d} strokeWidth="4" {...stroke} /><circle cx="100" cy="100" r="80" strokeWidth="1.6" {...stroke} /></>;
      }
      default: return <><circle cx="100" cy="100" r="92" strokeWidth="6" {...stroke} /><circle cx="100" cy="100" r="82" strokeWidth="1.6" {...stroke} /></>;
    }
  })();
  const silBox = arc ? [62, 48, 76, 62] : shape === "oval" ? [64, 52, 72, 56] : [62, 58, 76, 58];

  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={label} className={`province-stamp${locked ? " locked" : ""}`}
      style={{ rotate: `${rot}deg` }}>
      <defs>
        <filter id={`${uid}-ink`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={id} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" result="d" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -6 4.9" result="m" />
          <feComposite in="d" in2="m" operator="in" />
        </filter>
        <path id={`${uid}-top`} d="M 32 100 A 68 68 0 0 1 168 100" />
        <path id={`${uid}-bot`} d="M 37 100 A 63 63 0 0 0 163 100" />
      </defs>
      <g filter={locked ? undefined : `url(#${uid}-ink)`} opacity={locked ? 0.55 : 0.92} strokeDasharray={locked ? "5 5" : undefined}>
        {border}
        <path d={outline(f, ...(silBox as [number, number, number, number]))} fill={ink} fillOpacity={locked ? 0.08 : 0.22} stroke={ink} strokeWidth="1.6" strokeLinejoin="round" />
        {arc ? (
          <g fill={ink} fontFamily="var(--font-data)" fontWeight="700" textAnchor="middle" stroke="none">
            <text fontSize={fit(en, 15, 190)} letterSpacing="1.5"><textPath href={`#${uid}-top`} startOffset="50%">{en}</textPath></text>
            <text fontSize={fit(name_th, 15, 170)} fontFamily="var(--font-body)"><textPath href={`#${uid}-bot`} startOffset="50%" dominantBaseline="hanging">{name_th}</textPath></text>
          </g>
        ) : (
          <g fill={ink} fontWeight="700" textAnchor="middle" stroke="none">
            <text x="100" y={shape === "oval" ? 48 : 52} fontSize={fit(en, 14, 150)} fontFamily="var(--font-data)" letterSpacing="1.2">{en}</text>
            <text x="100" y={shape === "oval" ? 160 : 156} fontSize={fit(name_th, 15, 140)} fontFamily="var(--font-body)">{name_th}</text>
          </g>
        )}
        {locked ? (
          <text x="100" y="134" textAnchor="middle" fontSize="12" fontWeight="700" fill={ink} stroke="none" fontFamily="var(--font-data)">NOT YET</text>
        ) : (
          <g>
            <rect x="26" y="118" width="148" height="20" fill={ink} stroke="none" />
            <text x="100" y="132.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fdf8ec" stroke="none" fontFamily="var(--font-data)" letterSpacing=".4" textLength="132" lengthAdjust="spacingAndGlyphs">
              ENTRY · {fmt(earnedAt!)}</text>
          </g>
        )}
      </g>
    </svg>
  );
}
