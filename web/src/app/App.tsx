import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bell, Camera, Car, Coins, LocateFixed, Map as MapIcon, MapPin, Navigation, Plus, Swords, Trophy, UserRound, X } from "lucide-react";
import { ApiError, ensureSession, supabase } from "../lib/supabase";
import { addFriend, type CheckinTarget, choosePlan, getProfile, type LatLng, planRoute, type Profile, readCodeParam, readScanParam, type RoutePlan } from "../lib/api";
import MapView from "./MapView";
import CheckIn from "./CheckIn";
import Planner from "./Planner";
import Results from "./Results";
import { budgetLabel, DEFAULT_PREFS, departLabel, MODES, type Place, type Prefs, toRequest } from "./prefs";
import { resumeSignIn } from "../lib/auth";
import { useStops } from "./useStops";
import Nickname from "./social/Nickname";
import RideAlong, { useTrip } from "./social/RideAlong";
import Leaderboard from "./Leaderboard";
import Quests from "./Quests";
import Feed from "./Feed";
import ProfileTab from "./Profile";
import Shop from "./passport/Shop";
import AvatarBuilder from "./avatar/AvatarBuilder";
import { levelFor, levelProgress } from "../lib/api";
import PlaceSheet from "./PlaceSheet";
import AddPlace from "./AddPlace";
import Navigate, { type Waypoint } from "./nav/Navigate";
import EtaView from "./nav/EtaView";
import LayersButton from "./LayersButton";
import { loadLook, type MapLook, saveLook } from "./mapLayers";
import ExploreChips, { CHIPS } from "./ExploreChips";


type Tab = "map" | "board" | "quests" | "feed" | "profile";
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "map", label: "Map", icon: <MapIcon size={24} /> }, { id: "board", label: "Leaderboard", icon: <Trophy size={24} /> },
  { id: "quests", label: "Quests", icon: <Swords size={24} /> }, { id: "feed", label: "Feed", icon: <Bell size={24} /> },
  { id: "profile", label: "Profile", icon: <UserRound size={24} /> },
];

// Real places from the seed: Phu Phan Museum -> Wat Phra That Choeng Chum
const DEFAULT_ORIGIN: Place = { point: { lat: 17.17313, lng: 104.14488 }, name: "Phu Phan Museum" };
const DEFAULT_DEST: Place = { point: { lat: 17.16445, lng: 104.15345 }, name: "Wat Phra That Choeng Chum" };

// shared empty arrays: a fresh [] each render would make the map refit the route on every position update
const NONE: never[] = [];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => readCodeParam("friend") ? "profile" : "map");
  const [friend, setFriend] = useState<string | null>(null);   // a friend's profile open in the Profile tab
  const [overlay, setOverlay] = useState<"shop" | "avatar" | "ride" | "add" | null>(() => readCodeParam("trip") ? "ride" : null);
  const [origin, setOrigin] = useState<Place | null>(DEFAULT_ORIGIN);
  const [dest, setDest] = useState<Place | null>(DEFAULT_DEST);
  const [chip, setChip] = useState<string | null>(null);
  const [nav, setNav] = useState<Waypoint[] | null>(null);   // turn-by-turn running
  const [look, setLookState] = useState<MapLook>(loadLook);   // map type + night map, remembered on this device
  const setLook = (patch: Partial<MapLook>) => setLookState((l) => { const next = { ...l, ...patch }; saveLook(next); return next; });
  const [etaToken, setEtaToken] = useState(() => {
    const t = /^[0-9a-f]{32}$/.exec(new URLSearchParams(location.search).get("eta") ?? "")?.[0] ?? null;
    if (t) history.replaceState(null, "", location.pathname);   // keep the link out of history and referrers
    return t;
  });
  // the place page open on the map: a tapped pin, a saved place, or a shared /app/?place=ID link
  const [place, setPlace] = useState<number | null>(() => Number(new URLSearchParams(location.search).get("place")) || null);
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
  const [view, setView] = useState<"plan" | "results">("plan");

  // any change to the trip drops the old result and cancels a request in flight
  const routeRequest = useRef(0);
  useEffect(() => { routeRequest.current++; setBusy(false); setPlan(null); }, [origin, dest, prefs]);
  const set = (patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) =>
    setPrefs((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));

  useEffect(() => { getProfile().then(setProfile).catch(() => setProfile(null)); }, [refreshKey]);
  const nearby = useStops(refreshKey);
  const zoneStop = nearby.inZone[0];
  const trip = useTrip(nearby.here, nearby.start, refreshKey);
  const [nameSheet, setNameSheet] = useState(false);
  const [nameLater, setNameLater] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingFriend, setPendingFriend] = useState(() => readCodeParam("friend"));

  // ride-along QR: /app/?trip=CODE joins straight away
  useEffect(() => {
    const code = readCodeParam("trip");
    if (!code) return;
    history.replaceState(null, "", location.pathname);
    trip.join(code);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // friend QR: /app/?friend=CODE adds them once you have a name (they see it on the request)
  useEffect(() => {
    if (!pendingFriend || !profile?.nickname) return;
    history.replaceState(null, "", location.pathname);
    setPendingFriend(null);
    addFriend(pendingFriend)
      .then((r) => setNotice(r === "friends" ? "You're friends now." : "Friend request sent."))
      .catch(() => setNotice("Couldn't add that friend code. It may be your own or mistyped."));
  }, [pendingFriend, profile?.nickname]);
  // back from Google/Apple: finish sign-in if linking to the guest account wasn't possible
  useEffect(() => { resumeSignIn().then((m) => { if (m) { setNotice(m); setTab("profile"); } }); }, []);

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
    () => setError("Location is blocked. Search for a place or pick your start on the map instead."),
    { enableHighAccuracy: true, timeout: 10000 });

  const submit = async () => {
    if (!origin || !dest) return;
    const requestId = ++routeRequest.current;
    setBusy(true); setError(""); setPlan(null);
    try {
      const result = await planRoute(toRequest(prefs, origin.point, dest.point));
      if (requestId !== routeRequest.current) return;
      setChoice(null); setPlan(result); setView("results");
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

  const tripLine = `${prefs.budget === "auto" ? (plan ? `+${budgetLabel(plan.budget_min)} (auto)` : "auto extra time") : `+${budgetLabel(prefs.budget)}`} · ${MODES.find((m) => m.id === prefs.mode)!.label.toLowerCase()} · leaves ${departLabel(prefs)}`
    + (prefs.meals.length ? ` · ${prefs.meals.join(" & ")}` : "");
  const showResults = view === "results" && response && plan;
  const refresh = () => setRefreshKey((k) => k + 1);
  const level = levelFor(profile?.xp ?? 0);
  const { into, span } = levelProgress(profile?.xp ?? 0);
  return (
    <div className={`app-shell tab-${tab}`}>
      <nav className="tabbar" aria-label="Sections">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden><MapPin size={18} /></span><span className="brand-word">giggles <span>maps</span></span></a>
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? "on" : ""} aria-current={tab === t.id ? "page" : undefined}
            onClick={() => { setTab(t.id); if (t.id === "profile") setFriend(null); }}>
            {t.icon}<span>{t.label}</span>
          </button>
        ))}
      </nav>
      <header className="topbar">
        <a className="brand mobile-only" href="/"><span className="brand-mark" aria-hidden><MapPin size={16} /></span></a>
        <div className="stat-chips">
          <button type="button" className="stat-chip level" onClick={() => setTab("profile")} aria-label={`Level ${level}, ${profile?.xp ?? 0} XP`}
            style={{ ["--p" as string]: span ? into / span : 1 }}><span className="ring"><b>{level}</b></span><span className="num">{profile?.xp ?? 0} XP</span></button>
          <button type="button" className="stat-chip provinces" onClick={() => setTab("profile")} aria-label={`${profile?.provinces ?? 0} of 77 provinces`}>
            <MapIcon size={18} aria-hidden /><span className="num">{profile?.provinces ?? 0}/77</span></button>
          <button type="button" className="stat-chip coins" onClick={() => setOverlay("shop")} aria-label={`${profile?.coins ?? 0} coins, open the shop`}>
            <Coins size={18} aria-hidden /><span className="num">{profile?.coins ?? 0}</span></button>
        </div>
      </header>

      {notice && <p className="hint toast" role="status">{notice}<button type="button" className="icon-btn" onClick={() => setNotice("")} aria-label="Dismiss"><X size={16} /></button></p>}
      {tab === "map" ? (
        <main className="workspace">
          <div className="map-pane">
            {picking && (
              <p className="map-banner">Tap the map to set your {picking === "origin" ? "start" : "destination"}.
                <button className="link" onClick={() => setPicking(null)}>Cancel</button></p>
            )}
            <MapView origin={origin?.point ?? null} dest={dest?.point ?? null} stops={showResults ? plan.stops : NONE} geometry={showResults ? plan.geometry : NONE}
              baseGeometry={showResults ? plan.base_geometry : NONE} estimated={plan?.routing === "estimate"} picking={picking} onPick={onPick} onSelectStop={onSelectStop}
              nearby={nearby.stops} here={nearby.here} inZone={nearby.inZone.map((s) => s.id)}
              members={trip.trip?.members ?? NONE} skin={profile?.look.map ?? "liberty"} look={look}
              kinds={CHIPS.find((c) => c.id === chip)?.kinds ?? null} onPlace={(p) => setPlace(p.id)} />
            <ExploreChips active={chip} onPick={setChip} />
            <LayersButton look={look} setLook={setLook} />
            <button type="button" className="btn soft small add-place-fab" onClick={() => setOverlay("add")}><Plus size={15} aria-hidden /> Add place</button>
            {place && <PlaceSheet id={place} onClose={() => setPlace(null)}
              onDirections={(p) => { setDest({ point: { lat: p.lat, lng: p.lng }, name: p.name }); setPlace(null); setView("plan"); }}
              onCheckin={(p) => setCheckin({ target: { id: p.id, name: p.name, lat: p.lat, lng: p.lng, is_partner: false, is_demo: false } })} />}
            <button type="button" className={`btn soft small trip-chip${trip.trip ? " live" : ""}`} onClick={() => setOverlay("ride")}>
              <Car size={16} aria-hidden /> {trip.trip ? `Ride along · ${trip.trip.members.length}` : "Ride along"}
            </button>
            <div className="map-actions">
              {zoneStop ? (
                <button type="button" className={`btn checkin-cta tier-${zoneStop.tier}`}
                  onClick={() => setCheckin({ target: { id: zoneStop.id, name: zoneStop.name, lat: zoneStop.lat, lng: zoneStop.lng, is_partner: false, is_demo: false } })}>
                  <Camera size={18} aria-hidden /> {zoneStop.stamped ? "Add a photo at" : "Check in at"} {zoneStop.name}
                </button>
              ) : !nearby.watching && (
                <button type="button" className="btn soft" onClick={nearby.start}><LocateFixed size={16} aria-hidden /> Show stops near me</button>
              )}
            </div>
          </div>

          <section className="panel glass" aria-live="polite">
            {showResults ? (
              <>
                <div className="panel-head">
                  <div className="row between">
                    <button type="button" className="link" onClick={() => setView("plan")}><ArrowLeft size={16} aria-hidden /> Edit trip</button>
                    <button type="button" className="btn small" onClick={() => setNav([...plan.stops.map((st) => ({ lat: st.lat, lng: st.lng, name: st.name })),
                      { ...dest!.point, name: dest!.name }])}><Navigation size={15} aria-hidden /> Start</button>
                  </div>
                  <p className="trip-title"><span><b>{origin?.name}</b> → <b>{dest?.name}</b></span><span className="fine">{tripLine}</span></p>
                </div>
                <div className="panel-body">
                  <Results response={response} plan={plan} choice={choice} setChoice={setChoice} selected={selected}
                    onCheckin={(target) => setCheckin({ target })} picks={prefs.picks} />
                </div>
              </>
            ) : (
              <>
                <div className="panel-body">
                  <h1 className="panel-title">Plan your detour</h1>
                  <Planner prefs={prefs} set={set} origin={origin} dest={dest} setOrigin={setOrigin} setDest={setDest}
                    swap={() => { setOrigin(dest); setDest(origin); }} pickOnMap={setPicking} useMyLocation={useMyLocation} />
                </div>
                <div className="panel-foot">
                  {error && <p className="error" role="alert">{error}</p>}
                  {plan && !busy && <button type="button" className="link" onClick={() => setView("results")}>Back to your plans <ArrowRight size={14} aria-hidden /></button>}
                  <button type="button" className="btn big find" onClick={submit} disabled={busy || !origin || !dest}>
                    {busy ? "Finding your detour…" : "Find my detour"}
                  </button>
                  <p className="fine center">{tripLine}</p>
                </div>
              </>
            )}
          </section>
        </main>
      ) : (
        <main className="page-view">
          {tab === "board" && <Leaderboard profile={profile} onChange={refresh} />}
          {tab === "quests" && <Quests profile={profile} refreshKey={refreshKey} onChange={refresh} />}
          {tab === "feed" && <Feed profile={profile} refreshKey={refreshKey} openFriend={(id) => { setFriend(id); setTab("profile"); }} goProfile={() => { setFriend(null); setTab("profile"); }} openPlace={(id) => { setPlace(id); setTab("map"); }} />}
          {tab === "profile" && <ProfileTab profile={profile} refreshKey={refreshKey} onChange={refresh} friend={friend} setFriend={setFriend}
            editAvatar={() => setOverlay("avatar")} editName={() => setNameSheet(true)}
            openPlace={(id) => { setPlace(id); setTab("map"); }} />}
        </main>
      )}

      {overlay === "shop" && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Shop" onClick={(e) => { if (e.target === e.currentTarget) setOverlay(null); }}>
          <div className="modal shop-modal">
            <header className="modal-head"><h2>Shop</h2><button type="button" className="icon-btn" onClick={() => setOverlay(null)} aria-label="Close"><X size={20} /></button></header>
            <Shop profile={profile} coins={profile?.coins ?? 0} onChange={refresh} onAvatar={() => setOverlay("avatar")} />
          </div>
        </div>
      )}
      {overlay === "add" && <AddPlace onClose={() => setOverlay(null)} />}
      {nav && <Navigate waypoints={nav} mode={prefs.mode} onClose={() => setNav(null)} />}
      {etaToken && <EtaView token={etaToken} onClose={() => setEtaToken(null)} />}
      {overlay === "avatar" && profile && <AvatarBuilder profile={profile} onClose={() => setOverlay(null)} onSaved={() => { setOverlay(null); refresh(); }} />}
      {overlay === "ride" && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Ride along" onClick={(e) => { if (e.target === e.currentTarget) setOverlay(null); }}>
          <div className="modal">
            <header className="modal-head"><h2>Ride along</h2><button type="button" className="icon-btn" onClick={() => setOverlay(null)} aria-label="Close"><X size={20} /></button></header>
            <RideAlong trip={trip} profile={profile} />
          </div>
        </div>
      )}

      {profile && (nameSheet || (tab !== "map" && !profile.nickname && !nameLater)) && (
        <Nickname current={profile.nickname} colour={profile.colour}
          onDone={() => { setNameSheet(false); refresh(); }}
          onLater={() => { setNameSheet(false); setNameLater(true); }} />
      )}

      {checkin && (
        <CheckIn target={checkin.target} initialCode={checkin.code} hasPlus={!!profile?.plusUntil} onClose={() => setCheckin(null)} onDone={refresh} />
      )}
    </div>
  );
}
