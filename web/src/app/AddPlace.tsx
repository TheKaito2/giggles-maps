import { useState } from "react";
import { X } from "lucide-react";
import { ApiError } from "../lib/supabase";
import { suggestEdit } from "../lib/api";
import { KINDS } from "./kinds";

/** Add a missing place where you're standing (GPS within 100 m); an admin checks it before it goes on the map. */
export default function AddPlace({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("restaurant");
  const [hours, setHours] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const send = () => {
    setBusy(true); setMsg("Getting your location…");
    navigator.geolocation.getCurrentPosition((pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      suggestEdit(null, { name: name.trim(), kind, ...here, ...(hours.trim() ? { opening_hours: hours.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) }, here)
        .then(() => setMsg("Thanks! We'll check it and add it to the map. +50 XP when it's approved."))
        .catch((e) => setMsg(e instanceof ApiError && e.code === "too_many_edits" ? "That's a lot of suggestions today. Try again tomorrow." : "Couldn't send that. Try again."))
        .finally(() => setBusy(false));
    }, () => { setMsg("We need your location: add the place while you're standing at it."); setBusy(false); },
    { enableHighAccuracy: true, timeout: 15000 });
  };
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-place-title">
      <form className="modal" onSubmit={(e) => { e.preventDefault(); if (name.trim().length > 1) send(); }}>
        <header className="modal-head"><h2 id="add-place-title">Add a missing place</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        <p className="fine">Stand at the place: we pin it where you are.</p>
        <label className="field"><span>Name</span><input className="text-in" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>What is it?</span>
          <select className="text-in" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KINDS).map(([id, k]) => <option key={id} value={id}>{k.en} · {k.th}</option>)}
          </select></label>
        <label className="field"><span>Opening hours (optional)</span><input className="text-in" value={hours} placeholder="Mo-Su 08:00-17:00" onChange={(e) => setHours(e.target.value)} /></label>
        <label className="field"><span>Phone (optional)</span><input className="text-in" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} /></label>
        {msg && <p className="fine" role="status">{msg}</p>}
        <button className="btn" type="submit" disabled={busy || name.trim().length < 2}>Send for review</button>
      </form>
    </div>
  );
}
