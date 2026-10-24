import { loadProvinces, type ProvinceFeature, REGIONS, regionOf, ringsOf } from "../passport/useProvinces";

// Share images, drawn on a canvas: story size (1080 x 1920), or a square transparent sticker to lay over your own photo in
// Instagram Stories. Classic is free; the other designs come with Giggles Plus.
export const DESIGNS = {
  classic: { name: "Classic", bg: ["#e8eafb", "#ffffff"], ink: "#283593", accent: "#c0392b", plus: false },
  postcard: { name: "Postcard", bg: ["#fff2d9", "#fad9b3"], ink: "#4d260d", accent: "#bf4019", plus: true },
  neon: { name: "Night neon", bg: ["#14052e", "#4d0d59"], ink: "#ffffff", accent: "#ff4dbf", plus: true },
  indigo: { name: "Indigo cloth", bg: ["#212b73", "#0d1238"], ink: "#ffffff", accent: "#e8a317", plus: true },
} as const;
export type Design = keyof typeof DESIGNS;

const TIER = { 3: "LANDMARK", 2: "WORTH A VISIT", 1: "EVERYDAY" } as const;
const DISPLAY = '"Mali", "LINE Seed Sans TH", sans-serif', BODY = '"LINE Seed Sans TH", system-ui, sans-serif', MONO = '"IBM Plex Mono", monospace';
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();

export type Card =
  | { kind: "photo" | "sticker"; place: string; placeTh: string | null; tier: 1 | 2 | 3; province: string | null; at: Date; level: number | null; photo?: string }
  | { kind: "progress"; name: string; visited: Set<number> }
  | { kind: "milestone"; what: "province"; province: number | string; at: Date; name: string }   // province id or English name
  | { kind: "milestone"; what: "level"; level: number; name: string }
  | { kind: "milestone"; what: "badge"; title: string; tier: number; colour: string; name: string }
  | { kind: "milestone"; what: "fortune"; rarity: string; prize: string; stick: number; name: string }
  | { kind: "trip"; title: string; photos: string[]; members: string[]; at: Date };

function image(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.crossOrigin = "anonymous";   // signed storage links allow it; without it the canvas can't be exported
    img.onload = () => ok(img); img.onerror = () => ok(null);
    img.src = src;
  });
}
const fonts = () => Promise.all([`800 80px ${BODY}`, `700 80px ${DISPLAY}`, `600 40px ${MONO}`].map((f) => document.fonts.load(f).catch(() => [])));

/** Draw an image to cover a box (centre crop). */
function cover(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}
/** Fill text, shrinking it until it fits the width. */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string, weight = 800) {
  let s = size;
  do { g.font = `${weight} ${s}px ${font}`; s -= 4; } while (g.measureText(text).width > maxW && s > 24);
  g.fillText(text, x, y);
}
/** Text across up to two lines (by words), shrinking to fit; returns the y below the last line. */
function twoLines(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string) {
  for (let s = size; s >= 40; s -= 4) {
    g.font = `800 ${s}px ${font}`;
    const words = text.split(" ");
    let a = "", i = 0;
    for (; i < words.length && g.measureText(`${a} ${words[i]}`.trim()).width <= maxW; i++) a = `${a} ${words[i]}`.trim();
    const b = words.slice(i).join(" ");
    if (!b || g.measureText(b).width <= maxW || s === 40) {
      g.fillText(a || text, x, y);
      if (b) g.fillText(b, x, y + s * 1.08);
      return y + (b ? 2 : 1) * s * 1.08;
    }
  }
  return y;
}
/** Wear the ink: knock small specks out of what's on the canvas, the same pattern every time. */
function speckle(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  let s = seed || 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.save(); g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 900; i++) { g.globalAlpha = 0.25 + rnd() * 0.6; g.beginPath(); g.arc(x + rnd() * w, y + rnd() * h, 0.6 + rnd() * 2.6, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

/** A round rubber stamp: double ring, words around the edge, a big middle line and a date band. Drawn at (cx, cy). */
function stamp(cx: number, cy: number, r: number, ink: string, top: string, middle: string | ((g: CanvasRenderingContext2D) => void), band: string,
  seed: number, paper?: string) {
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(r * 2 + 40);
  const g = c.getContext("2d")!;
  const o = c.width / 2;
  if (paper) { g.fillStyle = paper; g.beginPath(); g.arc(o, o, r, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = ink; g.fillStyle = ink;
  g.lineWidth = r * 0.06; g.beginPath(); g.arc(o, o, r * 0.96, 0, Math.PI * 2); g.stroke();
  g.lineWidth = r * 0.016; g.beginPath(); g.arc(o, o, r * 0.8, 0, Math.PI * 2); g.stroke();
  // words around the top
  g.font = `700 ${r * 0.11}px ${MONO}`; g.textAlign = "center"; g.textBaseline = "middle";
  const chars = [...top], step = Math.min(0.13, (Math.PI * 0.9) / chars.length);
  chars.forEach((ch, i) => {
    g.save(); g.translate(o, o); g.rotate((i - (chars.length - 1) / 2) * step); g.fillText(ch, 0, -r * 0.88); g.restore();
  });
  [-1, 1].forEach((side) => { g.beginPath(); g.arc(o + side * r * 0.62, o + r * 0.5, r * 0.035, 0, Math.PI * 2); g.fill(); });
  g.save(); g.translate(o, o);
  if (typeof middle === "string") fitText(g, middle, 0, -r * 0.08, r * 1.36, r * 0.34, BODY, 900);
  else middle(g);
  g.fillRect(-r * 0.74, r * 0.14, r * 1.48, r * 0.22);
  g.font = `700 ${r * 0.11}px ${MONO}`;
  if (paper) g.fillStyle = paper; else g.globalCompositeOperation = "destination-out";   // no paper: the date shows what's under the stamp
  g.fillText(band, 0, r * 0.255);
  g.globalCompositeOperation = "source-over";
  g.restore();
  speckle(g, 0, 0, c.width, c.height, seed);
  return { canvas: c, x: cx - o, y: cy - o };
}
function placeStamp(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, ink: string, tier: 1 | 2 | 3, at: Date, seed: number, paper?: string) {
  const s = stamp(cx, cy, r, ink, "GIGGLES MAPS · ประทับตรา", TIER[tier], `ENTRY · ${day(at)}`, seed, paper);
  g.save(); g.translate(cx, cy); g.rotate(-0.14); g.translate(-cx, -cy); g.drawImage(s.canvas, s.x, s.y); g.restore();
}

function background(g: CanvasRenderingContext2D, d: Design, w: number, h: number) {
  const grad = g.createLinearGradient(0, 0, w * 0.3, h);
  grad.addColorStop(0, DESIGNS[d].bg[0]); grad.addColorStop(1, DESIGNS[d].bg[1]);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
}
function footer(g: CanvasRenderingContext2D, colour: string, y = 1840) {
  g.fillStyle = colour; g.globalAlpha = 0.75; g.textAlign = "center"; g.font = `600 34px ${MONO}`;
  g.fillText("giggles-maps.pages.dev", 540, y); g.globalAlpha = 1;
}
/** Thailand, visited provinces filled, fitted into a box. */
function thailand(g: CanvasRenderingContext2D, features: ProvinceFeature[], visited: (id: number) => boolean, x: number, y: number, h: number, fill: string, rest: string) {
  const LNG0 = 97.3, LNG1 = 105.7, LAT0 = 5.5, LAT1 = 20.6, w = h * (260 / 460);
  for (const f of features) {
    const p = new Path2D();
    for (const ring of ringsOf(f.geometry)) ring.forEach(([lng, lat], i) => {
      const px = x + ((lng - LNG0) / (LNG1 - LNG0)) * w, py = y + ((LAT1 - lat) / (LAT1 - LAT0)) * h;
      if (i) p.lineTo(px, py); else p.moveTo(px, py);
    });
    g.fillStyle = visited(f.id) ? fill : rest; g.fill(p);
    g.strokeStyle = "rgb(255 255 255 / .55)"; g.lineWidth = 1.5; g.stroke(p);
  }
  return w;
}

/** A province's outline, fitted into a box centred on (0, cy) (longitude scaled by latitude so shapes aren't stretched). */
function silhouette(f: ProvinceFeature, size: number, cy: number) {
  const rings = ringsOf(f.geometry), pts = rings.flat();
  const k = Math.cos(((pts.reduce((a, p) => a + p[1], 0) / pts.length) * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * k), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = size / Math.max(maxX - minX, maxY - minY);
  const path = new Path2D();
  for (const ring of rings) ring.forEach(([lng, lat], i) => {
    const x = (lng * k - (minX + maxX) / 2) * s, y = cy + ((minY + maxY) / 2 - lat) * s;
    if (i) path.lineTo(x, y); else path.moveTo(x, y);
  });
  return path;
}

const SHIELD = "M50 4 L92 20 L92 58 C92 82 72 98 50 106 C28 98 8 82 8 58 L8 20 Z";

/** Draw a card. Story cards are 1080 x 1920; the sticker is 1080 x 1080 with a clear background. */
export async function drawCard(card: Card, d: Design): Promise<HTMLCanvasElement> {
  await fonts();
  const { ink, accent } = DESIGNS[d];
  const c = document.createElement("canvas");
  c.width = 1080; c.height = card.kind === "sticker" ? 1080 : 1920;
  const g = c.getContext("2d")!;
  g.textAlign = "center"; g.textBaseline = "alphabetic";

  if (card.kind === "sticker") {
    placeStamp(g, 540, 430, 360, accent, card.tier, card.at, card.place.length, "rgb(255 255 255 / .92)");
    g.fillStyle = "rgb(255 255 255 / .94)";
    g.beginPath(); g.roundRect(80, 840, 920, card.placeTh ? 200 : 140, 40); g.fill();
    g.fillStyle = "#1d1d2b"; fitText(g, card.place, 540, 920, 860, 70, BODY);
    if (card.placeTh) { g.fillStyle = "#555"; fitText(g, card.placeTh, 540, 1000, 860, 50, BODY, 700); }
    return c;
  }

  if (card.kind === "photo") {
    const img = card.photo ? await image(card.photo) : null;
    if (img) {
      cover(g, img, 0, 0, 1080, 1920);
      const top = g.createLinearGradient(0, 0, 0, 360); top.addColorStop(0, "rgb(0 0 0 / .5)"); top.addColorStop(1, "rgb(0 0 0 / 0)");
      g.fillStyle = top; g.fillRect(0, 0, 1080, 360);
      const bot = g.createLinearGradient(0, 1000, 0, 1920); bot.addColorStop(0, "rgb(0 0 0 / 0)"); bot.addColorStop(1, "rgb(0 0 0 / .82)");
      g.fillStyle = bot; g.fillRect(0, 1000, 1080, 920);
    } else background(g, d, 1080, 1920);
    const text = img ? "#ffffff" : ink;
    g.fillStyle = text; g.textAlign = "left"; g.font = `600 36px ${MONO}`;
    g.fillText("GIGGLES MAPS", 72, 130);
    g.textAlign = "right"; g.fillText(day(card.at), 1008, 130);
    if (img) placeStamp(g, 790, 1060, 230, "#ffffff", card.tier, card.at, card.place.length);
    else placeStamp(g, 540, 760, 390, accent, card.tier, card.at, card.place.length);
    g.textAlign = "left"; g.fillStyle = text;
    let y = twoLines(g, card.place, 72, 1440, 936, 96, BODY);
    if (card.placeTh) { g.globalAlpha = 0.85; g.font = `700 56px ${BODY}`; g.fillText(card.placeTh, 72, y + 4); y += 70; g.globalAlpha = 1; }
    g.fillStyle = img ? "#ffd166" : accent; g.font = `700 44px ${BODY}`;
    g.fillText([card.province, card.level ? `Level ${card.level} explorer` : null].filter(Boolean).join("  ·  "), 72, y + 40);
    footer(g, text);
    return c;
  }

  background(g, d, 1080, 1920);
  if (card.kind === "progress") {
    const features = await loadProvinces();
    g.fillStyle = ink; g.font = `600 36px ${MONO}`; g.fillText("GIGGLES MAPS · PASSPORT", 540, 150);
    g.font = `700 92px ${DISPLAY}`; g.fillText("My Thailand", 540, 270);
    g.globalAlpha = 0.75; g.font = `700 44px ${BODY}`; g.fillText(card.name, 540, 340); g.globalAlpha = 1;
    // the map on the left, the big count on its right
    const mx = 60, w = thailand(g, features, (id) => card.visited.has(id), mx, 400, 1000, accent,
      d === "neon" || d === "indigo" ? "rgb(255 255 255 / .16)" : "rgb(40 53 147 / .12)");
    const cx = mx + w + (1080 - mx - w) / 2;
    g.fillStyle = accent; g.font = `900 220px ${BODY}`; g.fillText(String(card.visited.size), cx, 820);
    g.fillStyle = ink; g.font = `700 60px ${BODY}`; g.fillText("of 77", cx, 900);
    g.font = `700 40px ${BODY}`; g.globalAlpha = 0.75; g.fillText("provinces", cx, 960); g.globalAlpha = 1;
    // region bars
    const regions = REGIONS.map((r) => {
      const all = features.filter((f) => regionOf(f.properties.iso).id === r.id);
      return { r, have: all.filter((f) => card.visited.has(f.id)).length, total: all.length };
    });
    regions.forEach(({ r, have, total }, i) => {
      const y = 1480 + i * 56;
      g.textAlign = "left"; g.fillStyle = ink; g.font = `700 34px ${BODY}`; g.fillText(r.en, 100, y + 12);
      g.globalAlpha = 0.15; g.fillRect(380, y - 12, 520, 24); g.globalAlpha = 1;
      g.fillStyle = r.ink; g.fillRect(380, y - 12, total ? (520 * have) / total : 0, 24);
      g.fillStyle = ink; g.textAlign = "right"; g.font = `600 30px ${MONO}`; g.fillText(`${have}/${total}`, 990, y + 10);
    });
    footer(g, ink);
    return c;
  }

  if (card.kind === "trip") {
    g.fillStyle = ink; g.font = `600 36px ${MONO}`; g.fillText(`RIDE ALONG · ${day(card.at)}`, 540, 150);
    g.font = `700 88px ${DISPLAY}`; fitText(g, card.title, 540, 260, 940, 88, DISPLAY, 700);
    const imgs = (await Promise.all(card.photos.slice(0, 6).map(image))).filter((x): x is HTMLImageElement => !!x);
    const cols = imgs.length > 2 ? 2 : 1, rows = Math.ceil(imgs.length / cols) || 1;
    const cw = cols === 2 ? 440 : 760, ch = Math.min(cw * 1.2, (1300 - 40 * rows) / rows);
    imgs.forEach((img, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = (1080 - cols * cw - (cols - 1) * 40) / 2 + col * (cw + 40), y = 340 + row * (ch + 40);
      g.save(); g.translate(x + cw / 2, y + ch / 2); g.rotate(((i * 37) % 7 - 3) * 0.012);
      g.fillStyle = "#fff"; g.shadowColor = "rgb(0 0 0 / .25)"; g.shadowBlur = 24; g.fillRect(-cw / 2 - 14, -ch / 2 - 14, cw + 28, ch + 28);
      g.shadowBlur = 0; cover(g, img, -cw / 2, -ch / 2, cw, ch); g.restore();
    });
    g.fillStyle = ink; g.font = `700 44px ${BODY}`; fitText(g, card.members.join(" · "), 540, 1760, 940, 44, BODY, 700);
    footer(g, ink);
    return c;
  }

  // milestones: a big emblem in the middle, the news underneath
  const m = card as Extract<Card, { kind: "milestone" }>;   // only milestones are left here
  const [head, title, sub] = await (async (): Promise<[string, string, string]> => {
    switch (m.what) {
      case "province": {
        const f = (await loadProvinces()).find((x) => x.id === m.province || x.properties.name_en === m.province);
        const en = f?.properties.name_en ?? "", th = f?.properties.name_th.replace(/^จังหวัด/, "") ?? "";
        const region = f ? regionOf(f.properties.iso) : REGIONS[0];
        const shape = f && silhouette(f, 300, -130);
        const s = stamp(540, 820, 360, region.ink, `${en.toUpperCase()} · ${th}`, shape ? (g2) => {
          g2.fillStyle = region.ink; g2.globalAlpha = 0.3; g2.fill(shape); g2.globalAlpha = 1; g2.lineWidth = 5; g2.strokeStyle = region.ink; g2.stroke(shape);
        } : en.toUpperCase(), `ENTRY · ${day(m.at)}`, f?.id ?? 1, "#fdf8ec");
        g.save(); g.translate(540, 820); g.rotate(-0.1); g.translate(-540, -820); g.drawImage(s.canvas, s.x, s.y); g.restore();
        return ["NEW PROVINCE", en, th];
      }
      case "level": {
        g.fillStyle = accent;
        g.beginPath();
        for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2, rr = i % 2 ? 300 : 360; g.lineTo(540 + rr * Math.cos(a), 820 + rr * Math.sin(a)); }
        g.fill();
        g.fillStyle = "#fff"; g.font = `900 260px ${BODY}`; g.textBaseline = "middle"; g.fillText(String(m.level), 540, 840); g.textBaseline = "alphabetic";
        return ["LEVEL UP", `Level ${m.level}`, "Explorer of Thailand"];
      }
      case "badge": {
        g.save(); g.translate(540 - 300, 820 - 330); g.scale(6, 6);
        g.fillStyle = m.colour; g.fill(new Path2D(SHIELD)); g.fillStyle = "rgb(255 255 255 / .25)";
        g.fill(new Path2D("M50 14 L83 27 L83 58 C83 76 68 89 50 96 C32 89 17 76 17 58 L17 27 Z")); g.restore();
        g.fillStyle = "#fff"; g.font = `900 170px ${BODY}`; g.textBaseline = "middle";
        g.fillText(["", "I", "II", "III", "IV", "V"][m.tier] ?? "", 540, 830); g.textBaseline = "alphabetic";
        return ["BADGE UNLOCKED", m.title, `Tier ${m.tier}`];
      }
      case "fortune": {
        g.save(); g.translate(540, 820); g.rotate(-0.2);
        g.fillStyle = "#c8a24a"; g.beginPath(); g.roundRect(-46, -380, 92, 760, 40); g.fill();
        g.fillStyle = "#8e1c1c"; g.font = `900 90px ${BODY}`; g.fillText(String(m.stick), 0, -230); g.restore();
        return [`SIAM SI · ${m.rarity.toUpperCase()}`, m.prize, `Stick No. ${m.stick}`];
      }
    }
  })();
  g.fillStyle = ink; g.font = `600 36px ${MONO}`; g.fillText("GIGGLES MAPS", 540, 150);
  g.fillStyle = accent; g.font = `700 52px ${MONO}`; g.fillText(head, 540, 1270);
  g.fillStyle = ink; const y = twoLines(g, title, 540, 1390, 940, 110, BODY);
  g.globalAlpha = 0.8; fitText(g, sub, 540, y + 40, 940, 54, BODY, 700); g.globalAlpha = 1;
  g.font = `700 44px ${BODY}`; g.globalAlpha = 0.6; g.fillText(m.name, 540, y + 130); g.globalAlpha = 1;
  footer(g, ink);
  return c;
}
