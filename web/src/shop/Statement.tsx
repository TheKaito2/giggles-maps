import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { type Statement as Data, shopStatement } from "../lib/api";

const KIND: Record<string, string> = { credit: "Credit top-up", partner: "Partner", choice: "Giggles Choice" };
const thisMonth = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);   // Bangkok
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const baht = (n: number | null) => `฿${Number(n ?? 0).toLocaleString()}`;

/** A month's receipt for the shop: payments in, and every visit and booking its credit paid for. Print or save as PDF.
 *  Not a tax invoice: Giggles Maps isn't VAT-registered yet. */
export default function Statement({ shopId }: { shopId: string }) {
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null); setErr("");
    shopStatement(shopId, month).then(setData).catch(() => setErr("Couldn't load this month."));
  }, [shopId, month]);
  const paidIn = (data?.payments ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const used = (data?.visits ?? []).filter((v) => v.status === "charged").reduce((a, v) => a + Number(v.amount), 0)
    + (data?.bookings ?? []).reduce((a, b) => a + Number(b.amount ?? 0), 0);
  return (
    <section className="statement stack" aria-labelledby="statement-h">
      <div className="row between no-print">
        <h3 id="statement-h">Monthly statement</h3>
        <label className="field"><span className="sr-only">Month</span>
          <input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        <button type="button" className="btn small" onClick={() => print()} disabled={!data}><Printer size={15} aria-hidden /> Print or save PDF</button>
      </div>
      {err && <p className="fine">{err}</p>}
      {data && <div className="statement-sheet">
        <p><b>Giggles Maps</b> · gigglesmap.xyz<br />Statement for <b>{data.shop}</b>, {month}</p>
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>What</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {data.payments.map((p) => <tr key={p.ref}><td className="num">{when(p.at)}</td><td>{KIND[p.kind] ?? p.kind} (paid)</td><td className="num r">{baht(p.amount)}</td></tr>)}
            {data.visits.map((v, i) => <tr key={`v${i}`}><td className="num">{when(v.at)}</td>
              <td>Verified visit · {v.place}{v.status === "disputed" ? " (disputed, refunded)" : ""}</td><td className="num r">−{baht(v.status === "charged" ? v.amount : 0)}</td></tr>)}
            {data.bookings.map((b, i) => <tr key={`b${i}`}><td className="num">{when(b.at)}</td><td>Booking ({b.kind}) · {b.place}</td><td className="num r">−{baht(b.amount)}</td></tr>)}
            {!data.payments.length && !data.visits.length && !data.bookings.length && <tr><td colSpan={3} className="fine">Nothing this month.</td></tr>}
          </tbody>
          <tfoot>
            <tr><th colSpan={2}>Paid in</th><th className="num r">{baht(paidIn)}</th></tr>
            <tr><th colSpan={2}>Paid from credit</th><th className="num r">−{baht(used)}</th></tr>
          </tfoot>
        </table></div>
        <p className="fine">This is a statement, not a tax invoice. Card and PromptPay receipts come from Stripe by email.</p>
      </div>}
    </section>
  );
}
