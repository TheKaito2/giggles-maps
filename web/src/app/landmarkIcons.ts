import type maplibregl from "maplibre-gl";

// Roadtrippers-style landmark icons for the map: a small flat illustration on a white badge, as map images "lm-<id>".
// Sky palette: ink #0e2440, blues #0a72d6 / #3ea8ff, one warm accent each. Drawn at 2x (88 px), shown at 44 px or less.
const INK = "#0e2440", BLUE = "#0a72d6", SKY = "#3ea8ff", GOLD = "#f5a524", SUN = "#ff9d2e", BRICK = "#d9733b", SAND = "#f6cf7a";
const line = `stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`;

const ART: Record<string, string> = {
  // golden chedi on a blue base
  temple: `<path d="M24 8 27 19H21Z" fill="${GOLD}" ${line}/><rect x="19.5" y="19" width="9" height="3.5" rx="1" fill="${BLUE}" ${line}/>
    <path d="M16.5 32Q16.5 24 24 22.5 31.5 24 31.5 32Z" fill="${GOLD}" ${line}/><rect x="13" y="32" width="22" height="5" rx="1.2" fill="${BLUE}" ${line}/>`,
  // two peaks, a snow cap and the sun
  mountain: `<circle cx="33.5" cy="14" r="4" fill="${SUN}"/><path d="M9 36 20 17 30 36Z" fill="${SKY}" ${line}/>
    <path d="M17 36 28.5 19.5 40 36Z" fill="${BLUE}" ${line}/><path d="M25.3 24 28.5 19.5 31.7 24 29.6 23 28.5 24.5 27.2 23Z" fill="#fff"/>`,
  // water falling between warm rocks into a pool
  waterfall: `<path d="M10 37V17Q10 12 15 12H19V37Z" fill="${BRICK}" ${line}/><path d="M38 37V17Q38 12 33 12H29V37Z" fill="${BRICK}" ${line}/>
    <rect x="19" y="12" width="10" height="21" fill="${SKY}" ${line}/><path d="M22 15V29M26 17V31" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
    <ellipse cx="24" cy="35" rx="13" ry="3.6" fill="${BLUE}" ${line}/>`,
  // sun, palm tree, sand and a wave
  beach: `<circle cx="15" cy="15" r="4.5" fill="${SUN}"/><path d="M8 35Q16 29 24 31T40 30V37H8Z" fill="${SAND}" ${line}/>
    <path d="M29 31Q30 23 27 16" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M27 16Q21 13 18 18Q23 15 27 16ZM27 16Q32 11 37 15Q31 14 27 16ZM27 16Q26 10 21 10Q26 12 27 16ZM27 16Q34 17 35 22Q31 17 27 16Z" fill="${BLUE}" ${line}/>
    <path d="M8 38Q12 35.5 16 38T24 38T32 38T40 38" fill="none" stroke="${SKY}" stroke-width="2" stroke-linecap="round"/>`,
  // Thai palace: stacked blue roofs, a gold spire, white walls
  palace: `<path d="M24 7 25.5 14H22.5Z" fill="${GOLD}" ${line}/><path d="M17 20 24 13.5 31 20Z" fill="${BLUE}" ${line}/>
    <path d="M12 27 24 18 36 27Z" fill="${SKY}" ${line}/><rect x="14" y="27" width="20" height="9" fill="#fff" ${line}/>
    <path d="M20 36V31H23V36M25 36V31H28V36" fill="none" ${line}/><path d="M11 37H37" ${line}/>`,
  // brick prang towers, one broken
  ruins: `<path d="M18 37V21Q18 15 22 12Q26 15 26 21V37Z" fill="${BRICK}" ${line}/><path d="M28 37V26Q28 22 31 20.5L33 23 35 22V37Z" fill="${BRICK}" ${line}/>
    <path d="M10 37V29H15V37" fill="${SAND}" ${line}/><path d="M20 25H24M20 30H24M30 29H33" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M8 37H40" ${line}/><circle cx="12" cy="14" r="3" fill="${SKY}"/>`,
  // classical front: pediment, columns, steps
  museum: `<path d="M10 19 24 10 38 19Z" fill="${BLUE}" ${line}/><circle cx="24" cy="15.5" r="1.8" fill="${GOLD}"/>
    <path d="M14 21V32M20 21V32M28 21V32M34 21V32" stroke="${SKY}" stroke-width="3.2" stroke-linecap="round"/>
    <rect x="11" y="32" width="26" height="4" rx="1" fill="${BLUE}" ${line}/><path d="M11 20H37" ${line}/>`,
  // pine forest under the sun
  park: `<circle cx="34" cy="13" r="4" fill="${SUN}"/><path d="M17 9 25 23H20.5L27 33H7L13.5 23H9Z" fill="${BLUE}" ${line}/>
    <path d="M31 17 37 27H34L39 35H23L28 27H25Z" fill="${SKY}" ${line}/><path d="M17 33V38M31 35V38" ${line}/>`,
  // seated golden figure on a blue plinth
  statue: `<circle cx="24" cy="13" r="7" fill="${SKY}"/><circle cx="24" cy="12.5" r="4" fill="${GOLD}" ${line}/><path d="M24 7.5V8.5" ${line}/>
    <path d="M17.5 30Q17 19 24 17.5 31 19 30.5 30Z" fill="${GOLD}" ${line}/><path d="M13 31Q24 26 35 31Z" fill="${GOLD}" ${line}/>
    <rect x="14" y="31" width="20" height="6" rx="1.2" fill="${BLUE}" ${line}/>`,
  // limestone island with a cave mouth, in the sea
  island: `<circle cx="13" cy="13" r="3.6" fill="${SUN}"/><path d="M15 33Q13 24 16 19Q18 13 23 14Q26 10 30 13Q34 16 32 21Q36 26 34 33Z" fill="${BLUE}" ${line}/>
    <path d="M20 33V29.5Q20 26 23 26T26 29.5V33Z" fill="${INK}"/><path d="M23 14Q24 9 26 8M26 8Q23 7 21.5 9M26 8Q29 7 30 9.5" fill="none" stroke="${SKY}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M8 35Q12 32.5 16 35T24 35T32 35T40 35" fill="none" stroke="${SKY}" stroke-width="2.4" stroke-linecap="round"/>`,
  // any other landmark: a gold star
  star: `<path d="M24 9.5 28.3 18.6 38.2 19.8 30.9 26.6 32.8 36.4 24 31.6 15.2 36.4 17.1 26.6 9.8 19.8 19.7 18.6Z" fill="${GOLD}" ${line}/>
    <circle cx="24" cy="24.5" r="3" fill="${BLUE}"/>`,
};

/** The full badge SVG for one icon id (also used by the preview page). */
export const landmarkSvg = (id: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="22.5" fill="#fff" stroke="${INK}" stroke-opacity=".28" stroke-width="2"/>${ART[id] ?? ART.star}</svg>`;
export const LANDMARK_ICONS = Object.keys(ART);

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
/** Which landmark icon a place gets: its name first (palace, ruins, island, statue), then its kind, else the star. */
export function landmarkIconOf(p: { kind: string | null; name: string; name_th?: string | null }): string {
  const text = `${p.name} ${p.name_th ?? ""}`;
  return BY_NAME.find(([re]) => re.test(text))?.[1] ?? BY_KIND[p.kind ?? ""] ?? "star";
}

const SIZE = 88;   // drawn at 2x, shown at 44 px (icon-size 1)

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
