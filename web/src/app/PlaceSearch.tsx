import { useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { type FoundPlace, type LatLng, searchAddresses, searchPlaces } from "../lib/api";
import { CATEGORY } from "./Results";

// Start/destination search: our own places first, then addresses from Photon (OpenStreetMap search),
// or "lat, lng" typed directly. Runs on Search/Enter only (Photon asks for fair use).
export default function PlaceSearch({ label, initial = "", tone = "start", near, onPick }: {
  label: string; initial?: string; tone?: "start" | "end"; near?: LatLng | null; onPick: (point: LatLng, name: string) => void;
}) {
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<FoundPlace[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const search = async () => {
    const id = ++request.current;
    const text = query.trim();
    setResults([]); setMessage("");
    // Any selected map coordinate can be used, even if no POI record exists there.
    const coords = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(text);
    if (coords) {
      const lat = Number(coords[1]), lng = Number(coords[2]);
      if (lat < 5 || lat > 21 || lng < 97 || lng > 106) { setMessage("Choose a point inside Thailand."); return; }
      onPick({ lat, lng }, `${lat.toFixed(4)}, ${lng.toFixed(4)}`); setMessage("Location selected."); return;
    }
    if (text.length < 2) { setMessage("Enter at least 2 characters, or latitude, longitude."); return; }
    setBusy(true);
    try {
      const ours = await searchPlaces(text, near).catch(() => [] as FoundPlace[]);
      // few of our own matches: add addresses (hotels, malls, streets) from OpenStreetMap search
      const addresses = ours.length < 4 ? await searchAddresses(text, near).catch(() => [] as FoundPlace[]) : [];
      if (id !== request.current) return;
      const found = [...ours.slice(0, 6), ...addresses];
      setResults(found);
      if (!found.length) setMessage("Nothing found. Try another name, set a pin on the map, or enter coordinates.");
    } finally { if (id === request.current) setBusy(false); }
  };
  return <div className="place-search">
    <label className="field">
      <span>{label}</span>
      <span className={`input-icon ${tone}`}><MapPin size={16} aria-hidden />
      <input value={query} maxLength={100} placeholder="ชื่อสถานที่ / place / address"
        onChange={(e) => { request.current++; setBusy(false); setResults([]); setMessage(""); setQuery(e.target.value); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} /></span>
    </label>
    <button type="button" className="btn small soft" disabled={busy} onClick={search}>{busy ? "Searching…" : "Search"}</button>
    {message && <p className="fine" role="status">{message}</p>}
    {!!results.length && <ul className="place-results" aria-label={`${label} search results`}>
      {results.map((p, i) => <li key={p.id ?? `a${i}`}><button type="button" className="link" onClick={() => {
        request.current++; onPick({ lat: p.lat, lng: p.lng }, p.name); setQuery(p.name); setResults([]); setMessage("Location selected.");
      }}>{p.name}{p.name_th && p.name_th !== p.name ? ` · ${p.name_th}` : ""}
        <span className="fine"> · {p.source === "photon" ? "address via OpenStreetMap" : CATEGORY[p.category ?? ""] ?? p.category}
          {p.distance_m != null && ` · ${formatDistance(p.distance_m)}`}</span></button></li>)}
    </ul>}
  </div>;
}

export const formatDistance = (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
