import { useId } from "react";
import { type ProvinceFeature, type Region, regionOf, ringsOf, thName } from "./useProvinces";
import { stampDate } from "../../lib/format";

const SHAPES = ["circle", "rect", "octagon", "oval", "scallop", "hexagon", "postmark", "ticket"] as const;
type Shape = (typeof SHAPES)[number];
const ARC = new Set<Shape>(["circle", "scallop", "hexagon", "postmark"]);   // names curve along the ring

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

/** A small line drawing for each region, set into the date band: a temple spire, waves, a sticky-rice basket,
 *  mountains, a mountain over a river, a palm. Drawn on a 24 x 24 grid. */
const MOTIF: Record<Region["id"], string> = {
  central: "M12 2 L13.6 8 L15.6 8 L16.6 13 L18.6 13 L20 22 L4 22 L5.4 13 L7.4 13 L8.4 8 L10.4 8 Z",
  east: "M1 11 Q5 5 9 11 T17 11 T25 11 M1 18 Q5 12 9 18 T17 18 T25 18",
  northeast: "M6 7 L18 7 M7 7 L8 21 L16 21 L17 7 M9 7 Q12 2 15 7 M8 12 L16 12 M8.4 16.5 L15.6 16.5",
  north: "M1 21 L8 8 L11.5 14 L16 5 L23 21 Z",
  west: "M2 15 L8.5 5 L15 15 Z M13 15 L16.5 9.5 L22 15 M2 20 Q7 17 12 20 T22 20",
  south: "M12 22 L12 10 M12 10 Q6 5 1.5 9 M12 10 Q18 5 22.5 9 M12 10 Q9 3.5 4.5 3 M12 10 Q15 3.5 19.5 3",
};

// mono glyphs are ~0.6 em wide: the size that fits `text` (with its letter spacing) into `room` units, at most `max`
const fit = (text: string, max: number, room: number, spacing = 0) => Math.min(max, (room / Math.max(text.length, 1) - spacing) / 0.62);
const pt = (r: number, a: number) => `${(100 + r * Math.cos(a)).toFixed(1)},${(100 + r * Math.sin(a)).toFixed(1)}`;

function Border({ shape, ink }: { shape: Shape; ink: string }) {
  const s = { stroke: ink, fill: "none" };
  switch (shape) {
    case "rect": return <><rect x="12" y="26" width="176" height="148" rx="16" strokeWidth="6" {...s} /><rect x="22" y="36" width="156" height="128" rx="9" strokeWidth="1.6" {...s} /></>;
    case "octagon": return <><path d="M66 8 L134 8 L192 66 L192 134 L134 192 L66 192 L8 134 L8 66 Z" strokeWidth="6" {...s} />
      <path d="M70 19 L130 19 L181 70 L181 130 L130 181 L70 181 L19 130 L19 70 Z" strokeWidth="1.6" {...s} /></>;
    case "oval": return <><ellipse cx="100" cy="100" rx="93" ry="78" strokeWidth="6" {...s} /><ellipse cx="100" cy="100" rx="83" ry="68" strokeWidth="1.6" {...s} /></>;
    case "scallop": {
      const d = `M${pt(93, 0)}` + Array.from({ length: 28 }, (_, i) => ` Q${pt(101, ((i + 0.5) / 28) * Math.PI * 2)} ${pt(93, ((i + 1) / 28) * Math.PI * 2)}`).join("") + " Z";
      return <><path d={d} strokeWidth="4" {...s} /><circle cx="100" cy="100" r="82" strokeWidth="1.6" {...s} /></>;
    }
    case "hexagon": {
      const hex = (r: number) => "M" + Array.from({ length: 6 }, (_, i) => pt(r, (i / 6) * Math.PI * 2 - Math.PI / 2)).join(" L") + " Z";
      return <><path d={hex(96)} strokeWidth="6" strokeLinejoin="round" {...s} /><path d={hex(84)} strokeWidth="1.6" strokeLinejoin="round" {...s} /></>;
    }
    case "postmark": return <><circle cx="100" cy="100" r="92" strokeWidth="4" {...s} />
      <circle cx="100" cy="100" r="84" strokeWidth="3.2" strokeDasharray="0.1 6.2" strokeLinecap="round" {...s} />
      <circle cx="100" cy="100" r="77" strokeWidth="1.4" {...s} /></>;
    case "ticket": {   // notched corners, a perforated inner line
      const n = 16, x0 = 10, y0 = 28, x1 = 190, y1 = 172;
      const d = `M${x0 + n} ${y0} L${x1 - n} ${y0} A${n} ${n} 0 0 0 ${x1} ${y0 + n} L${x1} ${y1 - n} A${n} ${n} 0 0 0 ${x1 - n} ${y1} L${x0 + n} ${y1} A${n} ${n} 0 0 0 ${x0} ${y1 - n} L${x0} ${y0 + n} A${n} ${n} 0 0 0 ${x0 + n} ${y0} Z`;
      return <><path d={d} strokeWidth="6" {...s} /><rect x="24" y="40" width="152" height="120" rx="4" strokeWidth="1.6" strokeDasharray="4 3" {...s} /></>;
    }
    default: return <><circle cx="100" cy="100" r="92" strokeWidth="6" {...s} /><circle cx="100" cy="100" r="82" strokeWidth="1.6" {...s} /></>;
  }
}

/**
 * A rubber stamp for one province: its real silhouette, English and Thai names, region ink, one of eight stamp shapes
 * (picked by province id), an ENTRY date band with the region's motif, and an inked look (uneven pressure, a faint
 * second impression, a little bleed). Locked = a blank pressed into the paper. `fresh` drops it onto the page.
 */
export default function ProvinceStamp({ f, earnedAt, size = 120, tilt = true, fresh = false }: {
  f: ProvinceFeature; earnedAt?: string | null; size?: number; tilt?: boolean; fresh?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const { id, iso, name_en } = f.properties;
  const name_th = thName(f);
  const region = regionOf(iso);
  const locked = !earnedAt;
  const ink = locked ? "#b9b2a0" : region.ink;
  const shape = SHAPES[id % SHAPES.length];
  const rot = tilt ? ((id * 37) % 17) - 8 : 0;
  const label = locked ? `${name_en} stamp, not collected yet` : `${name_en} stamp, entered ${stampDate(earnedAt!)}`;

  const arc = ARC.has(shape);
  const en = name_en.toUpperCase();
  // zones: name on top, silhouette, the date band, Thai name underneath, never overlapping
  // straight names sit where the shape is wide enough: [baseline y, room]
  const top = ({ oval: [55, 100], octagon: [57, 110] } as Partial<Record<Shape, number[]>>)[shape] ?? [51, 136];
  const sil: [number, number, number, number] = arc ? [56, 44, 88, 68] : [58, top[0] + 5, 84, 112 - top[0]];
  const enSize = arc ? fit(en, 13, 118, 1.2) : fit(en, 15, top[1], 1);
  const thRoom = shape === "oval" ? 88 : shape === "octagon" || arc ? 100 : 136;
  const thSize = Math.min(15, thRoom / Math.max(name_th.length, 1) / 0.55);
  const pressure = (id * 53) % 360;   // which edge got less ink

  const draw = (ink: string) => <>
    <Border shape={shape} ink={ink} />
    <path d={outline(f, ...sil)} fill={ink} fillOpacity={locked ? 0.1 : 0.2} stroke={ink} strokeWidth="1.8" strokeLinejoin="round" />
    <g fill={ink} fontWeight="700" textAnchor="middle" stroke="none">
      {arc ? <text fontSize={enSize} letterSpacing="1.2" fontFamily="var(--font-data)"><textPath href={`#${uid}-top`} startOffset="50%">{en}</textPath></text>
        : <text x="100" y={top[0]} fontSize={enSize} fontFamily="var(--font-data)" letterSpacing="1">{en}</text>}
      <text x="100" y={shape === "oval" ? 156 : 159} fontSize={thSize} fontFamily="var(--font-body)">{name_th}</text>
    </g>
    {locked ? (
      <text x="100" y="131" textAnchor="middle" fontSize="12" fontWeight="700" fill={ink} stroke="none" fontFamily="var(--font-data)" letterSpacing="2">NOT YET</text>
    ) : (
      <g>
        <rect x="30" y="118" width="140" height="20" rx="2" fill={ink} stroke="none" />
        <path d={MOTIF[region.id]} transform="translate(34 120.5) scale(.62)" fill="none" stroke="#fdf8ec" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <text x="107" y="132" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fdf8ec" stroke="none" fontFamily="var(--font-data)" letterSpacing=".4"
          textLength="112" lengthAdjust="spacingAndGlyphs">ENTRY · {stampDate(earnedAt!)}</text>
      </g>
    )}
  </>;

  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={label} className={`province-stamp${locked ? " locked" : ""}${fresh ? " fresh" : ""}`}
      style={{ rotate: `${rot}deg` }}>
      <defs>
        <filter id={`${uid}-ink`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={id} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" result="d" />
          <feGaussianBlur in="d" stdDeviation=".35" result="b" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -6 4.9" result="m" />
          <feComposite in="b" in2="m" operator="in" />
        </filter>
        <linearGradient id={`${uid}-p`} gradientTransform={`rotate(${pressure} .5 .5)`}>
          <stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".55" stopColor="#fff" /></linearGradient>
        <mask id={`${uid}-m`}><rect width="200" height="200" fill={`url(#${uid}-p)`} /></mask>
        <path id={`${uid}-top`} d="M 38 100 A 62 62 0 0 1 162 100" />
      </defs>
      {locked ? <>
        <g transform="translate(0 1.4)" opacity=".9">{draw("#fffaf0")}</g>
        <g opacity=".8">{draw(ink)}</g>
      </> : <>
        {fresh && <circle className="stamp-splat" cx="100" cy="100" r="96" fill="none" stroke={ink} strokeWidth="3" />}
        <g transform="translate(1.6 -1.2)" opacity=".14">{draw(ink)}</g>
        <g filter={`url(#${uid}-ink)`} mask={`url(#${uid}-m)`} opacity=".94">{draw(ink)}</g>
      </>}
    </svg>
  );
}
