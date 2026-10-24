import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Bell, Camera, Coins, LocateFixed, Map as MapIcon, MapPin, Navigation, Swords, Trophy, UserRound, X } from "lucide-react";
import { ensureSession, supabase } from "../lib/supabase";
import { addFriend, type CheckinTarget, getProfile, type LatLng, type Profile, readCodeParam, readScanParam } from "../lib/api";
import MapView from "./MapView";
import CheckIn from "./CheckIn";
import Sheet, { type Snap } from "./detour/Sheet";
import WhereTo from "./detour/WhereTo";
import Choose, { TripHead } from "./detour/Choose";
import Results from "./detour/Results";
import { useDetour } from "./detour/useDetour";
import { resumeSignIn, useUser } from "../lib/auth";
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
import DemoBar from "./DemoBar";
import { demoOn, moveTo, onDemoChange } from "../lib/demoGps";


type Tab = "map" | "board" | "quests" | "feed" | "profile";
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "map", label: "Map", icon: <MapIcon size={24} /> }, { id: "board", label: "Leaderboard", icon: <Trophy size={24} /> },
  { id: "quests", label: "Quests", icon: <Swords size={24} /> }, { id: "feed", label: "Feed", icon: <Bell size={24} /> },
  { id: "profile", label: "Profile", icon: <UserRound size={24} /> },
];


// shared empty arrays: a fresh [] each render would make the map refit the route on every position update
const NONE: never[] = [];

const TIER_WORD = { 3: "landmark", 2: "worth-a-visit", 1: "everyday" } as const;

export default function App() {
  const [tab, setTab] = useState<Tab>(() => readCodeParam("friend") ? "profile" : "map");
  const [friend, setFriend] = useState<string | null>(null);   // a friend's profile open in the Profile tab
  const [overlay, setOverlay] = useState<"shop" | "bag" | "avatar" | "ride" | "add" | null>(() => readCodeParam("trip") ? "ride" : null);
  const [chip, setChip] = useState<string | null>(null);
  const [nav, setNav] = useState<Waypoint[] | null>(null);   // turn-by-turn running
  const [paused, setPaused] = useState<Waypoint[] | null>(null);   // directions left off to check in at a stop
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
  const [error, setError] = useState("");
  const [checkin, setCheckin] = useState<{ target: CheckinTarget; code?: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const d = useDetour(setError);
  const plan = d.stage === "results" ? d.plan : null;
  const mapPlan = d.stage === "browse" ? null : d.plan;   // while choosing, the highlighted option's route previews
  // the other plan cards' routes, faint on the map behind the one you picked
  const alternates = useMemo(() => d.stage === "results" && plan ? (d.response?.plans ?? []).filter((p) => p.geometry !== plan.geometry).map((p) => p.geometry) : NONE,
    [d.stage, d.response, plan?.geometry]); // eslint-disable-line react-hooks/exhaustive-deps
  const [focus, setFocus] = useState<LatLng | null>(null);
  // the sheet rises as you go: peek while browsing, half while choosing and on results (drag for more)
  const [snap, setSnap] = useState<Snap>("peek");
  useEffect(() => { setSnap(d.stage === "browse" ? "peek" : "half"); }, [d.stage]);

  const user = useUser();
  // reload on sign-in and sign-out too: the profile belongs to whoever is signed in now
  useEffect(() => { getProfile().then(setProfile).catch(() => setProfile(null)); }, [refreshKey, user?.id]);
  const nearby = useStops(refreshKey);
  // demo mode: re-render when you move, and watch the (fake) location from the start
  const [, demoMoved] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onDemoChange(demoMoved), []);
  useEffect(() => { if (demoOn()) nearby.start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const zoneStop = nearby.inZone[0];
  // walking into a stop's zone you haven't stamped: a buzz, so the check-in card gets noticed
  const buzzed = useRef<number | null>(null);
  useEffect(() => {
    if (zoneStop && !zoneStop.stamped && buzzed.current !== zoneStop.id) navigator.vibrate?.([60, 40, 60]);
    buzzed.current = zoneStop?.id ?? null;
  }, [zoneStop?.id, zoneStop?.stamped]);
  const checkInAt = (s: { id: number; name: string; lat: number; lng: number }) =>
    setCheckin({ target: { id: s.id, name: s.name, lat: s.lat, lng: s.lng, is_partner: false, is_demo: false } });
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
    if (picking === "origin") d.setOrigin(place); else if (picking === "dest") d.goTo(place);
    setPicking(null);
  }, [picking]); // eslint-disable-line react-hooks/exhaustive-deps


  const onSelectStop = useCallback((id: number) => {
    setSelected(id); setSnap((sn) => sn === "peek" ? "half" : sn);
    document.getElementById(`stop-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

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
            <MapView origin={d.stage === "browse" ? null : d.origin?.point ?? null} dest={d.dest?.point ?? null}
              stops={mapPlan?.stops ?? NONE} geometry={mapPlan?.geometry ?? NONE}
              alternates={alternates} focus={focus} estimated={plan?.routing === "estimate"} picking={picking} onPick={onPick} onSelectStop={onSelectStop}
              nearby={nearby.stops} here={nearby.here} inZone={nearby.inZone.map((s) => s.id)}
              members={trip.trip?.members ?? NONE} skin={profile?.look.map ?? "liberty"} look={look}
              kinds={d.stage === "browse" ? CHIPS.find((c) => c.id === chip)?.kinds ?? null : null} onPlace={(p) => setPlace(p.id)}
              onTap={demoOn() ? moveTo : undefined} />
            {demoOn() && <DemoBar />}
            {d.stage === "browse" && <ExploreChips active={chip} onPick={setChip} />}
            <div className="map-tools">
              <LayersButton look={look} setLook={setLook} />
              {!nearby.watching && <button type="button" className="map-tool" onClick={nearby.start} aria-label="Show stops near me"><LocateFixed size={20} /></button>}
            </div>
            {place && <PlaceSheet id={place} onClose={() => setPlace(null)}
              onDirections={(p) => { setPlace(null); d.goTo({ point: { lat: p.lat, lng: p.lng }, name: p.name }); }}
              onCheckin={(p) => setCheckin({ target: { id: p.id, name: p.name, lat: p.lat, lng: p.lng, is_partner: false, is_demo: false } })} />}
            {(zoneStop || paused) && (
              <div className="map-actions">
                {zoneStop && !zoneStop.stamped ? (
                  <div className={`arrive-card tier-${zoneStop.tier}`} role="status">
                    <span className="eyebrow">You're here</span>
                    <b>{zoneStop.name}</b>
                    <p className="fine">Check in with a photo to collect the {TIER_WORD[zoneStop.tier]} stamp.</p>
                    <button type="button" className="btn big checkin-go" onClick={() => checkInAt(zoneStop)}><Camera size={20} aria-hidden /> Check in</button>
                  </div>
                ) : zoneStop && (
                  <button type="button" className={`btn checkin-cta tier-${zoneStop.tier}`} onClick={() => checkInAt(zoneStop)}>
                    <Camera size={18} aria-hidden /> Add a photo at {zoneStop.name}
                  </button>
                )}
                {paused && !checkin && <span className="row resume-row">
                  <button type="button" className="btn resume-nav" onClick={() => { setNav(paused); setPaused(null); }}>
                    <Navigation size={16} aria-hidden /> Resume directions to {paused[0].name}</button>
                  <button type="button" className="icon-btn" onClick={() => setPaused(null)} aria-label="Stop these directions"><X size={16} /></button>
                </span>}
              </div>
            )}
          </div>

          <Sheet snap={snap} setSnap={setSnap} label={d.stage === "browse" ? "Where to?" : "Your detour"}
            head={d.stage !== "browse" && <TripHead d={d} onBack={d.stage === "results" ? () => d.setStage("choose") : d.close}
              backLabel={d.stage === "results" ? "Back to time options" : "Close this trip"} onSearch={() => setSnap("full")} />}
            foot={d.stage === "results" && plan && plan.stops.length > 0 && (
              <button type="button" className="btn big find" onClick={() => { setPaused(null); setNav([...plan.stops.map((st) => ({ lat: st.lat, lng: st.lng, name: st.name, id: st.id })),
                { ...d.dest!.point, name: d.dest!.name }]); }}><Navigation size={18} aria-hidden /> Start · {plan.stops.length} stop{plan.stops.length === 1 ? "" : "s"}</button>
            )}>
            {error && <p className="error" role="alert">{error}<button type="button" className="icon-btn" onClick={() => setError("")} aria-label="Dismiss"><X size={16} /></button></p>}
            {d.stage === "browse" && <WhereTo near={nearby.here} onPick={(point, name) => d.goTo({ point, name })} pickOnMap={() => { setPicking("dest"); setSnap("peek"); }}
              addPlace={() => setOverlay("add")} rideAlong={() => setOverlay("ride")} rideLive={trip.trip ? trip.trip.members.length : null} onSearch={() => setSnap("full")} />}
            {d.stage === "choose" && <Choose d={d} onPicked={() => d.setStage("results")} />}
            {d.stage === "results" && <Results d={d} selected={selected} onOpen={(s) => { setSelected(s.id); setFocus({ lat: s.lat, lng: s.lng }); setPlace(s.id); }}
              onCheckin={(target) => setCheckin({ target })} />}
          </Sheet>
        </main>
      ) : (
        <main className="page-view">
          {tab === "board" && <Leaderboard profile={profile} onChange={refresh} />}
          {tab === "quests" && <Quests profile={profile} refreshKey={refreshKey} onChange={refresh} onShop={() => setOverlay("shop")} />}
          {tab === "feed" && <Feed profile={profile} refreshKey={refreshKey} openFriend={(id) => { setFriend(id); setTab("profile"); }} goProfile={() => { setFriend(null); setTab("profile"); }} openPlace={(id) => { setPlace(id); setTab("map"); }} />}
          {tab === "profile" && <ProfileTab profile={profile} refreshKey={refreshKey} onChange={refresh} friend={friend} setFriend={setFriend}
            editAvatar={() => setOverlay("avatar")} editName={() => setNameSheet(true)} openShop={() => setOverlay("shop")} openBag={() => setOverlay("bag")}
            openPlace={(id) => { setPlace(id); setTab("map"); }} />}
        </main>
      )}

      {(overlay === "shop" || overlay === "bag") && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Shop" onClick={(e) => { if (e.target === e.currentTarget) setOverlay(null); }}>
          <div className="modal shop-modal">
            <header className="modal-head"><h2>Shop</h2><button type="button" className="icon-btn" onClick={() => setOverlay(null)} aria-label="Close"><X size={20} /></button></header>
            <Shop profile={profile} coins={profile?.coins ?? 0} onChange={refresh} onAvatar={() => setOverlay("avatar")} start={overlay} />
          </div>
        </div>
      )}
      {overlay === "add" && <AddPlace onClose={() => setOverlay(null)} />}
      {nav && <Navigate waypoints={nav} mode={d.prefs.mode} onClose={() => setNav(null)}
        onCheckin={(stop, rest) => { setNav(null); setPaused(rest.length ? rest : null); if (stop.id != null) checkInAt({ ...stop, id: stop.id }); }} />}
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
        <CheckIn target={checkin.target} initialCode={checkin.code} hasPlus={!!profile?.plusUntil} nickname={profile?.nickname} onClose={() => setCheckin(null)} onDone={refresh} />
      )}
    </div>
  );
}
