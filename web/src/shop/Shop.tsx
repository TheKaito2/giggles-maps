import { useEffect, useState } from "react";
import { ApiError, callFn, ensureSession, supabase } from "../lib/supabase";

interface ShopRow { id: string; name: string; wallet_thb: number; is_demo: boolean; places: { id: number; name: string; bid_thb: number }[] }
interface Visit { id: number; amount_thb: number; created_at: string; places: { name: string } | null }

const PACKS = [500, 1000, 3000];
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Shop() {
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [shopId, setShopId] = useState("");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [msg, setMsg] = useState(() => {
    const q = new URLSearchParams(location.search).get("topup");
    return q === "success" ? "Payment received. Credit appears once the bank confirms (PromptPay can take a minute)." : q === "cancelled" ? "Top-up cancelled." : "";
  });

  useEffect(() => {
    (async () => {
      await ensureSession();
      const { data } = await supabase.from("shops").select("id, name, wallet_thb, is_demo, places(id, name, bid_thb)").order("name");
      const rows = (data ?? []) as ShopRow[];
      setShops(rows);
      setShopId((cur) => cur || rows[0]?.id || "");
    })().catch(() => setMsg("Couldn't load shops. Check your connection."));
  }, []);

  useEffect(() => {
    if (!shopId) return;
    supabase.from("billable_visits").select("id, amount_thb, created_at, places(name)").eq("shop_id", shopId)
      .order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => setVisits((data ?? []) as unknown as Visit[]));
  }, [shopId]);

  const shop = shops.find((s) => s.id === shopId);
  const spent = visits.reduce((sum, v) => sum + Number(v.amount_thb), 0);
  const bid = shop?.places[0]?.bid_thb ?? 0;

  const topUp = async (pack: number) => {
    setMsg("");
    try {
      const { url } = await callFn<{ url: string }>("stripe-checkout", { shop_id: shopId, pack });
      location.href = url;
    } catch (e) {
      setMsg(e instanceof ApiError && e.code === "payments_not_configured"
        ? "Payments aren't switched on yet. This MVP runs Stripe in test mode once keys are added."
        : "Couldn't start checkout. Try again.");
    }
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
        {shop?.is_demo && <p className="fine notice">Example shop for the demo. This business hasn't signed up; numbers come from test check-ins.</p>}

        <section className="tiles" aria-label="Summary">
          <div className="tile"><span className="fine">Credit left</span><b className="num">฿{Number(shop?.wallet_thb ?? 0).toLocaleString()}</b></div>
          <div className="tile"><span className="fine">Your bid per verified visit</span><b className="num">฿{bid}</b></div>
          <div className="tile"><span className="fine">Verified visits</span><b className="num">{visits.length}</b></div>
          <div className="tile"><span className="fine">Spent on visits</span><b className="num">฿{spent.toLocaleString()}</b></div>
        </section>

        <section className="stack">
          <h2>Top up credit</h2>
          <p className="fine">You only pay when a traveller is verified at your door: GPS within 60 m plus a selfie. Higher bids get you placed first on routes.</p>
          <div className="row">
            {PACKS.map((p) => <button key={p} className="btn gold" onClick={() => topUp(p)} disabled={!shopId}>Add <span className="num">฿{p.toLocaleString()}</span></button>)}
          </div>
          <p className="fine">Card or PromptPay via Stripe.</p>
          {msg && <p className="notice" role="status">{msg}</p>}
        </section>

        <section className="stack">
          <h2>Recent visits</h2>
          {visits.length === 0
            ? <p className="fine">No verified visits yet. They appear here the moment a traveller checks in.</p>
            : <div className="table-wrap"><table>
                <thead><tr><th>When</th><th>Place</th><th className="r">Charged</th></tr></thead>
                <tbody>{visits.map((v) => (
                  <tr key={v.id}><td className="num">{fmt(v.created_at)}</td><td>{v.places?.name}</td><td className="num r">฿{v.amount_thb}</td></tr>
                ))}</tbody>
              </table></div>}
        </section>
      </main>
    </div>
  );
}
