import { type CSSProperties, useEffect, useState } from "react";
import { ApiError, callFn, ensureSession, supabase } from "../lib/supabase";
import { type ExclusivePlace, getExclusives, getMonthlyStamps, getPassport, KIND_NAME, levelFor, levelProgress, type PassportData, type Profile, startCheckout } from "../lib/api";
import { isGuest, useUser } from "../lib/auth";
import SignIn from "./SignIn";
import ProvinceMap from "./passport/ProvinceMap";
import Stamps from "./passport/Stamps";
import Album from "./passport/Album";
import Challenges from "./passport/Challenges";
import Shop from "./passport/Shop";


const PLUS_THB = 59;
const MEMBER_THB = 349;
const monthName = (m: string) => new Date(`${m}T00:00:00+07:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function Passport({ refreshKey, profile, onChange }: { refreshKey: number; profile: Profile | null; onChange: () => void }) {
  const plusUntil = profile?.plusUntil ?? null;
  const user = useUser();
  const [data, setData] = useState<PassportData | null>(null);
  const [province, setProvince] = useState<number | null>(null);
  const [tab, setTab] = useState<"stamps" | "photos" | "challenges" | "shop">("stamps");
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
      setData(await getPassport());
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
      setData(null);
    } catch { setMsg("Couldn't delete the account. Try again."); }
    setConfirmDelete(false);
  };

  const guest = isGuest(user);
  const xp = profile?.xp ?? 0;
  const level = levelFor(xp);
  const { into, span } = levelProgress(xp);
  const member = profile?.member ?? false;
  const name = profile?.nickname ?? "Guest explorer";

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
            {profile?.title && <span className="fine">{profile.title}</span>}
            <span className="num">{xp} XP{member && <> · {data?.profile?.coins ?? 0} coins</>}</span>
            {span ? <><progress value={into} max={span} /><span className="fine">{span - into} XP to level {level + 1}</span></>
              : <span className="fine">Top level</span>}
          </div>
        </div>
        {member
          ? <span className="chip">Member</span>
          : <>
              <p className="fine">Your stamps, photos and map are free. Become a member to unlock Level {level} and everything after it: coins for every level and challenge, hidden gems from level 2, member perks from level 4, events from level 6. One payment of <span className="num">฿{MEMBER_THB}</span>, yours for good. XP you earn now is kept.</p>
              {guest ? <p className="fine">Sign in below first, so your membership stays with your account.</p>
                : <button className="btn gold" onClick={() => buy("membership", setMemberMsg)}>Become a member · ฿{MEMBER_THB}</button>}
            </>}
        {memberMsg && <p className="fine" role="status">{memberMsg}</p>}
      </section>

      {data && (() => {
        const counts = new Map(data.provinces.map((p) => [p.id, p.stamps]));
        const provinceName = (id: number | null) => data.provinces.find((p) => p.id === id)?.name_en ?? "";
        const stamps = data.stamps.filter((s) => province == null || s.province_id === province);
        const photos = data.photos.filter((p) => province == null || p.province_id === province);
        return (
          <section className="passport-book" aria-label="Your travels">
            <ProvinceMap counts={counts} selected={province} onSelect={setProvince} />
            <div className="seg" role="tablist" aria-label="Passport pages">
              {(["stamps", "photos", "challenges", "shop"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "stamps" ? `Stamps (${stamps.length})` : t === "photos" ? `Photos (${photos.length})` : t === "challenges" ? "Challenges" : "Shop"}
                </button>
              ))}
            </div>
            {tab === "stamps" && <Stamps stamps={stamps} provinceName={provinceName} />}
            {tab === "photos" && <Album photos={photos} onChange={onChange} frame={profile?.look.frame} />}
            {tab === "challenges" && <Challenges list={data.challenges} member={member} />}
            {tab === "shop" && <Shop profile={profile} coins={data.profile?.coins ?? 0} onChange={onChange} />}
          </section>
        );
      })()}

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
