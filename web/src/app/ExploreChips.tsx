import { Coffee, CreditCard, Fuel, Gem, Hospital, Hotel, Landmark, ShoppingBasket, UtensilsCrossed } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const CHIPS: { id: string; label: string; icon: LucideIcon; kinds: string[] }[] = [
  { id: "food", label: "Restaurants", icon: UtensilsCrossed, kinds: ["restaurant", "fast_food"] },
  { id: "local", label: "OTOP & local", icon: Gem, kinds: ["otop", "community_enterprise", "craft", "souvenir", "market", "night_market"] },
  { id: "coffee", label: "Coffee", icon: Coffee, kinds: ["cafe", "bakery", "dessert"] },
  { id: "convenience", label: "Convenience", icon: ShoppingBasket, kinds: ["convenience"] },   // 7-Eleven, FamilyMart, Lotus's go...
  { id: "sights", label: "Sights", icon: Landmark, kinds: ["temple", "museum", "viewpoint", "attraction", "waterfall", "beach", "park", "national_park", "art"] },
  { id: "hotels", label: "Hotels", icon: Hotel, kinds: ["hotel", "guesthouse"] },
  { id: "gas", label: "Gas", icon: Fuel, kinds: ["fuel", "ev_charging"] },
  { id: "health", label: "Hospitals", icon: Hospital, kinds: ["hospital", "clinic", "pharmacy"] },
  { id: "atm", label: "ATMs", icon: CreditCard, kinds: ["atm", "bank"] },
];

/** Google-style one-tap filters over the map; tapping the active chip clears it. */
export default function ExploreChips({ active, onPick }: { active: string | null; onPick: (id: string | null) => void }) {
  return (
    <div className="explore-chips" role="toolbar" aria-label="Show on the map">
      {CHIPS.map((c) => (
        <button key={c.id} type="button" className={`explore-chip${active === c.id ? " on" : ""}`} aria-pressed={active === c.id}
          onClick={() => onPick(active === c.id ? null : c.id)}>
          <c.icon size={15} aria-hidden /> {c.label}
        </button>
      ))}
    </div>
  );
}
