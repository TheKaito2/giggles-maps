import { useEffect, useState } from "react";
import { ApiError, callFn, ensureSession, supabase } from "../lib/supabase";
import { type ExclusivePlace, getExclusives, getMonthlyStamps, KIND_NAME, type Profile, startCheckout } from "../lib/api";
import { isGuest, useUser } from "../lib/auth";
import SignIn from "./SignIn";


const PLUS_THB = 59;
const MEMBER_THB = 349;
const monthName = (m: string) => new Date(`${m}T00:00:00+07:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Membership, Plus, member-level places, sign-in and account deletion (bottom of the Profile tab). */
export default function Account({ refreshKey, profile, onChange }: { refreshKey: number; profile: Profile | null; onChange: () => void }) {
  const plusUntil = profile?.plusUntil ?? null;
  const user = useUser();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState("");
  const [plusMsg, setPlusMsg] = useState("");
  const [memberMsg, setMemberMsg] = useState("");
  const [exclusives, setExclusives] = useState<ExclusivePlace[]>([]);
  const [stamps, setStamps] = useState<string[]>([]);

  const [paidMsg] = useState(() => new URLSearchParams(location.search).get("paid") === "success"
    ? "Payment received. It switches on in a few seconds (PromptPay can take a minute)." : "");
  // back from Stripe: the webhook switches it on a few seconds later, so reload the profile once
  useEffect(() => {
    if (!paidMsg) return;
    const t = setTimeout(onChange, 5000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      await ensureSession();
      setExclusives(await getExclusives());
      setStamps(await getMonthlyStamps());
    })().catch(() => setMsg("Couldn't load your passport. Check your connection."));
  }, [refreshKey, user?.id, !!plusUntil]);

  const buy = async (kind: "plus" | "membership", say: (m: string) => void) => {
    say("");
    try {
      location.href = (await startCheckout({ kind })).url;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      say(code === "sign_in_required" ? "Sign in first so it stays with your account."
        : code === "already_member" ? "You're already a member."
        : code === "payments_not_configured" ? "Payments aren't switched on yet." : "Couldn't start checkout. Try again.");
    }
  };

  const deleteAccount = async () => {
    try {
      await callFn("delete-account", {});
      await supabase.auth.signOut();
      setMsg("Account deleted. A fresh guest passport starts next time you plan a route.");
    } catch { setMsg("Couldn't delete the account. Try again."); }
    setConfirmDelete(false);
  };

  const guest = isGuest(user);
  const member = profile?.member ?? false;


  return (
    <div className="stack account-wrap">
      {paidMsg && <p className="fine" role="status">{paidMsg}</p>}
      {!member && (
        <section className="member-card" aria-label="Membership">
          <h3>Become a member</h3>
          <p className="fine">Stamps, photos and the map are free. Members turn XP into levels and coins for the shop, and unlock hidden gems from level 2,
            member perks from level 4 and events from level 6. One payment of <span className="num">฿{MEMBER_THB}</span>, yours for good. XP you earn now is kept.</p>
          {guest ? <p className="fine">Sign in below first, so your membership stays with your account.</p>
            : <button className="btn gold" onClick={() => buy("membership", setMemberMsg)}>Become a member · ฿{MEMBER_THB}</button>}
          {memberMsg && <p className="fine" role="status">{memberMsg}</p>}
        </section>
      )}

      <section className="account" aria-label="Account">
        {guest
          ? <SignIn why="You're using Giggles Maps as a guest. Sign in to keep your stamps on any device." />
          : <div className="row between">
              <span className="fine">Signed in as <b>{user?.email ?? "your account"}</b></span>
              <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>}
      </section>

      <section className={`plus-card ${plusUntil ? "active" : ""}`} aria-label="Giggles Plus">
        <div className="row between">
          <h3>Giggles Plus</h3>
          {plusUntil ? <span className="chip">Active until {fmtDate(plusUntil)}</span> : <span className="num price-tag">฿{PLUS_THB} / 30 days</span>}
        </div>
        {plusUntil
          ? <>
              <p className="fine">Every Plus cover and name flair is yours in the Shop tab.</p>
              <div className="field">
                <span>Monthly stamps</span>
                <div className="month-stamps">{stamps.map((m) => <span key={m} className="month-stamp">{monthName(m)}</span>)}</div>
              </div>
              <button className="link" onClick={() => buy("plus", setPlusMsg)}>Add another 30 days</button>
            </>
          : <>
              <p className="fine">Make your passport yours: every Plus cover and name flair in the shop, 3 premium share-card designs, a new stamp every month, and 25% more coins from stamps and challenges. Every place and route stays free.</p>
              {guest ? <p className="fine">Sign in above to get Plus.</p>
                : <button className="btn gold" onClick={() => buy("plus", setPlusMsg)}>Get Plus · ฿{PLUS_THB}</button>}
            </>}
        {plusMsg && <p className="fine" role="status">{plusMsg}</p>}
        <p className="fine">Card or PromptPay. No auto-renew.</p>
      </section>

      {exclusives.length > 0 && <>
        <h3>Exclusive places</h3>
        <ul className="exclusives">{exclusives.map((p) => (
          <li key={p.id} className={p.unlocked ? "" : "locked"}>
            <div>
              <b>{p.name}</b>
              <div className="row">
                <span className="chip exclusive">{KIND_NAME[p.exclusive_kind]}</span>
                <span className="chip exclusive">Level {p.min_level}</span>
                {!p.unlocked && <span className="chip">Locked</span>}
                {p.is_demo && <span className="chip">Example</span>}
              </div>
              {p.unlocked && p.perk_text && <p className="fine">{p.perk_text}</p>}
            </div>
          </li>
        ))}</ul>
      </>}

      <div className="danger">
        {!confirmDelete
          ? <button className="btn ghost" onClick={() => setConfirmDelete(true)}>Delete my account</button>
          : <div className="stack">
              <p>This deletes your account, check-ins, stamps, photos and coins. It can't be undone.</p>
              <div className="row">
                <button className="btn danger-btn" onClick={deleteAccount}>Delete everything</button>
                <button className="btn ghost" onClick={() => setConfirmDelete(false)}>Keep my account</button>
              </div>
            </div>}
        {msg && <p className="fine" role="status">{msg}</p>}
      </div>
    </div>
  );
}
