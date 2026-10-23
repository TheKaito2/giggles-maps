import { type CSSProperties, useEffect, useState } from "react";
import { ApiError, callFn, ensureSession, supabase } from "../lib/supabase";
import { type ExclusivePlace, getExclusives, getMonthlyStamps, KIND_NAME, levelFor, levelProgress, type Profile, setCosmetics, startCheckout } from "../lib/api";
import { isGuest, useUser } from "../lib/auth";
import SignIn from "./SignIn";

interface Collection { id: number; slug: string; name: string; description: string; required_count: number; sponsor_name: string | null; collection_places: { place_id: number }[] }
interface CouponWin { id: number; code: string; created_at: string; redeemed_at: string | null; coupons: { title: string; places: { name: string } | null } | null }

const PLUS_THB = 59;
const MEMBER_THB = 349;
// ids match the whitelist in public.set_cosmetics
const THEMES: Record<string, string> = { classic: "Classic", indigo: "Indigo cloth", lotus: "Lotus", "night-market": "Night market", "temple-gold": "Temple gold", rain: "Rainy season" };
const FLAIRS: Record<string, string> = { none: "None", marigold: "Marigold", indigo: "Indigo", lotus: "Lotus", sparkle: "Sparkle" };
const monthName = (m: string) => new Date(`${m}T00:00:00+07:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function Passport({ refreshKey, profile, onChange }: { refreshKey: number; profile: Profile | null; onChange: () => void }) {
  const plusUntil = profile?.plusUntil ?? null;
  const user = useUser();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [visited, setVisited] = useState<Set<number>>(new Set());
  const [badges, setBadges] = useState<Set<number>>(new Set());
  const [recent, setRecent] = useState<{ id: string; status: string; created_at: string; places: { name: string } | null }[]>([]);
  const [coupons, setCoupons] = useState<CouponWin[]>([]);
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

  const saveLook = async (p: { p_theme?: string; p_flair?: string }) => {
    setPlusMsg("");
    try { await setCosmetics(p); onChange(); } catch { setPlusMsg("Couldn't save that. Try again."); }
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
  const xp = profile?.xp ?? 0;
  const level = levelFor(xp);
  const { into, span } = levelProgress(xp);
  const member = profile?.member ?? false;
  const name = user?.email?.split("@")[0] ?? "Guest explorer";

  return (
    <div className="stack passport">
      <h2>Your passport</h2>
      {paidMsg && <p className="fine" role="status">{paidMsg}</p>}

      <section className={`level-card theme-${profile?.theme ?? "classic"}`} aria-label="Level">
        <div className="level-top">
          <div className={`level-ring ${member ? "" : "locked"}`} style={{ "--p": span ? into / span : 1 } as CSSProperties}
            aria-label={member ? `Level ${level}` : `Level ${level}, locked`}>
            <span><small>LV</small>{level}</span>
          </div>
          <div className="level-info">
            <b className={`flair flair-${profile?.flair ?? "none"}`}>{name}</b>
            <span className="num">{xp} XP</span>
            {span ? <><progress value={into} max={span} /><span className="fine">{span - into} XP to level {level + 1}</span></>
              : <span className="fine">Top level</span>}
          </div>
        </div>
        {member
          ? <span className="chip">Member</span>
          : <>
              <p className="fine">Become a member to unlock your level: hidden gems from level 2, member perks from level 4, events from level 6. One payment of <span className="num">฿{MEMBER_THB}</span>, yours for good. You keep earning XP either way.</p>
              {guest ? <p className="fine">Sign in below first, so your membership stays with your account.</p>
                : <button className="btn gold" onClick={() => buy("membership", setMemberMsg)}>Become a member · ฿{MEMBER_THB}</button>}
            </>}
        {memberMsg && <p className="fine" role="status">{memberMsg}</p>}
      </section>

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
              <label className="field">
                <span>Passport theme</span>
                <select value={profile?.theme} onChange={(e) => saveLook({ p_theme: e.target.value })}>
                  {Object.entries(THEMES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Name flair</span>
                <select value={profile?.flair} onChange={(e) => saveLook({ p_flair: e.target.value })}>
                  {Object.entries(FLAIRS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <div className="field">
                <span>Monthly stamps</span>
                <div className="month-stamps">{stamps.map((m) => <span key={m} className="month-stamp">{monthName(m)}</span>)}</div>
              </div>
              <button className="link" onClick={() => buy("plus", setPlusMsg)}>Add another 30 days</button>
            </>
          : <>
              <p className="fine">Make your passport yours: 6 cover themes, a coloured name, 3 premium share-card designs and a new stamp every month. Looks only: every place and route stays free.</p>
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
