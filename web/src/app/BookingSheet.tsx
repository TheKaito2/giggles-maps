import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { requestBooking } from "../lib/api";
import { isGuest, useUser } from "../lib/auth";
import { ApiError } from "../lib/supabase";
import SignIn from "./SignIn";

const ERR: Record<string, string> = {
  sign_in_required: "Sign in first so the shop knows who's coming.",
  not_bookable: "This place doesn't take bookings through Giggles right now.",
  too_many_bookings: "You have 5 bookings waiting already. Cancel one in Profile settings first.",
  bad_day: "Pick a day from today up to 6 months ahead.",
  already_booked: "You already have a booking here that day.",
};
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);   // Bangkok date

/** Book a partner place: day, party size and a note. The shop accepts or declines; checking in there completes it. */
export default function BookingSheet({ place, name, onClose, onDone }: { place: number; name: string; onClose: () => void; onDone: (msg: string) => void }) {
  const guest = isGuest(useUser());
  const [day, setDay] = useState(today);
  const [party, setParty] = useState(2);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const send = () => {
    setBusy(true); setMsg("");
    requestBooking(place, day, party, note.trim())
      .then(() => onDone(`Booking sent to ${name}. You'll see their answer in Profile settings.`))
      .catch((e) => setMsg(ERR[e instanceof ApiError ? e.message : ""] ?? "Couldn't send the booking. Try again."))
      .finally(() => setBusy(false));
  };
  if (guest) return <section className="booking glass stack"><SignIn why="Sign in to book, so the shop knows who's coming." /></section>;
  return (
    <section className="booking glass stack" aria-label={`Book ${name}`}>
      <div className="booking-fields">
        <label className="field"><span>Day</span><input type="date" value={day} min={today()} onChange={(e) => setDay(e.target.value)} /></label>
        <label className="field"><span>People</span><input type="number" inputMode="numeric" min={1} max={20} value={party}
          onChange={(e) => setParty(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
      </div>
      <label className="field"><span>Note for the shop</span><input type="text" maxLength={300} value={note} placeholder="Optional"
        onChange={(e) => setNote(e.target.value)} /></label>
      {msg && <p className="fine" role="status">{msg}</p>}
      <div className="row">
        <button type="button" className="btn gold" disabled={busy || !day} onClick={send}><CalendarCheck size={16} aria-hidden /> Send booking</button>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </section>
  );
}
