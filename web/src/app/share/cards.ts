import { createElement, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { loadProvinces, type ProvinceFeature, REGIONS, regionOf, ringsOf } from "../passport/useProvinces";
import ProvinceStamp from "../passport/ProvinceStamp";
import { MedalSvg, METAL } from "../Badges";

// Share images, drawn on a canvas: story size (1080 x 1920), or a square transparent sticker to lay over your own photo in
// Instagram Stories (Strava's stats stickers). Layout follows Spotify Wrapped: bold type on flat colour, one oversized
// thing per card, a 72 px margin. Classic and Bold are free; the other designs come with Giggles Plus.
export const DESIGNS = {
  classic: { name: "Classic", bg: ["#eef0fb", "#ffffff"], ink: "#1d2470", accent: "#d1452f", pop: "#ffd23f", dark: false, plus: false },
  bold: { name: "Bold", bg: ["#140d2b", "#140d2b"], ink: "#ffffff", accent: "#d4ff3a", pop: "#ff3d8b", dark: true, plus: false },
  postcard: { name: "Postcard", bg: ["#fff2d9", "#fad9b3"], ink: "#4d260d", accent: "#bf4019", pop: "#2f7d6d", dark: false, plus: true },
  neon: { name: "Night neon", bg: ["#14052e", "#4d0d59"], ink: "#ffffff", accent: "#ff4dbf", pop: "#3df5ff", dark: true, plus: true },
  indigo: { name: "Indigo cloth", bg: ["#212b73", "#0d1238"], ink: "#ffffff", accent: "#e8a317", pop: "#5c6bc0", dark: true, plus: true },
  riso: { name: "Riso", bg: ["#f4efe4", "#f4efe4"], ink: "#2346c8", accent: "#ff4d6d", pop: "#ffcf33", dark: false, plus: true },
} as const;
export type Design = keyof typeof DESIGNS;

const TIER = { 3: "LANDMARK", 2: "WORTH A VISIT", 1: "EVERYDAY" } as const;
const DISPLAY = '"Mali", "LINE Seed Sans TH", sans-serif', BODY = '"LINE Seed Sans TH", system-ui, sans-serif', MONO = '"IBM Plex Mono", monospace';
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
const W = 1080, H = 1920, M = 72;

export type Card =
  | { kind: "photo" | "sticker"; place: string; placeTh: string | null; tier: 1 | 2 | 3; province: string | null; at: Date; level: number | null; photo?: string }
  | { kind: "progress"; name: string; visited: Set<number> }
  | { kind: "stats"; name: string; visited: Set<number>; level: number; stamps: number }   // transparent sticker
  | { kind: "milestone"; what: "province"; province: number | string; at: Date; name: string }   // province id or English name
  | { kind: "milestone"; what: "level"; level: number; name: string }
  | { kind: "milestone"; what: "badge"; title: string; tier: number; colour: string; name: string; icon?: string }
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
/** Render one of the app's SVG components (a stamp, a medal) to an image, so the card shows exactly what the app shows.
 *  Web fonts don't reach an SVG drawn as an image, so the font variables become plain family names. */
function svgImage(el: ReactElement, size: number): Promise<HTMLImageElement | null> {
  const div = document.createElement("div"), root = createRoot(div);
  flushSync(() => root.render(el));
  const svg = div.querySelector("svg");
  if (!svg) { root.unmount(); return Promise.resolve(null); }
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size * (svg.viewBox.baseVal.height / svg.viewBox.baseVal.width)));
  svg.removeAttribute("style");
  const markup = svg.outerHTML.replaceAll("var(--font-data)", "'IBM Plex Mono', Menlo, monospace").replaceAll("var(--font-body)", "'LINE Seed Sans TH', 'Thonburi', sans-serif");
  root.unmount();
  return image(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
}
const fonts = () => Promise.all([`800 80px ${BODY}`, `900 80px ${BODY}`, `700 80px ${DISPLAY}`, `600 40px ${MONO}`, `700 40px ${MONO}`]
  .map((f) => document.fonts.load(f).catch(() => [])));
const rng = (seed: number) => { let s = seed || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

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
      if (b) g.fillText(b, x, y + s * 1.04);
      return y + (b ? 2 : 1) * s * 1.04;
    }
  }
  return y;
}
/** Wear the ink: knock small specks out of what's on the canvas, the same pattern every time. */
function speckle(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  const rnd = rng(seed);
  g.save(); g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 900; i++) { g.globalAlpha = 0.25 + rnd() * 0.6; g.beginPath(); g.arc(x + rnd() * w, y + rnd() * h, 0.6 + rnd() * 2.6, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

/** A round rubber stamp for a place: double ring, words around the edge, the tier in the middle and a date band. */
function placeStamp(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, ink: string, tier: 1 | 2 | 3, at: Date, seed: number, paper?: string) {
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(r * 2 + 40);
  const s = c.getContext("2d")!, o = c.width / 2;
  if (paper) { s.fillStyle = paper; s.beginPath(); s.arc(o, o, r, 0, Math.PI * 2); s.fill(); }
  s.strokeStyle = ink; s.fillStyle = ink;
  s.lineWidth = r * 0.06; s.beginPath(); s.arc(o, o, r * 0.96, 0, Math.PI * 2); s.stroke();
  s.lineWidth = r * 0.016; s.beginPath(); s.arc(o, o, r * 0.8, 0, Math.PI * 2); s.stroke();
  s.font = `700 ${r * 0.1}px ${MONO}`; s.textAlign = "center"; s.textBaseline = "middle";
  const chars = [..."GIGGLES MAPS · ประทับตรา"], step = Math.min(0.12, (Math.PI * 0.9) / chars.length);
  chars.forEach((ch, i) => { s.save(); s.translate(o, o); s.rotate((i - (chars.length - 1) / 2) * step); s.fillText(ch, 0, -r * 0.88); s.restore(); });
  [-1, 1].forEach((side) => { s.beginPath(); s.arc(o + side * r * 0.62, o + r * 0.55, r * 0.035, 0, Math.PI * 2); s.fill(); });
  s.save(); s.translate(o, o);
  fitText(s, TIER[tier], 0, -r * 0.1, r * 1.32, r * 0.3, BODY, 900);
  s.fillRect(-r * 0.74, r * 0.12, r * 1.48, r * 0.22);
  s.font = `700 ${r * 0.1}px ${MONO}`;
  if (paper) s.fillStyle = paper; else s.globalCompositeOperation = "destination-out";   // no paper: the date shows what's under the stamp
  s.fillText(`ENTRY · ${day(at)}`, 0, r * 0.235);
  s.restore();
  speckle(s, 0, 0, c.width, c.height, seed);
  g.save(); g.translate(cx, cy); g.rotate(-0.14);
  g.globalAlpha = 0.16; g.drawImage(c, -o + r * 0.02, -o - r * 0.015);   // a faint second impression
  g.globalAlpha = 1; g.drawImage(c, -o, -o); g.restore();
}

function background(g: CanvasRenderingContext2D, d: Design, seed: number) {
  const { bg, pop } = DESIGNS[d];
  const grad = g.createLinearGradient(0, 0, W * 0.3, H);
  grad.addColorStop(0, bg[0]); grad.addColorStop(1, bg[1]);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // one flat shape in the second colour, Wrapped-style, off the top right corner
  g.fillStyle = pop; g.beginPath(); g.arc(W - 40, 150, 250, 0, Math.PI * 2); g.fill();
  if (d === "riso") {   // risograph grain: fine dots in both inks
    const rnd = rng(seed + 7);
    g.save();
    for (let i = 0; i < 9000; i++) { g.globalAlpha = 0.05 + rnd() * 0.08; g.fillStyle = i % 2 ? DESIGNS.riso.ink : DESIGNS.riso.accent; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
    g.restore();
  }
}
function header(g: CanvasRenderingContext2D, colour: string, right: string) {
  g.fillStyle = colour; g.font = `700 34px ${MONO}`; g.textAlign = "left"; g.fillText("GIGGLES MAPS", M, 128);
  g.textAlign = "right"; g.fillText(right, W - M, 128); g.textAlign = "center";
}
function footer(g: CanvasRenderingContext2D, colour: string) {
  g.fillStyle = colour; g.globalAlpha = 0.7; g.textAlign = "center"; g.font = `600 32px ${MONO}`;
  g.fillText("giggles-maps.pages.dev", W / 2, 1850); g.globalAlpha = 1;
}
/** Thailand, visited provinces filled, fitted into a box of height h. Returns its width. */
function thailand(g: CanvasRenderingContext2D, features: ProvinceFeature[], visited: (f: ProvinceFeature) => string | null, x: number, y: number, h: number,
  rest: string, line: string) {
  const LNG0 = 97.3, LNG1 = 105.7, LAT0 = 5.5, LAT1 = 20.6, w = h * (260 / 460);
  for (const f of features) {
    const p = new Path2D();
    for (const ring of ringsOf(f.geometry)) ring.forEach(([lng, lat], i) => {
      const px = x + ((lng - LNG0) / (LNG1 - LNG0)) * w, py = y + ((LAT1 - lat) / (LAT1 - LAT0)) * h;
      if (i) p.lineTo(px, py); else p.moveTo(px, py);
    });
    g.fillStyle = visited(f) ?? rest; g.fill(p);
    g.strokeStyle = line; g.lineWidth = 1.5; g.stroke(p);
  }
  return w;
}
function pill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, Math.max(w, h), h, h / 2); g.fill();
}
/** Confetti dots, seeded: the same card always gets the same dots. */
function confetti(g: CanvasRenderingContext2D, colours: string[], seed: number, cy: number) {
  const rnd = rng(seed);
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2, r = 330 + rnd() * 160;
    g.fillStyle = colours[i % colours.length]; g.globalAlpha = 0.85;
    g.beginPath(); g.arc(W / 2 + r * Math.cos(a), cy + r * Math.sin(a) * 0.95, 6 + rnd() * 12, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

/** Draw a card. Story cards are 1080 x 1920; stickers are 1080 x 1080 with a clear background. */
export async function drawCard(card: Card, d: Design): Promise<HTMLCanvasElement> {
  await fonts();
  const { ink, accent, pop, dark } = DESIGNS[d];
  const c = document.createElement("canvas");
  c.width = W; c.height = card.kind === "sticker" || card.kind === "stats" ? 1080 : H;
  const g = c.getContext("2d")!;
  g.textAlign = "center"; g.textBaseline = "alphabetic";

  if (card.kind === "sticker") {
    placeStamp(g, 540, 430, 360, accent, card.tier, card.at, card.place.length, "rgb(255 255 255 / .94)");
    g.fillStyle = "rgb(255 255 255 / .95)";
    g.beginPath(); g.roundRect(80, 840, 920, card.placeTh ? 200 : 140, 40); g.fill();
    g.fillStyle = "#1d1d2b"; fitText(g, card.place, 540, 920, 860, 70, BODY);
    if (card.placeTh) { g.fillStyle = "#555"; fitText(g, card.placeTh, 540, 1000, 860, 50, BODY, 700); }
    return c;
  }

  if (card.kind === "stats") {   // white on clear, with a shadow, to sit on any photo
    const features = await loadProvinces();
    g.shadowColor = "rgb(0 0 0 / .45)"; g.shadowBlur = 18; g.shadowOffsetY = 4;
    const mw = thailand(g, features, (f) => card.visited.has(f.id) ? "#ffffff" : null, 60, 90, 900, "rgb(255 255 255 / .28)", "rgb(0 0 0 / .18)");
    const x = 60 + mw + 50, wR = W - x - 50;
    g.textAlign = "left"; g.fillStyle = "#fff";
    g.font = `700 34px ${MONO}`; g.fillText("GIGGLES MAPS", x, 200);
    fitText(g, String(card.visited.size), x - 8, 470, wR, 300, BODY, 900);
    g.font = `800 64px ${BODY}`; g.fillText("/ 77 provinces", x, 560);
    g.font = `800 56px ${BODY}`; g.fillText(`Level ${card.level}`, x, 720);
    g.fillText(`${card.stamps} stamps`, x, 800);
    g.font = `700 40px ${BODY}`; fitText(g, card.name, x, 900, wR, 40, BODY, 700);
    return c;
  }

  if (card.kind === "photo") {
    const img = card.photo ? await image(card.photo) : null;
    if (img) {
      cover(g, img, 0, 0, W, H);
      const top = g.createLinearGradient(0, 0, 0, 340); top.addColorStop(0, "rgb(0 0 0 / .5)"); top.addColorStop(1, "rgb(0 0 0 / 0)");
      g.fillStyle = top; g.fillRect(0, 0, W, 340);
      const bot = g.createLinearGradient(0, 1000, 0, H); bot.addColorStop(0, "rgb(0 0 0 / 0)"); bot.addColorStop(1, "rgb(0 0 0 / .85)");
      g.fillStyle = bot; g.fillRect(0, 1000, W, 920);
      placeStamp(g, 800, 420, 200, "#ffffff", card.tier, card.at, card.place.length);
    } else {
      background(g, d, card.place.length);
      placeStamp(g, 540, 700, 380, accent, card.tier, card.at, card.place.length);
    }
    const text = img ? "#ffffff" : ink;
    header(g, text, day(card.at));
    g.textAlign = "left"; g.fillStyle = text;
    let y = twoLines(g, card.place, M, 1330, W - 2 * M, 108, BODY);
    if (card.placeTh) { g.globalAlpha = 0.85; fitText(g, card.placeTh, M, y + 6, W - 2 * M, 56, BODY, 700); y += 76; g.globalAlpha = 1; }
    // a stats strip like Strava's: three labelled numbers in a rounded panel
    const sy = Math.max(y + 40, 1560);
    g.fillStyle = img ? "rgb(255 255 255 / .14)" : dark ? "rgb(255 255 255 / .1)" : "rgb(0 0 0 / .06)";
    g.beginPath(); g.roundRect(M, sy, W - 2 * M, 200, 36); g.fill();
    const cols: [string, string][] = [["PROVINCE", card.province ?? "Thailand"], ["STAMP", TIER[card.tier]], card.level ? ["LEVEL", String(card.level)] : ["DATE", day(card.at).slice(0, 6)]];
    cols.forEach(([k, v], i) => {
      const cx = M + 40 + i * ((W - 2 * M - 80) / 3);
      g.textAlign = "left"; g.fillStyle = img ? "#ffd166" : accent; g.font = `700 28px ${MONO}`; g.fillText(k, cx, sy + 72);
      g.fillStyle = text; fitText(g, v, cx, sy + 146, (W - 2 * M - 80) / 3 - 24, 56, BODY, 900);
    });
    footer(g, text);
    return c;
  }

  background(g, d, card.kind === "trip" ? card.title.length : 3);
  if (card.kind === "progress") {
    const features = await loadProvinces();
    header(g, ink, "PASSPORT");
    g.textAlign = "left"; g.fillStyle = accent; g.font = `700 44px ${MONO}`; g.fillText("MY THAILAND", M, 250);
    g.fillStyle = ink; g.font = `900 360px ${BODY}`; g.fillText(String(card.visited.size), M - 10, 590);
    const cw = g.measureText(String(card.visited.size)).width;
    g.globalAlpha = 0.55; g.font = `900 110px ${BODY}`; g.fillText("/77", M + cw + 6, 590); g.globalAlpha = 1;
    g.font = `800 52px ${BODY}`; g.fillText(`provinces · ${card.name}`, M, 680);
    // the map on the left, how far you've got on the right
    thailand(g, features, (f) => card.visited.has(f.id) ? regionOf(f.properties.iso).ink : null, 40, 740, 1040,
      dark ? "rgb(255 255 255 / .14)" : "rgb(29 36 112 / .1)", dark ? "rgb(0 0 0 / .3)" : "rgb(255 255 255 / .7)");
    const regions = REGIONS.map((r) => {
      const all = features.filter((f) => regionOf(f.properties.iso).id === r.id);
      return { r, have: all.filter((f) => card.visited.has(f.id)).length, total: all.length };
    });
    const best = [...regions].sort((a, b) => b.have / b.total - a.have / a.total)[0];
    const x = 680, wR = W - M - x;
    g.fillStyle = accent; g.font = `900 140px ${BODY}`; g.fillText(`${Math.round((card.visited.size / 77) * 100)}%`, x, 880);
    g.fillStyle = ink; g.font = `700 34px ${BODY}`; g.fillText("of Thailand", x, 930);
    if (best.have) { g.globalAlpha = 0.7; g.font = `700 30px ${MONO}`; g.fillText("BEST REGION", x, 1010); g.globalAlpha = 1;
      g.font = `800 50px ${BODY}`; g.fillText(best.r.en, x, 1066); }
    regions.forEach(({ r, have, total }, i) => {
      const y = 1150 + i * 102;
      g.fillStyle = ink; g.font = `800 32px ${BODY}`; g.textAlign = "left"; g.fillText(r.en, x, y);
      g.textAlign = "right"; g.font = `700 28px ${MONO}`; g.fillText(`${have}/${total}`, W - M, y);
      pill(g, x, y + 18, wR, 28, dark ? "rgb(255 255 255 / .14)" : "rgb(0 0 0 / .08)");
      if (have) pill(g, x, y + 18, (wR * have) / total, 28, r.ink);
    });
    footer(g, ink);
    return c;
  }

  if (card.kind === "trip") {
    header(g, ink, `RIDE ALONG · ${day(card.at)}`);
    g.fillStyle = ink; g.textAlign = "left"; twoLines(g, card.title, M, 290, W - 2 * M, 100, DISPLAY);
    const imgs = (await Promise.all(card.photos.slice(0, 6).map(image))).filter((x): x is HTMLImageElement => !!x);
    const cols = imgs.length > 2 ? 2 : 1, rows = Math.ceil(imgs.length / cols) || 1;
    const cw = cols === 2 ? 440 : 760, ch = Math.min(cw * 1.2, (1260 - 40 * rows) / rows);
    imgs.forEach((img, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = (W - cols * cw - (cols - 1) * 40) / 2 + col * (cw + 40), y = 440 + row * (ch + 40);
      g.save(); g.translate(x + cw / 2, y + ch / 2); g.rotate(((i * 37) % 7 - 3) * 0.012);
      g.fillStyle = "#fff"; g.shadowColor = "rgb(0 0 0 / .25)"; g.shadowBlur = 24; g.fillRect(-cw / 2 - 14, -ch / 2 - 14, cw + 28, ch + 28);
      g.shadowBlur = 0; cover(g, img, -cw / 2, -ch / 2, cw, ch); g.restore();
    });
    g.textAlign = "center"; g.fillStyle = ink; fitText(g, card.members.join(" · "), 540, 1770, 940, 44, BODY, 700);
    footer(g, ink);
    return c;
  }

  // milestones: one big emblem in the middle, the news underneath
  const m = card as Extract<Card, { kind: "milestone" }>;   // only milestones are left here
  const cy = 740;
  const [head, title, sub] = await (async (): Promise<[string, string, string]> => {
    switch (m.what) {
      case "province": {
        const f = (await loadProvinces()).find((x) => x.id === m.province || x.properties.name_en === m.province);
        const en = f?.properties.name_en ?? String(m.province), th = f?.properties.name_th.replace(/^จังหวัด/, "") ?? "";
        confetti(g, [accent, pop, f ? regionOf(f.properties.iso).ink : ink], f?.id ?? 1, cy);
        if (f) {
          g.save(); g.translate(540, cy); g.rotate(0.05);   // a torn-out passport page under the stamp
          g.shadowColor = "rgb(0 0 0 / .25)"; g.shadowBlur = 40; g.shadowOffsetY = 16;
          g.fillStyle = "#fdf8ec"; g.beginPath(); g.roundRect(-370, -370, 740, 740, 28); g.fill(); g.restore();
          const img = await svgImage(createElement(ProvinceStamp, { f, earnedAt: m.at.toISOString(), size: 640, tilt: false }), 640);
          if (img) { g.save(); g.translate(540, cy); g.rotate(-0.1); g.drawImage(img, -320, -320, 640, 640); g.restore(); }
        }
        return ["NEW PROVINCE", en, th];
      }
      case "level": {
        g.fillStyle = pop;
        g.beginPath();
        for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, rr = i % 2 ? 320 : 400; g.lineTo(540 + rr * Math.cos(a), cy + rr * Math.sin(a)); }
        g.fill();
        g.fillStyle = accent; g.beginPath(); g.arc(540, cy, 270, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#fff"; g.textBaseline = "middle"; fitText(g, String(m.level), 540, cy + 16, 440, 300, BODY, 900); g.textBaseline = "alphabetic";
        return ["LEVEL UP", `Level ${m.level}`, "Explorer of Thailand"];
      }
      case "badge": {
        const [, mid] = METAL[m.tier] ?? METAL[0];
        g.save(); g.translate(540, cy); g.fillStyle = mid; g.globalAlpha = 0.28;   // rays behind the medal
        for (let i = 0; i < 18; i++) { g.rotate(Math.PI / 9); g.beginPath(); g.moveTo(0, 0); g.lineTo(-60, -560); g.lineTo(60, -560); g.closePath(); g.fill(); }
        g.restore();
        const img = await svgImage(createElement(MedalSvg, { b: { icon: m.icon ?? "trophy", tier: m.tier }, size: 600 }), 600);
        if (img) { g.shadowColor = "rgb(0 0 0 / .3)"; g.shadowBlur = 40; g.shadowOffsetY = 18; g.drawImage(img, 240, cy - 340, 600, 660); g.shadowColor = "transparent"; }
        return [`${["", "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"][m.tier] ?? ""} BADGE`, m.title, `Tier ${["", "I", "II", "III", "IV", "V"][m.tier] ?? ""}`];
      }
      case "fortune": {
        g.save(); g.translate(540, cy); g.rotate(-0.2);
        g.fillStyle = "#c8a24a"; g.beginPath(); g.roundRect(-50, -400, 100, 800, 44); g.fill();
        g.fillStyle = "#8e1c1c"; g.font = `900 92px ${BODY}`; g.fillText(String(m.stick), 0, -240); g.restore();
        return [`SIAM SI · ${m.rarity.toUpperCase()}`, m.prize, `Stick No. ${m.stick}`];
      }
    }
  })();
  header(g, ink, ({ province: "PASSPORT", level: "EXPLORER", badge: "ACHIEVEMENT", fortune: "SIAM SI" } as const)[m.what]);
  g.textAlign = "center"; g.fillStyle = accent; g.font = `700 50px ${MONO}`; g.fillText(head, 540, 1250);
  g.fillStyle = ink; const y = twoLines(g, title, 540, 1376, W - 2 * M, 120, BODY);
  g.globalAlpha = 0.8; fitText(g, sub, 540, y + 30, W - 2 * M, 56, BODY, 700); g.globalAlpha = 1;
  g.font = `700 42px ${BODY}`; g.globalAlpha = 0.6; g.fillText(m.name, 540, Math.min(y + 110, 1760)); g.globalAlpha = 1;
  footer(g, ink);
  return c;
}
