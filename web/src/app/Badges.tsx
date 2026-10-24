import { type CSSProperties, type PointerEvent, type ReactNode, useState } from "react";
import { Camera, Car, Check, Flower2, Landmark, Lock, type LucideIcon, Map, MapPinPlus, Share2, Stamp, Star, Trophy, Users, UtensilsCrossed, X } from "lucide-react";
import type { Badge } from "../lib/api";
import { useDialog } from "../lib/useDialog";
import ShareSheet from "./share/ShareSheet";

const GLYPH: Record<string, LucideIcon> = { map: Map, landmark: Landmark, stamp: Stamp, camera: Camera, utensils: UtensilsCrossed,
  temple: Flower2, users: Users, car: Car, trophy: Trophy, star: Star, pin: MapPinPlus };
// the icon nested in the medal's face, centred on (50, 51)
const ICON: Record<string, (s: number) => ReactNode> = Object.fromEntries(Object.entries(GLYPH).map(([k, I]) =>
  [k, (s: number) => <I size={s} x={50 - s / 2} y={51 - s / 2} strokeWidth={2.4} />]));
// tier 0 = not earned yet; then bronze, silver, gold, platinum, diamond
export const TIER_COLOURS = ["#c4c9d6", "#c8813f", "#9aa7b8", "#e9a400", "#3fb3c6", "#7b5cff"];
export const TIER_NAMES = ["Locked", "Bronze", "Silver", "Gold", "Platinum", "Diamond"];
const ROMAN = ["", "I", "II", "III", "IV", "V"];
/** Metal for each tier: highlight, body, shadow (the share card draws the same). */
export const METAL: [string, string, string][] = [
  ["#f1efe9", "#d3d0c8", "#a9a59a"], ["#ffd9ab", "#c8813f", "#6e3f17"], ["#ffffff", "#b4bfcc", "#5f6c7c"],
  ["#fff3b0", "#e9a400", "#7d5100"], ["#e6fcff", "#6fcbd9", "#1f6f7d"], ["#f3ecff", "#9b7bff", "#3f22a8"],
];

/** The rim gets fancier with the tier, like Apple's award medals: plain coin, beaded, scalloped, an 8-point star, a 12-point burst. */
function rim(tier: number) {
  const pts = (n: number, r0: number, r1: number) => "M" + Array.from({ length: n * 2 }, (_, i) => {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? r1 : r0;
    return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" L") + " Z";
  if (tier === 3) return "M" + Array.from({ length: 24 }, (_, i) => {
    const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 0.5) / 24) * Math.PI * 2, a2 = ((i + 1) / 24) * Math.PI * 2;
    const p = (r: number, a: number) => `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
    return `${i ? "" : p(44, a0)} Q${p(49, a1)} ${p(44, a2)}`;
  }).join(" ") + " Z";
  if (tier === 4) return pts(8, 48, 41);
  if (tier === 5) return pts(12, 49, 42);
  return "M50 4 A46 46 0 1 1 49.99 4 Z";
}

/** A medal in the tier's metal: a notched rim, a recessed face with the icon pressed in, and the tier on a ribbon tab.
 *  All one SVG, so the share cards can draw the very same medal. */
export function MedalSvg({ b, size = 72 }: { b: Pick<Badge, "icon" | "tier">; size?: number }) {
  const [hi, mid, lo] = METAL[b.tier] ?? METAL[0];
  const id = `m${b.tier}`;
  return (
    <svg viewBox="0 0 100 110" width={size} height={size * 1.1} aria-hidden>
      <defs>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={hi} /><stop offset=".5" stopColor={mid} /><stop offset="1" stopColor={lo} /></linearGradient>
        <radialGradient id={`${id}-face`} cx=".38" cy=".3" r=".9"><stop offset="0" stopColor={hi} /><stop offset=".55" stopColor={mid} /><stop offset="1" stopColor={lo} /></radialGradient>
        <filter id={`${id}-emb`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="0" floodColor={hi} /><feDropShadow dx="0" dy="-.8" stdDeviation="0" floodColor="#000" floodOpacity=".2" /></filter>
      </defs>
      <path d={rim(b.tier)} fill={`url(#${id}-rim)`} />
      {b.tier === 2 && Array.from({ length: 28 }, (_, i) => {
        const a = (i / 28) * Math.PI * 2;
        return <circle key={i} cx={50 + 41 * Math.cos(a)} cy={50 + 41 * Math.sin(a)} r="1.7" fill={hi} opacity=".9" />;
      })}
      <circle cx="50" cy="50" r="35" fill={lo} />
      <circle cx="50" cy="51.5" r="33.5" fill={`url(#${id}-face)`} />
      <path d="M22 40 A30 30 0 0 1 78 40 A40 40 0 0 0 22 40 Z" fill="#fff" opacity=".35" />
      <g filter={`url(#${id}-emb)`} color={b.tier ? lo : "#9a968b"}>
        {b.tier ? ICON[b.icon]?.(34) : <Lock size={28} x={36} y={37} strokeWidth={2.4} />}
      </g>
      {b.tier > 0 && <>
        <path d="M36 87 L64 87 L68 105 L50 98.5 L32 105 Z" fill={mid} stroke={lo} strokeWidth="1.5" strokeLinejoin="round" />
        <text x="50" y="97.5" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff" fontFamily="var(--font-data)" stroke={lo} strokeWidth=".6" paintOrder="stroke">{ROMAN[b.tier]}</text>
      </>}
    </svg>
  );
}
export function BadgeIcon({ b, size = 72 }: { b: Pick<Badge, "icon" | "tier">; size?: number }) {
  return <span className={`badge-icon medal t${b.tier}`} style={{ width: size, height: size * 1.1 }}><MedalSvg b={b} size={size} /></span>;
}

const share = (b: Badge) => (b.tier >= 5 ? 1 : (b.value - (b.tier ? b.goals[b.tier - 1] : 0)) / Math.max(1, b.next - (b.tier ? b.goals[b.tier - 1] : 0)));
/** The medal inside a ring that fills towards the next tier. */
const Ringed = ({ b, size }: { b: Badge; size: number }) => (
  <span className="medal-ring" style={{ "--p": Math.min(1, Math.max(0, share(b))) } as CSSProperties}><BadgeIcon b={b} size={size} /></span>
);

/** Achievements as a trophy shelf (Duolingo / Apple Fitness): tiers earned overall, the three closest to their next tier,
 *  then every medal, earned first. Tap one for its tier ladder, a medal you can tilt, and Share. */
export default function Badges({ list, shareAs }: { list: Badge[]; shareAs?: { name: string; hasPlus: boolean } }) {
  const [open, setOpen] = useState<Badge | null>(null);
  const earned = list.reduce((n, b) => n + b.tier, 0), total = list.length * 5;
  const close = list.filter((b) => b.tier < 5 && b.value > 0).sort((a, b) => share(b) - share(a)).slice(0, 3);
  const sorted = [...list].sort((a, b) => b.tier - a.tier || share(b) - share(a));
  return (
    <div className="trophies">
      <div className="trophy-head">
        <b className="num">{earned}<small> / {total} tiers</small></b>
        <span className="trophy-bar" aria-hidden><i style={{ width: `${(earned / Math.max(total, 1)) * 100}%` }} /></span>
      </div>
      {close.length > 0 && <section className="almost">
        <h4 className="eyebrow">Almost there</h4>
        <ul>{close.map((b) => <li key={b.slug}><button type="button" onClick={() => setOpen(b)}>
          <Ringed b={b} size={44} />
          <span><b>{b.name_en}</b><span className="fine num">{b.value} / {b.next} for {TIER_NAMES[b.tier + 1]}</span></span>
        </button></li>)}</ul>
      </section>}
      <ul className="badge-grid">
        {sorted.map((b) => (
          <li key={b.slug} className={b.tier ? "" : "locked"}>
            <button type="button" onClick={() => setOpen(b)} aria-label={`${b.name_en}, ${TIER_NAMES[b.tier]}`}>
              <Ringed b={b} size={64} />
              <b>{b.name_en}</b>
              <span className="fine num">{b.tier >= 5 ? "Max tier" : `${b.value} / ${b.next}`}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && <BadgeSheet b={open} shareAs={shareAs} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** One badge up close: a medal that tilts under your finger, its five tiers with goals, and Share. */
function BadgeSheet({ b, shareAs, onClose }: { b: Badge; shareAs?: { name: string; hasPlus: boolean }; onClose: () => void }) {
  const box = useDialog(onClose);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [sharing, setSharing] = useState(false);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTilt({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 });
  };
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={b.name_en} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal badge-sheet t${b.tier}`} ref={box} tabIndex={-1}>
        <header className="modal-head">
          <span><span className="eyebrow">{TIER_NAMES[b.tier]}</span><h2>{b.name_en}</h2><span className="fine">{b.name_th}</span></span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="medal-stage" onPointerMove={move} onPointerLeave={() => setTilt({ x: 0, y: 0 })}
          style={{ "--rx": `${-tilt.y * 28}deg`, "--ry": `${tilt.x * 34}deg`, "--gx": `${(tilt.x + 0.5) * 100}%`, "--gy": `${(tilt.y + 0.5) * 100}%` } as CSSProperties}>
          <div className="medal-3d"><BadgeIcon b={b} size={168} /><span className="medal-glare" /></div>
        </div>
        <ol className="tier-ladder">
          {b.goals.map((goal, i) => {
            const t = i + 1, done = b.tier >= t, now = b.tier + 1 === t;
            return <li key={t} className={done ? "done" : now ? "now" : ""}>
              <BadgeIcon b={{ icon: b.icon, tier: done ? t : 0 }} size={30} />
              <span><b>{TIER_NAMES[t]}</b><span className="fine num">{goal}</span></span>
              {done ? <Check size={18} aria-label="Reached" /> : now ? <span className="ladder-bar" aria-label={`${b.value} of ${goal}`}>
                <i style={{ width: `${Math.min(100, (b.value / goal) * 100)}%` }} /></span> : null}
            </li>;
          })}
        </ol>
        {shareAs && b.tier > 0 && <button type="button" className="btn" onClick={() => setSharing(true)}><Share2 size={16} aria-hidden /> Share</button>}
      </div>
      {sharing && shareAs && <ShareSheet hasPlus={shareAs.hasPlus} onClose={() => setSharing(false)}
        options={[{ id: "badge", label: "Badge", card: { kind: "milestone", what: "badge", title: b.name_en, tier: b.tier, colour: TIER_COLOURS[b.tier], name: shareAs.name, icon: b.icon } }]} />}
    </div>
  );
}
