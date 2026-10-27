import { useEffect, useState } from "react";
import { Gift, Infinity as Unlimited, Sparkles, X } from "lucide-react";
import { getPlanUsage, PLUS_YEAR_SAVE, PRICES, type PlanUsage } from "../lib/api";
import { isNative, purchase, purchaseErrorText } from "../lib/native";
import { useDialog } from "../lib/useDialog";
import { isGuest, useUser } from "../lib/auth";
import type { Gate } from "./detour/useDetour";
import SignIn from "./SignIn";
import RewardedAd from "./RewardedAd";

type Why = Gate | "ads" | "perk";
const TITLE: Record<Why, string> = {
  ads: "Go ad-free",
  perk: "Members get partner perks",
  sign_in_required: "Sign in to plan more detours",
  sign_in_edits: "Sign in to keep changing it",
  detour_limit: "That's today's free detours",
  edit_limit: "That's today's free changes",
  stop_limit_free: "Members can add more stops",
};

/** Monthly or yearly Plus. Web only: the iOS app sells monthly Plus through the App Store (no yearly product there). */
export function PlusTerm({ year, setYear }: { year: boolean; setYear: (y: boolean) => void }) {
  if (isNative) return null;
  return (
    <div className="seg plus-term" role="radiogroup" aria-label="How long">
      <button type="button" role="radio" aria-checked={!year} className={year ? "" : "on"} onClick={() => setYear(false)}>
        Monthly <span className="fine num">฿{PRICES.plus}</span></button>
      <button type="button" role="radio" aria-checked={year} className={year ? "on" : ""} onClick={() => setYear(true)}>
        Yearly <span className="fine num">฿{PRICES.plusYear} · save {PLUS_YEAR_SAVE}%</span></button>
    </div>
  );
}

/** v5: a guest is asked to sign in; a free account at its daily limit is offered membership (unlimited detours, no ads);
 *  "Remove ads" offers membership or Plus, and so does a free plan's 3-stop limit (both lift it). */
export default function Upgrade({ gate, onClose, onRewarded }: { gate: Why; onClose: () => void; onRewarded?: () => void }) {
  const box = useDialog(onClose);
  const user = useUser(), guest = isGuest(user);
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [msg, setMsg] = useState("");
  const [watching, setWatching] = useState(false);
  const [year, setYear] = useState(false);   // yearly Plus picked
  const adKind = gate === "detour_limit" ? "detour" : gate === "edit_limit" ? "edit" : null;
  useEffect(() => { if (gate === "detour_limit" || gate === "edit_limit") getPlanUsage().then(setUsage).catch(() => undefined); }, [gate]);
  // signed in from this sheet: the detour plans itself now
  const signIn = gate === "sign_in_required" || gate === "sign_in_edits";
  useEffect(() => { if (signIn && !guest) onClose(); }, [guest]); // eslint-disable-line react-hooks/exhaustive-deps
  const buy = async (kind: "membership" | "plus" | "plus_year") => {
    setMsg("");
    try { if (await purchase(kind, user?.id)) { setMsg("Thanks! It switches on in a moment."); setTimeout(onClose, 1500); } }
    catch (e) { setMsg(purchaseErrorText(e)); }
  };
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={TITLE[gate]} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal upgrade" ref={box} tabIndex={-1}>
        <header className="modal-head"><h2>{TITLE[gate]}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        {signIn || ((gate === "ads" || gate === "perk" || gate === "stop_limit_free") && guest) ? <>
          <p className="fine">{gate === "ads" || gate === "perk" || gate === "stop_limit_free" ? "Sign in first, so it stays with your account."
            : gate === "sign_in_edits" ? "Guests get 3 changes a day; a free account makes 10. Your stamps, coins and photos come with you."
            : "Guests try one detour a day; a free account plans 3. Your stamps, coins and photos come with you."}</p>
          <SignIn />
        </> : <>
          {usage && <div className="usage-row">
            <span><b className="num">{usage.detours}/{usage.max_detours}</b><span className="fine">detours</span></span>
            <span><b className="num">{usage.edits}/{usage.max_edits}</b><span className="fine">changes</span></span>
            <span className="fine">Resets at midnight</span>
          </div>}
          {adKind && usage && usage.ads_left > 0 && <button type="button" className="btn watch-ad" onClick={() => setWatching(true)}>
            <Gift size={16} aria-hidden /> Watch an ad · {adKind === "detour" ? "+1 detour" : "+5 changes"}
            <span className="fine num">{usage.ads_left} left today</span></button>}
          <section className="member-card">
            <div className="row between"><h3><Unlimited size={20} aria-hidden /> Membership</h3><span className="num price-tag">฿{PRICES.membership} once</span></div>
            <ul className="perks">
              <li>Unlimited detours and changes</li>
              <li>Up to 15 stops a plan (free plans hold 3)</li>
              <li>No ads, forever</li>
              <li>Partner and Giggles Choice stops first</li>
              <li>Member perks at partner shops</li>
              <li>3 months of Plus free</li>
            </ul>
            <button type="button" className="btn gold" onClick={() => buy("membership")}><Sparkles size={16} aria-hidden /> Become a member · ฿{PRICES.membership}</button>
          </section>
          {(gate === "ads" || gate === "stop_limit_free") && <section className="plus-card">
            <div className="row between"><h3>Giggles Plus</h3><span className="num price-tag">{year ? `฿${PRICES.plusYear} / year` : `฿${PRICES.plus} / month`}</span></div>
            <ul className="perks"><li>No ads</li><li>Up to 15 stops a plan</li><li>+20 coins every day</li><li>The Plus shelf and title</li></ul>
            <PlusTerm year={year} setYear={setYear} />
            <button type="button" className="btn" onClick={() => buy(year ? "plus_year" : "plus")}>Get Plus · ฿{year ? PRICES.plusYear : PRICES.plus}</button>
          </section>}
          {msg && <p className="fine" role="status">{msg}</p>}
        </>}
      </div>
      {watching && adKind && <RewardedAd kind={adKind} onClose={() => setWatching(false)} onDone={() => { setWatching(false); onClose(); onRewarded?.(); }} />}
    </div>
  );
}
