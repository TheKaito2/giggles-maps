import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { Flag, X } from "lucide-react";
import { type EtaView as Eta, viewEta } from "../../lib/api";
import Avatar from "../social/Avatar";

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** What someone sees when you share your trip: where you are now and when you'll arrive. Refreshes every 15 s. */
export default function EtaView({ token, onClose }: { token: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marks = useRef<maplibregl.Marker[]>([]);
  const [eta, setEta] = useState<Eta | null | undefined>(undefined);
  useEffect(() => {
    map.current = new maplibregl.Map({ container: box.current!, style: "https://tiles.openfreemap.org/styles/liberty", center: [104.149, 17.163], zoom: 12,
      attributionControl: { compact: true } });
    const load = () => viewEta(token).then(setEta).catch(() => setEta(null));
    load();
    const t = setInterval(load, 15000);
    return () => { clearInterval(t); map.current?.remove(); };
  }, [token]);
  useEffect(() => {
    const m = map.current;
    if (!m || !eta) return;
    marks.current.forEach((x) => x.remove());
    const dest = document.createElement("span"); dest.className = "pin end"; dest.textContent = "B";
    marks.current = [new maplibregl.Marker({ element: dest }).setLngLat([eta.dest.lng, eta.dest.lat]).addTo(m)];
    if (eta.at) {
      const el = document.createElement("span"); el.className = "nav-me";
      marks.current.push(new maplibregl.Marker({ element: el }).setLngLat([eta.at.lng, eta.at.lat]).addTo(m));
      if (m.getContainer().clientHeight > 200 && m.getContainer().clientWidth > 200)   // fitBounds throws when the map is smaller than its padding
        m.fitBounds(new maplibregl.LngLatBounds([eta.at.lng, eta.at.lat], [eta.at.lng, eta.at.lat]).extend([eta.dest.lng, eta.dest.lat]),
          { padding: 80, maxZoom: 15, duration: 600 });
      else m.easeTo({ center: [eta.at.lng, eta.at.lat], zoom: 13 });
    } else m.easeTo({ center: [eta.dest.lng, eta.dest.lat], zoom: 14 });
  }, [eta]);
  return (
    <div className="nav-mode" role="dialog" aria-modal="true" aria-label="Shared trip">
      <div ref={box} className="nav-map" />
      <div className="nav-top">
        {eta === undefined ? <b>Loading…</b> : eta === null ? <b>This shared trip has ended.</b> : <>
          <Avatar name={eta.who.nickname} colour={eta.who.colour} avatar={eta.who.avatar} size={44} />
          <span className="nav-turn"><b>{eta.who.nickname} is on the way{eta.dest.name ? ` to ${eta.dest.name}` : ""}</b>
            <span>{eta.eta_at ? <>Arriving around <b className="num">{hhmm(eta.eta_at)}</b></> : null}
              {eta.at ? ` · updated ${hhmm(eta.at.seen_at)}` : " · waiting for their location"}</span></span>
          <Flag size={22} aria-hidden />
        </>}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </div>
    </div>
  );
}
