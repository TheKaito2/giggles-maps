import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { bookingKind, requestBooking } from "../lib/api";
import { isGuest, useUser } from "../lib/auth";
import { errCode } from "../lib/supabase";
import SignIn from "./SignIn";

const ERR: Record<string, string> = {
  sign_in_required: "Sign in first so the shop knows who's coming.",
  not_bookable: "This place doesn't take bookings through Giggles right now.",
  too_many_bookings: "You have 5 bookings waiting already. Cancel one in Profile settings first.",
  bad_day: "Pick a day from today up to 6 months ahead.",
  bad_time: "Pick a time.",
  bad_check_out: "Check-out has to be after check-in, at most 30 nights later.",
  bad_rooms: "Pick 1 to 10 rooms.",
  already_booked: "You already have a booking here that day.",
  too_many_requests: "That's 10 booking requests today. Try again tomorrow.",
};
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);   // Bangkok date
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const clamp = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || lo));

/** Book a partner place. A table or a visit: day, time and party size. A stay: check-in, check-out, rooms and guests; the
 *  shop sets the price when it accepts. The shop accepts or declines; checking in there completes it. */
export default function BookingSheet({ place, name, category, onClose, onDone }:
  { place: number; name: string; category: string; onClose: () => void; onDone: (msg: string) => void }) {
  const guest = isGuest(useUser());
  const kind = bookingKind(category);
  const [day, setDay] = useState(today);
  const [time, setTime] = useState(kind === "table" ? "12:00" : "10:00");
  const [checkOut, setCheckOut] = useState(() => plusDays(today(), 1));
  const [rooms, setRooms] = useState(1);
  const [party, setParty] = useState(2);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const send = () => {
    setBusy(true); setMsg("");
    requestBooking(place, day, party, note.trim(), kind === "stay" ? { check_out: checkOut, rooms } : { time })
      .then(() => onDone(kind === "stay"
        ? `Stay request sent to ${name}. They'll reply with the price; you'll see it in Profile settings.`
        : `Booking sent to ${name}. You'll see their answer in Profile settings.`))
      .catch((e) => setMsg(ERR[errCode(e)] ?? "Couldn't send the booking. Try again."))
      .finally(() => setBusy(false));
  };
  if (guest) return <section className="booking glass stack"><SignIn why="Sign in to book, so the shop knows who's coming." /></section>;
  return (
    <section className="booking glass stack" aria-label={`Book ${name}`}>
      {kind === "stay" ? <div className="booking-fields">
        <label className="field"><span>Check-in</span><input type="date" value={day} min={today()}
          onChange={(e) => { setDay(e.target.value); if (checkOut <= e.target.value) setCheckOut(plusDays(e.target.value, 1)); }} /></label>
        <label className="field"><span>Check-out</span><input type="date" value={checkOut} min={plusDays(day, 1)} max={plusDays(day, 30)}
          onChange={(e) => setCheckOut(e.target.value)} /></label>
        <label className="field"><span>Rooms</span><input type="number" inputMode="numeric" min={1} max={10} value={rooms}
          onChange={(e) => setRooms(clamp(e.target.value, 1, 10))} /></label>
        <label className="field"><span>Guests</span><input type="number" inputMode="numeric" min={1} max={20} value={party}
          onChange={(e) => setParty(clamp(e.target.value, 1, 20))} /></label>
      </div> : <div className="booking-fields">
        <label className="field"><span>Day</span><input type="date" value={day} min={today()} onChange={(e) => setDay(e.target.value)} /></label>
        <label className="field"><span>Time</span><input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} /></label>
        <label className="field"><span>People</span><input type="number" inputMode="numeric" min={1} max={20} value={party}
          onChange={(e) => setParty(clamp(e.target.value, 1, 20))} /></label>
      </div>}
      {kind === "stay" && <p className="fine">The place replies with the room price. You pay them directly, as usual.</p>}
      <label className="field"><span>Note for the shop</span><input type="text" maxLength={300} value={note} placeholder="Optional"
        onChange={(e) => setNote(e.target.value)} /></label>
      {msg && <p className="fine" role="status">{msg}</p>}
      <div className="row">
        <button type="button" className="btn gold" disabled={busy || !day || (kind !== "stay" && !time)} onClick={send}>
          <CalendarCheck size={16} aria-hidden /> {kind === "stay" ? "Ask for a room" : "Send booking"}</button>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </section>
  );
}
