import { useState } from "react";
import Modal from "./Modal";
import { X } from "lucide-react";
import { errCode } from "../lib/supabase";
import { nominate, suggestEdit, uploadSelfie } from "../lib/api";
import { shrinkPhoto } from "../lib/photo";
import { KINDS } from "./kinds";
import { PhotoConsentTerms, readConsent, saveConsent } from "./PhotoConsent";

const LOCAL_KINDS = ["otop", "community_enterprise", "craft", "souvenir", "market", "night_market", "restaurant", "cafe", "bakery", "dessert"];

/**
 * Add a missing place where you're standing. Local shops (OTOP, community, crafts, food) are nominations: a photo,
 * then two other travellers confirm on the spot and it goes live (+100 XP). Anything else goes to an admin.
 */
export default function AddPlace({ onClose }: { onClose: () => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [consent, setConsent] = useState(readConsent);   // the same photo consent as check-in, asked once
  const [name, setName] = useState("");
  const [kind, setKind] = useState("restaurant");
  const [hours, setHours] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const local = LOCAL_KINDS.includes(kind);
  const send = () => {
    if (local && !photo) { setMsg("Add a photo of the shop: it helps us check the place, and it's deleted 30 days after the nomination closes."); return; }
    setBusy(true); setMsg("Getting your location…");
    navigator.geolocation.getCurrentPosition((pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (local) {
        shrinkPhoto(photo!).then(uploadSelfie).then((path) => nominate({ name: name.trim(), kind, otop: kind === "otop", community: kind === "community_enterprise", photo: path, at: here }))
          .then(() => setMsg("Nominated! When two other travellers confirm it on the spot, it goes on the map and you get +100 XP."))
          .catch((e) => setMsg(errCode(e) === "sign_in_required" ? "Sign in on your Profile first: nominations need a real account."
            : errCode(e) === "already_listed" ? "That shop is already listed or nominated here."
            : errCode(e) === "too_many_nominations" ? "That's 5 nominations today. Try again tomorrow." : "Couldn't send that. Try again."))
          .finally(() => setBusy(false));
        return;
      }
      suggestEdit(null, { name: name.trim(), kind, ...here, ...(hours.trim() ? { opening_hours: hours.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) }, here)
        .then(() => setMsg("Thanks! We'll check it and add it to the map. +50 XP when it's approved."))
        .catch((e) => setMsg(errCode(e) === "too_many_edits" ? "That's a lot of suggestions today. Try again tomorrow." : "Couldn't send that. Try again."))
        .finally(() => setBusy(false));
    }, () => { setMsg("We need your location: add the place while you're standing at it."); setBusy(false); },
    { enableHighAccuracy: true, timeout: 15000 });
  };
  return (
    <Modal labelledBy="add-place-title" dismissable={false} onClose={onClose} onSubmit={() => { if (name.trim().length > 1) send(); }}>
        <header className="modal-head"><h2 id="add-place-title">Add a missing place</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        <p className="fine">Stand at the place: we pin it where you are.</p>
        <label className="field"><span>Name</span><input className="text-in" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>What is it?</span>
          <select className="text-in" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KINDS).map(([id, k]) => <option key={id} value={id}>{k.en} · {k.th}</option>)}
          </select></label>
        {local && (consent
          ? <label className="field"><span>Photo of the shop (required)</span>
              <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
          : <div className="stack"><span>Photo of the shop (required)</span><PhotoConsentTerms />
              <button type="button" className="btn soft" onClick={() => { saveConsent(); setConsent(true); }}>I agree, add a photo</button></div>)}
        <p className="fine">{local ? "Local shops go live when two other travellers confirm them on the spot." : "We check other places before they go on the map."}</p>
        <label className="field"><span>Opening hours (optional)</span><input className="text-in" value={hours} placeholder="Mo-Su 08:00-17:00" onChange={(e) => setHours(e.target.value)} /></label>
        <label className="field"><span>Phone (optional)</span><input className="text-in" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} /></label>
        {msg && <p className="fine" role="status">{msg}</p>}
        <button className="btn" type="submit" disabled={busy || name.trim().length < 2}>{local ? "Nominate this shop" : "Send for review"}</button>
    </Modal>
  );
}
