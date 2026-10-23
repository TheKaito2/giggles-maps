import { useEffect, useState } from "react";
import { ApiError, callFn, ensureSession, supabase } from "../lib/supabase";
import { startCheckout } from "../lib/api";
import { isGuest, useUser } from "../lib/auth";
import SignIn from "./SignIn";

interface Collection { id: number; slug: string; name: string; description: string; required_count: number; sponsor_name: string | null; collection_places: { place_id: number }[] }
interface CouponWin { id: number; code: string; created_at: string; redeemed_at: string | null; coupons: { title: string; places: { name: string } | null } | null }

const PLUS_THB = 59;
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function Passport({ refreshKey, plusUntil }: { refreshKey: number; plusUntil: Date | null }) {
  const user = useUser();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [visited, setVisited] = useState<Set<number>>(new Set());
  const [badges, setBadges] = useState<Set<number>>(new Set());
  const [recent, setRecent] = useState<{ id: string; status: string; created_at: string; places: { name: string } | null }[]>([]);
  const [coupons, setCoupons] = useState<CouponWin[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState("");
  const [plusMsg, setPlusMsg] = useState(() =>
    new URLSearchParams(location.search).get("paid") === "success" ? "Payment received. Plus switches on in a few seconds (PromptPay can take a minute)." : "");

  useEffect(() => {
    (async () => {
      await ensureSession();
      const [c, ch, b, w] = await Promise.all([
        supabase.from("collections").select("id, slug, name, description, required_count, sponsor_name, collection_places(place_id)").order("id"),
        supabase.from("checkins").select("id, place_id, status, rewarded, created_at, places(name)").order("created_at", { ascending: false }).limit(50),
        supabase.from("user_badges").select("collection_id"),
        supabase.from("coupon_wins").select("id, code, created_at, redeemed_at, coupons(title, places(name))").order("created_at", { ascending: false }).limit(20),
      ]);
      setCollections((c.data ?? []) as Collection[]);
      const rows = (ch.data ?? []) as unknown as { id: string; place_id: number; status: string; rewarded: boolean; created_at: string; places: { name: string } | null }[];
      setVisited(new Set(rows.filter((r) => r.rewarded).map((r) => r.place_id)));
      setRecent(rows.slice(0, 8));
      setBadges(new Set((b.data ?? []).map((r) => r.collection_id as number)));
      setCoupons((w.data ?? []) as unknown as CouponWin[]);
    })().catch(() => setMsg("Couldn't load your passport. Check your connection."));
  }, [refreshKey, user?.id]);

  const buyPlus = async () => {
    setPlusMsg("");
    try {
      location.href = (await startCheckout({ kind: "plus" })).url;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setPlusMsg(code === "sign_in_required" ? "Sign in first so Plus stays with your account."
        : code === "payments_not_configured" ? "Payments aren't switched on yet." : "Couldn't start checkout. Try again.");
    }
  };

  const deleteAccount = async () => {
    try {
      await callFn("delete-account", {});
      await supabase.auth.signOut();
      setMsg("Account deleted. A fresh guest passport starts next time you plan a route.");
      setRecent([]); setVisited(new Set()); setBadges(new Set()); setCoupons([]);
    } catch { setMsg("Couldn't delete the account. Try again."); }
    setConfirmDelete(false);
  };

  const guest = isGuest(user);

  return (
    <div className="stack passport">
      <h2>Your passport</h2>

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
        <ul className="fine plus-list">
          <li>Extra time up to +240 min (free: +120)</li>
          <li>Plus-only cosmetic badges · offline maps coming soon</li>
        </ul>
        {!plusUntil && (guest
          ? <p className="fine">Sign in above to get Plus.</p>
          : <button className="btn gold" onClick={buyPlus}>Get Plus · ฿{PLUS_THB}</button>)}
        {plusUntil && <button className="link" onClick={buyPlus}>Add another 30 days</button>}
        {plusMsg && <p className="fine" role="status">{plusMsg}</p>}
        <p className="fine">Card or PromptPay. No auto-renew.</p>
      </section>

      <div className="collections">
        {collections.map((c) => {
          const have = c.collection_places.filter((p) => visited.has(p.place_id)).length;
          const done = badges.has(c.id);
          return (
            <article key={c.id} className={`collection ${done ? "done" : ""}`}>
              <div className="collection-top">
                <h3>{c.name}</h3>
                {done && <span className="mini-stamp">Earned</span>}
              </div>
              <p className="fine">{c.description}</p>
              {c.sponsor_name && <p className="fine">Sponsored by {c.sponsor_name}</p>}
              <div className="dots" aria-label={`${Math.min(have, c.required_count)} of ${c.required_count}`}>
                {Array.from({ length: c.required_count }, (_, i) => <span key={i} className={i < have ? "on" : ""} />)}
              </div>
            </article>
          );
        })}
      </div>

      <h3>Coupons</h3>
      {coupons.length === 0
        ? <p className="fine">Every check-in gives you a free spin for a nearby coupon.</p>
        : <ul className="coupons">{coupons.map((w) => (
            <li key={w.id} className={w.redeemed_at ? "used" : ""}>
              <div>
                <b>{w.coupons?.title ?? "Coupon"}</b>
                <div className="fine">{w.coupons?.places?.name}</div>
              </div>
              <span className="coupon-code num">{w.code}</span>
            </li>
          ))}</ul>}

      <h3>Recent check-ins</h3>
      {recent.length === 0
        ? <p className="fine">No check-ins yet. Plan a route and check in at a stop to get your first stamp.</p>
        : <ul className="recent">{recent.map((r) => (
            <li key={r.id}><span>{r.places?.name ?? "Place"}</span><span className={`chip ${r.status}`}>{r.status}</span></li>
          ))}</ul>}

      <div className="danger">
        {!confirmDelete
          ? <button className="btn ghost" onClick={() => setConfirmDelete(true)}>Delete my account</button>
          : <div className="stack">
              <p>This deletes your account, check-ins, badges, coupons and selfies. It can't be undone.</p>
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
