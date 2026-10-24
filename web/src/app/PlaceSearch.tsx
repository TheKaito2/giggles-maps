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
// Photon asks for fair use: 3+ characters, a 300 ms pause, and the previous request is cancelled.
/** "17.16, 104.14" typed into the search box. */
const parseLatLng = (text: string) => {
  const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(text);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
};

export default function PlaceSearch({ label, value, pin, near, onPick, actions, footer }: {
  label: string; value: string; pin: ReactNode; near?: LatLng | null;
  onPick: (point: LatLng, name: string) => void; actions?: ReactNode;
  footer?: ReactNode;   // last rows of the open list, e.g. "Pick on the map", "Add a missing place"
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [places, setPlaces] = useState<FoundPlace[]>([]);
  const [addresses, setAddresses] = useState<FoundPlace[]>([]);
  const [message, setMessage] = useState("");
  // the text both searches (places, addresses) have answered for: when both found nothing, say so instead of an empty list
  const [settled, setSettled] = useState({ places: "", addresses: "" });
  const request = useRef(0);
  useEffect(() => setQuery(value), [value]);

  // Search as you type, like every map app: each letter asks again, and an answer shows as soon as it's newer than
  // the one on screen (waiting for the very latest showed nothing while you kept typing). Earlier answers are cached,
  // so backspacing is instant.
  const shown = useRef({ places: 0, addresses: 0 });
  const cache = useRef(new Map<string, FoundPlace[]>());
  useEffect(() => {
    const text = query.trim();
    if (!open || text.length < 2 || text === value) { request.current++; setPlaces([]); setAddresses([]); return; }   // drop late replies
    const coords = parseLatLng(text);
    if (coords) { setPlaces([]); setAddresses([]); return; }
    const id = ++request.current;
    const key = `${text.toLowerCase()}|${near?.lat?.toFixed(2)},${near?.lng?.toFixed(2)}`;
    const hit = cache.current.get(key);
    if (hit) { shown.current.places = id; setPlaces(hit); setMessage(""); }
    const abort = new AbortController();
    const t1 = hit ? undefined : setTimeout(() => {
      searchPlaces(text, near).then((r) => {
        cache.current.set(key, r.slice(0, 6));
        if (id > shown.current.places && id <= request.current) { shown.current.places = id; setPlaces(r.slice(0, 6)); setMessage(""); }
        if (id === request.current) setSettled((x) => ({ ...x, places: text }));
      }).catch(() => { if (id === request.current) setMessage("Search is unavailable. Pick on the map instead."); });
    }, 100);
    // addresses (Photon, fair use): 3+ letters, a short pause, the previous request cancelled
    const t2 = text.length >= 3 ? setTimeout(() => {
      searchAddresses(text, near, abort.signal).then((r) => {
        if (id > shown.current.addresses && id <= request.current) { shown.current.addresses = id; setAddresses(r.slice(0, 4)); }
        if (id === request.current) setSettled((x) => ({ ...x, addresses: text }));
      }).catch(() => undefined);   // cancelled or Photon down: places still show
    }, 300) : undefined;
    return () => { clearTimeout(t1); clearTimeout(t2); abort.abort(); };
  }, [query, open, near?.lat, near?.lng, value]); // eslint-disable-line react-hooks/exhaustive-deps -- near by value: a GPS fix is a new object

  const pick = (p: FoundPlace) => {
    request.current++;
    saveRecent(p);
    onPick({ lat: p.lat, lng: p.lng }, p.name);
    setQuery(p.name); setPlaces([]); setAddresses([]); setMessage(""); setOpen(false);
  };
  const enter = () => {
    const coords = parseLatLng(query.trim());
    if (coords) {
      const { lat, lng } = coords;
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

  const typed = query.trim();
  const nothing = typed.length >= 2 && typed !== value && !places.length && !addresses.length && settled.places === typed
    && (typed.length < 3 || settled.addresses === typed);

  return (
    <div className="place-field">
      <div className="place-row">
        {pin}
        <input value={query} maxLength={100} aria-label={label} placeholder={label}
          onFocus={(e) => { setOpen(true); e.target.select(); }}
          onBlur={(e) => {
            // Tab into a suggestion keeps the list open; leaving the field closes it
            if (e.relatedTarget && e.currentTarget.closest(".place-field")?.contains(e.relatedTarget as Node)) return;
            setTimeout(() => { setOpen(false); setQuery((q) => q.trim() ? q : value); }, 150);
          }}
          onChange={(e) => { setQuery(e.target.value); setMessage(""); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); enter(); }
            if (e.key === "Escape") { setOpen(false); setQuery(value); }
          }} />
        {actions}
      </div>
      {open && (recent.length > 0 || places.length > 0 || addresses.length > 0 || message || footer || nothing) && (
        <ul className="place-results" aria-label={`${label} suggestions`}>
          {recent.length > 0 && <li className="results-head fine">Recent</li>}
          {recent.map((p, i) => row(p, i, true))}
          {places.length > 0 && <li className="results-head fine">Places</li>}
          {places.map((p, i) => row(p, i))}
          {addresses.length > 0 && <li className="results-head fine">Addresses</li>}
          {addresses.map((p, i) => row(p, i))}
          {message && <li className="fine msg" role="status">{message}</li>}
          {nothing && !message && <li className="fine msg" role="status">Nothing found for “{query.trim()}”. Try another spelling, or pick it on the map.</li>}
          {footer}
        </ul>
      )}
    </div>
  );
}

export const formatDistance = (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
