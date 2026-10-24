import { type ReactNode, useId } from "react";

/**
 * Mix-and-match avatar (Duolingo-style creator), drawn in code on a 120 x 120 canvas: head and shoulders.
 * Part ids here must match public.avatar_parts in the database (migration 024): the server whitelists them,
 * and parts marked premium are shop_items of kind "avatar" with id "<slot>:<part>".
 */
export type Slot = "bg" | "skin" | "face" | "eyes" | "brows" | "mouth" | "hair" | "hair_colour" | "facial_hair"
  | "glasses" | "headwear" | "outfit" | "outfit_colour";
export type AvatarLook = Partial<Record<Slot, string>>;
interface Option { id: string; label: string; premium?: boolean; colour?: string }

const c = (id: string, label: string, colour: string, premium = false): Option => ({ id, label, colour, premium });
const o = (id: string, label: string, premium = false): Option => ({ id, label, premium });

export const SLOTS: Record<Slot, { label: string; options: Option[] }> = {
  bg: { label: "Background", options: [c("sky", "Sky", "#bfe3ff"), c("mint", "Mint", "#c4f1d9"), c("peach", "Peach", "#ffd9c2"),
    c("lilac", "Lilac", "#e1d4ff"), c("butter", "Butter", "#fff1a8"), c("rose", "Rose", "#ffc9dc"), c("sand", "Sand", "#efe2c8"),
    c("teal", "Teal", "#9fe0dc"), c("navy", "Navy", "#27348b"), c("grey", "Cloud", "#dfe3ea"),
    c("sunset", "Sunset", "url(#sunset)", true), c("temple", "Temple gold", "url(#temple)", true),
    c("lanterns", "Sky lanterns", "url(#lanterns)", true), c("beach", "Beach", "url(#beach)", true), c("rice-field", "Rice field", "url(#rice)", true),
    c("galaxy", "Galaxy", "url(#galaxy)", true)] },
  skin: { label: "Skin", options: [c("s1", "1", "#ffe0c7"), c("s2", "2", "#f6cba4"), c("s3", "3", "#e8b48a"), c("s4", "4", "#d39a6a"),
    c("s5", "5", "#b97c4f"), c("s6", "6", "#9a6038"), c("s7", "7", "#7a4626"), c("s8", "8", "#5a321b")] },
  face: { label: "Face", options: [o("round", "Round"), o("oval", "Oval"), o("square", "Square")] },
  eyes: { label: "Eyes", options: [o("dots", "Dots"), o("happy", "Happy"), o("wide", "Wide"), o("sleepy", "Sleepy"), o("wink", "Wink")] },
  brows: { label: "Brows", options: [o("soft", "Soft"), o("bold", "Bold"), o("none", "None")] },
  mouth: { label: "Mouth", options: [o("smile", "Smile"), o("grin", "Grin"), o("small", "Small"), o("laugh", "Laugh"), o("neutral", "Calm")] },
  hair: { label: "Hair", options: [o("short", "Short"), o("side-part", "Side part"), o("buzz", "Buzz"), o("curly", "Curly"),
    o("bun", "Bun"), o("long", "Long"), o("bob", "Bob"), o("ponytail", "Ponytail"), o("afro", "Afro"), o("none", "None"),
    o("mohawk", "Mohawk", true)] },
  hair_colour: { label: "Hair colour", options: [c("black", "Black", "#1f1a17"), c("dark-brown", "Dark brown", "#4a2e1f"),
    c("brown", "Brown", "#7b4a2a"), c("auburn", "Auburn", "#a2462b"), c("blonde", "Blonde", "#e3b55b"), c("platinum", "Platinum", "#efe2c0"),
    c("grey", "Grey", "#a9a9b0"), c("pink", "Pink", "#f28bb7"), c("blue", "Blue", "#4f7cf0"), c("green", "Green", "#3dbf8a")] },
  facial_hair: { label: "Facial hair", options: [o("none", "None"), o("stubble", "Stubble"), o("moustache", "Moustache"), o("beard", "Beard")] },
  glasses: { label: "Glasses", options: [o("none", "None"), o("round", "Round"), o("square", "Square"), o("sunglasses", "Shades"),
    o("aviator", "Aviators", true), o("heart", "Hearts", true), o("star", "Stars", true), o("goggles", "Swim goggles", true), o("monocle", "Monocle", true)] },
  headwear: { label: "Headwear", options: [o("none", "None"), o("cap", "Cap"), o("beanie", "Beanie"), o("bucket", "Bucket hat"),
    o("headband", "Headband"), o("flower", "Frangipani"), o("ngob", "Straw ngob hat", true), o("helmet", "Moto helmet", true),
    o("crown", "Crown", true), o("mongkol", "Mongkol", true), o("flower-crown", "Flower crown", true),
    o("beret", "Beret", true), o("chada", "Chada crown", true), o("halo", "Halo", true)] },
  outfit: { label: "Outfit", options: [o("tshirt", "T-shirt"), o("hoodie", "Hoodie"), o("collared", "Collared"), o("tank", "Tank top"),
    o("jacket", "Jacket"), o("scarf", "Scarf"), o("striped", "Stripes"), o("overalls", "Overalls"),
    o("pha-khao-ma", "Pha khao ma", true), o("muay-thai", "Muay Thai", true), o("hawaiian", "Flower shirt", true), o("raincoat", "Raincoat", true), o("mudmee", "Mudmee shirt", true),
    o("suit", "Suit", true), o("chut-thai", "Chut Thai silk", true)] },
  outfit_colour: { label: "Outfit colour", options: [c("indigo", "Indigo", "#27348b"), c("marigold", "Marigold", "#e9a400"),
    c("red", "Red", "#d1452f"), c("green", "Green", "#1b7f52"), c("sky", "Sky", "#2f7bf5"), c("pink", "Pink", "#e05a8a"),
    c("purple", "Purple", "#7a3b8f"), c("black", "Black", "#2a2a2e"), c("white", "White", "#f4f4f4"), c("khaki", "Khaki", "#b59a6a")] },
};
const SLOT_ORDER: Slot[] = ["skin", "face", "hair", "hair_colour", "eyes", "brows", "mouth", "facial_hair", "glasses", "headwear", "outfit", "outfit_colour", "bg"];
export const DEFAULT_LOOK: Required<AvatarLook> = { bg: "sky", skin: "s3", face: "round", eyes: "dots", brows: "soft", mouth: "smile",
  hair: "short", hair_colour: "black", facial_hair: "none", glasses: "none", headwear: "none", outfit: "tshirt", outfit_colour: "indigo" };

const colourOf = (slot: Slot, id: string | undefined) =>
  SLOTS[slot].options.find((x) => x.id === id)?.colour ?? SLOTS[slot].options.find((x) => x.id === DEFAULT_LOOK[slot])!.colour!;
/** A random look from free parts only (Randomize button). */
export function randomLook(): Required<AvatarLook> {
  const pick = (s: Slot) => { const free = SLOTS[s].options.filter((x) => !x.premium); return free[Math.floor(Math.random() * free.length)].id; };
  return Object.fromEntries(SLOT_ORDER.map((s) => [s, pick(s)])) as Required<AvatarLook>;
}
// a darker shade of a hex colour for outlines and shading
const shade = (hex: string, k = 0.78) => {
  if (!hex.startsWith("#")) return "#00000033";
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * k).toString(16).padStart(2, "0");
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
};
const INK = "#2a1d1a";

function hairBack(id: string, h: string): ReactNode {
  switch (id) {
    case "long": return <path d="M31 50 C26 16 94 16 89 50 L93 96 C80 102 40 102 27 96 Z" fill={h} />;
    case "bob": return <path d="M31 48 C27 16 93 16 89 48 L91 76 C82 81 38 81 29 76 Z" fill={h} />;
    case "ponytail": return <ellipse cx="90" cy="60" rx="8" ry="19" transform="rotate(18 90 60)" fill={h} />;
    case "afro": return <circle cx="60" cy="42" r="35" fill={h} />;
    case "bun": return <circle cx="60" cy="17" r="10" fill={h} />;
    default: return null;
  }
}
function hairFront(id: string, h: string): ReactNode {
  switch (id) {
    case "buzz": return <path d="M35 48 C35 22 85 22 85 48 C80 36 40 36 35 48 Z" fill={h} opacity=".85" />;
    case "short": case "bun": case "ponytail":
      return <path d="M33 50 C30 18 90 18 87 50 C84 40 76 34 66 36 C58 30 46 34 40 40 C37 43 35 47 33 50 Z" fill={h} />;
    case "side-part": return <path d="M33 52 C28 16 92 16 87 50 C86 40 82 34 74 32 C64 38 48 40 36 44 Z" fill={h} />;
    case "curly": return <g fill={h}>{[[37, 44, 8], [41, 33, 9], [50, 26, 9], [61, 24, 10], [72, 27, 9], [80, 34, 9], [84, 44, 8]].map(([x, y, r]) =>
      <circle key={`${x}`} cx={x} cy={y} r={r} />)}</g>;
    case "long": case "bob": return <path d="M34 47 C34 22 86 22 86 47 C76 37 50 33 34 47 Z" fill={h} />;
    case "afro": return <path d="M34 46 C36 24 84 24 86 46 C76 36 44 36 34 46 Z" fill={h} />;
    case "mohawk": return <g fill={h}><path d="M35 48 C35 22 85 22 85 48 C80 36 40 36 35 48 Z" opacity=".35" /><path d="M54 40 C52 22 56 6 60 3 C64 6 68 22 66 40 Z" /></g>;
    default: return null;
  }
}
function headShape(face: string, fill: string): ReactNode {
  if (face === "oval") return <ellipse cx="60" cy="49" rx="22" ry="28" fill={fill} />;
  if (face === "square") return <rect x="36" y="23" width="48" height="53" rx="17" fill={fill} />;
  return <ellipse cx="60" cy="50" rx="25" ry="26" fill={fill} />;
}
function eyes(id: string): ReactNode {
  const arc = (x: number, up: boolean) => <path d={`M${x - 4} 53 Q${x} ${up ? 47.5 : 56} ${x + 4} 53`} stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />;
  const dot = (x: number) => <ellipse cx={x} cy="52" rx="2.9" ry="3.4" fill={INK} />;
  switch (id) {
    case "happy": return <>{arc(51, true)}{arc(69, true)}</>;
    case "sleepy": return <>{arc(51, false)}{arc(69, false)}</>;
    case "wink": return <>{dot(51)}{arc(69, true)}</>;
    case "wide": return <>{[51, 69].map((x) => <g key={x}><circle cx={x} cy="52" r="5" fill="#fff" stroke={INK} strokeWidth="1.2" /><circle cx={x + 0.6} cy="52.6" r="2.6" fill={INK} /></g>)}</>;
    default: return <>{dot(51)}{dot(69)}</>;
  }
}
function brows(id: string, h: string): ReactNode {
  if (id === "none") return null;
  const w = id === "bold" ? 3.6 : 2.2;
  return <g stroke={h === "#efe2c0" ? "#b9a77c" : h} strokeWidth={w} strokeLinecap="round" fill="none">
    <path d={id === "bold" ? "M45.5 44.5 L56 43" : "M46 45 Q51 41.5 56 44.5"} /><path d={id === "bold" ? "M64 43 L74.5 44.5" : "M64 44.5 Q69 41.5 74 45"} /></g>;
}
function mouth(id: string): ReactNode {
  switch (id) {
    case "grin": return <g><path d="M51.5 62 Q60 73 68.5 62 Z" fill="#7a2e2e" /><path d="M53 62.4 L67 62.4 L66 65 L54 65 Z" fill="#fff" /></g>;
    case "small": return <path d="M57 64 Q60 66.5 63 64" stroke={INK} strokeWidth="2.2" fill="none" strokeLinecap="round" />;
    case "laugh": return <g><path d="M50.5 61 Q60 76 69.5 61 Z" fill="#7a2e2e" /><ellipse cx="60" cy="69" rx="5" ry="3" fill="#e46f7a" /></g>;
    case "neutral": return <path d="M55 65 L65 65" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />;
    default: return <path d="M53 62.5 Q60 69 67 62.5" stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />;
  }
}
function facialHair(id: string, h: string): ReactNode {
  switch (id) {
    case "stubble": return <path d="M39 57 C41 79 79 79 81 57 C76 71 44 71 39 57 Z" fill={h} opacity=".28" />;
    case "moustache": return <path d="M51.5 60 Q55.5 56.5 60 59.5 Q64.5 56.5 68.5 60 Q64.5 63 60 61.3 Q55.5 63 51.5 60 Z" fill={h} />;
    case "beard": return <path d="M37 52 C36 82 84 82 83 52 C81 66 73 73 60 73 C47 73 39 66 37 52 Z M52 61 Q60 57 68 61 Q60 64 52 61 Z" fill={h} fillRule="evenodd" />;
    default: return null;
  }
}
function glasses(id: string): ReactNode {
  const frame = { stroke: "#222", strokeWidth: 2, fill: "none" };
  switch (id) {
    case "round": return <g {...frame}><circle cx="51" cy="52" r="7" /><circle cx="69" cy="52" r="7" /><path d="M58 51 Q60 49 62 51" /></g>;
    case "square": return <g {...frame}><rect x="43" y="46" width="15" height="12" rx="3" /><rect x="62" y="46" width="15" height="12" rx="3" /><path d="M58 51 L62 51" /></g>;
    case "sunglasses": return <g><rect x="42" y="46" width="16" height="11" rx="4" fill="#1d1d24" /><rect x="62" y="46" width="16" height="11" rx="4" fill="#1d1d24" /><path d="M58 50 L62 50" stroke="#1d1d24" strokeWidth="2.4" /></g>;
    case "aviator": return <g stroke="#b38b2d" strokeWidth="1.6"><path d="M42 47 L58 47 Q58 60 50 59 Q42 58 42 47 Z" fill="#3b4a5a" opacity=".9" /><path d="M62 47 L78 47 Q78 58 70 59 Q62 60 62 47 Z" fill="#3b4a5a" opacity=".9" /><path d="M58 48 L62 48" /></g>;
    case "heart": return <g fill="#ff4d8d" opacity=".9">{[51, 69].map((x) => <path key={x} d={`M${x} 59 C${x - 11} 51 ${x - 6} 43 ${x} 48 C${x + 6} 43 ${x + 11} 51 ${x} 59 Z`} />)}<path d="M57 50 L63 50" stroke="#ff4d8d" strokeWidth="2" /></g>;
    case "goggles": return <g><path d="M33 51 L87 51" stroke="#0277bd" strokeWidth="3" />
      {[50, 70].map((x) => <g key={x}><ellipse cx={x} cy="52" rx="8.5" ry="7" fill="#4fc3f7" opacity=".75" stroke="#0277bd" strokeWidth="2.4" />
        <path d={`M${x - 4} 49 Q${x - 1} 47 ${x + 2} 48`} stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" /></g>)}
      <path d="M58.5 52 L61.5 52" stroke="#0277bd" strokeWidth="2.4" /></g>;
    case "monocle": return <g><circle cx="69" cy="52" r="7.5" fill="#cfe8ff" opacity=".35" /><circle cx="69" cy="52" r="7.5" fill="none" stroke="#b38b2d" strokeWidth="2.2" />
      <path d="M64 48.5 Q66 46.5 69 46.8" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M75 57 Q80 70 84 84" stroke="#b38b2d" strokeWidth="1" fill="none" strokeDasharray="2 1.5" /></g>;
    case "star": return <g fill="#ffd23f" stroke="#c99a00" strokeWidth=".8">{[51, 69].map((x) => <path key={x} d={`M${x} 44 L${x + 2.6} 49.5 L${x + 8.5} 50 L${x + 4} 54 L${x + 5.4} 60 L${x} 56.8 L${x - 5.4} 60 L${x - 4} 54 L${x - 8.5} 50 L${x - 2.6} 49.5 Z`} />)}</g>;
    default: return null;
  }
}
function headwear(id: string, oc: string): ReactNode {
  switch (id) {
    case "cap": return <g><path d="M33 42 C33 14 87 14 87 42 Z" fill={oc} /><path d="M60 40 L101 41 C101 46 72 46 60 44 Z" fill={shade(oc)} /><circle cx="60" cy="17" r="2.5" fill={shade(oc)} /></g>;
    case "beanie": return <g><path d="M33 42 C33 10 87 10 87 42 Z" fill={oc} /><rect x="32" y="35" width="56" height="9" rx="4" fill={shade(oc)} /><circle cx="60" cy="10" r="6" fill={shade(oc, 1.1)} /></g>;
    case "bucket": return <g><path d="M38 36 C38 15 82 15 82 36 Z" fill={oc} /><ellipse cx="60" cy="38" rx="33" ry="6.5" fill={shade(oc)} /></g>;
    case "headband": return <rect x="34" y="33" width="52" height="7" rx="3.5" fill={oc} />;
    case "flower": return <g transform="translate(84 37)">{[0, 72, 144, 216, 288].map((r) =>
      <ellipse key={r} cx="0" cy="-6" rx="4.2" ry="6.5" fill="#fff" stroke="#f1d6a0" strokeWidth=".6" transform={`rotate(${r})`} />)}<circle r="3" fill="#f7c21b" /></g>;
    case "ngob": return <g><path d="M10 42 L60 9 L110 42 Q60 52 10 42 Z" fill="#d9b56b" stroke="#a9843c" strokeWidth="1.2" />
      <path d="M26 36 Q60 44 94 36 M38 28 Q60 34 82 28" stroke="#a9843c" strokeWidth="1" fill="none" /></g>;
    case "helmet": return <g><path d="M31 48 C29 10 91 10 89 48 Z" fill="#2f7bf5" /><path d="M36 42 Q60 34 84 42 L84 48 Q60 41 36 48 Z" fill="#1d1d24" opacity=".8" /><path d="M50 14 L70 14" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></g>;
    case "crown": return <path d="M37 32 L42 13 L51 25 L60 8 L69 25 L78 13 L83 32 Z" fill="#f2c230" stroke="#b8860b" strokeWidth="1.4" />;
    case "mongkol": return <g fill="none" strokeLinecap="round"><path d="M34 40 C40 28 80 28 86 40" stroke="#d1452f" strokeWidth="6" />
      <path d="M34 40 C40 28 80 28 86 40" stroke="#fff" strokeWidth="2" strokeDasharray="4 5" /><path d="M86 40 Q96 44 99 56" stroke="#d1452f" strokeWidth="4" /></g>;
    case "flower-crown": return <g>{[[38, 38, "#ff8fab"], [45, 30, "#ffd23f"], [53, 26, "#fff"], [61, 25, "#ff8fab"], [69, 26, "#c3a6ff"], [77, 30, "#ffd23f"], [83, 37, "#fff"]].map(([x, y, f]) =>
      <g key={`${x}`}><circle cx={x as number} cy={y as number} r="5" fill={f as string} /><circle cx={x as number} cy={y as number} r="1.6" fill="#f08a00" /></g>)}</g>;
    case "beret": return <g><ellipse cx="60" cy="35" rx="25" ry="4.5" fill={shade(oc)} />
      <ellipse cx="57" cy="29" rx="30" ry="10.5" fill={oc} transform="rotate(-8 57 29)" /><path d="M56 19.5 L57 13.5" stroke={shade(oc)} strokeWidth="2.6" strokeLinecap="round" /></g>;
    case "chada": return <g stroke="#8a6200" strokeWidth=".9" strokeLinejoin="round">
      <path d="M33 45 Q26 52 31 62 Q33 53 37 47 Z M87 45 Q94 52 89 62 Q87 53 83 47 Z" fill="#f2c230" />
      <path d="M33 43 Q60 31 87 43 L85 34 Q60 24 35 34 Z" fill="#f2c230" />
      <path d="M40 32 Q60 23 80 32 L73 24 Q60 18 47 24 Z" fill="#e0a800" />
      <path d="M47 24 Q60 18 73 24 L68 17 Q60 14 52 17 Z" fill="#f2c230" />
      <path d="M52 17 Q60 14 68 17 L60 9 Z" fill="#e0a800" />
      <g stroke="none">{[42, 51, 60, 69, 78].map((x) => <circle key={x} cx={x} cy={x === 60 ? 33 : 35} r="1.8" fill="#d1452f" />)}
        <circle cx="60" cy="21" r="1.5" fill="#2bb39a" /></g></g>;
    case "halo": return <g fill="none"><ellipse cx="60" cy="17" rx="21" ry="5" stroke="#fff3a6" strokeWidth="7" opacity=".35" />
      <ellipse cx="60" cy="17" rx="21" ry="5" stroke="#ffd84d" strokeWidth="3" /><path d="M46 14.5 Q53 12.6 60 12.4" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" /></g>;
    default: return null;
  }
}
const BODY = "M8 122 C10 97 33 86 60 86 C87 86 110 97 112 122 Z";
function outfit(id: string, oc: string, skin: string, clip: string): ReactNode {
  const dark = shade(oc);
  const tee = <path d="M50 87 Q60 97 70 87" stroke={dark} strokeWidth="2.4" fill="none" />;
  switch (id) {
    case "hoodie": return <g><path d={BODY} fill={oc} /><path d="M38 90 C40 78 80 78 82 90 Q60 82 38 90 Z" fill={dark} />
      <path d="M55 92 L54 106 M65 92 L66 106" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></g>;
    case "collared": return <g><path d={BODY} fill={oc} /><path d="M49 85 L60 99 L55 85 Z M71 85 L60 99 L65 85 Z" fill="#fff" stroke={dark} strokeWidth="1" />
      {[104, 112, 120].map((y) => <circle key={y} cx="60" cy={y} r="1.6" fill={dark} />)}</g>;
    case "tank": return <g><path d={BODY} fill={skin} /><path d="M38 122 L41 90 Q60 101 79 90 L82 122 Z" fill={oc} /></g>;
    case "jacket": return <g><path d={BODY} fill={oc} /><path d="M53 87 L67 87 L65 122 L55 122 Z" fill="#f4f4f4" /><path d="M53 87 L58 100 M67 87 L62 100" stroke={dark} strokeWidth="2" /></g>;
    case "scarf": return <g><path d={BODY} fill={oc} /><path d="M44 83 Q60 96 76 83 L77 91 Q60 104 43 91 Z" fill="#e9a400" /><path d="M66 95 L70 116 L62 114 Z" fill="#e9a400" /></g>;
    case "striped": return <g><path d={BODY} fill={oc} /><g clipPath={`url(#${clip})`} stroke="#fff" strokeWidth="4" opacity=".85">
      {[98, 108, 118].map((y) => <path key={y} d={`M0 ${y} L120 ${y}`} />)}</g>{tee}</g>;
    case "overalls": return <g><path d={BODY} fill={oc} /><path d="M44 122 L46 100 L74 100 L76 122 Z" fill="#3c5a8a" />
      <path d="M46 101 L40 88 M74 101 L80 88" stroke="#3c5a8a" strokeWidth="4" /><circle cx="48" cy="103" r="1.8" fill="#e9c46a" /><circle cx="72" cy="103" r="1.8" fill="#e9c46a" /></g>;
    case "pha-khao-ma": return <g><path d={BODY} fill={oc} /><g clipPath={`url(#${clip})`} opacity=".95">
      <path d="M40 84 Q60 100 80 84 L84 96 Q60 112 36 96 Z" fill="#d1452f" />
      <path d="M40 84 Q60 100 80 84 L84 96 Q60 112 36 96 Z" fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M48 92 L46 104 M60 96 L60 108 M72 92 L74 104" stroke="#27348b" strokeWidth="2" /></g></g>;
    case "muay-thai": return <g><path d={BODY} fill={skin} /><path d="M20 106 Q30 100 34 112" stroke="#d1452f" strokeWidth="5" fill="none" />
      <path d="M100 106 Q90 100 86 112" stroke="#d1452f" strokeWidth="5" fill="none" /><path d="M50 98 Q60 104 70 98" stroke={shade(skin)} strokeWidth="1.5" fill="none" /></g>;
    case "hawaiian": return <g><path d={BODY} fill={oc} /><g clipPath={`url(#${clip})`}>{[[30, 104], [48, 114], [74, 106], [92, 116], [62, 96]].map(([x, y]) =>
      <g key={x} transform={`translate(${x} ${y})`}>{[0, 72, 144, 216, 288].map((r) => <ellipse key={r} cy="-3" rx="2" ry="3.4" fill="#fff" transform={`rotate(${r})`} />)}<circle r="1.4" fill="#ffd23f" /></g>)}</g>
      <path d="M49 85 L60 99 L55 85 Z M71 85 L60 99 L65 85 Z" fill={dark} /></g>;
    case "mudmee": return <g><path d={BODY} fill="#6a1b4d" /><g clipPath={`url(#${clip})`}>
      {[22, 40, 58, 76, 94].map((x) => <g key={x}><rect x={x} y="80" width="6" height="45" fill="#c2477d" />
        {[92, 104, 116].map((y) => <path key={y} d={`M${x + 3} ${y - 4} L${x + 7} ${y} L${x + 3} ${y + 4} L${x - 1} ${y} Z`} fill="#f3c6dc" />)}</g>)}</g>
      <path d="M50 85 Q60 93 70 85" stroke="#e9c46a" strokeWidth="2.5" fill="none" /></g>;
    case "raincoat": return <g><path d={BODY} fill="#f5c400" /><path d="M60 92 L60 122" stroke="#c99a00" strokeWidth="2" />
      {[100, 110].map((y) => <circle key={y} cx="64" cy={y} r="1.8" fill="#c99a00" />)}<path d="M40 90 C42 80 78 80 80 90 Q60 84 40 90 Z" fill="#c99a00" /></g>;
    case "suit": return <g><path d={BODY} fill="#2a2f45" /><path d="M49 86 L60 108 L71 86 Z" fill="#fff" />
      <path d="M49 86 L60 108 L52 101 L42 92 Z M71 86 L60 108 L68 101 L78 92 Z" fill="#3c4364" />
      <path d="M57.5 88 L62.5 88 L61.5 92 L58.5 92 Z M58.5 92 L61.5 92 L63 103 L60 107 L57 103 Z" fill={oc} />
      <path d="M78 100 L86 100 L84 104 L82 101 L80 104 Z" fill="#fff" /></g>;
    case "chut-thai": return <g><path d={BODY} fill="#8e1c3a" /><g clipPath={`url(#${clip})`}>
      {[96, 106, 116].map((y) => [20, 34, 48, 62, 76, 90, 104].map((x) => <circle key={`${x}-${y}`} cx={x + (y % 20 ? 7 : 0)} cy={y} r="1.1" fill="#f2c230" opacity=".55" />))}
      <path d="M26 96 L44 84 L104 122 L80 122 Z" fill="#e9b949" />
      <path d="M26 96 L44 84 L104 122 L80 122 Z" fill="none" stroke="#a87a12" strokeWidth="1.2" />
      {[[40, 92], [52, 100], [64, 108], [76, 116]].map(([x, y]) => <path key={x} d={`M${x} ${y - 3.5} L${x + 3.5} ${y} L${x} ${y + 3.5} L${x - 3.5} ${y} Z`} fill="#8e1c3a" />)}</g>
      <path d="M48 86 Q60 96 72 86" stroke="#f2c230" strokeWidth="3" fill="none" /><circle cx="44" cy="86" r="3.2" fill="#f2c230" stroke="#a87a12" /></g>;
    default: return <g><path d={BODY} fill={oc} />{tee}</g>;
  }
}

/** The avatar as an SVG. Missing slots use the default look. */
export function AvatarSvg({ look, size = 40, title }: { look: AvatarLook; size?: number; title?: string }) {
  const id = useId().replace(/:/g, "");
  const l = { ...DEFAULT_LOOK, ...look };
  const skin = colourOf("skin", l.skin), h = colourOf("hair_colour", l.hair_colour), oc = colourOf("outfit_colour", l.outfit_colour);
  const bg = colourOf("bg", l.bg).replace("url(#", `url(#${id}-`);
  const earX = l.face === "oval" ? [38, 82] : [35, 85];
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="avatar-svg">
      <defs>
        <clipPath id={`${id}-c`}><circle cx="60" cy="60" r="60" /></clipPath>
        <clipPath id={`${id}-b`}><path d={BODY} /></clipPath>
        <linearGradient id={`${id}-sunset`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff9a8b" /><stop offset=".55" stopColor="#ffc56f" /><stop offset="1" stopColor="#7f7fd5" /></linearGradient>
        <linearGradient id={`${id}-lanterns`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b0d26" /><stop offset="1" stopColor="#2b3a78" /></linearGradient>
        <linearGradient id={`${id}-beach`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5cc8ff" /><stop offset=".6" stopColor="#c8f0ff" /></linearGradient>
        <linearGradient id={`${id}-rice`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#bfe8ff" /><stop offset=".5" stopColor="#eaf7d2" /></linearGradient>
        <radialGradient id={`${id}-galaxy`} cx=".35" cy=".3" r=".9"><stop offset="0" stopColor="#5b2a9a" /><stop offset=".5" stopColor="#24124f" /><stop offset="1" stopColor="#070617" /></radialGradient>
        <radialGradient id={`${id}-temple`}><stop offset="0" stopColor="#fff2b0" /><stop offset=".7" stopColor="#f2c230" /><stop offset="1" stopColor="#b8860b" /></radialGradient>
      </defs>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="120" height="120" fill={bg} />
        {l.bg === "lanterns" && <g>{[[16, 20, 5], [96, 16, 4], [104, 48, 3.5], [12, 58, 3], [28, 92, 4], [100, 90, 3]].map(([x, y, r]) =>
          <g key={x}><circle cx={x} cy={y} r={r * 2.2} fill="#ffb84d" opacity=".25" /><rect x={x - r * 0.7} y={y - r} width={r * 1.4} height={r * 2} rx={r * 0.5} fill="#ffcf6b" /></g>)}</g>}
        {l.bg === "beach" && <g><circle cx="94" cy="22" r="10" fill="#ffd84d" /><path d="M0 62 Q30 58 60 62 T120 62 L120 86 L0 86 Z" fill="#1fa9d6" />
          <path d="M0 70 Q15 67 30 70 T60 70 T90 70 T120 70" stroke="#fff" strokeWidth="1.5" fill="none" opacity=".6" />
          <path d="M0 84 Q60 76 120 84 L120 120 L0 120 Z" fill="#f3d9a4" /></g>}
        {l.bg === "rice-field" && <g><path d="M0 50 L22 30 L40 44 L62 24 L88 46 L104 34 L120 46 L120 60 L0 60 Z" fill="#7fae7a" opacity=".7" />
          {[["#9ccc4a", 52], ["#7cb342", 66], ["#9ccc4a", 80], ["#689f38", 94], ["#8bc34a", 108]].map(([f, y]) =>
            <path key={y} d={`M0 ${y} Q30 ${(y as number) - 7} 60 ${y} T120 ${y} L120 120 L0 120 Z`} fill={f as string} stroke="#c5e1a5" strokeWidth="1.2" />)}</g>}
        {l.bg === "galaxy" && <g><ellipse cx="60" cy="60" rx="80" ry="13" fill="#c9b6ff" opacity=".22" transform="rotate(-30 60 60)" />
          <ellipse cx="60" cy="60" rx="70" ry="5" fill="#fff" opacity=".18" transform="rotate(-30 60 60)" />
          {[[14, 18, 1.4], [30, 40, .8], [96, 14, 1.2], [106, 36, .9], [84, 28, .7], [20, 74, 1], [102, 70, 1.3], [12, 100, .8], [108, 100, .9], [46, 12, .9]].map(([x, y, r]) =>
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#fff" />)}
          <path d="M96 14 m-4 0 h8 m-4 -4 v8" stroke="#fff" strokeWidth=".8" /></g>}
        {l.bg === "temple" && <g fill="#fff" opacity=".35">{[0, 45, 90, 135].map((r) => <rect key={r} x="58" y="-10" width="4" height="140" transform={`rotate(${r} 60 60)`} />)}</g>}
        <g transform="translate(60 66) scale(1.16) translate(-60 -66)">
        {hairBack(l.hair, h)}
        {outfit(l.outfit, oc, skin, `${id}-b`)}
        <rect x="51" y="68" width="18" height="22" rx="7" fill={skin} />
        <rect x="51" y="70" width="18" height="6" fill={shade(skin, 0.9)} />
        {earX.map((x) => <circle key={x} cx={x} cy="53" r="5.5" fill={skin} />)}
        {headShape(l.face, skin)}
        <circle cx="45" cy="60" r="4.5" fill="#ff7a8a" opacity=".22" /><circle cx="75" cy="60" r="4.5" fill="#ff7a8a" opacity=".22" />
        {eyes(l.eyes)}
        <path d="M60 54.5 Q57.5 59 60.8 60" stroke={shade(skin, 0.8)} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        {facialHair(l.facial_hair, h)}
        {mouth(l.mouth)}
        {brows(l.brows, h)}
        {["none", "flower", "headband", "beret", "halo"].includes(l.headwear) ? hairFront(l.hair, h) : null}
        {glasses(l.glasses)}
        {headwear(l.headwear, oc)}
        </g>
      </g>
    </svg>
  );
}
