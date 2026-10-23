import { type ReactNode, useEffect, useRef, useState } from "react";
import { type FoundPlace, type LatLng, searchAddresses, searchPlaces } from "../lib/api";
import { CATEGORY } from "./Results";

// Start/destination field: our places as you type (300 ms pause), addresses from Photon (OpenStreetMap search)
// on Enter or "Search addresses" only (Photon asks for fair use), or "lat, lng" typed directly.
export default function PlaceSearch({ label, value, pin, near, onPick, actions }: {
  label: string; value: string; pin: ReactNode; near?: LatLng | null;
  onPick: (point: LatLng, name: string) => void; actions?: ReactNode;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<FoundPlace[]>([]);
  const [message, setMessage] = useState("");
  const request = useRef(0);
  useEffect(() => setQuery(value), [value]);

  // type-ahead over our own places
  useEffect(() => {
    const text = query.trim();
    if (!open || text.length < 2 || text === value) { setResults([]); return; }
    const id = ++request.current;
    const t = setTimeout(() => {
      searchPlaces(text, near).then((r) => { if (id === request.current) { setResults(r.slice(0, 6)); setMessage(""); } })
        .catch(() => { if (id === request.current) setMessage("Search is unavailable. Pick on the map instead."); });
    }, 300);
    return () => clearTimeout(t);
  }, [query, open, near, value]);

  const searchAll = async () => {
    const text = query.trim();
    const coords = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(text);
    if (coords) {
      const lat = Number(coords[1]), lng = Number(coords[2]);
      if (lat < 5 || lat > 21 || lng < 97 || lng > 106) { setMessage("Choose a point inside Thailand."); return; }
      pick({ lat, lng }, `${lat.toFixed(4)}, ${lng.toFixed(4)}`); return;
    }
    if (text.length < 2) return;
    const id = ++request.current;
    setMessage("Searching addresses…");
    const [ours, addresses] = await Promise.all([
      searchPlaces(text, near).catch(() => [] as FoundPlace[]), searchAddresses(text, near).catch(() => [] as FoundPlace[]),
    ]);
    if (id !== request.current) return;
    setResults([...ours.slice(0, 4), ...addresses]);
    setMessage(ours.length + addresses.length ? "" : "Nothing found. Try another name or pick on the map.");
  };

  const pick = (point: LatLng, name: string) => {
    request.current++;
    onPick(point, name);
    setQuery(name); setResults([]); setMessage(""); setOpen(false);
  };

  return (
    <div className="place-field">
      <div className="place-row">
        {pin}
        <input value={query} maxLength={100} aria-label={label} placeholder={label}
          onFocus={(e) => { setOpen(true); e.target.select(); }}
          onBlur={() => setTimeout(() => { setOpen(false); setQuery((q) => q.trim() ? q : value); }, 150)}
          onChange={(e) => { setQuery(e.target.value); setMessage(""); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void searchAll(); }
            if (e.key === "Escape") { setOpen(false); setQuery(value); }
          }} />
        {actions}
      </div>
      {open && (results.length > 0 || message || query.trim().length >= 2) && query.trim() !== value && (
        <ul className="place-results" aria-label={`${label} suggestions`}>
          {results.map((p, i) => (
            <li key={p.id ?? `a${i}`}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick({ lat: p.lat, lng: p.lng }, p.name)}>
                <b>{p.name}</b>
                <span className="fine">{p.source === "photon" ? "Address · OpenStreetMap" : CATEGORY[p.category ?? ""] ?? p.category}
                  {p.distance_m != null && ` · ${formatDistance(p.distance_m)}`}</span>
              </button>
            </li>
          ))}
          {message && <li className="fine msg" role="status">{message}</li>}
          <li><button type="button" className="link" onMouseDown={(e) => e.preventDefault()} onClick={searchAll}>Search addresses for “{query.trim()}”</button></li>
        </ul>
      )}
    </div>
  );
}

export const formatDistance = (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
