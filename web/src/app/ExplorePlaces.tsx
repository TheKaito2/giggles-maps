import { useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { type FoundPlace, type Kind, type LatLng, searchPlaces } from "../lib/api";
import { formatDistance } from "./PlaceSearch";
import { kindOf } from "./kinds";
import type { Pick } from "./prefs";

const KINDS: { id: Kind | null; label: string }[] = [
  { id: null, label: "All" }, { id: "food", label: "Food" }, { id: "cafes", label: "Cafés" },
  { id: "culture", label: "Culture" }, { id: "nature", label: "Nature" }, { id: "shopping", label: "Shopping" },
];
const MAX_PICKS = 3;

/** "Places you want to visit": search our places by name or kind near the start, and add up to 3 as stops. */
export default function ExplorePlaces({ near, picks, setPicks }: { near: LatLng | null; picks: Pick[]; setPicks: (p: Pick[]) => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const [results, setResults] = useState<FoundPlace[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const search = async (k = kind) => {
    const text = query.trim();
    if (text.length < 2 && !k) { setMessage("Type a name (e.g. waterfall, วัด) or pick a kind."); return; }
    setBusy(true); setMessage("");
    try {
      const found = await searchPlaces(text, near, k);
      setResults(found);
      if (!found.length) setMessage(text ? "No places match that name nearby." : "None of that kind within 30 km of your start.");
    } catch { setMessage("Search is unavailable right now. Try again in a moment."); }
    finally { setBusy(false); }
  };
  const add = (p: FoundPlace) => p.id != null && setPicks([...picks, { id: p.id, name: p.name }]);

  return (
    <div className="explore">
      <div className="explore-bar">
        <span className="input-icon"><Search size={16} aria-hidden />
          <input value={query} maxLength={100} placeholder="Search places, e.g. waterfall, cafe, วัด" aria-label="Search places to visit"
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} />
        </span>
        <button type="button" className="btn small soft" disabled={busy} onClick={() => search()}>{busy ? "Searching…" : "Search"}</button>
      </div>
      <div className="row tight" role="radiogroup" aria-label="Kind of place">
        {KINDS.map((k) => (
          <button key={k.label} type="button" role="radio" aria-checked={kind === k.id} className={`pill ${kind === k.id ? "on" : ""}`}
            onClick={() => { setKind(k.id); if (k.id || query.trim().length >= 2) void search(k.id); }}>{k.label}</button>
        ))}
      </div>
      {message && <p className="fine" role="status">{message}</p>}
      {!!results.length && (
        <ul className="explore-results">
          {results.map((p) => {
            const added = picks.some((x) => x.id === p.id);
            return (
              <li key={p.id}>
                <div className="explore-name">
                  <b>{p.name}{p.tier === 3 && <span className="chip landmark">Landmark</span>}</b>
                  <span className="fine">{kindOf(null, p.category).en}
                    {p.rating != null ? ` · ★ ${p.rating.toFixed(1)}` : " · Unrated"}
                    {p.distance_m != null && ` · ${formatDistance(p.distance_m)}`}</span>
                </div>
                <button type="button" className="btn small soft" disabled={added || picks.length >= MAX_PICKS} onClick={() => add(p)}>
                  {added ? "Added" : <><Plus size={14} aria-hidden /> Add</>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {picks.length > 0 && (
        <div className="row tight picks" aria-label="Places you picked">
          {picks.map((p) => (
            <span key={p.id} className="tag picked">{p.name}
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPicks(picks.filter((x) => x.id !== p.id))}><X size={12} aria-hidden /></button>
            </span>
          ))}
        </div>
      )}
      <p className="fine">Up to {MAX_PICKS} places. They go into every plan when they fit your time.</p>
    </div>
  );
}
