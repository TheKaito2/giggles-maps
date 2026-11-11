import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { errCode, supabase } from "../lib/supabase";
import { PRICES, requestChoice, type ShopBooking, shopBookings, shopSubscription, SITE, startCheckout } from "../lib/api";
import Statement from "./Statement";
import { isGuest, resumeSignIn, useUser } from "../lib/auth";
import { bookingChime } from "../lib/sfx";
import { lang, setLang } from "../lib/i18n";
import SignIn from "../app/SignIn";
import Funnel, { type Week } from "./Funnel";
import MyListing from "./MyListing";
import Pitch from "./Pitch";
import ShopBookings from "./ShopBookings";

interface ShopRow { id: string; name: string; is_demo: boolean; owner_id: string | null; tier: "partner" | "choice" | null; tier_until: string | null;
  subscription_status?: "active" | "cancelling" | "cancelled" | null;
  choice_approved: boolean; choice_requested_at: string | null }
interface PlaceStat {
  id: number; name: string; bid_thb: number; qr_code: string | null; last_qr_scan_at: string | null;
  impressions_30d: number; card_impressions_30d: number; visits_30d: number;
}
interface Overview { wallet_thb: number; places: PlaceStat[]; weeks?: Week[] }
const LOW_CREDIT = 200;   // below this, warn: bookings can't be accepted without credit
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
        <b>Scan here for bonus XP on Giggles Maps</b>
        <span className="num sticker-code">{place.qr_code}</span>
        <span className="fine">Print it and put it on your counter. Travellers who scan it on their first visit get +25 XP, their review shows "scanned at the
          counter", and your page counts every traveller who checked in. Free: scans never cost you anything.</span>
        <span className="fine">{place.last_qr_scan_at ? `Last scan ${fmt(place.last_qr_scan_at)}` : "Not scanned yet."}</span>
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
  // each tab has a link (/shop/#partner, #bookings…): opening one goes straight to it, and switching tabs updates it
  const hashTab = () => TABS.find(([id]) => `#${id}` === location.hash)?.[0];
  const [tab, setTabState] = useState<Tab>(() => hashTab() ?? "overview");
  const setTab = (t: Tab) => { setTabState(t); history.replaceState(null, "", `#${t}`); };
  useEffect(() => {
    const onHash = () => { const t = hashTab(); if (t) { setTabState(t); document.getElementById("dashboard")?.scrollIntoView(); } };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [peek, setPeek] = useState(false);   // a visitor looking at the example dashboard
  const [msg, setMsg] = useState(() => {
    const q = new URLSearchParams(location.search).get("paid");
    return q === "success" ? "Payment received. It shows up once the bank confirms (PromptPay can take a minute)." : q === "cancelled" ? "Payment cancelled." : "";
  });

  useEffect(() => { resumeSignIn().then((m) => m && setMsg(m)); }, []);

  useEffect(() => {
    (async () => {
      // no guest sign-up just for looking: the example shops are public (every visit used to create an anonymous account)
      const { data } = await supabase.from("shops").select("id, name, is_demo, owner_id, tier, tier_until, choice_approved, choice_requested_at, subscription_status")
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

  // live: a new booking (or a guest cancelling) rings and reloads, so the owner doesn't have to refresh. It listens to
  // booking_events (booking id and status only, no guest identity: PDPA), which row-level security limits to the owner.
  const ownsShop = !!user && !isGuest(user) && shops.some((s) => s.id === shopId && s.owner_id === user.id && !s.is_demo);
  useEffect(() => {
    if (!ownsShop) return;
    const ch = supabase.channel(`shop-bookings-${shopId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "booking_events", filter: `shop_id=eq.${shopId}` }, (e) => {
        if ((e.new as { status?: string }).status === "requested") { bookingChime(); setMsg("New booking! Accept or decline it in Bookings."); }
        load().catch(() => undefined);
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [ownsShop, shopId, load]);
  // the waiting count in the tab title, so a shop with the dashboard in a background tab sees it
  const waiting = bookings.filter((b) => b.status === "requested").length;
  useEffect(() => { document.title = waiting ? `(${waiting}) Giggles Maps for shops` : "Giggles Maps for shops"; }, [waiting]);

  const shop = shops.find((s) => s.id === shopId);
  const totals = (overview?.places ?? []).reduce((t, p) => ({
    shown: t.shown + p.impressions_30d, cards: t.cards + p.card_impressions_30d, visits: t.visits + p.visits_30d,
  }), { shown: 0, cards: 0, visits: 0 });
  // fees over the 8 weeks the funnel shows (route appearances and bookings; visits are free since prices v7)
  const spent = (overview?.weeks ?? []).reduce((sum, w) => sum + Number(w.spent), 0);

  const pay = async (p: Parameters<typeof startCheckout>[0]) => {
    setMsg("");
    try {
      location.href = (await startCheckout(p)).url;
    } catch (e) {
      const code = errCode(e);
      setMsg(code === "payments_not_configured" ? "Payments aren't switched on yet."
        : code === "no_place" ? "Claim your place first, then become a Partner."
        : code === "choice_not_approved" ? "Giggles Choice is by invitation: apply first and we'll review your shop."
        : code === "already_subscribed" ? "You already pay monthly. Stop renewing first to switch, or pay 30 days once."
        : code === "sign_in_required" ? "Sign in at the bottom of this page first." : "Couldn't start checkout. Try again.");
    }
  };
  const tierLive = shop?.tier && shop.tier_until && new Date(shop.tier_until) > new Date() ? shop.tier : null;
  const verified = (overview?.places ?? []).some((p) => p.qr_code && p.last_qr_scan_at);
  // a tier's buttons: monthly autopay by card (the default), or one 30-day payment by PromptPay; once subscribed, when it
  // renews and a way to stop (or restart) renewing
  const subbed = shop?.subscription_status === "active" || shop?.subscription_status === "cancelling";
  const renew = (action: "cancel" | "resume") => shopSubscription(shopId, action)
    .then(({ status }) => setShops((xs) => xs.map((x) => x.id === shopId ? { ...x, subscription_status: status } : x)))
    .catch(() => setMsg("Couldn't change the renewal. Try again."));
  const plan = (kind: "partner" | "choice", live: boolean) => {
    const price = kind === "choice" ? PRICES.choice : PRICES.partner, name = kind === "choice" ? "Giggles Choice" : "Partner";
    if (live && subbed) return <>
      <span className="chip">{shop!.subscription_status === "cancelling" ? "Ends" : "Renews"} {day(shop!.tier_until!)}</span>
      {shop!.subscription_status === "cancelling"
        ? <button className="btn small" onClick={() => renew("resume")}>Keep renewing</button>
        : <button className="link" onClick={() => renew("cancel")}>Stop renewing</button>}</>;
    return <>
      {live && <span className="chip">Until {day(shop!.tier_until!)}</span>}
      <button className="btn gold" disabled={!shopId} onClick={() => pay({ kind, shop_id: shopId })}>
        {live ? "Renew monthly" : `Become a ${name}`} · ฿{price.toLocaleString()}/month</button>
      <button className="link" disabled={!shopId} onClick={() => pay({ kind, shop_id: shopId, once: true })}>
        Or pay 30 days once (PromptPay)</button></>;
  };
  const wallet = Number(overview?.wallet_thb ?? 0);
  const lowCredit = ownsShop && wallet < LOW_CREDIT && (!!tierLive || waiting > 0);
  const apply = () => requestChoice(shopId).then(() => { setMsg("Thanks! We'll review your shop for Giggles Choice."); setShops((xs) =>
    xs.map((x) => x.id === shopId ? { ...x, choice_requested_at: new Date().toISOString() } : x)); })
    .catch((e) => setMsg(errCode(e) === "partners_only" ? "Only partners can apply for Giggles Choice." : "Couldn't send that. Try again."));
  const mine = shops.filter((s) => !s.is_demo && s.owner_id === user?.id && !isGuest(user));
  const owner = mine.length > 0;
  const picker = owner ? mine : shops.filter((s) => s.is_demo);
  // opened with a tab link (/shop/#partner): once the owner's dashboard is on the page, bring it into view
  useEffect(() => { if (owner && hashTab()) document.getElementById("dashboard")?.scrollIntoView(); }, [owner]); // eslint-disable-line react-hooks/exhaustive-deps

  const dispute = async (id: number) => {
    const { data, error } = await supabase.rpc("dispute_visit", { p_visit: id, p_reason: reason });
    if (error) setMsg(error.message.includes("window") ? "Disputes are only possible within 7 days." : "Couldn't dispute this visit.");
    else setMsg(`Disputed. ฿${(data as { refunded_thb: number }).refunded_thb} went back to your credit while we review it.`);
    setDisputing(null); setReason("");
    load();
  };

  const dashboard = (
    <section className="dash stack" aria-label="Your shop" id="dashboard">
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
      {lowCredit && <p className="notice low-credit" role="alert">Credit is low (฿{wallet.toLocaleString()}). Without credit you can't accept bookings.
        <button className="link" onClick={() => setTab("partner")}>Add credit</button></p>}
      <div className="seg dash-tabs" role="tablist" aria-label="Dashboard">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""}
          onClick={() => setTab(id)}>{label}{id === "bookings" && bookings.some((b) => b.status === "requested") && <span className="dot-new" aria-label="new" />}</button>)}
      </div>

      {tab === "overview" && <>
        <section className="tiles" aria-label="Last 30 days">
          <div className="tile"><span className="fine">Shown on routes (30 days)</span><b className="num">{totals.shown}</b><span className="fine num">{totals.cards} as "Near this spot" cards</span></div>
          <div className="tile"><span className="fine">Check-ins (30 days)</span><b className="num">{totals.visits}</b></div>
          <div className="tile"><span className="fine">Bookings waiting</span><b className="num">{bookings.filter((b) => b.status === "requested").length}</b></div>
          <div className="tile"><span className="fine">Credit left</span><b className="num">฿{Number(overview?.wallet_thb ?? 0).toLocaleString()}</b><span className="fine num">฿{spent.toLocaleString()} spent in 8 weeks</span></div>
        </section>
        <p className="next-step">{!verified ? <>Next: print your <button className="link" onClick={() => setTab("sticker")}>counter sticker</button>. Travellers scan it for bonus XP and verified reviews.</>
          : !tierLive ? <>Next: <button className="link" onClick={() => setTab("partner")}>become a Partner</button> to come first on Plus routes and take bookings.</>
          : <>You're a {tierLive === "choice" ? "Giggles Choice" : "Partner"} until {day(shop!.tier_until!)}.</>}</p>
        {overview?.weeks && <Funnel weeks={overview.weeks} />}
      </>}

      {tab === "partner" && <>
        <div className="ladder">
          <article className={tierLive ? "" : "here"}><span className="eyebrow">Listing</span><b className="num">Free</b>
            <span className="fine">On the map and in routes.</span>{!tierLive && <span className="chip">You're here</span>}</article>
          <article className={tierLive === "partner" ? "here hot" : "hot"}><span className="eyebrow">Partner</span><b className="num">฿{PRICES.partner}<small>/month</small></b>
            <span className="fine">Boosted on Plus routes, a Partner badge, bookings.</span>
            {tierLive === "choice" ? <span className="chip">Included in Giggles Choice</span> : <>
              {plan("partner", tierLive === "partner")}
              </>}</article>
          <article className={tierLive === "choice" ? "here" : ""}><span className="eyebrow">Giggles Choice</span><b>By invitation</b>
            <span className="fine">Hand-picked partners. A Choice badge, ×2 on Plus routes and the Partner picks plan.</span>
            {tierLive === "choice" ? plan("choice", true)
              : shop?.choice_approved ? <>
                <span className="chip chosen"><Sparkles size={13} aria-hidden /> You've been chosen</span>
                {plan("choice", false)}</>
              : !tierLive ? <span className="fine">Partners can apply to be chosen.</span>
              : shop?.choice_requested_at ? <span className="chip">Applied · under review</span>
              : <button className="btn" onClick={apply}>Apply to be Giggles Choice</button>}
          </article>
        </div>
        <h3>Credit</h3>
        <p className="fine">Pays for bookings (฿{PRICES.booking} a table or visit once the guest checks in, {PRICES.stayPct}% of a stay) and ฿{PRICES.per1000} per 1,000 times your shop is shown on a route. Card or PromptPay.</p>
        <div className="row">
          {PACKS.map((p) => <button key={p} className="btn soft" onClick={() => pay({ kind: "credit", shop_id: shopId, pack: p })} disabled={!shopId}>Add <span className="num">฿{p.toLocaleString()}</span></button>)}
        </div>
      </>}

      {tab === "bookings" && <ShopBookings bookings={bookings} live={!!tierLive} onChange={() => { setMsg(""); load().catch(() => undefined); }} onError={setMsg} />}

      {tab === "visits" && <>
        {visits.length === 0
          ? <p className="fine">No visit charges: since prices v7 visits are free for shops. Charges from before then are listed here.</p>
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
        {ownsShop && <Statement shopId={shopId} />}
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
        <a className="brand" href="/"><img className="brand-mark" src="/logo.svg" alt="" width={36} height={36} /><span className="brand-word">giggles <span>maps</span></span></a>
        <span className="chip">For shops</span>
        {/* each language named in itself, never translated */}
        <button type="button" className="btn ghost small lang-toggle" translate="no" onClick={() => setLang(lang() === "th" ? "en" : "th")}>
          {lang() === "th" ? "English" : "ไทย"}</button>
        {/* sign-in sits at the bottom of a long page: a way there from the top, or straight to the dashboard once signed in */}
        {isGuest(user) ? <a className="btn small" href="#account">Sign in</a>
          : owner ? <a className="btn small" href="#overview">Dashboard</a> : null}
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
            ? <SignIn why="Sign in to claim or add your shop and manage it here. Free for every local business."
                note="Your shop, its listing and its credit stay with this account." />
            : <p className="fine">Signed in as <b>{user?.email}</b>.</p>}
        </section>
      </main>
    </div>
  );
}
