import { useCallback, useEffect, useRef, useState } from "react";
import { Car, Download, LogOut, Share2 } from "lucide-react";
import { ApiError } from "../../lib/supabase";
import { getTrip, joinTrip, type LatLng, leaveTrip, photoUrls, type Profile, SITE, startTrip, type Trip, tripPing } from "../../lib/api";
import ShareSheet from "../share/ShareSheet";
import Avatar from "./Avatar";
import Album from "../passport/Album";
import QrLink from "./QrLink";
import { Spinner } from "../Skeleton";
import Info from "../Info";

const POLL_MS = 15_000;
const PING_MS = 30_000;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * The running trip: reloads every 15 s while one is live and sends your position at most every 30 s.
 * ponytail: polling, Supabase Realtime if 15 s feels slow.
 */
export function useTrip(here: LatLng | null, startWatching: () => void, refreshKey: number) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState("");
  const pinged = useRef(0);
  const load = useCallback(() => getTrip().then(setTrip).catch(() => undefined), []);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    if (!trip) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [trip?.id, load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!trip || !here || Date.now() - pinged.current < PING_MS) return;
    pinged.current = Date.now();
    tripPing(here).catch(() => undefined);
  }, [trip?.id, here]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (p: Promise<Trip | null | void>) => {
    setError("");
    return p.then((t) => { setTrip(t ?? null); pinged.current = 0; if (t) startWatching(); })
      .catch((e) => setError(e instanceof ApiError && e.code === "trip_not_found" ? "That trip has ended or the code is wrong."
        : e instanceof ApiError && e.code === "trip_full" ? "That trip is full (20 people)."
        : e instanceof ApiError && e.code === "bad_name" ? "Trip names can't contain < or >." : "Couldn't do that. Try again."));
  };
  return {
    trip, error,
    start: (name?: string) => run(startTrip(name)),
    join: (code: string) => run(joinTrip(code)),
    leave: () => run(leaveTrip().then(() => null)),
  };
}
export type TripState = ReturnType<typeof useTrip>;

export default function RideAlong({ trip: t, profile }: { trip: TripState; profile: Profile | null }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [card, setCard] = useState<string[] | null>(null);
  const [albumMsg, setAlbumMsg] = useState("");
  const trip = t.trip;

  if (!trip) return (
    <div className="stack">
      <p className="fine">Travelling with friends or family? <Info label="About ride along">Start a trip and they join with your link or QR. While it
        runs you see each other on the map and share one album, and checking in at the same place within an hour gives everyone +50% XP and
        coins.</Info></p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); t.start(name); }}>
        <input className="text-in" value={name} maxLength={40} placeholder="Trip name (optional), e.g. Sakon weekend" aria-label="Trip name"
          onChange={(e) => setName(e.target.value)} />
        <button className="btn" type="submit"><Car size={16} aria-hidden /> Start a trip</button>
      </form>
      <form className="row add-friend" onSubmit={(e) => { e.preventDefault(); t.join(code); }}>
        <input className="text-in code-in" value={code} maxLength={10} placeholder="Trip code" aria-label="Trip code" autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
        <button className="btn soft" type="submit" disabled={code.length < 6}>Join</button>
      </form>
      {t.error && <p className="error" role="alert">{t.error}</p>}
      <p className="fine">Your location is shared only with people on the trip, only while it runs (12 hours at most), and deleted when it ends.</p>
    </div>
  );

  const byCheckin = new Map(trip.album.map((p) => [p.checkin_id, p.nickname]));
  // the album stays with the group: everyone on the trip can save it or share a card, nothing goes to the feed
  const saveAll = async () => {
    setSaving(true); setAlbumMsg("");
    try {
      const urls = await photoUrls(trip.album.map((p) => p.path));
      const files = (await Promise.all(trip.album.map(async (p, i) => {
        const u = urls[p.path]; if (!u) return null;
        const b = await fetch(u).then((r) => r.blob());
        return new File([b], `trip-${trip.code}-${i + 1}.jpg`, { type: b.type || "image/jpeg" });
      }))).filter((f): f is File => !!f);
      const download = async () => { for (const f of files) {   // one download each where the browser can't share files
        const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click();
        await new Promise((r) => setTimeout(r, 300)); URL.revokeObjectURL(a.href);
      } };
      if (!navigator.canShare?.({ files })) await download();
      else await navigator.share({ files }).catch((e: Error) => e.name === "AbortError" ? undefined : download());   // Safari may refuse after the wait
    } catch { setAlbumMsg("Couldn't save the photos. Try again."); } finally { setSaving(false); }
  };
  const openCard = async () => {
    if (saving) return;
    const urls = await photoUrls(trip.album.slice(0, 6).map((p) => p.path)).catch(() => ({} as Record<string, string>));
    setCard(Object.values(urls));
  };
  return (
    <div className="stack">
      <section className="me-card glass">
        <div className="row between">
          <span className="person-main"><b>{trip.name ?? "Ride along"}</b>
            <span className="fine">Live until {hhmm(trip.ends_at)} · code <b className="num">{trip.code}</b></span></span>
          <button type="button" className="btn ghost" onClick={() => { if (confirm(trip.owner ? "End the trip for everyone?" : "Leave this trip?")) t.leave(); }}>
            <LogOut size={15} aria-hidden /> {trip.owner ? "End trip" : "Leave"}</button>
        </div>
        <ul className="crew" aria-label="People on this trip">
          {trip.members.map((m) => (
            <li key={m.id} title={m.nickname}><Avatar name={m.nickname} colour={m.colour} />
              <span className="fine">{m.me ? "You" : m.nickname}{m.lat == null && !m.me ? " · no location" : ""}</span></li>
          ))}
        </ul>
        <QrLink url={`${SITE}/app/?trip=${trip.code}`} label="QR code to join this trip" />
      </section>
      {t.error && <p className="error" role="alert">{t.error}</p>}
      <div className="row between"><h4 className="eyebrow">Trip album ({trip.album.length})</h4>
        {trip.album.length > 0 && <span className="row">
          <button type="button" className="btn soft small" onClick={openCard}><Share2 size={14} aria-hidden /> Trip card</button>
          <button type="button" className="btn soft small" onClick={saveAll} disabled={saving}><Download size={14} aria-hidden /> {saving ? <><Spinner size={14} /> Saving…</> : "Save all"}</button>
        </span>}</div>
      {albumMsg && <p className="error" role="alert">{albumMsg}</p>}
      {card && <ShareSheet hasPlus={!!profile?.plusUntil} onClose={() => setCard(null)} options={[{ id: "trip", label: "Trip", card: { kind: "trip",
        title: trip.name ?? "Ride along", photos: card, members: trip.members.map((m) => m.nickname), at: new Date(trip.started_at) } }]} />}
      <Album photos={trip.album.map((p) => ({ ...p, province_id: null }))} frame={profile?.look.frame}
        by={(p) => byCheckin.get(p.checkin_id) ?? ""} />
    </div>
  );
}
