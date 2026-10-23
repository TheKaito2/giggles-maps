import type { ReactNode } from "react";
import { Coffee, Landmark, Leaf, Mountain, Palette, ShoppingBag, Star, Store, UtensilsCrossed } from "lucide-react";
import type { PassportStamp } from "../../lib/api";

const ICON: Record<string, ReactNode> = {
  temple: <Landmark size={20} />, museum: <Landmark size={20} />, park: <Leaf size={20} />, viewpoint: <Mountain size={20} />,
  cafe: <Coffee size={20} />, food: <UtensilsCrossed size={20} />, market: <Store size={20} />, craft: <ShoppingBag size={20} />,
  art: <Palette size={20} />,
};
const TIER = { 3: "Landmark", 2: "Worth a visit", 1: "Everyday" } as const;

/** Each stamp gets its own look from its place: tier colour, kind icon, and a tilt picked from the place id. */
export default function Stamps({ stamps, provinceName }: { stamps: PassportStamp[]; provinceName: (id: number | null) => string }) {
  if (!stamps.length) return <p className="fine">No stamps yet. Go to a place on the map, check in with a photo, and it lands here.</p>;
  const order = [...stamps].sort((a, b) => b.tier - a.tier || b.earned_at.localeCompare(a.earned_at));
  return (
    <ul className="stamp-grid">
      {order.map((s) => (
        <li key={s.place_id} className={`stamp-card tier-${s.tier}`} style={{ rotate: `${(s.place_id % 9) - 4}deg` }}
          title={`${TIER[s.tier]} · ${s.name}`}>
          {s.tier === 3 && <Star size={12} className="stamp-star" aria-label="Landmark" />}
          <span className="stamp-icon" aria-hidden>{ICON[s.category] ?? <Landmark size={20} />}</span>
          <b className="stamp-name">{s.name}</b>
          <span className="stamp-meta">{provinceName(s.province_id)} · {new Date(s.earned_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}</span>
          {s.event && <span className="chip meal">{s.event}</span>}
        </li>
      ))}
    </ul>
  );
}
