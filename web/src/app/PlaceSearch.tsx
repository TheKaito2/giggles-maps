import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { LatLng } from "../lib/api";

interface Place extends LatLng { id: number; name: string; name_th: string | null }

export default function PlaceSearch({ label, point, onPick }: {
  label: string; point: LatLng | null; onPick: (point: LatLng) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
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
      onPick({ lat, lng }); setMessage("Location selected."); return;
    }
    if (text.length < 2) { setMessage("Enter at least 2 characters, or latitude, longitude."); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("search_route_places", { p_query: text });
      if (id !== request.current) return;
      if (error) throw error;
      setResults((data ?? []) as Place[]);
      if (!data?.length) setMessage("No matching places yet. Set a pin on the map or enter coordinates.");
    } catch { if (id === request.current) setMessage("Place search is unavailable. Set a pin on the map instead."); }
    finally { if (id === request.current) setBusy(false); }
  };
  return <div className="place-search">
    <label className="field">
      <span>{label} place or latitude, longitude</span>
      <input value={query} maxLength={100} placeholder="ชื่อสถานที่ / place / 13.7563, 100.5018"
        onChange={(e) => { request.current++; setBusy(false); setResults([]); setMessage(""); setQuery(e.target.value); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} />
    </label>
    <button type="button" className="btn small" disabled={busy} onClick={search}>{busy ? "Searching…" : "Search"}</button>
    {point && <span className="fine num">{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</span>}
    {message && <p className="fine" role="status">{message}</p>}
    {!!results.length && <ul className="place-results" aria-label={`${label} search results`}>
      {results.map((p) => <li key={p.id}><button type="button" className="link" onClick={() => {
        request.current++; onPick({ lat: p.lat, lng: p.lng }); setQuery(p.name); setResults([]); setMessage("Location selected.");
      }}>{p.name}{p.name_th && p.name_th !== p.name ? ` · ${p.name_th}` : ""}<span className="fine"> · {p.lat.toFixed(3)}, {p.lng.toFixed(3)}</span></button></li>)}
    </ul>}
  </div>;
}
