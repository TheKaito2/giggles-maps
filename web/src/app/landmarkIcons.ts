import type maplibregl from "maplibre-gl";

// Landmark icons for the map: little isometric dioramas standing on a ground tile (Roadtrippers-style, our own Thai
// scenes), as map images "lm-<id>". One kind icon per landmark type plus bespoke scenes for the most famous Icons
// ("place-<id>"). Drawn on a 64-unit canvas, rasterised at 2x; light comes from the top left (top faces lightest, right
// faces darkest) and one dark silhouette outline is drawn around the whole scene.
type Pt = [number, number];
const iso = (u: number, v: number, h = 0): Pt => [32 + u - v, 45 + (u + v) / 2 - h];   // u runs right-down, v left-down
const n2 = (x: number) => +x.toFixed(2);
const poly = (fill: string, ...p: Pt[]) => `<polygon points="${p.map(([x, y]) => `${n2(x)},${n2(y)}`).join(" ")}" fill="${fill}"/>`;
/** Mix a colour toward white (f > 0) or black (f < 0). */
const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => { const c = (n >> s) & 255; return Math.round(f > 0 ? c + (255 - c) * f : c * (1 + f)); };
  return "#" + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
};

const GRASS = "#8cc45a", SOIL = "#a86a40", SAND = "#f1d596", SANDSIDE = "#d6a45e", WATER = "#3fc1cc", SEA = "#2a93ad",
  STONE = "#ddd4c1", WHITE = "#f6f1e6", GOLD = "#f0ae26", RED = "#d8432d", ORANGE = "#f28b25", GREENROOF = "#2e9a62",
  BRICK = "#c2573a", ROCK = "#c08a5a", LEAF = "#3f9a4a", WOOD = "#8a5a34", LIME = "#a5d36a";

/** An upright box: base centre (u, v), half sizes a × b, from height z up by h. */
function box(u: number, v: number, a: number, b: number, z: number, h: number, c: string, top = shade(c, 0.25)) {
  const g = (du: number, dv: number, dz: number) => iso(u + du, v + dv, z + dz);
  return poly(c, g(-a, b, 0), g(a, b, 0), g(a, b, h), g(-a, b, h))                    // front-left face, lit
    + poly(shade(c, -0.25), g(a, b, 0), g(a, -b, 0), g(a, -b, h), g(a, b, h))          // front-right face, shaded
    + poly(top, g(-a, -b, h), g(a, -b, h), g(a, b, h), g(-a, b, h));
}
/** A pitched roof over a × b at height z, ridge h higher, running along u (or along v). */
function gable(u: number, v: number, a: number, b: number, z: number, h: number, c: string, alongV = false, trim = GOLD) {
  const g = (du: number, dv: number, dz: number) => alongV ? iso(u + dv, v + du, z + dz) : iso(u + du, v + dv, z + dz);
  if (!alongV) return poly(shade(c, -0.35), g(-a, -b, 0), g(a, -b, 0), g(a, 0, h), g(-a, 0, h))
    + poly(shade(c, 0.12), g(-a, b, 0), g(a, b, 0), g(a, 0, h), g(-a, 0, h))
    + poly(trim, g(a, -b - 0.6, -0.4), g(a, b + 0.6, -0.4), g(a, 0, h + 0.9)) + poly(shade(c, -0.3), g(a, -b + 0.9, 0.3), g(a, b - 0.9, 0.3), g(a, 0, h - 0.6))
    + poly(trim, g(-a - 0.4, 0, h - 0.3), g(-a + 0.6, 0, h), g(-a - 0.7, 0, h + 2.4)) + poly(trim, g(a + 0.4, 0, h - 0.3), g(a - 0.6, 0, h), g(a + 0.7, 0, h + 2.4));
  // ridge along v: the gable end faces the front-left (lit), the slope faces right
  return poly(shade(c, -0.1), g(-a, b, 0), g(a, b, 0), g(a, 0, h), g(-a, 0, h))
    + poly(trim, g(-a - 0.6, b, -0.4), g(-a - 0.6, -b, -0.4), g(-a, 0, h + 0.9)) + poly(shade(c, 0.2), g(-a, -b + 0.9, 0.3), g(-a, b - 0.9, 0.3), g(-a, 0, h - 0.6));
}
/** A solid of revolution standing at screen point (x, y): profile is [height, half width] pairs, bottom to top. */
function round(x: number, y: number, prof: [number, number][], c: string, dark = shade(c, -0.24)) {
  const side = (s: number) => {
    const w0 = prof[0][1];
    let d = `M${n2(x)} ${n2(y + w0 / 2)}A${n2(w0)} ${n2(w0 / 2)} 0 0 ${s > 0 ? 0 : 1} ${n2(x + s * w0)} ${n2(y)}`;
    for (const [h, w] of prof.slice(1)) d += `L${n2(x + s * w)} ${n2(y - h)}`;
    return `${d}L${n2(x)} ${n2(y - prof[prof.length - 1][0])}Z`;
  };
  return `<path d="${side(-1)}" fill="${shade(c, 0.1)}"/><path d="${side(1)}" fill="${dark}"/>`;
}
const roundAt = (u: number, v: number, z: number, prof: [number, number][], c: string) => round(...iso(u, v, z), prof, c);
/** A ball of leaves (tree crown, bush, boulder): lit on the left, a darker crescent on the right. */
function blob(x: number, y: number, r: number, c: string) {
  return `<circle cx="${n2(x)}" cy="${n2(y)}" r="${r}" fill="${c}"/><path d="M${n2(x + r * 0.2)} ${n2(y - r * 0.98)}A${r} ${r} 0 0 1 ${n2(x + r * 0.2)} ${n2(y + r * 0.98)}A${r * 0.8} ${r} 0 0 0 ${n2(x + r * 0.2)} ${n2(y - r * 0.98)}Z" fill="${shade(c, -0.25)}"/>`
    + `<circle cx="${n2(x - r * 0.35)}" cy="${n2(y - r * 0.35)}" r="${n2(r * 0.32)}" fill="${shade(c, 0.22)}"/>`;
}
function tree(u: number, v: number, r: number, c = LEAF, z = 0) {
  const [x, y] = iso(u, v, z);
  return `<rect x="${n2(x - 0.8)}" y="${n2(y - r - 1)}" width="1.6" height="${n2(r + 1.4)}" fill="${WOOD}"/>` + blob(x, y - r - 1.6, r, c);
}
const pine = (u: number, v: number, s: number, c = "#2f8a4a") => roundAt(u, v, 0, [[0, 0.7], [1.2, 0.7], [1.2, 2.6 * s], [3.4 * s, 1.4 * s], [3.4 * s, 2 * s], [6.4 * s, 0]], c);
/** Low-poly peak on the ground at (u, v): lit left flank, shaded right flank, optional pale cap. */
function peak(u: number, v: number, w: number, h: number, c: string, cap?: string) {
  const [x, y] = iso(u, v), P: Pt = [x + w * 0.1, y - h], L: Pt = [x - w, y], R: Pt = [x + w, y], F: Pt = [x + w * 0.15, y + w * 0.4];
  let s = poly(shade(c, 0.08), L, P, F) + poly(shade(c, -0.22), F, P, R);
  if (cap) {
    const k = 0.32, at = (q: Pt): Pt => [P[0] + (q[0] - P[0]) * k, P[1] + (q[1] - P[1]) * k];
    s += poly(cap, at(L), P, at(F), [at(L)[0] + (at(F)[0] - at(L)[0]) * 0.5, at(L)[1] + 1.4]) + poly(shade(cap, -0.12), at(F), P, at(R));
  }
  return s;
}
/** Water on part of the tile top, given as ground (u, v) points. */
const ground = (c: string, ...uv: [number, number][]) => poly(c, ...uv.map(([u, v]) => iso(u, v)));
const T = 13, D = 3;   // tile half size and thickness
/** The tile's front-left side between u0 and u1 (to show water or sand on the side), and its whole front-right side. */
const sideL = (c: string, u0: number, u1: number) => poly(c, iso(u0, T), iso(u1, T), iso(u1, T, -D), iso(u0, T, -D));
const sideR = (c: string, v0 = -T, v1 = T) => poly(c, iso(T, v0), iso(T, v1), iso(T, v1, -D), iso(T, v0, -D));
function tile(top: string, side = SOIL) {
  return sideL(side, -T, T) + sideR(shade(side, -0.25)) + ground(top, [-T, -T], [T, -T], [T, T], [-T, T])
    + poly(shade(top, 0.18), iso(-T, -T), iso(T, -T), iso(T - 1, -T + 1), iso(-T + 1, -T + 1)) + poly(shade(top, 0.1), iso(-T, -T), iso(-T + 1, -T + 1), iso(-T + 1, T - 1), iso(-T, T));
}
/** A sea tile: water top and sides with a pale shallow rim. */
const seaTile = () => tile(WATER, SEA) + ground(shade(WATER, 0.25), [-T, -T], [T, -T], [T, -T + 1.5], [-T + 1.5, -T + 1.5], [-T + 1.5, T], [-T, T]);
const foam = (...uv: [number, number][]) => `<polyline points="${uv.map(([u, v]) => iso(u, v).map(n2).join(",")).join(" ")}" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
const flag = (u: number, v: number, z: number, h: number, c = RED) => {
  const [x, y] = iso(u, v, z);
  return `<rect x="${n2(x - 0.6)}" y="${n2(y - h)}" width="1.3" height="${h}" fill="#5b3b22"/>`
    + `<path d="M${n2(x + 0.6)} ${n2(y - h)}h6l-1.6 2.2 1.6 2.2h-6Z" fill="${c}"/><path d="M${n2(x + 0.6)} ${n2(y - h + 1.6)}h4.8l0.5 1.2h-5.3Z" fill="#fff"/>`;
};
/** A Thai bell chedi at (u, v, z): stepped base, bell, rings and spire, scaled by s. */
const chedi = (u: number, v: number, z: number, s: number, c = WHITE, spire = GOLD) => {
  const [x, y] = iso(u, v, z), k = (p: [number, number][]) => p.map(([h, w]) => [h * s, w * s] as [number, number]);
  return round(x, y, k([[0, 4.4], [1.3, 4.4], [1.3, 3.6], [2.6, 3.6], [2.6, 3], [4, 3.3], [5.6, 3.1], [7, 2.5], [8.2, 1.4], [8.6, 1.4]]), c)
    + round(x, y - 8.6 * s, k([[0, 1.1], [1.2, 1.1], [1.2, 0.8], [4.6, 0.35], [6.4, 0]]), spire);
};
/** A Khmer-style prang (corn-cob tower) at (u, v, z), scaled by s; broken lops off the top. */
const prang = (u: number, v: number, z: number, s: number, c: string, broken = false) => {
  const [x, y] = iso(u, v, z), prof: [number, number][] = [[0, 3.4], [2.2, 3.4], [2.2, 3], [4.5, 3], [7, 2.8], [9, 2.4], [10.8, 1.9], [12.3, 1.3], [13.4, 0.7], [14, 0.25]];
  return round(x, y, (broken ? prof.slice(0, 6).concat([[9.6, 1.6]]) : prof).map(([h, w]) => [h * s, w * s]), c);
};
/** A seated Buddha on a lotus at (u, v, z), scaled by s. */
const buddha = (u: number, v: number, z: number, s: number, c = GOLD, lotus = "#f19bb2") => {
  const [x, y] = iso(u, v, z), k = (p: [number, number][]) => p.map(([h, w]) => [h * s, w * s] as [number, number]);
  return round(x, y, k([[0, 4.6], [0.9, 5.6], [1.6, 5.4]]), lotus)
    + round(x, y - 1.6 * s, k([[0, 5.4], [1.2, 5.6], [2, 4.4], [2.3, 3.2], [4.6, 3.3], [5.6, 3], [6.2, 1.6], [6.5, 0.8]]), c)
    + round(x, y - 6.9 * s, k([[0, 0.8], [0.4, 1.7], [1.9, 1.8], [2.8, 1.2], [3.1, 0.6], [4.6, 0]]), shade(c, 0.12));
};
const boat = (u: number, v: number) => {
  const [x, y] = iso(u, v);
  return `<path d="M${x - 5} ${y - 1.6}L${x + 4} ${y - 0.4}Q${x + 6} ${y - 1.4} ${x + 6.6} ${y - 3.6}L${x + 4.4} ${y + 1.4}L${x - 4} ${y + 0.6}Z" fill="${WOOD}"/>`
    + `<path d="M${x - 4.6} ${y - 1.2}L${x + 4} ${y}L${x + 3.4} ${y + 0.9}L${x - 4} ${y}Z" fill="${shade(WOOD, -0.3)}"/>`
    + `<rect x="${x - 2.2}" y="${y - 3.6}" width="3.4" height="2.2" rx=".6" fill="#2f7fd0"/><path d="M${x + 6.4} ${y - 3.4}l1.4-1.6 0.4 1.8Z" fill="#ff5c8a"/>`;
};
const palm = (u: number, v: number, lean = 1) => {
  const [x, y] = iso(u, v), tx = x + 5 * lean, ty = y - 17;
  const leaf = (dx: number, dy: number) => `<path d="M${tx} ${ty}Q${tx + dx * 0.5} ${ty + dy * 0.5 - 3} ${tx + dx} ${ty + dy}Q${tx + dx * 0.45} ${ty + dy * 0.5 - 0.6} ${tx} ${ty + 1.2}Z" fill="${dx * lean > 0 ? "#2f8a3a" : "#4cae4a"}"/>`;
  return `<path d="M${x} ${y}Q${x + 0.5 * lean} ${y - 10} ${tx} ${ty}" fill="none" stroke="#9a6a3c" stroke-width="2.2" stroke-linecap="round"/>`
    + leaf(-8, 2) + leaf(-6, 6) + leaf(7, 3) + leaf(5, 7) + leaf(-1, -5.5) + leaf(6, -3) + `<circle cx="${tx}" cy="${ty + 1.2}" r="1.3" fill="#7a4a24"/>`;
};

const ART: Record<string, () => string> = {
  // a white bell chedi beside a small ubosot hall with stacked red and orange roofs, on a stone platform
  temple: () => tile(GRASS) + box(0, 0, 11, 11, 0, 2, STONE) + box(3.5, -3, 7.5, 4.2, 2, 6, WHITE)
    + gable(3.5, -3, 8.6, 5.6, 8, 5.6, RED) + gable(3.5, -3, 6, 3.8, 12.4, 5, ORANGE)
    + box(4.5, 1.3, 1.4, 0.1, 2, 3.8, "#9b3a2a") + chedi(-5.5, 5.5, 2, 1.55),
  // layered green mountains, a misty peak, a little wooden viewing deck with a flag
  mountain: () => tile(GRASS) + peak(-3, -6, 14, 30, "#4d9a5c", "#e4f1e6") + peak(-8, 4, 10, 16, "#68b157")
    + `<ellipse cx="34" cy="26" rx="9" ry="2" fill="#fff" opacity=".75"/>` + box(6, 5, 3.5, 3.5, 0, 3.2, WOOD, "#c79a62")
    + box(6, 8.3, 3.5, 0.3, 3.2, 1.4, "#6f4526") + box(9.3, 5, 0.3, 3.5, 3.2, 1.4, "#6f4526") + flag(3.5, 2.5, 3.2, 10),
  // water spilling down tiered rock ledges into a teal pool, jungle around
  waterfall: () => tile(GRASS) + box(0, -6.5, 11, 4.5, 0, 19, ROCK, LIME) + box(-1, 0, 8, 3, 0, 9, ROCK, LIME)
    + poly("#bfeef5", iso(-3, -2, 19), iso(1, -2, 19), iso(1, -2, 9), iso(-3, -2, 9)) + poly("#bfeef5", iso(-3, -2, 9), iso(1, -2, 9), iso(1, 3, 9), iso(-3, 3, 9))
    + poly("#9fe2ee", iso(-3, 3, 9), iso(1, 3, 9), iso(1, 3, 0), iso(-3, 3, 0)) + `<path d="M${iso(-1.6, -2, 17).join(" ")}V${iso(-1.6, -2, 10)[1]}M${iso(-0.2, -2, 18).join(" ")}V${iso(-0.2, -2, 11)[1]}M${iso(-1.2, 3, 8).join(" ")}V${iso(-1.2, 3, 1)[1]}" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`
    + ground(WATER, [-5, 3], [3, 3], [5, 7], [3, 11], [-4, 12], [-7, 8]) + ground("#fff", [-3.4, 3], [1.4, 3], [2, 4.6], [-3.6, 4.6])
    + tree(8, -1, 3.6) + tree(9, 6, 3, "#4fae4f") + tree(-9, 2, 3.2, "#358a42") + blob(...iso(8, -8, 21.5), 3, "#3f9a4a"),
  // sand meeting turquoise water with a wave edge, a leaning palm and a Thai longtail boat
  beach: () => tile(SAND, SANDSIDE) + ground(WATER, [0, -T], [T, -T], [T, T], [-3, T], [-1, 6], [1, 0], [-1, -6]) + sideR(SEA) + sideL(SEA, -3, T)
    + foam([-1, -T + 0.5], [1, -6], [-0.4, 0], [1.6, 6], [-1.4, T - 0.5]) + palm(-6, 3, 1) + boat(7, 2),
  // multi-tiered pointed Thai roofs (green and orange tiles, a gold spire) on white walls
  palace: () => tile("#e3dccb", "#b5a585") + box(0, 0, 9, 6.5, 0, 5.5, WHITE) + box(-2, 6.6, 1.4, 0.1, 0, 3.4, GOLD) + box(4, 6.6, 1.4, 0.1, 0, 3.4, GOLD)
    + gable(0, 0, 10, 7.6, 5.5, 5, ORANGE) + gable(0, 0, 7.6, 5.6, 9, 4.6, GREENROOF) + gable(0, 0, 5.2, 3.8, 12.4, 4.2, ORANGE)
    + roundAt(0, 0, 15, [[0, 2.2], [1.4, 2.2], [1.4, 1.6], [3.5, 1.8], [5, 1.1], [11, 0.3], [12.5, 0]], GOLD),
  // weathered red-brick prangs and a broken wall, Ayutthaya style
  ruins: () => tile("#b4c46c") + box(-3, -3, 5.4, 5.4, 0, 3.4, BRICK) + prang(-3, -3, 3.4, 1.7, BRICK)
    + box(6, -5, 3, 3, 0, 2.4, BRICK) + prang(6, -5, 2.4, 1.15, "#b8553a", true)
    + box(-4, 7, 6, 1.2, 0, 4.6, "#cf6b47") + box(3.4, 7, 1.6, 1.2, 0, 2.4, "#cf6b47") + box(7, 6.6, 1.2, 1.2, 0, 1.2, "#cf6b47") + box(9.5, 4, 1, 1, 0, 0.8, "#b8553a")
    + blob(...iso(-8, -8, 0), 2.6, "#6aa84a"),
  // a classical building: columns, pediment and steps
  museum: () => tile(GRASS) + box(0, 1, 10, 9, 0, 1.3, STONE) + box(0, 1, 9, 8, 1.3, 1.3, "#e8e0cf") + box(0, -1, 8, 5, 2.6, 8, "#efe7d6")
    + [-6, -3, 0, 3, 6].map((u) => roundAt(u, 5.2, 2.6, [[0, 1], [7.4, 1]], "#fbf6ea")).join("")
    + box(0, 1, 8.8, 4.4, 10.6, 1.6, "#e9dfca") + gable(0, 1, 8.8, 4.4, 12.2, 4, "#e5d9c2", true, "#cdbf9f") + box(0, 5.4, 2, 0.1, 2.6, 4.4, "#7b6a54"),
  // rolling green hills, a cluster of trees and a little path
  park: () => tile(GRASS) + roundAt(-5, -6, 0, [[0, 11], [3, 9], [5, 5], [5.6, 0]], "#77b852") + roundAt(5, -4, 0, [[0, 8], [2.6, 6], [3.8, 0]], "#86c55c")
    + ground("#ead7aa", [T, 2], [T, 5], [4, 4], [-1, 9], [-2, T], [-5, T], [-4, 8], [3, 1]) + sideL("#d1b27a", -5, -2)
    + tree(-7, 4, 3.6, "#3f9a4a") + pine(-3, 8, 1.2) + tree(6, -6, 3.2, "#4fae4f") + tree(8, 7, 2.8, "#5bb85a") + pine(1, -9, 1),
  // a large seated golden Buddha on a lotus pedestal
  statue: () => tile("#ddd4c3", "#b0a387") + box(0, 0, 7, 7, 0, 3.2, "#cbbfab") + buddha(0, 0, 3.2, 2.15),
  // a tall limestone karst rising from a turquoise sea, greenery on top
  island: () => seaTile() + ground(SAND, [-2, 1], [4, 0], [6, 5], [0, 7], [-4, 5])
    + roundAt(-2, -2, 0, [[0, 6.5], [2, 5.2], [3.5, 6], [12, 6.6], [20, 5.4], [24, 4.2]], "#d2c2a6") + blob(...iso(-2, -2, 23), 4.6, "#3f9a4a")
    + blob(...iso(-5, -1, 20), 3, "#55ad4c") + roundAt(7, -6, 0, [[0, 3.6], [8, 3.8], [11, 2.6]], "#c9b89b") + blob(...iso(7, -6, 11.4), 2.8, "#4fae4f") + boat(6, 8),
  // any other landmark: a small hill with a red-and-white flag
  star: () => tile(GRASS) + roundAt(0, 0, 0, [[0, 10], [3, 8], [5, 4.4], [5.8, 0]], "#7dbd56") + flag(0, 0, 5.8, 15) + tree(-8, 5, 2.6) + tree(7, -6, 2.4, "#4fae4f"),

  // ---- bespoke scenes for the most famous Icons ----
  // Wat Arun: a tall white porcelain prang with four satellites, by the river
  arun: () => tile("#e7dfcd", "#b5a585") + ground(WATER, [-T, 7], [T, 7], [T, T], [-T, T]) + sideL(SEA, -T, T) + sideR(SEA, 7, T) + foam([-T + 0.5, 7], [T - 0.5, 7])
    + prang(-7, -7, 0, 0.75, "#efe8da") + prang(7, -7, 0, 0.75, "#efe8da") + box(0, -1, 6, 6, 0, 2, "#f0eadc") + box(0, -1, 4.6, 4.6, 2, 2, "#f6f1e6")
    + prang(0, -1, 4, 1.85, "#f8f3e8") + [[-1, 12], [1.6, 16], [-1.4, 20], [1, 24]].map(([dx, h]) => { const [x, y] = iso(0, -1, h); return `<circle cx="${x + dx}" cy="${y}" r="0.9" fill="${h % 8 ? "#e2725b" : "#3d86d6"}"/>`; }).join("")
    + prang(-7, 4, 0, 0.75, "#efe8da") + prang(6, 4, 0, 0.75, "#efe8da") + boat(2, 10),
  // Grand Palace / Wat Phra Kaew: a crenellated white wall, a golden chedi, a tiered green-and-orange hall with a spire
  palaceGrand: () => tile("#e5dfd0", "#b5a585") + chedi(-6, -5, 0, 1.45, GOLD, GOLD)
    + box(4, -2, 6, 4.2, 0, 5, WHITE) + gable(4, -2, 7, 5.2, 5, 4.6, GREENROOF, false, ORANGE) + gable(4, -2, 5, 3.6, 8.4, 4.2, ORANGE) + roundAt(4, -2, 11, [[0, 1.5], [2, 1.2], [9, 0.25], [10, 0]], GOLD)
    + box(0, 9, 12, 1, 0, 3.4, WHITE) + [-10, -6, -2, 2, 6, 10].map((u) => box(u, 9, 1, 1, 3.4, 1.2, WHITE)).join("") + box(2, 10.1, 1.6, 0.1, 0, 2.8, "#c0392b"),
  // Wat Rong Khun: an all-white temple with silver-blue accents over a pale pool and bridge
  rongkhun: () => tile("#d9e6ef", "#8ea6bd") + ground("#8fcbe6", [-T, 4], [7, 4], [7, T], [-T, T]) + sideL("#5f9fc2", -T, 7)
    + box(2, -3, 6.4, 4, 0, 6, "#fbfcfe") + gable(2, -3, 7.8, 5.2, 6, 5.4, "#f7f9fc", false, "#7f9cbf") + gable(2, -3, 5.4, 3.4, 10.2, 5, "#f3f6fa", false, "#7f9cbf")
    + box(3, 1.1, 1.3, 0.1, 0, 3.6, "#b9c9dc") + roundAt(2, -3, 14.6, [[0, 1.3], [1, 1.3], [6.4, 0.25], [7.6, 0]], "#c9d6e6")
    + box(-2, 5.2, 1.8, 6.2, 0, 1.4, "#f7f9fc") + chedi(-7, -6, 0, 0.95, "#f6f8fb", "#a9bdd4") + chedi(9, -8, 0, 0.7, "#f6f8fb", "#a9bdd4"),
  // Doi Inthanon: a high peak above the mist with the two royal chedis
  inthanon: () => tile(GRASS) + peak(-2, -5, 16, 32, "#3f8f55", "#e7f2ea") + `<ellipse cx="31" cy="27" rx="12" ry="2.2" fill="#fff" opacity=".8"/>`
    + box(-2, 5, 4, 4, 0, 1.6, STONE) + chedi(-2, 5, 1.6, 0.95, "#9a6aa6", GOLD) + box(7, 2, 3.6, 3.6, 0, 1.6, STONE) + chedi(7, 2, 1.6, 0.9, "#cfa7dc", GOLD) + pine(-9, 3, 0.9),
  // Ayutthaya Historical Park: a cluster of ruined brick prangs with a broken wall
  ayutthaya: () => tile("#b4c46c") + box(-1, -4, 9, 3.6, 0, 2.4, BRICK) + prang(-7, -4, 2.4, 0.95, "#b8553a") + prang(5, -4, 2.4, 0.95, "#b8553a", true) + prang(-1, -4, 2.4, 1.4, BRICK)
    + box(-3, 7, 7, 1.2, 0, 3.6, "#cf6b47") + box(6.4, 7, 2, 1.2, 0, 1.8, "#cf6b47") + box(10, 3, 1, 1, 0, 1, "#b8553a") + tree(9, -9, 3, "#4f9f45"),
  // Sukhothai Historical Park: a big seated Buddha among brick columns, a lotus pond in front
  sukhothai: () => tile("#a9c46a") + ground(WATER, [-T, 6], [2, 6], [3, T], [-T, T]) + sideL(SEA, -T, 3) + box(1, -2, 8, 6, 0, 2, "#c46a45")
    + [[-5, -6], [-1, -6], [6, -6]].map(([u, v]) => roundAt(u, v, 2, [[0, 1], [10, 1]], "#c7704c")).join("") + buddha(1, -2, 2, 1.6, "#ece6d8", "#d9cdb8")
    + [[-5, 2], [6, 2]].map(([u, v]) => roundAt(u, v, 2, [[0, 1], [9, 1]], "#c7704c")).join("") + [[-8, 9], [-3, 10], [-6, 11.5]].map(([u, v]) => blob(...iso(u, v), 1, "#f48fb1")).join(""),
  // Khao Yai: forest hills with a waterfall dropping into a pool
  khaoyai: () => tile(GRASS) + peak(-6, -6, 11, 20, "#3f8f55") + peak(6, -7, 9, 14, "#58a85a") + box(0, -2, 7, 3, 0, 9, ROCK, LIME)
    + poly("#bfeef5", iso(-2, 1, 9), iso(1.4, 1, 9), iso(1.4, 1, 0), iso(-2, 1, 0)) + `<path d="M${iso(-0.6, 1, 8).join(" ")}V${iso(-0.6, 1, 1)[1]}" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`
    + ground(WATER, [-4, 1], [3, 1], [5, 5], [1, 8], [-5, 6]) + tree(-8, 4, 3.4) + tree(8, 2, 3.2, "#4fae4f") + tree(5, 8, 2.6, "#358a42") + pine(-6, 9, 0.9),
  // Patong: a curved bay of sand around turquoise water, green headlands, beach umbrellas
  patong: () => tile(SAND, SANDSIDE) + ground(WATER, [-T, -2], [-7, -3], [-1, 0], [3, 5], [4, T], [-T, T]) + sideL(SEA, -T, 4)
    + foam([-T + 0.5, -2.2], [-7, -3.2], [-1.2, -0.2], [2.8, 5], [3.6, T - 0.5])
    + roundAt(-6, -9, 0, [[0, 7], [3, 5.4], [5, 2.6], [5.6, 0]], "#4f9f45") + roundAt(9, 7, 0, [[0, 5], [2.4, 3.8], [4, 0]], "#5bab4c")
    + [[3, -6, "#ff5c5c"], [7, -2, "#2f7fd0"], [8, -8, "#ffb020"]].map(([u, v, c]) => { const [x, y] = iso(+u, +v); return `<rect x="${x - 0.4}" y="${y - 5}" width="0.8" height="5" fill="#7a5a3a"/><path d="M${x - 3.4} ${y - 4.2}Q${x} ${y - 7.6} ${x + 3.4} ${y - 4.2}Z" fill="${c}"/>`; }).join("") + boat(-5, 7),
  // Golden Triangle: rivers meeting between green banks, a big golden Buddha on the bank
  goldenTriangle: () => tile(WATER, SEA) + ground("#8cc45a", [-T, -T], [-2, -T], [-3, -3], [-T, 0]) + ground("#7fbb52", [3, -T], [T, -T], [T, 2], [4, -1])
    + ground("#96cb5e", [-T, 5], [-2, 4], [6, 6], [T, 8], [T, T], [-T, T]) + sideL(SOIL, -T, T) + sideR(shade(SOIL, -0.25), 8, T)
    + foam([-T + 0.5, 4.6], [-2, 3.6], [6, 5.6], [T - 0.5, 7.6]) + box(4, 7, 5, 4, 0, 1.6, "#d9a640") + buddha(4, 7, 1.6, 1.8, GOLD, "#e0902a") + boat(-3, 0),
  // Mu Ko Similan: smooth granite boulders in clear water, a sliver of white sand
  similan: () => seaTile() + ground("#f6ead0", [-6, -2], [2, -4], [5, 1], [0, 4], [-6, 3])
    + blob(...iso(-3, -5, 5), 6, "#c8bdb2") + blob(...iso(4, -6, 3), 4.6, "#b9aea4") + blob(...iso(-7, 4, 2.4), 3.2, "#c0b5ab") + blob(...iso(6, 5, 2), 2.6, "#b3a89e")
    + tree(-1, -9, 2.6, "#4fae4f", 8) + boat(2, 9),
};

const BESPOKE: Record<number, string> = {
  37419: "arun", 37420: "palaceGrand", 38090: "palaceGrand", 37939: "rongkhun", 63: "inthanon", 91616: "inthanon",
  37505: "ayutthaya", 97046: "sukhothai", 95346: "khaoyai", 197649: "patong", 159: "goldenTriangle", 86746: "similan",
};
const KINDS = ["temple", "mountain", "waterfall", "beach", "palace", "ruins", "museum", "park", "statue", "island", "star"];

/** The full SVG for one icon id (a kind like "temple", or "place-<id>"; also used by the preview page). */
export function landmarkSvg(id: string) {
  const scene = ART[id.startsWith("place-") ? BESPOKE[+id.slice(6)] : id] ?? ART.star;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64">
  <defs><radialGradient id="sh"><stop offset="0" stop-color="#1d2a3a" stop-opacity=".38"/><stop offset="1" stop-color="#1d2a3a" stop-opacity="0"/></radialGradient>
  <g id="s">${scene()}</g></defs>
  <ellipse cx="33" cy="58.6" rx="30" ry="5.4" fill="url(#sh)"/>
  <use href="#s" xlink:href="#s" stroke="#3a2c26" stroke-opacity=".7" stroke-width="2.2" stroke-linejoin="round"/><use href="#s" xlink:href="#s"/></svg>`;
}
export const LANDMARK_ICONS = [...KINDS, ...Object.keys(BESPOKE).map((id) => `place-${id}`)];

const BY_KIND: Record<string, string> = { temple: "temple", viewpoint: "mountain", waterfall: "waterfall", beach: "beach",
  museum: "museum", national_park: "park", park: "park", art: "statue" };
// ponytail: palaces, ruins, statues and islands have no kind of their own, so a few name words pick them; add a kind if
// the heuristic ever mislabels a famous place
const BY_NAME: [RegExp, string][] = [
  [/palace|พระราชวัง|พระที่นั่ง/i, "palace"],
  [/historical park|ruins?\b|prasat|ปราสาท|อุทยานประวัติศาสตร์|โบราณสถาน/i, "ruins"],
  [/\bisland|\bko\b|\bkoh\b|\bcave|เกาะ|ถ้ำ/i, "island"],
  [/statue|monument|great buddha|อนุสาวรีย์/i, "statue"],
];
/** Which landmark icon a place gets: its own scene if it's one of the famous few, else its name (palace, ruins, island,
 *  statue), then its kind, else the generic flag hill. */
export function landmarkIconOf(p: { id?: number; kind: string | null; name: string; name_th?: string | null }): string {
  if (p.id != null && BESPOKE[p.id]) return `place-${p.id}`;
  const text = `${p.name} ${p.name_th ?? ""}`;
  return BY_NAME.find(([re]) => re.test(text))?.[1] ?? BY_KIND[p.kind ?? ""] ?? "star";
}

const SIZE = 128;   // drawn at 2x: 64 px at icon-size 1

/** Rasterise every icon once and register it with the map as "lm-<id>". */
export async function addLandmarkIcons(map: maplibregl.Map) {
  await Promise.all(LANDMARK_ICONS.map(async (id) => {
    if (map.hasImage(`lm-${id}`)) return;
    const img = new Image(SIZE, SIZE);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(landmarkSvg(id));
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = SIZE;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, SIZE, SIZE);
    if (!map.hasImage(`lm-${id}`)) map.addImage(`lm-${id}`, g.getImageData(0, 0, SIZE, SIZE), { pixelRatio: 2 });
  }));
}
