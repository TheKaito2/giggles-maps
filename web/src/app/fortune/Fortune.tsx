import { useEffect, useRef, useState } from "react";
import { Share2, X } from "lucide-react";
import ShareSheet from "../share/ShareSheet";
import { ApiError } from "../../lib/supabase";
import { type Rarity, type Shake, shakeFortune } from "../../lib/api";
import { FORTUNES } from "./fortunes";
import { rattle, reveal, stickDrop } from "../../lib/sfx";
import { buzz } from "../../lib/native";

export const RARITY: Record<Rarity, { en: string; th: string }> = {
  common: { en: "Common", th: "ธรรมดา" }, rare: { en: "Rare", th: "หายาก" },
  epic: { en: "Epic", th: "พิเศษ" }, legendary: { en: "Legendary", th: "ตำนาน" },
};
const KIND_NAME: Record<string, string> = { theme: "passport cover", flair: "name flair", map: "map skin", frame: "photo frame", title: "title", avatar: "avatar item" };

/** What a shake won, in one line. */
export function prizeText(s: Pick<Shake, "prize" | "coins" | "xp" | "boost_hours" | "item_kind" | "item_en"> & { member?: boolean }): string {
  switch (s.prize) {
    case "coins": return `+${s.coins} coins`;
    case "xp": return `+${s.xp} XP`;
    case "boost": return `XP ×1.5 on every stamp for ${s.boost_hours >= 48 ? `${s.boost_hours / 24} days` : `${s.boost_hours} hours`}`;
    case "item": return `New ${KIND_NAME[s.item_kind ?? ""] ?? "item"}: ${s.item_en}`;
  }
}

/** The published odds (same numbers as the server's fortune_rarity). */
export function OddsTable() {
  return (
    <div className="odds">
      <table>
        <thead><tr><th>Stick</th><th>Chance</th><th>At a landmark</th><th>Prize</th></tr></thead>
        <tbody>
          <tr><td>Common</td><td className="num">60%</td><td className="num">45%</td><td>10–20 coins or +30 XP</td></tr>
          <tr><td>Rare</td><td className="num">30%</td><td className="num">38%</td><td>40–60 coins, 24 h ×1.5 XP, or a shop item (up to 150)</td></tr>
          <tr><td>Epic</td><td className="num">9%</td><td className="num">14%</td><td>120 coins, 3 days ×1.5 XP, or a shop item (200–500)</td></tr>
          <tr><td>Legendary</td><td className="num">1%</td><td className="num">3%</td><td>A Siam Si-only item</td></tr>
        </tbody>
      </table>
      <p className="fine">Every 10th shake in a row without a Rare is Rare or better; the 80th without a Legendary is Legendary.
        You never get an item you already own (coins instead). Shakes are free: one per new place you check in at, plus bonus
        shakes for quests, new provinces and riding along. They can't be bought.</p>
    </div>
  );
}

type Phase = "ready" | "shaking" | "stick" | "card";
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Siam Si (เซียมซี) ceremony: shake the bamboo cup (tap it, or shake the phone), one numbered stick falls out, then its
 * fortune card turns over with the prize. `checkin` = the first-visit check-in this shake belongs to; none = a bonus shake.
 */
export default function Fortune({ checkin, onClose, onShaken, name = "Explorer", hasPlus = false }: {
  checkin?: string; onClose: () => void; onShaken: (s: Shake) => void; name?: string; hasPlus?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [shake, setShake] = useState<Shake | null>(null);
  const [error, setError] = useState("");
  const [odds, setOdds] = useState(false);
  const [usedCheckin, setUsedCheckin] = useState(false);
  const [sharing, setSharing] = useState(false);   // after the check-in's shake, "again" spends bonus shakes
  const started = useRef(false);
  const timers = useRef<number[]>([]);
  const hush = useRef(() => undefined as void);   // stops the cup's rattle
  useEffect(() => () => { timers.current.forEach(clearTimeout); hush.current(); }, []);
  useEffect(() => { if (phase === "card" && shake) reveal(shake.rarity); }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    if (started.current) return;
    started.current = true; setError(""); setPhase("shaking");
    buzz("shake");
    hush.current = rattle("sticks");
    const wait = new Promise((r) => timers.current.push(window.setTimeout(r, calm() ? 0 : 1300)));
    try {
      const [s] = await Promise.all([shakeFortune(checkin && !usedCheckin ? checkin : undefined), wait]);
      if (checkin) setUsedCheckin(true);
      hush.current();
      setShake(s); onShaken(s);
      setPhase("stick"); stickDrop(); buzz(s.rarity === "legendary" ? "big" : "tap");
      timers.current.push(window.setTimeout(() => setPhase("card"), calm() ? 0 : 900));
    } catch (e) {
      hush.current(); setPhase("ready");
      const code = e instanceof ApiError ? e.message : "";
      setError(code === "nothing_to_shake" ? "No shakes left. Check in somewhere new, finish a quest or reach a new province."
        : code === "shake_limit" ? "That's 30 shakes today, the daily most. The cup will be ready again tomorrow."
        : "Couldn't reach the fortune cup. Try again.");
    } finally { started.current = false; }
  };

  // shaking the phone works too, where the browser gives motion without asking (Android); iPhones tap the cup
  useEffect(() => {
    if (phase !== "ready" || typeof DeviceMotionEvent === "undefined"
      || typeof (DeviceMotionEvent as unknown as { requestPermission?: unknown }).requestPermission === "function") return;
    const onMove = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a && Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0) > 22) go();
    };
    addEventListener("devicemotion", onMove);
    return () => removeEventListener("devicemotion", onMove);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = shake ? FORTUNES[(shake.stick - 1) % FORTUNES.length] : null;
  const again = shake && shake.tickets > 0;
  return (
    <div className={`fortune-stage phase-${phase}${shake ? ` r-${shake.rarity}` : ""}`} role="dialog" aria-modal="true" aria-labelledby="fortune-title">
      <button type="button" className="icon-btn fortune-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
      <h2 id="fortune-title" className="fortune-title">เซียมซี <span>Siam Si</span></h2>

      {phase !== "card" && (
        <button type="button" className="fortune-cup" onClick={go} disabled={phase !== "ready"} aria-label="Shake the fortune cup">
          <svg viewBox="0 0 200 260" aria-hidden>
            {[...Array(11)].map((_, i) => (
              <rect key={i} x={52 + i * 9} y={30 + (i % 3) * 8} width="6" height="120" rx="3" className="cup-stick" />
            ))}
            {shake && phase === "stick" && <g className="falling-stick">
              <rect x="94" y="0" width="12" height="150" rx="5" className="cup-stick chosen" />
              <text x="100" y="40" textAnchor="middle" className="stick-num">{shake.stick}</text>
            </g>}
            <path d="M40 110 h120 l-14 140 a8 8 0 0 1 -8 7 h-76 a8 8 0 0 1 -8 -7 z" className="cup-body" />
            <path d="M40 110 h120" className="cup-rim" />
            <path d="M52 150 h96 M55 200 h90" className="cup-band" />
          </svg>
        </button>
      )}
      {phase === "ready" && <p className="fortune-hint">Tap the cup to shake{typeof DeviceMotionEvent !== "undefined" ? " (or shake your phone)" : ""}</p>}
      {phase === "shaking" && <p className="fortune-hint" role="status">Shaking…</p>}
      {phase === "stick" && shake && <p className="fortune-hint" role="status">Stick number {shake.stick}</p>}

      {phase === "card" && shake && f && (
        <div className="fortune-card" role="status">
          <span className="fortune-rarity">{RARITY[shake.rarity].en} · {RARITY[shake.rarity].th}</span>
          <span className="fortune-stick num">No. {shake.stick}</span>
          <p className="fortune-en">{f.en}</p>
          <p className="fortune-th" lang="th">{f.th}</p>
          <p className="fortune-prize">{prizeText(shake)}</p>
          {shake.prize === "item" && <p className="fine">It's in the shop under Owned. Wear it any time.</p>}
        </div>
      )}
      {error && <p className="fortune-error" role="alert">{error}</p>}

      <div className="fortune-actions">
        {phase === "card" && again && <button type="button" className="btn gold" onClick={() => { setShake(null); setPhase("ready"); }}>Shake again · {shake!.tickets} left</button>}
        {phase === "card" && shake && (shake.rarity === "epic" || shake.rarity === "legendary") &&
          <button type="button" className="btn soft" onClick={() => setSharing(true)}><Share2 size={16} aria-hidden /> Share</button>}
        {phase === "card" && <button type="button" className="btn" onClick={onClose}>Done</button>}
        {phase !== "card" && phase !== "ready" && <button type="button" className="link" onClick={() => setPhase(shake ? "card" : phase)}>Skip</button>}
        <button type="button" className="link" aria-expanded={odds} onClick={() => setOdds(!odds)}>Odds</button>
      </div>
      {odds && <OddsTable />}
      {sharing && shake && <ShareSheet hasPlus={hasPlus} onClose={() => setSharing(false)} options={[{ id: "fortune", label: "Siam Si",
        card: { kind: "milestone", what: "fortune", rarity: RARITY[shake.rarity].en, prize: prizeText(shake), stick: shake.stick, name } }]} />}
    </div>
  );
}
