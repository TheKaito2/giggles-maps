import ProvinceStamp from "./passport/ProvinceStamp";
import { useProvinces } from "./passport/useProvinces";
import { AvatarSvg, randomLook } from "./avatar/parts";

/** Dev-only sheets: /app/?debug=stamps (all 77, half collected) and /app/?debug=avatars (random looks). */
export default function Debug({ what }: { what: string }) {
  const features = useProvinces();
  if (what === "avatars") return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: 16, overflow: "auto", height: "100%" }}>
      {Array.from({ length: 40 }, (_, i) => <AvatarSvg key={i} look={randomLook()} size={110} />)}
    </div>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 16, overflow: "auto", height: "100%", background: "#f6efdc" }}>
      {features.map((f, i) => <ProvinceStamp key={f.id} f={f} earnedAt={i % 2 ? null : "2026-10-23T10:00:00Z"} size={Number(new URLSearchParams(location.search).get("size") ?? 150)} />)}
    </div>
  );
}
