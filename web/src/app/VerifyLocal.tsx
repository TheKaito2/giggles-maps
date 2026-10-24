import { useState } from "react";
import { HandHeart } from "lucide-react";
import { ApiError } from "../lib/supabase";
import { confirmNomination, type Nomination, nominationsNear } from "../lib/api";
import { kindOf } from "./kinds";
import { formatDistance } from "./PlaceSearch";
import Info from "./Info";

const here = () => new Promise<{ lat: number; lng: number }>((ok, fail) => navigator.geolocation.getCurrentPosition(
  (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), fail, { enableHighAccuracy: true, timeout: 15000 }));

/** Local Hero: shops other travellers nominated near you. Confirm one while standing at it (+20 XP); two confirmations put it on the map. */
export default function VerifyLocal() {
  const [list, setList] = useState<Nomination[] | null>(null);
  const [msg, setMsg] = useState("");
  const find = () => here().then(nominationsNear).then(setList).catch(() => setMsg("We need your location to find nominated shops near you."));
  const confirm = (n: Nomination) => here().then((at) => confirmNomination(n.id, at))
    .then((r) => { setMsg(r === "live" ? `${n.name} is on the map now. Thanks! +20 XP` : `Confirmed ${n.name}. +20 XP once it goes live.`); find(); })
    .catch((e) => setMsg(e instanceof ApiError && e.code === "be_there" ? `Go to ${n.name} first: confirm while you're within 50 m.`
      : e instanceof ApiError && e.code === "sign_in_required" ? "Sign in on your Profile first: confirmations need a real account."
      : e instanceof ApiError && e.code === "account_too_new" ? "New accounts can confirm shops after their first week." : "Couldn't confirm. Try again."));
  return (
    <section className="friend-quest glass" aria-label="Help verify local shops">
      <h3><HandHeart size={18} aria-hidden /> Local Hero: verify local shops <Info label="About Local Hero">Travellers nominate OTOP, craft and family
        shops the map is missing. Stand at one and confirm it: two confirmations put it on the map for everyone.</Info></h3>
      {list === null ? <button type="button" className="btn soft" onClick={find}>Find nominated shops near me</button>
        : list.length === 0 ? <p className="fine">None near you right now.</p>
        : <ul className="people">{list.map((n) => {
            const k = kindOf(n.kind, null);
            return <li key={n.id} className="person"><span className="person-main"><b>{n.name}</b>
              <span className="fine">{k.en} · {formatDistance(n.distance_m)} · {n.confirms}/2 confirmed</span></span>
              {n.mine ? <span className="fine">Yours</span> : n.confirmed ? <span className="fine">Confirmed</span>
                : <button type="button" className="btn small" onClick={() => confirm(n)}>I'm here, confirm</button>}</li>;
          })}</ul>}
      {msg && <p className="fine" role="status">{msg}</p>}
    </section>
  );
}
