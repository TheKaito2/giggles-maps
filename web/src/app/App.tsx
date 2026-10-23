import { useCallback, useEffect, useRef, useState } from "react";
import { Leaf, MapPin } from "lucide-react";
import { ApiError, ensureSession, supabase } from "../lib/supabase";
import { type CheckinTarget, choosePlan, getProfile, type LatLng, planRoute, type Profile, readScanParam, type RoutePlan } from "../lib/api";
import MapView from "./MapView";
import CheckIn from "./CheckIn";
import Passport from "./Passport";
import Planner from "./Planner";
import Results from "./Results";
import { Hero, Summary } from "./AdventureCard";
import { DEFAULT_PREFS, type Place, type Prefs, toRequest } from "./prefs";
import { resumeSignIn } from "../lib/auth";

// Real places from the seed: Phu Phan Museum -> Wat Phra That Choeng Chum
const DEFAULT_ORIGIN: Place = { point: { lat: 17.17313, lng: 104.14488 }, name: "Phu Phan Museum" };
const DEFAULT_DEST: Place = { point: { lat: 17.16445, lng: 104.15345 }, name: "Wat Phra That Choeng Chum" };

export default function App() {
  const [tab, setTab] = useState<"plan" | "passport">("plan");
  const [origin, setOrigin] = useState<Place | null>(DEFAULT_ORIGIN);
  const [dest, setDest] = useState<Place | null>(DEFAULT_DEST);
  const [picking, setPicking] = useState<"origin" | "dest" | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [response, setPlan] = useState<RoutePlan | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const plan = response && choosePlan(response, choice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkin, setCheckin] = useState<{ target: CheckinTarget; code?: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);

  // any change to the trip drops the old result and cancels a request in flight
  const routeRequest = useRef(0);
  useEffect(() => { routeRequest.current++; setBusy(false); setPlan(null); }, [origin, dest, prefs]);
  const set = (patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) =>
    setPrefs((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));

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

  const onPick = useCallback((point: LatLng) => {
    const place = { point, name: `Pin at ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}` };
    if (picking === "origin") setOrigin(place); else if (picking === "dest") setDest(place);
    setPicking(null);
  }, [picking]);

  const useMyLocation = () => navigator.geolocation.getCurrentPosition(
    (pos) => setOrigin({ point: { lat: pos.coords.latitude, lng: pos.coords.longitude }, name: "My location" }),
    () => setError("Location is blocked. Search for a place or set your start on the map instead."),
    { enableHighAccuracy: true, timeout: 10000 });

  const submit = async () => {
    if (!origin || !dest) return;
    const requestId = ++routeRequest.current;
    setBusy(true); setError(""); setPlan(null);
    try {
      const result = await planRoute(toRequest(prefs, origin.point, dest.point));
      if (requestId !== routeRequest.current) return;
      setChoice(null); setPlan(result);
      requestAnimationFrame(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      if (requestId !== routeRequest.current) return;
      const code = e instanceof ApiError ? e.code : "";
      setError(code === "routing_unavailable" ? "Couldn't find a road route. Try a nearby road pin, another way to travel, or retry shortly."
        : code.startsWith("bad_") ? "Pick a start and destination inside Thailand." : "Couldn't plan the route. Try again in a moment.");
    } finally { if (requestId === routeRequest.current) setBusy(false); }
  };

  const onSelectStop = useCallback((id: number) => {
    setSelected(id);
    document.getElementById(`stop-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const showMap = !!picking || !!plan;
  return (
    <div className="page-shell">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden><MapPin size={18} /></span>giggles <span>maps</span></a>
        <nav className="tabs" aria-label="Sections">
          <button className={tab === "plan" ? "on" : ""} onClick={() => setTab("plan")}>Plan</button>
          <button className={tab === "passport" ? "on" : ""} onClick={() => setTab("passport")}>Passport{profile?.plusUntil && <span className="plus-dot">Plus</span>}</button>
        </nav>
      </header>

      <main className="page">
        {tab === "plan" ? (
          <>
            <div className="page-head">
              <p className="crumb fine"><MapPin size={14} aria-hidden /> Sakon Nakhon, Thailand <span aria-hidden>/</span> Your next little adventure</p>
              <h1>Plan your detour</h1>
              <p className="muted">Discover something worth the extra time.</p>
            </div>
            <div className="cols">
              <Planner prefs={prefs} set={set} origin={origin} dest={dest} setOrigin={setOrigin} setDest={setDest}
                swap={() => { setOrigin(dest); setDest(origin); }} pickOnMap={setPicking} useMyLocation={useMyLocation} />
              <aside className="side" aria-live="polite">
                {showMap ? (
                  <div className="glass map-card">
                    {picking && <p className="hint">Tap the map to set your {picking === "origin" ? "start" : "destination"}. <button className="link" onClick={() => setPicking(null)}>Cancel</button></p>}
                    <MapView origin={origin?.point ?? null} dest={dest?.point ?? null} stops={plan?.stops ?? []} geometry={plan?.geometry ?? []}
                      baseGeometry={plan?.base_geometry} estimated={plan?.routing === "estimate"} picking={picking} onPick={onPick} onSelectStop={onSelectStop} />
                  </div>
                ) : <Hero />}
                {response && plan && (
                  <div className="glass results-card" id="results">
                    <Results response={response} plan={plan} choice={choice} setChoice={setChoice} selected={selected}
                      onCheckin={(target) => setCheckin({ target })} />
                  </div>
                )}
                <Summary prefs={prefs} origin={origin} dest={dest} busy={busy} error={error} hasPlan={!!plan}
                  onFind={submit} onReset={() => { setPrefs(DEFAULT_PREFS); setOrigin(DEFAULT_ORIGIN); setDest(DEFAULT_DEST); }} />
                <p className="fine aside-note"><Leaf size={16} aria-hidden /> The best bits aren't always on the way. Leave a little room for local flavours, quiet corners and happy discoveries.</p>
              </aside>
            </div>
          </>
        ) : (
          <div className="glass passport-wrap">
            <Passport refreshKey={refreshKey} profile={profile} onChange={() => setRefreshKey((k) => k + 1)} />
          </div>
        )}
      </main>

      <footer className="attrib fine">
        <span>Giggles Maps · Made for the curious.</span>
        <span>Places © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · Routing <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noreferrer">Valhalla</a></span>
      </footer>

      {checkin && (
        <CheckIn target={checkin.target} initialCode={checkin.code} hasPlus={!!profile?.plusUntil} onClose={() => setCheckin(null)} onDone={() => setRefreshKey((k) => k + 1)} />
      )}
    </div>
  );
}
