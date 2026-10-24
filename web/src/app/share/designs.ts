// The share-card designs and card types, kept apart from the canvas drawing code (cards.ts) so the share sheet can show
// its swatches straight away and load the drawing code only when a card is drawn.
export const DESIGNS = {
  classic: { name: "Classic", bg: ["#eef0fb", "#ffffff"], ink: "#1d2470", accent: "#d1452f", pop: "#ffd23f", dark: false, plus: false },
  bold: { name: "Bold", bg: ["#140d2b", "#140d2b"], ink: "#ffffff", accent: "#d4ff3a", pop: "#ff3d8b", dark: true, plus: false },
  postcard: { name: "Postcard", bg: ["#fff2d9", "#fad9b3"], ink: "#4d260d", accent: "#bf4019", pop: "#2f7d6d", dark: false, plus: true },
  neon: { name: "Night neon", bg: ["#14052e", "#4d0d59"], ink: "#ffffff", accent: "#ff4dbf", pop: "#3df5ff", dark: true, plus: true },
  indigo: { name: "Indigo cloth", bg: ["#212b73", "#0d1238"], ink: "#ffffff", accent: "#e8a317", pop: "#5c6bc0", dark: true, plus: true },
  riso: { name: "Riso", bg: ["#f4efe4", "#f4efe4"], ink: "#2346c8", accent: "#ff4d6d", pop: "#ffcf33", dark: false, plus: true },
} as const;
export type Design = keyof typeof DESIGNS;

export type Card =
  | { kind: "photo" | "sticker"; place: string; placeTh: string | null; tier: 1 | 2 | 3; province: string | null; at: Date; level: number | null; photo?: string }
  | { kind: "progress"; name: string; visited: Set<number> }
  | { kind: "stats"; name: string; visited: Set<number>; level: number; stamps: number }   // transparent sticker
  | { kind: "milestone"; what: "province"; province: number | string; at: Date; name: string }   // province id or English name
  | { kind: "milestone"; what: "level"; level: number; name: string }
  | { kind: "milestone"; what: "badge"; title: string; tier: number; colour: string; name: string; icon?: string }
  | { kind: "milestone"; what: "fortune"; rarity: string; prize: string; stick: number; name: string }
  | { kind: "trip"; title: string; photos: string[]; members: string[]; at: Date };
