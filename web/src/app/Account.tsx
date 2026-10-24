import { useEffect, useState } from "react";
import { ApiError, callFn, ensureSession, supabase } from "../lib/supabase";
import { type Booking, cancelBooking, getMonthlyStamps, myBookings, PRICES, type Profile, startCheckout } from "../lib/api";
import { isGuest, useUser } from "../lib/auth";
import SignIn from "./SignIn";

const PLUS_THB = PRICES.plus;
const MEMBER_THB = PRICES.membership;
const BOOKING_STATUS: Record<Booking["status"], string> = { requested: "Waiting for the shop", accepted: "Confirmed", declined: "Declined",
  completed: "Done", cancelled: "Cancelled" };
const monthName = (m: string) => new Date(`${m}T00:00:00+07:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Membership, Plus, your bookings, sign-in and account deletion (Profile settings). */
export default function Account({ refreshKey, profile, onChange }: { refreshKey: number; profile: Profile | null; onChange: () => void }) {
  const plusUntil = profile?.plusUntil ?? null;
  const user = useUser();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState("");
  const [plusMsg, setPlusMsg] = useState("");
  const [memberMsg, setMemberMsg] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
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
      setStamps(await getMonthlyStamps());
      if (!isGuest(user)) setBookings(await myBookings());
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
          <div className="row between"><h3>Membership</h3><span className="num price-tag">฿{MEMBER_THB} once</span></div>
          <ul className="perks">
            <li>No ads, forever</li>
            <li>Unlimited detours and added stops</li>
            <li>Partner and Giggles Choice stops first</li>
            <li>3 months of Plus free</li>
          </ul>
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
          {plusUntil ? <span className="chip">Active until {fmtDate(plusUntil)}</span> : <span className="num price-tag">฿{PLUS_THB} / month</span>}
        </div>
        {plusUntil
          ? <>
              <p className="fine">No ads, +20 coins every day you open the app, and the Plus shelf in the shop is yours.</p>
              <div className="field">
                <span>Monthly stamps</span>
                <div className="month-stamps">{stamps.map((m) => <span key={m} className="month-stamp">{monthName(m)}</span>)}</div>
              </div>
              <button className="link" onClick={() => buy("plus", setPlusMsg)}>Add another 30 days</button>
            </>
          : <>
              <ul className="perks">
                <li>No ads</li>
                <li>+20 coins every day you open the app</li>
                <li>The Plus shelf: covers, frames, flair and the Plus explorer title</li>
                <li>25% more coins from quests, a stamp every month</li>
              </ul>
              {guest ? <p className="fine">Sign in above to get Plus.</p>
                : <button className="btn gold" onClick={() => buy("plus", setPlusMsg)}>Get Plus · ฿{PLUS_THB}</button>}
            </>}
        {plusMsg && <p className="fine" role="status">{plusMsg}</p>}
        <p className="fine">Card or PromptPay. No auto-renew.</p>
      </section>

      {bookings.length > 0 && <section className="stack" aria-label="Your bookings">
        <h3>Your bookings</h3>
        <ul className="bookings">{bookings.map((b) => (
          <li key={b.id}>
            <span className="person-main"><b>{b.place}</b>
              <span className="fine num">{new Date(`${b.day}T00:00:00+07:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {b.party} {b.party === 1 ? "person" : "people"}</span></span>
            <span className={`chip booking-${b.status}`}>{BOOKING_STATUS[b.status]}</span>
            {(b.status === "requested" || b.status === "accepted") && <button type="button" className="link"
              onClick={() => cancelBooking(b.id).then(myBookings).then(setBookings).catch(() => setMsg("Couldn't cancel. Try again."))}>Cancel</button>}
          </li>
        ))}</ul>
      </section>}

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
