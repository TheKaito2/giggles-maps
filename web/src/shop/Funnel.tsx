import { useState } from "react";

export interface Week { week: string; shown: number; visits: number; bookings: number; spent: number }
const KEY = "gm-avg-bill";
const savedBill = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
const label = (iso: string) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** The last 8 weeks: how often travellers saw the shop on a route, check-ins, bookings and what they cost, with a return
 *  estimate from the shop's own average bill (kept on this device only). */
export default function Funnel({ weeks }: { weeks: Week[] }) {
  const [bill, setBill] = useState(savedBill);
  const keep = (v: number) => { setBill(v); try { localStorage.setItem(KEY, String(v)); } catch { /* this visit only */ } };
  const top = Math.max(1, ...weeks.map((w) => w.shown));
  const sum = (k: keyof Omit<Week, "week">) => weeks.reduce((a, w) => a + Number(w[k]), 0);
  const visits = sum("visits"), spent = sum("spent");
  return (
    <section className="funnel" aria-labelledby="funnel-h">
      <h3 id="funnel-h">Last 8 weeks</h3>
      <div className="table-wrap"><table>
        <thead><tr><th>Week of</th><th>On routes</th><th className="r">Check-ins</th><th className="r">Bookings</th><th className="r">Paid</th></tr></thead>
        <tbody>{weeks.map((w) => <tr key={w.week}>
          <td className="num">{label(w.week)}</td>
          <td><span className="funnel-bar" style={{ width: `${Math.round((100 * w.shown) / top)}%` }} aria-hidden /> <span className="num">{w.shown}</span></td>
          <td className="num r">{w.visits}</td><td className="num r">{w.bookings}</td><td className="num r">฿{Number(w.spent).toLocaleString()}</td>
        </tr>)}</tbody>
      </table></div>
      <label className="field avg-bill"><span>Your average bill (฿)</span>
        <input type="number" inputMode="numeric" min={0} value={bill || ""} placeholder="e.g. 250" onChange={(e) => keep(Math.max(0, Number(e.target.value) || 0))} /></label>
      {bill > 0 && <p className="fine">
        {visits} Giggles {visits === 1 ? "traveller" : "travellers"} checked in × ฿{bill.toLocaleString()} ≈ <b className="num">฿{(visits * bill).toLocaleString()}</b> of sales,
        for ฿{spent.toLocaleString()} in route-appearance and booking fees, plus your monthly plan. An estimate: it assumes every traveller who
        checked in spent your average bill.</p>}
    </section>
  );
}
