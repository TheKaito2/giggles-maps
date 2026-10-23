import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { ApiError, ensureSession, supabase } from "../lib/supabase";
import { startCheckout } from "../lib/api";
import { isGuest, resumeSignIn, useUser } from "../lib/auth";
import SignIn from "../app/SignIn";
import MyListing from "./MyListing";

interface ShopRow { id: string; name: string; is_demo: boolean; owner_id: string | null }
interface PlaceStat {
  id: number; name: string; bid_thb: number; qr_code: string | null; last_qr_scan_at: string | null;
  impressions_30d: number; card_impressions_30d: number; visits_30d: number;
}
interface Overview { wallet_thb: number; places: PlaceStat[] }
interface Visit { id: number; amount_thb: number; created_at: string; status: "charged" | "disputed"; places: { name: string } | null }

const PACKS = [500, 1000, 3000];
const SITE = "https://giggles-maps.pages.dev";
const DAY = 86400_000;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Sticker({ place }: { place: PlaceStat }) {
  const [src, setSrc] = useState("");
  const url = `${SITE}/app/?scan=${place.id}-${place.qr_code}`;
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: "#161b3d", light: "#ffffff" } }).then(setSrc); }, [url]);
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
  const [disputing, setDisputing] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState(() => {
    const q = new URLSearchParams(location.search).get("paid");
    return q === "success" ? "Payment received. It shows up once the bank confirms (PromptPay can take a minute)." : q === "cancelled" ? "Payment cancelled." : "";
  });

  useEffect(() => { resumeSignIn().then((m) => m && setMsg(m)); }, []);

  useEffect(() => {
    (async () => {
      await ensureSession();
      const { data } = await supabase.from("shops").select("id, name, is_demo, owner_id").order("is_demo").order("name");
      const rows = (data ?? []) as ShopRow[];
      setShops(rows);
      setShopId((cur) => cur || rows[0]?.id || "");
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
      setMsg(e instanceof ApiError && e.code === "payments_not_configured" ? "Payments aren't switched on yet." : "Couldn't start checkout. Try again.");
    }
  };

  const dispute = async (id: number) => {
    const { data, error } = await supabase.rpc("dispute_visit", { p_visit: id, p_reason: reason });
    if (error) setMsg(error.message.includes("window") ? "Disputes are only possible within 7 days." : "Couldn't dispute this visit.");
    else setMsg(`Disputed. ฿${(data as { refunded_thb: number }).refunded_thb} went back to your credit while we review it.`);
    setDisputing(null); setReason("");
    load();
  };

  return (
    <div className="shop-shell">
      <header className="topbar">
        <a className="brand" href="/">Giggles <span>Maps</span></a>
        <span className="chip">For shops</span>
      </header>
      <main className="shop-main">
        <div className="shop-head">
          <h1>Visits we sent you</h1>
          <label className="field shop-pick">
            <span>Shop</span>
            <select id="shop-select" value={shopId} onChange={(e) => setShopId(e.target.value)}>
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <MyListing signedIn={!isGuest(user)} />
        {shop?.is_demo && <p className="fine notice">Example shop for the demo. This business hasn't signed up; numbers come from test check-ins.</p>}

        <section className="tiles" aria-label="Last 30 days">
          <div className="tile"><span className="fine">Shown on routes (30 days)</span><b className="num">{totals.shown}</b><span className="fine num">{totals.cards} as "Near this spot" cards</span></div>
          <div className="tile"><span className="fine">Verified visits (30 days)</span><b className="num">{totals.visits}</b></div>
          <div className="tile"><span className="fine">Price per visit</span><b className="num">฿{overview?.places[0]?.bid_thb ?? 0}</b>
            <span className="fine">only for verified visits</span></div>
          <div className="tile"><span className="fine">Credit left</span><b className="num">฿{Number(overview?.wallet_thb ?? 0).toLocaleString()}</b><span className="fine num">฿{spent.toLocaleString()} spent</span></div>
        </section>

        <section className="stack">
          <h2>How you pay</h2>
          <div className="plans">
            <article className="plan current">
              <h3>Pay per visit</h3>
              <p className="fine">Prepaid credit. Your bid is taken only for a verified visit: counter QR scan + GPS within 60 m + selfie, from someone shown your shop in the last 3 hours, once per person per 30 days.</p>
              <div className="row">
                {PACKS.map((p) => <button key={p} className="btn gold" onClick={() => pay({ kind: "credit", shop_id: shopId, pack: p })} disabled={!shopId}>Add <span className="num">฿{p.toLocaleString()}</span></button>)}
              </div>
            </article>
          </div>
          <p className="fine">Card or PromptPay via Stripe. No monthly fee: no visits, no charge. The route is never for sale: travellers see your shop only when it ranks on quality, the same as places that don't pay. Signing up gets you this dashboard, your counter sticker, deals in the free coupon spin and, soon, bookings.</p>
          {msg && <p className="notice" role="status">{msg}</p>}
        </section>

        <section className="stack">
          <h2>Counter sticker</h2>
          <div className="stickers">
            {(overview?.places ?? []).filter((p) => p.qr_code).map((p) => <Sticker key={p.id} place={p} />)}
          </div>
        </section>

        <section className="stack">
          <h2>Recent visits</h2>
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
          <p className="fine">You can dispute a charge within 7 days. The credit comes back right away while we check it.</p>
        </section>

        <section className="stack">
          <h2>Your account</h2>
          {isGuest(user)
            ? <SignIn why="Sign in to claim or add your shop and manage it here. Free for every local business." />
            : <p className="fine">Signed in as <b>{user?.email}</b>. Shops you claim or add appear above.</p>}
        </section>
      </main>
    </div>
  );
}
