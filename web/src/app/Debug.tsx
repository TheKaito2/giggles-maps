import ProvinceStamp from "./passport/ProvinceStamp";
import { useProvinces } from "./passport/useProvinces";
import { AvatarSvg, randomLook } from "./avatar/parts";
import { useEffect, useState } from "react";
import Badges from "./Badges";
import { type Card, DESIGNS, type Design, drawCard } from "./share/cards";
import type { Badge } from "../lib/api";

const ICONS = ["map", "landmark", "stamp", "camera", "utensils", "temple", "users", "car", "trophy", "star", "pin"];
const BADGES: Badge[] = ICONS.map((icon, i) => ({ slug: icon, name_en: `${icon[0].toUpperCase()}${icon.slice(1)} badge`, name_th: "เหรียญ", icon,
  tier: i % 6, goals: [1, 5, 10, 25, 50], value: [0, 3, 7, 18, 40, 60][i % 6] + (i > 5 ? 1 : 0), next: [1, 5, 10, 25, 50, 50][i % 6] }));

/** Every share card in one design: /app/?debug=cards&design=bold */
function Cards() {
  const design = (new URLSearchParams(location.search).get("design") ?? "classic") as Design;
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const at = new Date("2026-10-23T10:00:00Z"), visited = new Set([1, 2, 3, 10, 11, 12, 13, 20, 21, 30, 40, 50, 60, 61, 62, 70]);
    const cards: Card[] = [
      { kind: "progress", name: "Ploy", visited },
      { kind: "photo", place: "Wat Phra Chetuphon Wimon Mangkhalaram", placeTh: "วัดพระเชตุพน", tier: 3, province: "Bangkok", at, level: 12 },
      { kind: "milestone", what: "province", province: 1, at, name: "Ploy" },
      { kind: "milestone", what: "badge", title: "Temple hopper", tier: 4, colour: "#3fb3c6", name: "Ploy", icon: "temple" },
      { kind: "milestone", what: "level", level: 12, name: "Ploy" },
      { kind: "milestone", what: "fortune", rarity: "Legendary", prize: "Golden naga frame", stick: 9, name: "Ploy" },
      { kind: "stats", name: "Ploy", visited, level: 12, stamps: 48 },
      { kind: "sticker", place: "Chatuchak Market", placeTh: "ตลาดนัดจตุจักร", tier: 2, province: "Bangkok", at, level: 12 },
    ];
    Promise.all(cards.map((c) => drawCard(c, design).then((cv) => cv.toDataURL("image/png")))).then(setUrls);
  }, [design]);
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: 16, overflow: "auto", height: "100%", background: "#888" }}>
    <p style={{ width: "100%", margin: 0 }}>{Object.keys(DESIGNS).join(" · ")}</p>
    {urls.map((u, i) => <img key={i} src={u} style={{ width: 270, background: "repeating-conic-gradient(#0000 0 25%, #0002 0 50%) 0 0 / 16px 16px" }} />)}
  </div>;
}

/** Dev-only sheets: /app/?debug=stamps (all 77, half collected) and /app/?debug=avatars (random looks). */
export default function Debug({ what }: { what: string }) {
  const features = useProvinces();
  if (what === "cards") return <Cards />;
  if (what === "medals") return <div className="page-col" style={{ overflow: "auto", height: "100%" }}><Badges list={BADGES} shareAs={{ name: "Ploy", hasPlus: true }} /></div>;
  if (what === "avatars") return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: 16, overflow: "auto", height: "100%" }}>
      {Array.from({ length: 40 }, (_, i) => <AvatarSvg key={i} look={randomLook()} size={110} />)}
    </div>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 16, overflow: "auto", height: "100%", background: "#f6efdc" }}>
      {features.map((f, i) => <ProvinceStamp key={f.id} f={f} earnedAt={i % 4 === 3 ? null : "2026-10-23T10:00:00Z"} fresh={i < 4} size={Number(new URLSearchParams(location.search).get("size") ?? 150)} />)}
    </div>
  );
}
