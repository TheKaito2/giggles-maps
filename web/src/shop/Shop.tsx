import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { ensureSession, errCode, supabase } from "../lib/supabase";
import { answerBooking, PRICES, requestChoice, type ShopBooking, shopBookings, SITE, startCheckout } from "../lib/api";
import { isGuest, resumeSignIn, useUser } from "../lib/auth";
import SignIn from "../app/SignIn";
import MyListing from "./MyListing";
import Pitch from "./Pitch";

interface ShopRow { id: string; name: string; is_demo: boolean; owner_id: string | null; tier: "partner" | "choice" | null; tier_until: string | null;
  choice_approved: boolean; choice_requested_at: string | null }
interface PlaceStat {
  id: number; name: string; bid_thb: number; qr_code: string | null; last_qr_scan_at: string | null;
  impressions_30d: number; card_impressions_30d: number; visits_30d: number;
}
interface Overview { wallet_thb: number; places: PlaceStat[] }
interface Visit { id: number; amount_thb: number; created_at: string; status: "charged" | "disputed"; places: { name: string } | null }

const PACKS = [500, 1000, 3000];
const TABS = [["overview", "Overview"], ["partner", "Partner"], ["bookings", "Bookings"], ["visits", "Visits"], ["listing", "Listing"], ["sticker", "Sticker"]] as const;
type Tab = (typeof TABS)[number][0];
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const DAY = 86400_000;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Sticker({ place }: { place: PlaceStat }) {
  const [src, setSrc] = useState("");
  const url = `${SITE}/app/?scan=${place.id}-${place.qr_code}`;
  useEffect(() => { import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: "#161b3d", light: "#ffffff" } })).then(setSrc).catch(() => setSrc("")); }, [url]);
  return (
    <figure className="sticker">
      {src && <img src={src} width={180} height={180} alt={`QR code for ${place.name}`} />}
      <figcaption>
        <b>Check in with Giggles Maps</b>
        <span className="num sticker-code">{place.qr_code}</span>
        <span className="fine">Print and stick it at your counter. Visitors scan it to check in.</span>
        <span className="fine">{place.last_qr_scan_at ? `Last scan ${fmt(place.last_qr_scan_at)}` : "Not scanned yet. Visits only count when travellers scan it."}</span>
      </figcaption>
    </figure>
  );
}

export default function Shop() {
  const user = useUser();
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [shopId, setShopId] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [bookings, setBookings] = useState<ShopBooking[]>([]);
  const [disputing, setDisputing] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [peek, setPeek] = useState(false);   // a visitor looking at the example dashboard
  const [msg, setMsg] = useState(() => {
    const q = new URLSearchParams(location.search).get("paid");
    return q === "success" ? "Payment received. It shows up once the bank confirms (PromptPay can take a minute)." : q === "cancelled" ? "Payment cancelled." : "";
  });

  useEffect(() => { resumeSignIn().then((m) => m && setMsg(m)); }, []);

  useEffect(() => {
    (async () => {
      await ensureSession();
      const { data } = await supabase.from("shops").select("id, name, is_demo, owner_id, tier, tier_until, choice_approved, choice_requested_at")
        .order("is_demo").order("name");
      const rows = (data ?? []) as ShopRow[];
      setShops(rows);
      // your own shops when you run one; otherwise the example (demo) shops, for a peek at the dashboard
      const mine = rows.filter((r) => !r.is_demo && r.owner_id === user?.id && !isGuest(user));
      const list = mine.length ? mine : rows.filter((r) => r.is_demo);
      setShopId((cur) => list.some((r) => r.id === cur) ? cur : list[0]?.id || "");
    })().catch(() => setMsg("Couldn't load shops. Check your connection."));
  }, [user?.id]);

  const load = useCallback(async () => {
    if (!shopId) return;
    const [o, v] = await Promise.all([
      supabase.rpc("shop_overview", { p_shop: shopId }),
      supabase.from("billable_visits").select("id, amount_thb, created_at, status, places(name)").eq("shop_id", shopId)
        .order("created_at", { ascending: false }).limit(50),
    ]);
    setOverview((o.data ?? null) as Overview | null);
    setVisits((v.data ?? []) as unknown as Visit[]);
    setBookings(await shopBookings(shopId).catch(() => []));
  }, [shopId]);
  useEffect(() => { load().catch(() => setMsg("Couldn't load this shop.")); }, [load]);

  const shop = shops.find((s) => s.id === shopId);
  const totals = (overview?.places ?? []).reduce((t, p) => ({
    shown: t.shown + p.impressions_30d, cards: t.cards + p.card_impressions_30d, visits: t.visits + p.visits_30d,
  }), { shown: 0, cards: 0, visits: 0 });
  const spent = visits.filter((v) => v.status === "charged").reduce((sum, v) => sum + Number(v.amount_thb), 0);

  const pay = async (p: Parameters<typeof startCheckout>[0]) => {
    setMsg("");
    try {
      location.href = (await startCheckout(p)).url;
    } catch (e) {
      const code = errCode(e);
      setMsg(code === "payments_not_configured" ? "Payments aren't switched on yet."
        : code === "not_verified" ? "Get your counter sticker scanned by a visitor first: partners must be verified."
        : code === "choice_not_approved" ? "Giggles Choice is by invitation: apply first and we'll review your shop."
        : code === "sign_in_required" ? "Sign in at the bottom of this page first." : "Couldn't start checkout. Try again.");
    }
  };
  const tierLive = shop?.tier && shop.tier_until && new Date(shop.tier_until) > new Date() ? shop.tier : null;
  const verified = (overview?.places ?? []).some((p) => p.qr_code && p.last_qr_scan_at);
  const answer = (id: number, ok: boolean) => answerBooking(id, ok).then(load).catch((e) => setMsg(errCode(e) === "top_up_first"
    ? `Add credit first: each booking costs ฿${PRICES.booking} once the guest checks in.` : "Couldn't answer that booking."));
  const apply = () => requestChoice(shopId).then(() => { setMsg("Thanks! We'll review your shop for Giggles Choice."); setShops((xs) =>
    xs.map((x) => x.id === shopId ? { ...x, choice_requested_at: new Date().toISOString() } : x)); })
    .catch((e) => setMsg(errCode(e) === "partners_only" ? "Only partners can apply for Giggles Choice." : "Couldn't send that. Try again."));
  const mine = shops.filter((s) => !s.is_demo && s.owner_id === user?.id && !isGuest(user));
  const owner = mine.length > 0;
  const picker = owner ? mine : shops.filter((s) => s.is_demo);

  const dispute = async (id: number) => {
    const { data, error } = await supabase.rpc("dispute_visit", { p_visit: id, p_reason: reason });
    if (error) setMsg(error.message.includes("window") ? "Disputes are only possible within 7 days." : "Couldn't dispute this visit.");
    else setMsg(`Disputed. ฿${(data as { refunded_thb: number }).refunded_thb} went back to your credit while we review it.`);
    setDisputing(null); setReason("");
    load();
  };

  const dashboard = (
    <section className="dash stack" aria-label="Your shop">
      <div className="shop-head">
        <h1>{owner ? "Your shop" : "Example dashboard"}</h1>
        {picker.length > 1 && <label className="field shop-pick">
          <span>Shop</span>
          <select id="shop-select" value={shopId} onChange={(e) => setShopId(e.target.value)}>
            {picker.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>}
      </div>
      {shop?.is_demo && <p className="fine notice">Example shop for the demo. This business hasn't signed up; numbers come from test check-ins.</p>}
      <div className="seg dash-tabs" role="tablist" aria-label="Dashboard">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""}
          onClick={() => setTab(id)}>{label}{id === "bookings" && bookings.some((b) => b.status === "requested") && <span className="dot-new" aria-label="new" />}</button>)}
      </div>

      {tab === "overview" && <>
        <section className="tiles" aria-label="Last 30 days">
          <div className="tile"><span className="fine">Shown on routes (30 days)</span><b className="num">{totals.shown}</b><span className="fine num">{totals.cards} as "Near this spot" cards</span></div>
          <div className="tile"><span className="fine">Verified visits (30 days)</span><b className="num">{totals.visits}</b></div>
          <div className="tile"><span className="fine">Bookings waiting</span><b className="num">{bookings.filter((b) => b.status === "requested").length}</b></div>
          <div className="tile"><span className="fine">Credit left</span><b className="num">฿{Number(overview?.wallet_thb ?? 0).toLocaleString()}</b><span className="fine num">฿{spent.toLocaleString()} spent</span></div>
        </section>
        <p className="next-step">{!verified ? <>Next: print your <button className="link" onClick={() => setTab("sticker")}>counter sticker</button>. The first visitor scan verifies your shop.</>
          : !tierLive ? <>Next: <button className="link" onClick={() => setTab("partner")}>become a Partner</button> to come first on members' routes and take bookings.</>
          : <>You're a {tierLive === "choice" ? "Giggles Choice" : "Partner"} until {day(shop!.tier_until!)}.</>}</p>
      </>}

      {tab === "partner" && <>
        <div className="ladder">
          <article className={tierLive ? "" : "here"}><span className="eyebrow">Listing</span><b className="num">Free</b>
            <span className="fine">On the map and in routes.</span>{!tierLive && <span className="chip">You're here</span>}</article>
          <article className={tierLive === "partner" ? "here hot" : "hot"}><span className="eyebrow">Partner</span><b className="num">฿{PRICES.partner}<small>/month</small></b>
            <span className="fine">First on members' routes, a Partner badge, bookings.</span>
            {tierLive === "partner" && <span className="chip">Until {day(shop!.tier_until!)}</span>}
            {tierLive === "choice" ? <span className="chip">Included in Giggles Choice</span> : <>
              <button className="btn gold" disabled={!shopId || !verified} onClick={() => pay({ kind: "partner", shop_id: shopId })}>
                {tierLive === "partner" ? "Add 30 days" : "Become a partner"}</button>
              {!verified && <span className="fine">Get your sticker scanned once first.</span>}</>}</article>
          <article className={tierLive === "choice" ? "here" : ""}><span className="eyebrow">Giggles Choice</span><b>By invitation</b>
            <span className="fine">Hand-picked partners. A Choice badge, ×2 on members' routes and the Giggle's picks plan.</span>
            {tierLive === "choice" ? <>
                <span className="chip">Until {day(shop!.tier_until!)}</span>
                <button className="btn gold" onClick={() => pay({ kind: "choice", shop_id: shopId })}>Add 30 days · ฿{PRICES.choice}</button></>
              : shop?.choice_approved ? <>
                <span className="chip chosen"><Sparkles size={13} aria-hidden /> You've been chosen</span>
                <button className="btn gold" onClick={() => pay({ kind: "choice", shop_id: shopId })}>Switch on Giggles Choice · ฿{PRICES.choice}/month</button></>
              : !tierLive ? <span className="fine">Partners can apply to be chosen.</span>
              : shop?.choice_requested_at ? <span className="chip">Applied · under review</span>
              : <button className="btn" onClick={apply}>Apply to be Giggles Choice</button>}
          </article>
        </div>
        <h3>Credit</h3>
        <p className="fine">Pays for bookings (฿{PRICES.booking} each, once the guest checks in){overview?.places[0]?.bid_thb ? ` and verified visits (฿${overview.places[0].bid_thb} each)` : ""}. Card or PromptPay.</p>
        <div className="row">
          {PACKS.map((p) => <button key={p} className="btn soft" onClick={() => pay({ kind: "credit", shop_id: shopId, pack: p })} disabled={!shopId}>Add <span className="num">฿{p.toLocaleString()}</span></button>)}
        </div>
      </>}

      {tab === "bookings" && (bookings.length === 0 ? <p className="fine">{tierLive ? "No bookings yet." : "Partners take bookings through Giggles Maps."}</p>
        : <ul className="bookings">{bookings.map((b) => (
            <li key={b.id}>
              <span className="person-main"><b>{b.guest} · {b.party} {b.party === 1 ? "person" : "people"}</b>
                <span className="fine num">{new Date(`${b.day}T00:00:00+07:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {b.place}{b.note ? ` · "${b.note}"` : ""}</span></span>
              {b.status === "requested" ? <span className="row tight">
                  <button className="btn small" onClick={() => answer(b.id, true)}>Accept</button>
                  <button className="btn ghost small" onClick={() => answer(b.id, false)}>Decline</button></span>
                : <span className={`chip booking-${b.status}`}>{b.status === "completed" ? `Done · ฿${b.charged ?? 0}` : b.status}</span>}
            </li>))}</ul>)}

      {tab === "visits" && <>
        {visits.length === 0
          ? <p className="fine">No verified visits yet. They appear here the moment a traveller checks in.</p>
          : <div className="table-wrap"><table>
              <thead><tr><th>When</th><th>Place</th><th className="r">Charged</th><th>Status</th></tr></thead>
              <tbody>{visits.map((v) => {
                const canDispute = v.status === "charged" && Number(v.amount_thb) > 0 && Date.now() - new Date(v.created_at).getTime() < 7 * DAY;
                return (
                  <tr key={v.id}>
                    <td className="num">{fmt(v.created_at)}</td>
                    <td>{v.places?.name}</td>
                    <td className="num r">฿{v.amount_thb}</td>
                    <td>
                      {v.status === "disputed" ? <span className="chip review">Disputed, refunded</span>
                        : disputing === v.id
                          ? <form className="row" onSubmit={(e) => { e.preventDefault(); dispute(v.id); }}>
                              <label className="sr-only" htmlFor={`reason-${v.id}`}>Reason</label>
                              <input id={`reason-${v.id}`} className="text-in" required maxLength={300} placeholder="What went wrong?" value={reason} onChange={(e) => setReason(e.target.value)} />
                              <button className="btn small">Send</button>
                              <button type="button" className="link" onClick={() => setDisputing(null)}>Cancel</button>
                            </form>
                          : canDispute ? <button className="link" onClick={() => setDisputing(v.id)}>Dispute</button>
                          : <span className="fine">Charged</span>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>}
        <p className="fine">Dispute a charge within 7 days: the credit comes back right away while we check it.</p>
      </>}

      {tab === "listing" && (owner ? <MyListing signedIn /> : <p className="fine">Your own listing appears here once you claim your shop.</p>)}

      {tab === "sticker" && <div className="stickers">
        {(overview?.places ?? []).filter((p) => p.qr_code).map((p) => <Sticker key={p.id} place={p} />)}
      </div>}
    </section>
  );

  return (
    <div className="shop-shell">
      <header className="topbar">
        <a className="brand" href="/">Giggles <span>Maps</span></a>
        <span className="chip">For shops</span>
      </header>
      <main className="shop-main">
        {msg && <p className="notice" role="status">{msg}</p>}
        {!owner && <Pitch />}
        {!owner && <section id="claim" className="stack"><MyListing signedIn={!isGuest(user)} /></section>}
        {!owner && picker.length > 0 && <button type="button" className="btn ghost peek" onClick={() => setPeek(!peek)}>
          {peek ? "Hide the example dashboard" : "See an example dashboard"}</button>}
        {(owner || peek) && dashboard}
        <section id="account" className="stack">
          <h2>Your account</h2>
          {isGuest(user)
            ? <SignIn why="Sign in to claim or add your shop and manage it here. Free for every local business." />
            : <p className="fine">Signed in as <b>{user?.email}</b>.</p>}
        </section>
      </main>
    </div>
  );
}
