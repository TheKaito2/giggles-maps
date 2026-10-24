import SiamSi from "./fortune/SiamSi";
import { type ReactNode, useEffect, useState } from "react";
import { ArrowLeft, Award, Backpack, BookOpen, Camera, Crown, Check, Map as MapIcon, NotebookPen, Pencil, Plus, Settings, Share2, ShoppingBag, Sparkles, Stamp,
  UserMinus, X, Zap } from "lucide-react";
import { ApiError } from "../lib/supabase";
import { getFriendPassport, getPassport, getProfilePage, levelProgress, nudge, type PassportPhoto, type PassportStamp, type Pin, type Profile,
  type ProfilePage, removeFriend, setShowcase, type TripMemory } from "../lib/api";
import { useUser } from "../lib/auth";
import { useDialog } from "../lib/useDialog";
import Avatar from "./social/Avatar";
import FriendsSection from "./social/Friends";
import Badges, { BadgeIcon } from "./Badges";
import Book from "./passport/Book";
import Logbook from "./passport/Logbook";
import ProvinceMap from "./passport/ProvinceMap";
import ShareSheet from "./share/ShareSheet";
import SettingsSheet from "./Settings";
import SavedLists from "./SavedLists";
import { SkelProfile } from "./Skeleton";

const month = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "";
const TIER = { 3: "Landmark", 2: "Worth a visit", 1: "Everyday" } as const;
type Sheet = "book" | "log" | "settings" | "pins" | "share" | null;

function PinView({ p }: { p: Pin }) {
  return p.type === "badge"
    ? <><BadgeIcon b={p} size={54} /><b>{p.name_en}</b><span className="fine">Tier {p.tier}</span></>
    : <><span className={`entry tier-${p.tier}`}><span className="entry-tier">{TIER[p.tier].toUpperCase()}</span></span><b>{p.name}</b>
        <span className="fine">{p.province ?? new Date(p.earned_at).getFullYear()}</span></>;
}

/** A modal with focus handling (focus in, Escape, focus back). */
function Modal({ label, className, onClose, children }: { label: string; className: string; onClose: () => void; children: ReactNode }) {
  const box = useDialog(onClose);
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${className}`} ref={box} tabIndex={-1}>{children}</div>
    </div>
  );
}

/** Pick up to 3 earned badges or stamps to pin under your name. */
function PinPicker({ page, stamps, onClose, onSaved }: { page: ProfilePage; stamps: PassportStamp[]; onClose: () => void; onSaved: () => void }) {
  const [pins, setPins] = useState(() => page.showcase.map((p) => `${p.type}:${p.type === "badge" ? p.slug : p.id}`));
  const [msg, setMsg] = useState("");
  const toggle = (k: string) => setPins((xs) => xs.includes(k) ? xs.filter((x) => x !== k) : xs.length >= 3 ? xs : [...xs, k]);
  const save = () => setShowcase(pins.map((k) => { const [type, id] = k.split(":"); return { type: type as "badge" | "stamp", id }; }))
    .then(() => { onSaved(); onClose(); }).catch(() => setMsg("Couldn't save. Try again."));
  const earned = page.badges.filter((b) => b.tier > 0);
  const best = [...stamps].sort((a, b) => b.tier - a.tier || b.earned_at.localeCompare(a.earned_at)).slice(0, 30);
  // a plain function, not a component: a component made here would remount (and drop focus) on every toggle
  const opt = (k: string, children: ReactNode) =>
    <li key={k}><button type="button" className={`pin-opt${pins.includes(k) ? " on" : ""}`} aria-pressed={pins.includes(k)} onClick={() => toggle(k)}>
      {children}{pins.includes(k) && <span className="pin-no num">{pins.indexOf(k) + 1}</span>}</button></li>;
  return (
    <Modal label="Pin to your profile" className="pin-picker" onClose={onClose}>
        <header className="modal-head"><span><h2>Showcase</h2><span className="fine">Pick up to 3 to show under your name ({pins.length}/3)</span></span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        <h4 className="eyebrow">Badges</h4>
        {earned.length ? <ul className="pin-grid">{earned.map((b) => opt(`badge:${b.slug}`, <><BadgeIcon b={b} size={44} /><b>{b.name_en}</b></>))}</ul>
          : <p className="fine">Earn a badge first: stamps, photos and quests all count.</p>}
        <h4 className="eyebrow">Stamps</h4>
        {best.length ? <ul className="pin-grid">{best.map((s) => opt(`stamp:${s.place_id}`,
          <><span className={`entry tier-${s.tier}`}><span className="entry-tier">{TIER[s.tier].toUpperCase()}</span></span><b>{s.name}</b></>))}</ul>
          : <p className="fine">Check in somewhere to collect stamps.</p>}
        {msg && <p className="fine" role="alert">{msg}</p>}
        <button type="button" className="btn" onClick={save}><Check size={16} aria-hidden /> Save showcase</button>
    </Modal>
  );
}

/**
 * One profile page: a hero in your passport-cover colours with your province map, a showcase of 3 pins, quick actions
 * (Passport, Logbook, Shop, Siam Si), stats and badges. Mine keeps settings and account in a sheet; a friend's adds Nudge.
 */
function ProfileView({ id, self, profile, refreshKey, onBack, editAvatar, editName, onChange, openFriend, openPlace, openShop, openBag, passport, onPassport }: {
  id: string; self: boolean; profile: Profile | null; refreshKey: number; onBack?: () => void;
  editAvatar?: () => void; editName?: () => void; onChange: () => void; openFriend?: (id: string) => void; openPlace?: (id: number) => void;
  openShop?: () => void; openBag?: () => void; passport?: boolean; onPassport?: () => void;
}) {
  const [page, setPage] = useState<ProfilePage | null>(null);
  const [book, setBook] = useState<{ stamps: PassportStamp[]; photos: PassportPhoto[]; trips?: TripMemory[] } | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [msg, setMsg] = useState("");
  const [again, setAgain] = useState(0);
  useEffect(() => { getProfilePage(id).then(setPage).catch(() => setMsg("Couldn't load this profile.")); }, [id, refreshKey, again]);
  // asked from outside (the provinces counter up top): open the passport, which shows once its stamps are in
  useEffect(() => { if (passport) { setSheet("book"); onPassport?.(); } }, [passport]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { (self ? getPassport() : getFriendPassport(id)).then((b) => setBook({ stamps: b.stamps, photos: b.photos, trips: "trips" in b ? b.trips : undefined })).catch(() => undefined); }, [id, self, refreshKey]);

  const doNudge = () => nudge(id).then(() => setMsg(`Nudged ${page?.nickname}. They'll see it in their feed.`))
    .catch((e) => setMsg(e instanceof ApiError && e.code === "already_nudged" ? "You nudged them today already." : "Couldn't nudge. Try again."));

  if (!page) return <div className="page-col">{onBack && <button type="button" className="link" onClick={onBack}><ArrowLeft size={16} /> Back</button>}{msg ? <p className="fine">{msg}</p> : <SkelProfile self={self} theme={self ? profile?.look?.theme : undefined} />}</div>;
  const look = self ? profile?.look ?? page.look : page.look;
  const avatar = self ? profile?.avatar : page.avatar;
  const counts = new Map<number, number>();
  for (const s of book?.stamps ?? []) if (s.province_id != null) counts.set(s.province_id, (counts.get(s.province_id) ?? 0) + 1);
  const { into, span } = levelProgress(page.xp);
  const tickets = self ? profile?.fortuneTickets ?? 0 : 0;

  return (
    <div className="page-col stack profile">
      {onBack && <button type="button" className="link back-link" onClick={onBack}><ArrowLeft size={16} aria-hidden /> Back</button>}
      <header className={`profile-hero cover-bg theme-${look.theme ?? "classic"}`}>
        <div className="hero-map" aria-hidden><ProvinceMap counts={counts} selected={null} onSelect={() => undefined} /></div>
        {self && <div className="hero-tools">
          <button type="button" className="icon-btn" onClick={() => setSheet("share")} disabled={!book} aria-label="Share your progress"><Share2 size={18} /></button>
          <button type="button" className="icon-btn" onClick={() => setSheet("settings")} aria-label="Settings and account"><Settings size={18} /></button>
        </div>}
        <div className="profile-avatar">
          <Avatar name={page.nickname} colour={page.colour} avatar={avatar} size={112} />
          {self && <button type="button" className="avatar-edit" onClick={editAvatar} aria-label="Edit avatar"><Pencil size={16} /></button>}
        </div>
        <div className="profile-id">
          <h1 className={`flair flair-${look.flair ?? "none"}`}>{page.nickname}{self && <button type="button" className="icon-btn name-edit" onClick={editName} aria-label="Edit name"><Pencil size={14} /></button>}</h1>
          {page.title && <span className="profile-title">{page.title}</span>}
          <span className="hero-level"><b className="num">Level {page.level}</b>
            {span ? <><progress value={into} max={span} aria-label={`${into} of ${span} XP to level ${page.level + 1}`} /><span className="num">{span - into} XP to go</span></>
              : <span>Max level</span>}</span>
          {page.crowns.length > 0 && <span className="row tight crowns">{page.crowns.map((c) =>
            <span key={c.id} className="crown-chip" title={`${c.visits} visit-days in 90 days`}><Crown size={13} aria-hidden /> {c.name_en} champion</span>)}</span>}
          <span className="hero-meta">Joined {month(page.joined)} · {page.friends} {page.friends === 1 ? "friend" : "friends"}</span>
        </div>
      </header>
      {!self && <div className="row">
        <button type="button" className="btn small" onClick={doNudge}><Zap size={14} aria-hidden /> Nudge</button>
        <button type="button" className="btn ghost small" onClick={() => { if (confirm(`Remove ${page.nickname} from your friends?`)) removeFriend(id).then(onBack); }}>
          <UserMinus size={14} aria-hidden /> Remove</button>
      </div>}
      {msg && <p className="fine" role="status">{msg}</p>}

      {self && page.showcase.length > 0 && <div className="row between showcase-head"><h4 className="eyebrow">Showcase</h4>
        <button type="button" className="link" onClick={() => setSheet("pins")}>Edit</button></div>}
      <section className="showcase" aria-label="Showcase">
        {page.showcase.map((p) => <div key={`${p.type}:${p.type === "badge" ? p.slug : p.id}`} className="show-pin"><PinView p={p} /></div>)}
        {self && page.showcase.length < 3 && <button type="button" className="show-pin add" style={{ gridColumn: `span ${3 - page.showcase.length}` }} onClick={() => setSheet("pins")}><Plus size={22} aria-hidden /><span>Pin a badge or stamp</span></button>}
        {!self && !page.showcase.length && <p className="fine">Nothing pinned yet.</p>}
      </section>

      <nav className="profile-actions" aria-label="Open">
        <button type="button" className="primary" onClick={() => setSheet("book")} disabled={!book}><BookOpen size={24} aria-hidden /><span>Passport</span></button>
        <button type="button" onClick={() => setSheet("log")} disabled={!book}><NotebookPen size={24} aria-hidden /><span>Logbook</span></button>
        {self && <button type="button" onClick={openShop}><ShoppingBag size={24} aria-hidden /><span>Shop</span></button>}
        {self && <button type="button" onClick={openBag}><Backpack size={24} aria-hidden /><span>Bag</span></button>}
        {self && <a href="#siamsi"><Sparkles size={24} aria-hidden /><span>Siam Si</span>{tickets > 0 && <b className="dot num">{tickets}</b>}</a>}
      </nav>

      <ul className="stat-strip">
        <li className="s-xp"><b className="num"><Zap size={20} aria-hidden />{page.xp}</b><span>XP</span></li>
        <li className="s-provinces"><b className="num"><MapIcon size={20} aria-hidden />{page.provinces}<small>/77</small></b><span>Provinces</span></li>
        <li className="s-stamps"><b className="num"><Stamp size={20} aria-hidden />{page.stamps}</b><span>Stamps</span></li>
        <li className="s-photos"><b className="num"><Camera size={20} aria-hidden />{page.photos}</b><span>Photos</span></li>
        <li className="s-badges"><b className="num"><Award size={20} aria-hidden />{page.badges.filter((b) => b.tier > 0).length}</b><span>Badges</span></li>
        <li className="s-rank"><b className="num"><Crown size={20} aria-hidden />{page.rank ? `#${page.rank}` : "–"}</b><span>Rank</span></li>
      </ul>

      {self && <div id="siamsi"><SiamSi profile={profile} onChange={onChange} onShop={openShop} /></div>}

      <h3>Achievements</h3>
      <Badges list={page.badges} shareAs={self ? { name: page.nickname, hasPlus: !!profile?.plusUntil } : undefined} />

      {self && openPlace && <SavedLists openPlace={openPlace} />}
      {self && openFriend && <FriendsSection profile={profile} onOpen={openFriend} />}

      {sheet === "settings" && (
        <Modal label="Settings" className="settings" onClose={() => setSheet(null)}>
          <SettingsSheet refreshKey={refreshKey} profile={profile} onChange={onChange} onClose={() => setSheet(null)} />
        </Modal>
      )}
      {sheet === "pins" && book && <PinPicker page={page} stamps={book.stamps} onClose={() => setSheet(null)} onSaved={() => setAgain((n) => n + 1)} />}
      {sheet === "log" && book && <Logbook owner={page.nickname} stamps={book.stamps} onClose={() => setSheet(null)} />}
      {sheet === "share" && <ShareSheet hasPlus={!!profile?.plusUntil} onClose={() => setSheet(null)}
        options={[{ id: "progress", label: "Provinces", card: { kind: "progress", name: page.nickname, visited: new Set(counts.keys()) } },
          { id: "stats", label: "Stats sticker", card: { kind: "stats", name: page.nickname, visited: new Set(counts.keys()), level: page.level, stamps: page.stamps } }]} />}
      {sheet === "book" && book && <Book onClose={() => setSheet(null)} stamps={book.stamps} photos={book.photos} trips={book.trips}
        shareAs={self ? { name: page.nickname, hasPlus: !!profile?.plusUntil } : undefined} theme={look.theme} frame={look.frame}
        owner={{ nickname: page.nickname, colour: page.colour, avatar, title: page.title, level: page.level,
          xp: page.xp, joined: page.joined, code: self ? page.friend_code : null }} />}
    </div>
  );
}

/** Profile tab: mine, or a friend's when one is opened (from the feed, friends list or a link). */
export default function ProfileTab({ profile, refreshKey, onChange, editAvatar, editName, friend, setFriend, openPlace, openShop, openBag, passport, onPassport }: {
  profile: Profile | null; refreshKey: number; onChange: () => void; editAvatar: () => void; editName: () => void;
  friend: string | null; setFriend: (id: string | null) => void; openPlace: (id: number) => void; openShop: () => void; openBag: () => void;
  passport: boolean; onPassport: () => void;
}) {
  const user = useUser();
  if (!user) return <div className="page-col"><SkelProfile /></div>;
  return friend
    ? <ProfileView key={friend} id={friend} self={false} profile={profile} refreshKey={refreshKey} onBack={() => setFriend(null)} onChange={onChange} />
    : <ProfileView key="me" id={user.id} self profile={profile} refreshKey={refreshKey} editAvatar={editAvatar} editName={editName} onChange={onChange}
        openFriend={(id) => { setFriend(id); scrollTo({ top: 0 }); }} openPlace={openPlace} openShop={openShop} openBag={openBag} passport={passport} onPassport={onPassport} />;
}
