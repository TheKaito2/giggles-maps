import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Camera, Coins, LocateFixed, Map as MapIcon, Navigation, ScrollText, Trophy, UserRound, Users, X } from "lucide-react";
import { ensureSession, supabase } from "../lib/supabase";
import { addFriend, adFree, type CheckinTarget, getProfile, type LatLng, levelFor, levelProgress, pendingLevels, plusDaily, type Profile, readCodeParam, readScanParam } from "../lib/api";
import Sheet, { type Snap } from "./detour/Sheet";
import WhereTo from "./detour/WhereTo";
import Choose, { TripHead } from "./detour/Choose";
import Results from "./detour/Results";
import { useDetour } from "./detour/useDetour";
import { listenForAuthCallback, resumeSignIn, useUser } from "../lib/auth";
import { buzz, deliverPurchases, liveTrip } from "../lib/native";
import { useStops } from "./useStops";
import Nickname from "./social/Nickname";
import RideAlong, { useTrip } from "./social/RideAlong";
import AdBanner from "./AdBanner";
import DemoWelcome from "./DemoWelcome";
import type { Waypoint } from "./nav/Navigate";
import LayersButton from "./LayersButton";
import { loadLook, type MapLook, saveLook } from "./mapLayers";
import ExploreChips, { CHIPS } from "./ExploreChips";
import DemoBar from "./DemoBar";
import { demoOn, onDemoChange } from "../lib/demoGps";
import { SkelLines } from "./Skeleton";
import Boundary from "./Boundary";
import Modal from "./Modal";
import { dialogsOpen, quietBack, quietPop } from "../lib/useDialog";

// Only the map and the detour sheet load up front; tabs and sheets arrive when first opened.
const MapView = lazy(() => import("./MapView"));   // maplibre is most of the code: the sheet paints first
const CheckIn = lazy(() => import("./CheckIn"));
const Leaderboard = lazy(() => import("./Leaderboard"));
const Upgrade = lazy(() => import("./Upgrade"));
const Quests = lazy(() => import("./Quests"));
const Feed = lazy(() => import("./Feed"));
const ProfileTab = lazy(() => import("./Profile"));
const Shop = lazy(() => import("./passport/Shop"));
const AvatarBuilder = lazy(() => import("./avatar/AvatarBuilder"));
const PlaceSheet = lazy(() => import("./PlaceSheet"));
const AddPlace = lazy(() => import("./AddPlace"));
const Navigate = lazy(() => import("./nav/Navigate"));
const EtaView = lazy(() => import("./nav/EtaView"));

type Tab = "map" | "board" | "quests" | "feed" | "profile";
// short = the phone tab bar's caption (icons alone were guesswork: swords read "battle", a bell reads "notifications")
const TABS: { id: Tab; label: string; short: string; icon: React.ReactNode }[] = [
  { id: "map", label: "Map", short: "Map", icon: <MapIcon size={24} /> }, { id: "board", label: "Leaderboard", short: "Ranks", icon: <Trophy size={24} /> },
  { id: "quests", label: "Quests", short: "Quests", icon: <ScrollText size={24} /> }, { id: "feed", label: "Feed", short: "Feed", icon: <Users size={24} /> },
  { id: "profile", label: "Profile", short: "Profile", icon: <UserRound size={24} /> },
];

// shared empty arrays: a fresh [] each render would make the map refit the route on every position update
const NONE: never[] = [];

const TIER_WORD = { 3: "landmark", 2: "worth-a-visit", 1: "everyday" } as const;

export default function App() {
  const [tab, setTabState] = useState<Tab>(() => readCodeParam("friend") ? "profile" : "map");
  // Back (phone gesture, browser button) from another tab comes back to the map in one step instead of leaving the app:
  // map → a tab adds one history entry, tab → tab replaces it, tab → map by the tab bar drops it
  const tabNow = useRef(tab);
  const setTab = useCallback((t: Tab) => {
    const from = tabNow.current;
    if (t === from) return;
    if (from === "map") history.pushState({ ...history.state, gmTab: t }, "");
    else if (t !== "map") history.replaceState({ ...history.state, gmTab: t }, "");
    else if (history.state?.gmTab) quietBack();
    tabNow.current = t;
    setTabState(t);
  }, []);
  useEffect(() => {
    const pop = () => { if (!quietPop() && !dialogsOpen() && !history.state?.gmTab && tabNow.current !== "map") { tabNow.current = "map"; setTabState("map"); } };
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  const [friend, setFriend] = useState<string | null>(null);   // a friend's profile open in the Profile tab
  const [passport, setPassport] = useState(false);   // open your passport on the Profile tab
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
  // Plus: +20 coins the first time you open the app each day
  const plusActive = !!profile?.plusUntil;
  useEffect(() => {
    if (!plusActive) return;
    plusDaily().then((c) => { if (c > 0) { setNotice(`+${c} coins: your Plus bonus for today`); setRefreshKey((k) => k + 1); } }).catch(() => undefined);
  }, [plusActive, user?.id]);
  const [adSheet, setAdSheet] = useState(false);
  const nearby = useStops(refreshKey);
  useEffect(() => { if (nearby.problem) setNotice(nearby.problem); }, [nearby.problem]);
  // back from Stripe: say so on whatever screen the app opens on (it was only inside Settings), then pick up the new plan
  useEffect(() => {
    if (new URLSearchParams(location.search).get("paid") !== "success") return;
    setNotice("Payment received. It switches on in a few seconds.");
    const t = setTimeout(() => setRefreshKey((k) => k + 1), 5000);
    return () => clearTimeout(t);
  }, []);
  // demo mode: re-render when you move, and watch the (fake) location from the start
  const [, demoMoved] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onDemoChange(demoMoved), []);
  useEffect(() => { if (demoOn()) nearby.start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const zoneStop = nearby.inZone[0];
  // walking into a stop's zone you haven't stamped: a buzz, so the check-in card gets noticed
  const buzzed = useRef<number | null>(null);
  useEffect(() => {
    if (zoneStop && !zoneStop.stamped && buzzed.current !== zoneStop.id) buzz("tap");
    buzzed.current = zoneStop?.id ?? null;
  }, [zoneStop?.id, zoneStop?.stamped]);
  const checkInAt = (s: { id: number; name: string; lat: number; lng: number }) =>
    setCheckin({ target: { id: s.id, name: s.name, lat: s.lat, lng: s.lng, is_partner: false, is_demo: false } });
  const trip = useTrip(nearby.here, nearby.start, refreshKey);
  const [nameSheet, setNameSheet] = useState(false);
  // "Later" on the name sheet holds for 3 days, not just this visit (it opened on every tab before)
  const [nameLater, setNameLater] = useState(() => { try { return Number(localStorage.getItem("gm-name-later")) > Date.now(); } catch { return false; } });
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
  useEffect(() => {
    const show = (m: string | null) => { if (m) { setNotice(m); setTab("profile"); } };
    resumeSignIn().then(show);
    listenForAuthCallback(show);   // iOS app only
  }, []);

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
  useEffect(() => deliverPurchases(refresh), []); // eslint-disable-line react-hooks/exhaustive-deps   iOS: App Store purchases not yet on the server
  const level = levelFor(profile?.xp ?? 0);
  const { into, span } = levelProgress(profile?.xp ?? 0);
  return (
    <div className={`app-shell tab-${tab}`}>
      <nav className="tabbar" aria-label="Sections">
        <a className="brand" href="/"><img className="brand-mark" src="/logo.svg" alt="" width={36} height={36} /><span className="brand-word">giggles <span>maps</span></span></a>
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? "on" : ""} aria-current={tab === t.id ? "page" : undefined}
            onClick={() => { setTab(t.id); if (t.id === "profile") setFriend(null); }}>
            {t.icon}<span className="tab-long">{t.label}</span><span className="tab-short" aria-hidden>{t.short}</span>
          </button>
        ))}
      </nav>
      <header className="topbar">
        <a className="brand mobile-only" href="/" aria-label="Giggles Maps home"><img className="brand-mark" src="/logo.svg" alt="" width={32} height={32} /></a>
        <div className="stat-chips">
          <button type="button" className="stat-chip level" onClick={() => setTab("profile")}
            style={{ ["--p" as string]: span ? into / span : 1 }}><span className="sr-only">Level </span><span className="ring"><b>{level}</b>{profile && pendingLevels(profile).length > 0 && <i className="ring-dot" aria-label="Level reward ready" />}</span><span className="num">{profile?.xp ?? 0} XP</span></button>
          <button type="button" className="stat-chip provinces" onClick={() => { setFriend(null); setTab("profile"); setPassport(true); }}
            aria-label={`${profile?.provinces ?? 0}/77 provinces, open your passport`}>
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
            <Boundary><Suspense fallback={null}><MapView origin={d.stage === "browse" ? null : d.origin?.point ?? null} dest={d.dest?.point ?? null}
              stops={mapPlan?.stops ?? NONE} geometry={mapPlan?.geometry ?? NONE}
              alternates={alternates} focus={focus} estimated={plan?.routing === "estimate"} picking={picking} onPick={onPick} onSelectStop={onSelectStop}
              nearby={nearby.stops} here={nearby.here} inZone={nearby.inZoneIds}
              members={trip.trip?.members ?? NONE} skin={profile?.look.map ?? "liberty"} look={look}
              kinds={d.stage === "browse" ? CHIPS.find((c) => c.id === chip)?.kinds ?? null : null} onPlace={(p) => setPlace(p.id)} /></Suspense></Boundary>
            {demoOn() && <DemoBar />}
            {d.stage === "browse" && <ExploreChips active={chip} onPick={setChip} />}
            <div className="map-tools">
              <LayersButton look={look} setLook={setLook} />
              {!nearby.watching && <button type="button" className="map-tool" onClick={nearby.start} aria-label="Show stops near me"><LocateFixed size={20} /></button>}
            </div>
            {place && <Boundary><Suspense fallback={null}><PlaceSheet id={place} onClose={() => setPlace(null)}
              onDirections={(p) => { setPlace(null); d.goTo({ point: { lat: p.lat, lng: p.lng }, name: p.name }); }}
              onCheckin={checkInAt} onCoins={refresh} /></Suspense></Boundary>}
            {(zoneStop || paused) && (
              <div className="map-actions">
                {zoneStop && !zoneStop.stamped ? (
                  <div className={`arrive-card tier-${zoneStop.tier}`} role="status">
                    <span className="eyebrow">You're here</span>
                    <b>{zoneStop.name}</b>
                    <p className="fine">Collect the {TIER_WORD[zoneStop.tier]} stamp. This card goes away when you leave.</p>
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

          <Sheet snap={snap} setSnap={setSnap} page={d.stage} label={d.stage === "browse" ? "Where to?" : "Your detour"}
            head={d.stage !== "browse" && <TripHead d={d} onBack={d.stage === "results" ? () => d.setStage("choose") : d.close}
              backLabel={d.stage === "results" ? "Back to time options" : "Close this trip"} onSearch={() => setSnap("full")} />}
            foot={d.stage === "results" && plan && plan.stops.length > 0 && (
              <button type="button" className="btn big find" onClick={() => { setPaused(null); setNav([...plan.stops.map((st) => ({ lat: st.lat, lng: st.lng, name: st.name, id: st.id })),
                { ...d.dest!.point, name: d.dest!.name }]); liveTrip.start(plan.stops, d.dest!.name); }}><Navigation size={18} aria-hidden /> Start · {plan.stops.length} stop{plan.stops.length === 1 ? "" : "s"}</button>
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
          <Boundary page key={tab}><Suspense fallback={<div className="page-col"><SkelLines n={6} /></div>}>
          {tab === "board" && <Leaderboard profile={profile} onChange={refresh} />}
          {tab === "quests" && <Quests profile={profile} refreshKey={refreshKey} onChange={refresh} onShop={() => setOverlay("shop")} />}
          {tab === "feed" && <Feed profile={profile} refreshKey={refreshKey} openFriend={(id) => { setFriend(id); setTab("profile"); }} goProfile={() => { setFriend(null); setTab("profile"); }} openPlace={(id) => { setPlace(id); setTab("map"); }} />}
          {tab === "profile" && <ProfileTab profile={profile} refreshKey={refreshKey} onChange={refresh} friend={friend} setFriend={setFriend}
            editAvatar={() => setOverlay("avatar")} editName={() => setNameSheet(true)} openShop={() => setOverlay("shop")} openBag={() => setOverlay("bag")}
            openPlace={(id) => { setPlace(id); setTab("map"); }} passport={passport} onPassport={() => setPassport(false)} />}
          </Suspense></Boundary>
          {profile && !adFree(profile) && <AdBanner page={tab} onRemove={() => setAdSheet(true)} />}
        </main>
      )}

      <Boundary><Suspense fallback={null}>
      {(overlay === "shop" || overlay === "bag") && (
        <Modal label="Shop" className="shop-modal" onClose={() => setOverlay(null)}>
          <header className="modal-head"><h2>Shop</h2><button type="button" className="icon-btn" onClick={() => setOverlay(null)} aria-label="Close"><X size={20} /></button></header>
          <Shop profile={profile} coins={profile?.coins ?? 0} onChange={refresh} onAvatar={() => setOverlay("avatar")} start={overlay} />
        </Modal>
      )}
      {overlay === "add" && <AddPlace onClose={() => setOverlay(null)} />}
      {d.gate && tab === "map" && <Upgrade gate={d.gate} onClose={() => d.setGate(null)}
        onRewarded={d.gate === "detour_limit" ? d.replanAll : () => setNotice("5 more changes for today. Make that change again.")} />}
      {adSheet && <Upgrade gate="ads" onClose={() => setAdSheet(false)} />}
      <DemoWelcome />
      {nav && <Navigate waypoints={nav} mode={d.prefs.mode} onClose={() => { setNav(null); liveTrip.end(); }}
        onCheckin={(stop, rest) => { setNav(null); setPaused(rest.length ? rest : null); if (stop.id != null) checkInAt({ ...stop, id: stop.id }); }} />}
      {etaToken && <EtaView token={etaToken} onClose={() => setEtaToken(null)} />}
      {overlay === "avatar" && profile && <AvatarBuilder profile={profile} onClose={() => setOverlay(null)} onSaved={() => { setOverlay(null); refresh(); }} />}
      {overlay === "ride" && (
        <Modal label="Ride along" onClose={() => setOverlay(null)}>
          <header className="modal-head"><h2>Ride along</h2><button type="button" className="icon-btn" onClick={() => setOverlay(null)} aria-label="Close"><X size={20} /></button></header>
          <RideAlong trip={trip} profile={profile} />
        </Modal>
      )}

      {profile && (nameSheet || (tab !== "map" && !profile.nickname && !nameLater)) && (
        <Nickname current={profile.nickname} colour={profile.colour}
          onDone={() => { setNameSheet(false); refresh(); }}
          onLater={() => { setNameSheet(false); setNameLater(true); try { localStorage.setItem("gm-name-later", String(Date.now() + 3 * 864e5)); } catch { /* this visit only */ } }} />
      )}

      </Suspense></Boundary>
      {checkin && <Boundary><Suspense fallback={null}>
        <CheckIn target={checkin.target} initialCode={checkin.code} hasPlus={!!profile?.plusUntil} luck={profile?.perks.luck} nickname={profile?.nickname} onClose={() => setCheckin(null)} onDone={() => { liveTrip.checkedIn(checkin.target.id); refresh(); }} />
      </Suspense></Boundary>}
    </div>
  );
}
