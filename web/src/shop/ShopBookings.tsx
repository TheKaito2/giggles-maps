import { useState } from "react";
import { answerBooking, bookingWhen, PRICES, type ShopBooking, shopCancelBooking } from "../lib/api";
import { errCode } from "../lib/supabase";

const ERR: Record<string, string> = {
  top_up_first: "Add credit first: the fee is paid from your credit once the guest checks in.",
  bad_price: "Enter the full price of the stay in baht (at least ฿100).",
  reason_required: "Tell the guest why, in a few words.",
};
const STATUS: Partial<Record<ShopBooking["status"], string>> = {
  accepted: "Accepted", declined: "Declined", cancelled: "Cancelled", expired: "Not answered in time", no_show: "No-show · free",
};

/** One booking: accept (a stay with its price) or decline a request; cancel an accepted one with a reason. */
function Row({ b, onChange, onError }: { b: ShopBooking; onChange: () => void; onError: (m: string) => void }) {
  const [price, setPrice] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const run = (p: Promise<void>) => p.then(onChange).catch((e) => onError(ERR[errCode(e)] ?? "Couldn't update that booking."));
  const stay = b.kind === "stay";
  return (
    <li>
      <span className="person-main"><b>{b.guest} · {b.place}</b>
        <span className="fine num">{bookingWhen(b)}{b.price ? ` · ฿${b.price.toLocaleString()}` : ""}{b.note ? ` · "${b.note}"` : ""}</span>
        {b.status === "cancelled" && b.cancel_reason && <span className="fine">You cancelled: "{b.cancel_reason}"</span>}</span>
      {b.status === "requested" ? <span className="row tight">
          {stay && <label className="field price-in"><span className="sr-only">Price of the whole stay (baht)</span>
            <input type="number" inputMode="numeric" min={100} placeholder="Stay price ฿" value={price} onChange={(e) => setPrice(e.target.value)} /></label>}
          <button className="btn small" disabled={stay && !(Number(price) >= 100)}
            onClick={() => run(answerBooking(b.id, true, stay ? Number(price) : undefined))}>
            {stay && Number(price) >= 100 ? `Accept · fee ฿${Math.round(Number(price) * PRICES.stayPct / 100)}` : "Accept"}</button>
          <button className="btn ghost small" onClick={() => run(answerBooking(b.id, false))}>Decline</button></span>
        : b.status === "accepted" && cancelling
          ? <form className="row tight" onSubmit={(e) => { e.preventDefault(); run(shopCancelBooking(b.id, reason)); }}>
              <input className="text-in" required minLength={3} maxLength={200} placeholder="Why? The guest sees this" aria-label="Reason"
                value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn small">Cancel booking</button>
              <button type="button" className="link" onClick={() => setCancelling(false)}>Keep it</button>
            </form>
        : <span className="row tight">
            <span className={`chip booking-${b.status}`}>{b.status === "completed" ? `Done · ฿${b.charged ?? 0}` : STATUS[b.status] ?? b.status}</span>
            {b.status === "accepted" && <button className="link" onClick={() => setCancelling(true)}>Cancel</button>}</span>}
    </li>
  );
}

export default function ShopBookings({ bookings, live, onChange, onError }:
  { bookings: ShopBooking[]; live: boolean; onChange: () => void; onError: (m: string) => void }) {
  if (!bookings.length) return <p className="fine">{live ? "No bookings yet. New ones ring here the moment they arrive." : "Partners take bookings through Giggles Maps."}</p>;
  return <>
    <ul className="bookings">{bookings.map((b) => <Row key={b.id} b={b} onChange={onChange} onError={onError} />)}</ul>
    <p className="fine">Tables and visits: ฿{PRICES.booking} once the guest checks in. Stays: {PRICES.stayPct}% of the price you set. Declines, cancellations and no-shows are free.</p>
  </>;
}
