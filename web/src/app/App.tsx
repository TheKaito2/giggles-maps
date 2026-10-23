import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, ensureSession, supabase } from "../lib/supabase";
import { type CheckinTarget, getProfile, KIND_NAME, type LatLng, planRoute, type Profile, readScanParam, type RoutePlan } from "../lib/api";
import MapView from "./MapView";
import CheckIn from "./CheckIn";
import Passport from "./Passport";
import PlaceSearch from "./PlaceSearch";
import { resumeSignIn } from "../lib/auth";

// Real places from the seed: Phu Phan Museum -> Wat Phra That Choeng Chum
const DEFAULT_ORIGIN: LatLng = { lat: 17.17313, lng: 104.14488 };
const DEFAULT_DEST: LatLng = { lat: 17.16445, lng: 104.15345 };
const MAX_BUDGET = 240; // v4: the same for everyone

const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
const CATEGORY: Record<string, string> = { cafe: "Café", food: "Food", craft: "Craft shop", temple: "Temple", park: "Park", museum: "Museum", market: "Market", viewpoint: "Viewpoint", art: "Art" };
const PARTNER_TIP = "This shop pays Giggles Maps when you visit. It's ranked like every other place; paying never moves it up.";

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
  const [checkin, setCheckin] = useState<{ target: CheckinTarget; code?: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);

  const routeRequest = useRef(0);
  useEffect(() => { routeRequest.current++; setBusy(false); }, [origin, dest, start, budget, mode]);

  useEffect(() => { getProfile().then(setProfile).catch(() => setProfile(null)); }, [refreshKey]);
  // back from Google/Apple: finish sign-in if linking to the guest account wasn't possible
  useEffect(() => { resumeSignIn().then((m) => { if (m) { setError(m); setTab("passport"); } }); }, []);

  // QR sticker at a shop counter opens /app/?scan=<place>-<code> straight into check-in
  useEffect(() => {
    const scan = readScanParam();
    if (!scan) return;
    (async () => {
      await ensureSession();
      const { data } = await supabase.rpc("place_for_checkin", { p_id: scan.placeId });
      const place = (data as CheckinTarget[] | null)?.[0];
      if (!place) return;
      setCheckin({ target: place, code: scan.code });
      history.replaceState(null, "", location.pathname);
    })().catch(() => setError("Couldn't open that shop's check-in. Try scanning again."));
  }, []);

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
    const requestId = ++routeRequest.current;
    setBusy(true); setError(""); setPlan(null);
    const [h, m] = start.split(":").map(Number);
    try {
      const result = await planRoute({ origin, dest, start_min: h * 60 + m, budget_min: Math.min(budget, MAX_BUDGET), mode });
      if (requestId === routeRequest.current) setPlan(result);
    } catch (e) {
      if (requestId !== routeRequest.current) return;
      const code = e instanceof ApiError ? e.code : "";
      setError(code === "routing_unavailable" ? "Couldn't find a road route. Try a nearby road pin, check Walk/Drive, or retry shortly."
        : code.startsWith("bad_") ? "Pick a start and destination inside Thailand." : "Couldn't plan the route. Try again in a moment.");
    } finally { if (requestId === routeRequest.current) setBusy(false); }
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
          <button className={tab === "passport" ? "on" : ""} onClick={() => setTab("passport")}>Passport{profile?.plusUntil && <span className="plus-dot">Plus</span>}</button>
        </nav>
      </header>

      <main className="layout">
        <MapView origin={origin} dest={dest} stops={plan?.stops ?? []} geometry={plan?.geometry ?? []}
          baseGeometry={plan?.base_geometry} estimated={plan?.routing === "estimate"} picking={picking} onPick={onPick} onSelectStop={onSelectStop} />

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

              <PlaceSearch label="Start" point={origin} onPick={(p) => { setOrigin(p); setPicking(null); setPlan(null); }} />
              <PlaceSearch label="Destination" point={dest} onPick={(p) => { setDest(p); setPicking(null); setPlan(null); }} />

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
                <span>Extra time I'm OK with: <strong className="num">+{Math.min(budget, MAX_BUDGET)} min</strong></span>
                <input id="budget" type="range" min={0} max={MAX_BUDGET} step={5} value={Math.min(budget, MAX_BUDGET)}
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
                    {plan.routing === "estimate" && <div className="fine" role="status">Routing is unavailable. The dashed line is an approximate walking connection, not road directions. Times and your allowance are checked using estimates.</div>}
                    {plan.stops.length > 0 && !!plan.base_geometry?.length && <div className="fine">Dashed grey: direct road route · Indigo: your detour. Both end at your destination.</div>}
                    {plan.warnings?.some((w) => w !== "estimated_local_walk") && <div className="fine" role="status">Some stops were adjusted or couldn't be checked. Retry to explore more detours.</div>}
                  </div>
                  {plan.stops.length === 0 && <p className="fine">No available stops fit +{plan.budget_min} min; place coverage varies by area.</p>}
                  <ol className="stops">
                    {plan.stops.map((s, i) => (
                      <li key={s.id} id={`stop-${s.id}`} className="stop-item">
                        <div className={`stop ${selected === s.id ? "sel" : ""} ${s.is_partner ? "is-partner" : ""}`}>
                          <span className={`pin static ${s.is_partner ? "stop partner" : "stop"}`}>{i + 1}</span>
                          <div className="stop-body">
                            <div className="stop-name">{s.name}</div>
                            {s.name_th && s.name_th !== s.name && <div className="fine">{s.name_th}</div>}
                            <div className="stop-meta">
                              <span className="num">{hhmm(s.eta_min)}</span>
                              <span>{CATEGORY[s.category] ?? s.category}</span>
                              <span>{s.dwell_min} min</span>
                              {s.is_partner && <span className="chip partner" title={PARTNER_TIP}>{s.is_demo ? "Example partner" : "Partner"}</span>}
                              {!!s.min_level && s.exclusive_kind && <span className="chip exclusive">{KIND_NAME[s.exclusive_kind]} · Level {s.min_level}</span>}
                            </div>
                            {!!s.min_level && s.perk_text && <div className="fine">{s.perk_text}</div>}
                          </div>
                          <button className="btn small" onClick={() => setCheckin({ target: s })}>Check in</button>
                        </div>
                        {s.nearby_partner && (
                          <div className="near-card">
                            <span className="near-label">Near this spot</span>
                            <span className="near-name">{s.nearby_partner.name}</span>
                            <span className="fine num">{s.nearby_partner.distance_m} m</span>
                            {!!s.nearby_partner.min_level && s.nearby_partner.exclusive_kind && <span className="chip exclusive">{KIND_NAME[s.nearby_partner.exclusive_kind]} · Level {s.nearby_partner.min_level}</span>}
                            {s.nearby_partner.is_partner && <span className="chip partner" title={PARTNER_TIP}>{s.nearby_partner.is_demo ? "Example partner" : "Partner"}</span>}
                            <button className="link" onClick={() => setCheckin({ target: s.nearby_partner! })}>Check in</button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                  <p className="fine">Stops are picked on quality only. Partner shops rank like everyone else.</p>
                </div>
              )}
            </div>
          )}

          {tab === "passport" && <Passport refreshKey={refreshKey} profile={profile} onChange={() => setRefreshKey((k) => k + 1)} />}
        </section>
      </main>

      <footer className="attrib fine">
        Places © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · Routing <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noreferrer">Valhalla</a>
      </footer>

      {checkin && (
        <CheckIn target={checkin.target} initialCode={checkin.code} hasPlus={!!profile?.plusUntil} onClose={() => setCheckin(null)} onDone={() => setRefreshKey((k) => k + 1)} />
      )}
    </div>
  );
}
