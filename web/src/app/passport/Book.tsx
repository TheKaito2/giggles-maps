import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Share2, X } from "lucide-react";
import ShareSheet, { type CardOption } from "../share/ShareSheet";
import { useBack, useDialog } from "../../lib/useDialog";
import { type PassportPhoto, type PassportStamp, photoUrls, type TripMemory } from "../../lib/api";
import type { AvatarLook } from "../avatar/parts";
import Avatar from "../social/Avatar";
import ProvinceMap from "./ProvinceMap";
import ProvinceStamp from "./ProvinceStamp";
import { REGIONS, regionOf, thName, useProvinces } from "./useProvinces";
import { STAMP_TIER, stampDate } from "../../lib/format";

interface BookOwner {
  nickname: string; colour: string; avatar?: AvatarLook | null; title: string | null; level: number; xp: number;
  joined?: string | null; code?: string | null;
}
const STAMPS_PER_PAGE = 8, PLACES_PER_PAGE = 3, PHOTOS_PER_PAGE = 4, TRIPS_PER_PAGE = 2;
interface Album {
  title: string; sub: string; photos: PassportPhoto[];
  stamp: { kind: "province"; id: number; at: string } | { kind: "landmark"; tier: 1 | 2 | 3 | 4; at: string; nameTh: string | null; province: string | null };
}
/** Who's sharing (your own passport only): your name on milestone cards, and whether Plus designs are unlocked. */
interface ShareAs { name: string; hasPlus: boolean }

/** Cards to share from a stamp: one photo (in the large view), or the stamp itself. */
function stampCards(album: Album, photo: PassportPhoto | null, url: string | undefined, name: string, tierOf: (p: PassportPhoto) => 1 | 2 | 3 | 4): CardOption[] {
  const s = album.stamp;
  if (photo) {
    const base = { place: photo.place, placeTh: null, tier: tierOf(photo), province: s.kind === "landmark" ? s.province : album.title, at: new Date(photo.at), level: null };
    return [{ id: "story", label: "Story", card: { kind: "photo", ...base, photo: url } }, { id: "sticker", label: "Sticker", card: { kind: "sticker", ...base } }];
  }
  if (s.kind === "province") return [{ id: "province", label: "Stamp", card: { kind: "milestone", what: "province", province: s.id, at: new Date(s.at), name } }];
  const base = { place: album.title, placeTh: s.nameTh, tier: s.tier, province: s.province, at: new Date(s.at), level: null };
  return [{ id: "story", label: "Story", card: { kind: "photo", ...base, photo: album.photos[0] ? url : undefined } },
    { id: "sticker", label: "Sticker", card: { kind: "sticker", ...base } }];
}

/** Every photo from one province or landmark, opened from its stamp. Tap a photo to see it large. */
function StampPhotos({ album, urls, shareAs, tierOf, onClose }: {
  album: Album; urls: Record<string, string>; shareAs?: ShareAs; tierOf: (p: PassportPhoto) => 1 | 2 | 3 | 4; onClose: () => void;
}) {
  const box = useDialog(onClose);
  const [big, setBig] = useState<number | null>(null);
  const [sharing, setSharing] = useState<CardOption[] | null>(null);
  const p = big != null ? album.photos[big] : null;
  const step = (d: number) => setBig((i) => i == null ? i : (i + d + album.photos.length) % album.photos.length);
  return (
    <div className="sheet-backdrop stamp-photos-backdrop" role="dialog" aria-modal="true" aria-label={`Photos: ${album.title}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal stamp-photos" ref={box} tabIndex={-1}
        onKeyDown={(e) => { if (p && e.key === "ArrowRight") step(1); if (p && e.key === "ArrowLeft") step(-1); }}>
        <header className="modal-head">
          <span><h2>{album.title}</h2><span className="fine">{album.sub} · {album.photos.length} {album.photos.length === 1 ? "photo" : "photos"}</span></span>
          <span className="row">
            {shareAs && <button type="button" className="btn soft small" onClick={() => {
              const photo = p ?? (album.stamp.kind === "landmark" ? album.photos[0] ?? null : null);
              setSharing(stampCards(album, p, urls[(photo ?? album.photos[0])?.path ?? ""], shareAs.name, tierOf));
            }}><Share2 size={14} aria-hidden /> {p ? "Share photo" : "Share stamp"}</button>}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
          </span>
        </header>
        {sharing && shareAs && <ShareSheet options={sharing} hasPlus={shareAs.hasPlus} onClose={() => setSharing(null)} />}
        {p ? (
          <figure className="stamp-photo-big">
            {urls[p.path] ? <img src={urls[p.path]} alt={p.caption ?? `Photo at ${p.place}`} /> : <div className="ph" />}
            <figcaption><b>{p.place}</b> · {stampDate(p.at)}{p.caption && <> · {p.caption}</>}</figcaption>
            <div className="row">
              <button type="button" className="btn soft small" onClick={() => setBig(null)}>All photos</button>
              {album.photos.length > 1 && <span className="row">
                <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label="Previous photo"><ChevronLeft /></button>
                <span className="num fine">{big! + 1} / {album.photos.length}</span>
                <button type="button" className="icon-btn" onClick={() => step(1)} aria-label="Next photo"><ChevronRight /></button>
              </span>}
            </div>
          </figure>
        ) : album.photos.length ? (
          <ul className="stamp-photo-grid">
            {album.photos.map((x, i) => <li key={x.checkin_id}><button type="button" onClick={() => setBig(i)} aria-label={`Open photo at ${x.place}, ${stampDate(x.at)}`}>
              {urls[x.path] ? <img src={urls[x.path]} alt="" loading="lazy" /> : <span className="ph" />}
              <span className="fine">{x.place}</span></button></li>)}
          </ul>
        ) : <p className="fine">No photos here yet: they come from your check-ins, unless you hid them.</p>}
      </div>
    </div>
  );
}
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
// machine-readable zone, passport style: letters, digits and "<" only, 30 characters a line
const mrz = (s: string) => (s.toUpperCase().normalize("NFD").replace(/[^A-Z0-9]+/g, "<") + "<".repeat(30)).slice(0, 30);

function Page({ n, children, className = "" }: { n?: number; children: ReactNode; className?: string }) {
  return <div className={`page ${className}`}>{children}{n != null && <span className="page-no">{n}</span>}</div>;
}

/**
 * The passport as a book you flip through: cover, ID page, Thailand map, the 77 province visa pages, place stamps,
 * photos. Two pages side by side on wide screens, one page on phones. Buttons, arrow keys or swipe turn the pages.
 */
// one shared empty list: a fresh [] default on every render re-ran the photo effect below after each render (setUrls ->
// render -> new [] -> effect ...), which froze a friend's passport (friends' passports come without trips)
const NO_TRIPS: TripMemory[] = [];

export default function Book({ owner, theme = "classic", frame = "none", stamps, photos, trips = NO_TRIPS, shareAs, onClose }: {
  owner: BookOwner; theme?: string; frame?: string; stamps: PassportStamp[]; photos: PassportPhoto[]; trips?: TripMemory[]; shareAs?: ShareAs;
  onClose: () => void;
}) {
  const features = useProvinces();
  const [spread, setSpread] = useState(() => matchMedia("(min-width: 860px)").matches);
  const [at, setAt] = useState(0);   // leaves turned
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [album, setAlbum] = useState<Album | null>(null);   // a stamp's photos, open over the book
  useEffect(() => {
    const m = matchMedia("(min-width: 860px)");
    const on = () => { setSpread(m.matches); setAt(0); };
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  // every photo in the book, signed in one request: memories, the photo on each stamp, ride-along picks
  useEffect(() => {
    const paths = new Set([...photos.map((p) => p.path), ...stamps.map((s) => s.photo).filter((p): p is string => !!p),
      ...trips.flatMap((t) => t.photos.map((p) => p.path))]);
    photoUrls([...paths]).then(setUrls).catch(() => undefined);
  }, [photos, stamps, trips]);

  const firstIn = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of stamps) if (s.province_id != null && (!m.has(s.province_id) || s.earned_at < m.get(s.province_id)!)) m.set(s.province_id, s.earned_at);
    return m;
  }, [stamps]);
  // a province's visa shows your first photo there, tucked behind the stamp
  const provincePhoto = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of [...photos].reverse()) if (p.province_id != null && !m.has(p.province_id)) m.set(p.province_id, p.path);
    return m;
  }, [photos]);
  const counts = useMemo(() => new Map([...firstIn.keys()].map((id) => [id, stamps.filter((s) => s.province_id === id).length])), [firstIn, stamps]);
  const ordered = useMemo(() => [...features].sort((a, b) =>
    REGIONS.indexOf(regionOf(a.properties.iso)) - REGIONS.indexOf(regionOf(b.properties.iso)) || a.properties.name_en.localeCompare(b.properties.name_en)), [features]);
  const issued = owner.joined ?? stamps.at(-1)?.earned_at ?? new Date().toISOString();

  const pages: ReactNode[] = [
    <div key="cover" className={`page cover theme-${theme}`}>
      <span className="cover-top">GIGGLES MAPS</span>
      <svg viewBox="0 0 100 100" className="cover-emblem" aria-hidden>
        <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="50" cy="50" r="37" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
        <path d="M50 18 C36 18 27 28 27 41 C27 58 50 80 50 80 C50 80 73 58 73 41 C73 28 64 18 50 18 Z" fill="none" stroke="currentColor" strokeWidth="3" />
        {[0, 60, 120, 180, 240, 300].map((r) => <ellipse key={r} cx="50" cy="35" rx="3.2" ry="7" fill="currentColor" transform={`rotate(${r} 50 41)`} />)}
        <circle cx="50" cy="41" r="3.5" fill="currentColor" />
      </svg>
      <span className="cover-title">PASSPORT</span>
      <span className="cover-th">หนังสือเดินทาง</span>
      <span className="cover-name">{owner.nickname}</span>
    </div>,
    <Page key="inside" className="inside">
      <p className="inside-head">This passport belongs to an explorer of Thailand.</p>
      <p className="inside-th">หนังสือเดินทางเล่มนี้เป็นของนักสำรวจประเทศไทย</p>
      <p className="inside-note">Stamps are earned in person. This book holds the 77 province visas and your landmark stamps; every other place goes in your Logbook.</p>
      <div className="inside-count"><b className="num">{firstIn.size}</b><span>/ 77 provinces</span></div>
    </Page>,
    <Page key="id" n={1} className="id-page">
      <div className="guilloche" aria-hidden />
      <div className="id-head"><span>PASSPORT</span><span>หนังสือเดินทาง</span></div>
      <div className="id-body">
        <div className="id-photo"><Avatar name={owner.nickname} colour={owner.colour} avatar={owner.avatar} size={200} /></div>
        <dl className="id-fields">
          <div><dt>Type</dt><dd>P</dd></div><div><dt>Code</dt><dd>GIG</dd></div>
          <div className="wide"><dt>Passport no.</dt><dd className="num">{owner.code ?? "PRIVATE"}</dd></div>
          <div className="wide"><dt>Name / ชื่อ</dt><dd>{owner.nickname}</dd></div>
          <div className="wide"><dt>Title</dt><dd>{owner.title ?? "Traveller"}</dd></div>
          <div><dt>Level</dt><dd className="num">{owner.level}</dd></div><div><dt>XP</dt><dd className="num">{owner.xp}</dd></div>
          <div className="wide"><dt>Date of issue</dt><dd className="num">{stampDate(issued)}</dd></div>
        </dl>
      </div>
      <div className="mrz num" aria-hidden>
        <span>{`P<GIG${mrz(owner.nickname)}`.slice(0, 30)}</span>
        <span>{mrz(`${owner.code ?? "0000000000"}<${owner.level}<${firstIn.size}<77`)}</span>
      </div>
    </Page>,
    <Page key="map" n={2} className="map-page">
      <h3 className="page-h">Provinces visited · จังหวัดที่ไป</h3>
      <ProvinceMap counts={counts} />
    </Page>,
    ...chunk(ordered, STAMPS_PER_PAGE).map((list, i) => (
      <Page key={`visa-${i}`} n={3 + i} className="visa">
        <h3 className="page-h">VISAS · {regionOf(list[0].properties.iso).en.toUpperCase()} <span>{regionOf(list[0].properties.iso).th}</span></h3>
        <div className="visa-grid">
          {list.map((f) => {
            const style = { translate: `${(f.id * 13) % 9 - 4}% ${(f.id * 7) % 9 - 4}%` };
            const inner = <>
              {firstIn.has(f.id) && urls[provincePhoto.get(f.id) ?? ""] && <img className="visa-photo" src={urls[provincePhoto.get(f.id)!]} alt=""
                style={{ rotate: `${(f.id % 7) - 3 + (f.id % 2 ? 8 : -8)}deg` }} loading="lazy" />}
              <ProvinceStamp f={f} earnedAt={firstIn.get(f.id) ?? null} size={160} fresh={Date.now() - Date.parse(firstIn.get(f.id) ?? "") < 2 * 864e5} />
            </>;
            if (!firstIn.has(f.id)) return <div key={f.id} className="visa-slot" style={style}>{inner}</div>;
            const pics = photos.filter((p) => p.province_id === f.id);
            return <button key={f.id} type="button" className="visa-slot stamp-btn" style={style} aria-label={`${f.properties.name_en}: ${pics.length} photo${pics.length === 1 ? "" : "s"}`}
              onClick={() => setAlbum({ title: f.properties.name_en, sub: thName(f), photos: pics,
                stamp: { kind: "province", id: f.id, at: firstIn.get(f.id)! } })}>
              {inner}<span className="stamp-tag"><Camera size={12} aria-hidden /> {pics.length ? `${pics.length} photo${pics.length === 1 ? "" : "s"}` : "No photos"}</span>
            </button>;
          })}
        </div>
      </Page>
    )),
  ];
  const visaPages = Math.ceil(ordered.length / STAMPS_PER_PAGE);
  const landmarks = stamps.filter((s) => s.tier >= 3);
  chunk(landmarks, PLACES_PER_PAGE).forEach((list, i) => pages.push(
    <Page key={`places-${i}`} n={3 + visaPages + i} className="places">
      <h3 className="page-h">LANDMARKS · แลนด์มาร์ก</h3>
      <ul className="landmark-list">
        {list.map((s, j) => <li key={s.place_id} className={`landmark-row${j % 2 ? " flip" : ""}`}>
          {s.photo && <figure className="print" style={{ rotate: `${j % 2 ? 4 : -4}deg` }}>
            {urls[s.photo] ? <img src={urls[s.photo]} alt={`Photo at ${s.name}`} loading="lazy" /> : <div className="ph" />}</figure>}
          {(() => {
            const pics = photos.filter((p) => p.place_id === s.place_id);
            return <button type="button" className="entry landmark stamp-btn" style={{ rotate: `${(s.place_id % 13) - 6}deg` }}
              aria-label={`${s.name}: ${pics.length} photo${pics.length === 1 ? "" : "s"}`} onClick={() => setAlbum({ title: s.name, sub: s.name_th ?? "Landmark", photos: pics, stamp: { kind: "landmark", tier: s.tier, at: s.earned_at,
                nameTh: s.name_th, province: features.find((x) => x.id === s.province_id)?.properties.name_en ?? null } })}>
              <span className="entry-tier">{STAMP_TIER[s.tier].toUpperCase()}</span><b>{s.name}</b>{s.name_th && <span className="th">{s.name_th}</span>}
              <span className="num band">{stampDate(s.earned_at)}</span>
              <span className="stamp-tag"><Camera size={12} aria-hidden /> {pics.length ? `${pics.length} photo${pics.length === 1 ? "" : "s"}` : "No photos"}</span>
            </button>;
          })()}
        </li>)}
      </ul>
    </Page>));
  const placePages = Math.ceil(landmarks.length / PLACES_PER_PAGE);
  chunk(photos, PHOTOS_PER_PAGE).forEach((list, i) => pages.push(
    <Page key={`photos-${i}`} n={3 + visaPages + placePages + i} className={`photos frame-${frame}`}>
      <h3 className="page-h">MEMORIES · ความทรงจำ</h3>
      <ul className="print-grid">
        {list.map((p, j) => <li key={p.checkin_id} className="print" style={{ rotate: `${j % 2 ? 3 : -3}deg` }}>
          {urls[p.path] ? <img src={urls[p.path]} alt={p.caption ?? `Photo at ${p.place}`} loading="lazy" /> : <div className="ph" />}
          <span>{p.place}</span>
        </li>)}
      </ul>
    </Page>));
  const photoPages = Math.ceil(photos.length / PHOTOS_PER_PAGE);
  chunk(trips, TRIPS_PER_PAGE).forEach((list, i) => pages.push(
    <Page key={`trips-${i}`} n={3 + visaPages + placePages + photoPages + i} className={`trips frame-${frame}`}>
      <h3 className="page-h">RIDE-ALONGS · ไปด้วยกัน</h3>
      {list.map((t) => <section key={t.id} className="trip-memory">
        <h4>{t.name ?? "Ride along"} <span className="num">{stampDate(t.started_at)}</span></h4>
        <ul className="print-grid three">
          {t.photos.map((p, j) => <li key={p.checkin_id} className="print" style={{ rotate: `${(j - 1) * 3}deg` }}>
            {urls[p.path] ? <img src={urls[p.path]} alt={p.caption ?? `${p.nickname} at ${p.place}`} loading="lazy" /> : <div className="ph" />}
            <span>{p.nickname}</span>
          </li>)}
        </ul>
      </section>)}
    </Page>));
  if (pages.length % 2 === 0) pages.push(<Page key="notes" className="notes"><h3 className="page-h">NOTES</h3></Page>);
  pages.push(<div key="back" className={`page cover back theme-${theme}`}><span className="cover-top">gigglesmap.xyz</span></div>);

  const leaves = spread
    ? chunk(pages, 2).map(([front, back]) => ({ front, back }))
    : pages.map((front) => ({ front, back: null as ReactNode }));
  const last = leaves.length - (spread ? 0 : 1);
  const go = (d: number) => setAt((a) => Math.max(0, Math.min(last, a + d)));

  useBack(onClose);   // Back closes the passport (it used to leave Profile for the map)
  // arrow keys turn pages, Escape closes: one listener, reading the latest state through a ref
  const keys = useRef({ go, album, onClose });
  keys.current = { go, album, onClose };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const k = keys.current;
      if (k.album) return;
      if (e.key === "ArrowRight") k.go(1); else if (e.key === "ArrowLeft") k.go(-1); else if (e.key === "Escape") k.onClose();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  const startX = useRef<number | null>(null);

  const shift = spread ? (at === 0 ? "-25%" : at === leaves.length ? "25%" : "0%") : "0%";
  const label = spread ? `${at} of ${leaves.length}` : `${at + 1} of ${leaves.length}`;
  return (
    <div className="book-overlay" role="dialog" aria-modal="true" aria-label={`${owner.nickname}'s passport`}>
      <button type="button" className="icon-btn book-close" onClick={onClose} aria-label="Close passport"><X size={22} /></button>
      <div className={`book ${spread ? "spread" : "single"}`} style={{ translate: shift }}
        onPointerDown={(e) => { startX.current = e.clientX; }}
        onPointerUp={(e) => { if (startX.current != null && Math.abs(e.clientX - startX.current) > 40) go(e.clientX < startX.current ? 1 : -1); startX.current = null; }}>
        {leaves.map((l, i) => {
          const turned = i < at;
          return (
            <div key={i} className={`leaf${turned ? " turned" : ""}`} style={{ zIndex: turned ? i : leaves.length - i }}
              aria-hidden={spread ? !(i === at || i === at - 1) : i !== at}>
              <div className="face front">{l.front}</div>
              <div className="face back">{l.back ?? <div className="page blank" />}</div>
            </div>
          );
        })}
      </div>
      {album && <StampPhotos album={album} urls={urls} shareAs={shareAs} onClose={() => setAlbum(null)}
        tierOf={(p) => stamps.find((s) => s.place_id === p.place_id)?.tier ?? 2} />}
      <div className="book-nav">
        <button type="button" className="btn soft" onClick={() => go(-1)} disabled={at === 0} aria-label="Previous page"><ChevronLeft size={18} /></button>
        <span className="num" aria-live="polite">{label}</span>
        <button type="button" className="btn soft" onClick={() => go(1)} disabled={at >= last} aria-label="Next page"><ChevronRight size={18} /></button>
      </div>
    </div>
  );
}
