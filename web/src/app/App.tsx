import { useCallback, useState } from "react";
import { ApiError } from "../lib/supabase";
import { type LatLng, planRoute, type RoutePlan, type RouteStop } from "../lib/api";
import MapView from "./MapView";
import CheckIn from "./CheckIn";
import Passport from "./Passport";

// Real places from the seed: Phu Phan Museum -> Wat Phra That Choeng Chum
const DEFAULT_ORIGIN: LatLng = { lat: 17.17313, lng: 104.14488 };
const DEFAULT_DEST: LatLng = { lat: 17.16445, lng: 104.15345 };

const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
const CATEGORY: Record<string, string> = { cafe: "Café", food: "Food", craft: "Craft shop", temple: "Temple", park: "Park", museum: "Museum", market: "Market", viewpoint: "Viewpoint", art: "Art" };

export default function App() {
  const [tab, setTab] = useState<"plan" | "passport">("plan");
  const [origin, setOrigin] = useState<LatLng | null>(DEFAULT_ORIGIN);
  const [dest, setDest] = useState<LatLng | null>(DEFAULT_DEST);
  const [picking, setPicking] = useState<"origin" | "dest" | null>(null);
  const [start, setStart] = useState(hhmm(Math.max(nowMin(), 9 * 60)));
  const [budget, setBudget] = useState(45);
  const [mode, setMode] = useState<"pedestrian" | "auto">("pedestrian");
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkinStop, setCheckinStop] = useState<RouteStop | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const onPick = useCallback((p: LatLng) => {
    if (picking === "origin") setOrigin(p); else if (picking === "dest") setDest(p);
    setPicking(null);
    setPlan(null);
  }, [picking]);

  const useMyLocation = () => navigator.geolocation.getCurrentPosition(
    (pos) => { setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setPlan(null); },
    () => setError("Location is blocked. Tap the map to set your start instead."),
    { enableHighAccuracy: true, timeout: 10000 });

  const submit = async () => {
    if (!origin || !dest) return;
    setBusy(true); setError("");
    const [h, m] = start.split(":").map(Number);
    try {
      setPlan(await planRoute({ origin, dest, start_min: h * 60 + m, budget_min: budget, mode }));
    } catch (e) {
      setError(e instanceof ApiError && e.code.startsWith("bad_") ? "Pick a start and destination inside Thailand." : "Couldn't plan the route. Try again in a moment.");
    } finally { setBusy(false); }
  };

  const onSelectStop = useCallback((id: number) => {
    setSelected(id);
    document.getElementById(`stop-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">Giggles <span>Maps</span></a>
        <nav className="tabs" aria-label="Sections">
          <button className={tab === "plan" ? "on" : ""} onClick={() => setTab("plan")}>Plan</button>
          <button className={tab === "passport" ? "on" : ""} onClick={() => setTab("passport")}>Passport</button>
        </nav>
      </header>

      <main className="layout">
        <MapView origin={origin} dest={dest} stops={plan?.stops ?? []} geometry={plan?.geometry ?? []}
          picking={picking} onPick={onPick} onSelectStop={onSelectStop} />

        <section className="panel" aria-live="polite">
          {picking && <p className="hint">Tap the map to set your {picking === "origin" ? "start" : "destination"}.</p>}

          {tab === "plan" && (
            <div className="stack">
              <div className="points">
                <div className="point">
                  <span className="pin start static">A</span>
                  <span className="point-label">Start</span>
                  <button className="link" onClick={() => setPicking("origin")}>Set on map</button>
                  <button className="link" onClick={useMyLocation}>Use my location</button>
                </div>
                <div className="point">
                  <span className="pin end static">B</span>
                  <span className="point-label">Destination</span>
                  <button className="link" onClick={() => setPicking("dest")}>Set on map</button>
                </div>
              </div>

              <div className="row fields">
                <label className="field">
                  <span>Leaving at</span>
                  <input id="start-time" type="time" value={start} onChange={(e) => { setStart(e.target.value); setPlan(null); }} />
                </label>
                <div className="field">
                  <span>Getting there by</span>
                  <div className="seg" role="radiogroup" aria-label="Travel mode">
                    <button role="radio" aria-checked={mode === "pedestrian"} className={mode === "pedestrian" ? "on" : ""} onClick={() => { setMode("pedestrian"); setPlan(null); }}>Walk</button>
                    <button role="radio" aria-checked={mode === "auto"} className={mode === "auto" ? "on" : ""} onClick={() => { setMode("auto"); setPlan(null); }}>Drive</button>
                  </div>
                </div>
              </div>

              <label className="field budget">
                <span>Extra time I'm OK with: <strong className="num">+{budget} min</strong></span>
                <input id="budget" type="range" min={0} max={120} step={5} value={budget}
                  onChange={(e) => { setBudget(Number(e.target.value)); setPlan(null); }} />
              </label>

              <button className="btn gold big" onClick={submit} disabled={busy || !origin || !dest}>
                {busy ? "Finding detours…" : "Find my detours"}
              </button>
              {error && <p className="error" role="alert">{error}</p>}

              {plan && (
                <div className="stack">
                  <div className="summary">
                    <div><span className="num big-num">+{plan.extra_min}</span><span className="fine"> of +{plan.budget_min} min used</span></div>
                    <div className="fine">{plan.stops.length} stop{plan.stops.length === 1 ? "" : "s"} · trip {plan.total_min} min instead of {plan.base_min}</div>
                    {plan.routing === "estimate" && <div className="fine">Times are estimates (routing service busy).</div>}
                  </div>
                  {plan.stops.length === 0 && <p className="fine">Nothing fits in +{plan.budget_min} min. Give yourself a bit more time.</p>}
                  <ol className="stops">
                    {plan.stops.map((s, i) => (
                      <li key={s.id} id={`stop-${s.id}`} className={`stop ${selected === s.id ? "sel" : ""}`}>
                        <span className={`pin static ${s.is_partner ? "stop partner" : "stop"}`}>{i + 1}</span>
                        <div className="stop-body">
                          <div className="stop-name">{s.name}</div>
                          {s.name_th && s.name_th !== s.name && <div className="fine">{s.name_th}</div>}
                          <div className="stop-meta">
                            <span className="num">{hhmm(s.eta_min)}</span>
                            <span>{CATEGORY[s.category] ?? s.category}</span>
                            <span>{s.dwell_min} min</span>
                            {s.is_partner && <span className="chip partner" title="Shops pay Giggles Maps when you visit. Example partners have not signed up.">{s.is_demo ? "Example partner" : "Partner"}</span>}
                          </div>
                        </div>
                        <button className="btn small" onClick={() => setCheckinStop(s)}>Check in</button>
                      </li>
                    ))}
                  </ol>
                  {plan.expected_thb > 0 && (
                    <p className="fine biz">Business view: partners on this route pay about <span className="num">฿{plan.expected_thb.toFixed(2)}</span> in expected visit fees.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "passport" && <Passport refreshKey={refreshKey} />}
        </section>
      </main>

      <footer className="attrib fine">
        Places © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · Routing <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noreferrer">Valhalla</a>
      </footer>

      {checkinStop && (
        <CheckIn stop={checkinStop} onClose={() => setCheckinStop(null)} onDone={() => setRefreshKey((k) => k + 1)} />
      )}
    </div>
  );
}
