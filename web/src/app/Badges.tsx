import type { ReactNode } from "react";
import { Camera, Car, Flower2, Landmark, Map, MapPinPlus, Stamp, Star, Trophy, Users, UtensilsCrossed } from "lucide-react";
import type { Badge } from "../lib/api";

const ICON: Record<string, (s: number) => ReactNode> = {
  map: (s) => <Map size={s} />, landmark: (s) => <Landmark size={s} />, stamp: (s) => <Stamp size={s} />, camera: (s) => <Camera size={s} />,
  utensils: (s) => <UtensilsCrossed size={s} />, temple: (s) => <Flower2 size={s} />, users: (s) => <Users size={s} />,
  car: (s) => <Car size={s} />, trophy: (s) => <Trophy size={s} />, star: (s) => <Star size={s} />, pin: (s) => <MapPinPlus size={s} />,
};
// tier 0 = not earned yet; then bronze, silver, gold, platinum, diamond
export const TIER_COLOURS = ["#c4c9d6", "#c8813f", "#9aa7b8", "#e9a400", "#3fb3c6", "#7b5cff"];
const ROMAN = ["", "I", "II", "III", "IV", "V"];

/** A shield in the tier colour with the badge icon and tier numeral. */
export function BadgeIcon({ b, size = 72 }: { b: Pick<Badge, "icon" | "tier">; size?: number }) {
  const c = TIER_COLOURS[b.tier];
  return (
    <span className={`badge-icon${b.tier ? "" : " locked"}`} style={{ width: size, height: size * 1.1 }}>
      <svg viewBox="0 0 100 110" width={size} height={size * 1.1} aria-hidden>
        <path d="M50 4 L92 20 L92 58 C92 82 72 98 50 106 C28 98 8 82 8 58 L8 20 Z" fill={c} />
        <path d="M50 14 L83 27 L83 58 C83 76 68 89 50 96 C32 89 17 76 17 58 L17 27 Z" fill="#fff" opacity=".25" />
        <path d="M50 4 L92 20 L92 40 C70 30 30 30 8 40 L8 20 Z" fill="#fff" opacity=".18" />
      </svg>
      <span className="badge-glyph" style={{ color: b.tier ? "#fff" : "#8a90a6" }}>{ICON[b.icon]?.(size * 0.36)}</span>
      {b.tier > 0 && <span className="badge-roman" style={{ background: c }}>{ROMAN[b.tier]}</span>}
    </span>
  );
}

/** Achievement grid: each badge with its tier and progress to the next one. */
export default function Badges({ list }: { list: Badge[] }) {
  return (
    <ul className="badge-grid">
      {list.map((b) => {
        const done = b.tier >= 5;
        const from = b.tier ? b.goals[b.tier - 1] : 0;
        return (
          <li key={b.slug} title={`${b.name_en} · ${b.name_th}`}>
            <BadgeIcon b={b} />
            <b>{b.name_en}</b>
            <span className="fine">{done ? "Max tier" : `${b.value} / ${b.next}`}</span>
            {!done && <progress value={b.value - from} max={b.next - from} aria-label={`${b.name_en}: ${b.value} of ${b.next}`} />}
          </li>
        );
      })}
    </ul>
  );
}
