import { type ReactNode, useEffect, useRef, useState } from "react";
import { Clock, MapPin } from "lucide-react";
import { type FoundPlace, type LatLng, searchAddresses, searchPlaces } from "../lib/api";
import { GROUPS, kindOf } from "./kinds";

const RECENT_KEY = "giggles.recentSearches";
const readRecent = (): FoundPlace[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; } };
const saveRecent = (p: FoundPlace) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([p, ...readRecent().filter((r) => r.name !== p.name)].slice(0, 6))); }
  catch { /* storage blocked: no recent list */ }
};

/** A result row's icon: the place kind's icon in its group colour, or a pin for addresses. */
function ResultIcon({ p }: { p: FoundPlace }) {
  if (p.source === "photon") return <span className="result-icon address"><MapPin size={15} aria-hidden /></span>;
  const k = kindOf(p.kind, p.category);
  return <span className="result-icon" style={{ background: GROUPS[k.group].colour }}><k.icon size={15} aria-hidden /></span>;
}

// Start/destination field, Google-style: our places AND addresses (Photon, OpenStreetMap search) preview as you type.
// Photon asks for fair use: 3+ characters, a 400 ms pause, and the previous request is cancelled.
export default function PlaceSearch({ label, value, pin, near, onPick, actions }: {
  label: string; value: string; pin: ReactNode; near?: LatLng | null;
  onPick: (point: LatLng, name: string) => void; actions?: ReactNode;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [places, setPlaces] = useState<FoundPlace[]>([]);
  const [addresses, setAddresses] = useState<FoundPlace[]>([]);
  const [message, setMessage] = useState("");
  const request = useRef(0);
  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    const text = query.trim();
    if (!open || text.length < 2 || text === value) { setPlaces([]); setAddresses([]); return; }
    const coords = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(text);
    if (coords) { setPlaces([]); setAddresses([]); return; }
    const id = ++request.current;
    const abort = new AbortController();
    const t1 = setTimeout(() => {
      searchPlaces(text, near).then((r) => { if (id === request.current) { setPlaces(r.slice(0, 6)); setMessage(""); } })
        .catch(() => { if (id === request.current) setMessage("Search is unavailable. Pick on the map instead."); });
    }, 250);
    const t2 = text.length >= 3 ? setTimeout(() => {
      searchAddresses(text, near, abort.signal).then((r) => { if (id === request.current) setAddresses(r.slice(0, 4)); })
        .catch(() => undefined);   // cancelled or Photon down: places still show
    }, 400) : undefined;
    return () => { clearTimeout(t1); clearTimeout(t2); abort.abort(); };
  }, [query, open, near, value]);

  const pick = (p: FoundPlace) => {
    request.current++;
    saveRecent(p);
    onPick({ lat: p.lat, lng: p.lng }, p.name);
    setQuery(p.name); setPlaces([]); setAddresses([]); setMessage(""); setOpen(false);
  };
  const enter = () => {
    const coords = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(query.trim());
    if (coords) {
      const lat = Number(coords[1]), lng = Number(coords[2]);
      if (lat < 5 || lat > 21 || lng < 97 || lng > 106) { setMessage("Choose a point inside Thailand."); return; }
      pick({ lat, lng, name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, source: "photon" }); return;
    }
    const first = places[0] ?? addresses[0];
    if (first) pick(first);
  };

  const text = query.trim();
  const showRecent = open && text === value;
  const recent = showRecent ? readRecent() : [];
  const row = (p: FoundPlace, i: number, recentRow = false) => {
    const k = p.source === "photon" ? null : kindOf(p.kind, p.category);
    return (
      <li key={`${p.id ?? "a"}-${i}-${p.name}`}>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
          {recentRow ? <span className="result-icon address"><Clock size={15} aria-hidden /></span> : <ResultIcon p={p} />}
          <span className="result-text">
            <b>{p.name}{p.tier === 3 && <span className="chip landmark">Landmark</span>}</b>
            <span className="fine">{k ? k.en : "Address"}{p.distance_m != null && ` · ${formatDistance(p.distance_m)}`}</span>
          </span>
        </button>
      </li>
    );
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
            if (e.key === "Enter") { e.preventDefault(); enter(); }
            if (e.key === "Escape") { setOpen(false); setQuery(value); }
          }} />
        {actions}
      </div>
      {open && (recent.length > 0 || places.length > 0 || addresses.length > 0 || message) && (
        <ul className="place-results" aria-label={`${label} suggestions`}>
          {recent.length > 0 && <li className="results-head fine">Recent</li>}
          {recent.map((p, i) => row(p, i, true))}
          {places.length > 0 && <li className="results-head fine">Places</li>}
          {places.map((p, i) => row(p, i))}
          {addresses.length > 0 && <li className="results-head fine">Addresses</li>}
          {addresses.map((p, i) => row(p, i))}
          {message && <li className="fine msg" role="status">{message}</li>}
        </ul>
      )}
    </div>
  );
}

export const formatDistance = (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
