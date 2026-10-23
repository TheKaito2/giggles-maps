import SiamSi from "./fortune/SiamSi";
import { demoOn, setDemo } from "../lib/demoGps";
import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Pencil, UserMinus, Zap } from "lucide-react";
import { ApiError } from "../lib/supabase";
import { getFriendPassport, getPassport, getProfilePage, nudge, type PassportPhoto, type PassportStamp, type Profile, type ProfilePage,
  removeFriend } from "../lib/api";
import { useUser } from "../lib/auth";
import Avatar from "./social/Avatar";
import FriendsSection from "./social/Friends";
import Badges from "./Badges";
import Book from "./passport/Book";
import Account from "./Account";
import SavedLists from "./SavedLists";
import AdminEdits from "./AdminEdits";

const month = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "";

/** One profile page (Duolingo-style): header, stats tiles, the passport, badges. Mine adds friends and account; a friend's adds Nudge. */
function ProfileView({ id, self, profile, refreshKey, onBack, editAvatar, editName, onChange, openFriend, openPlace }: {
  id: string; self: boolean; profile: Profile | null; refreshKey: number; onBack?: () => void;
  editAvatar?: () => void; editName?: () => void; onChange: () => void; openFriend?: (id: string) => void; openPlace?: (id: number) => void;
}) {
  const [page, setPage] = useState<ProfilePage | null>(null);
  const [book, setBook] = useState<{ stamps: PassportStamp[]; photos: PassportPhoto[] } | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { getProfilePage(id).then(setPage).catch(() => setMsg("Couldn't load this profile.")); }, [id, refreshKey]);

  const openBook = async () => {
    try { setBook(self ? await getPassport() : await getFriendPassport(id)); } catch { setMsg("Couldn't open the passport."); }
  };
  const doNudge = () => nudge(id).then(() => setMsg(`Nudged ${page?.nickname}. They'll see it in their feed.`))
    .catch((e) => setMsg(e instanceof ApiError && e.code === "already_nudged" ? "You nudged them today already." : "Couldn't nudge. Try again."));

  if (!page) return <div className="page-col">{onBack && <button type="button" className="link" onClick={onBack}><ArrowLeft size={16} /> Back</button>}<p className="fine">{msg || "Loading…"}</p></div>;
  const look = self ? profile?.look ?? page.look : page.look;
  return (
    <div className="page-col stack">
      {onBack && <button type="button" className="link back-link" onClick={onBack}><ArrowLeft size={16} aria-hidden /> Back</button>}
      <header className="profile-head">
        <div className="profile-avatar">
          <Avatar name={page.nickname} colour={page.colour} avatar={self ? profile?.avatar : page.avatar} size={132} />
          {self && <button type="button" className="avatar-edit" onClick={editAvatar} aria-label="Edit avatar"><Pencil size={18} /></button>}
        </div>
        <div className="profile-id">
          <h1 className={`flair flair-${look.flair ?? "none"}`}>{page.nickname}</h1>
          {page.title && <span className="profile-title">{page.title}</span>}
          <span className="fine">Joined {month(page.joined)} · {page.friends} {page.friends === 1 ? "friend" : "friends"}</span>
          <div className="row">
            {self ? <>
              <button type="button" className="btn soft small" onClick={editName}><Pencil size={14} aria-hidden /> Name</button>
              <a className="btn soft small" href="#friends">Add friends</a>
            </> : <>
              <button type="button" className="btn small" onClick={doNudge}><Zap size={14} aria-hidden /> Nudge</button>
              <button type="button" className="btn ghost small" onClick={() => { if (confirm(`Remove ${page.nickname} from your friends?`)) removeFriend(id).then(onBack); }}>
                <UserMinus size={14} aria-hidden /> Remove</button>
            </>}
          </div>
        </div>
      </header>
      {msg && <p className="fine" role="status">{msg}</p>}

      <h3>Statistics</h3>
      <ul className="stat-tiles">
        <li><b className="num">{page.xp}</b><span>Total XP</span></li>
        <li><b className="num">{page.level}</b><span>Level</span></li>
        <li><b className="num">{page.provinces}<small>/77</small></b><span>Provinces</span></li>
        <li><b className="num">{page.stamps}</b><span>Stamps</span></li>
        <li><b className="num">{page.photos}</b><span>Photos</span></li>
        <li><b className="num">{page.rank ? `#${page.rank}` : "–"}</b><span>All-time rank</span></li>
      </ul>

      <button type="button" className={`passport-card theme-${look.theme ?? "classic"}`} onClick={openBook}>
        <BookOpen size={28} aria-hidden />
        <span className="passport-card-text"><b>{self ? "Open your passport" : `Open ${page.nickname}'s passport`}</b>
          <span>{page.provinces} of 77 province stamps · {page.stamps} places</span></span>
        <span className="passport-card-word" aria-hidden>PASSPORT</span>
      </button>

      {self && <SiamSi profile={profile} onChange={onChange} />}
      {self && (
        <label className="pref-row demo-toggle">
          <span><b>Demo mode</b><span className="fine">Pretend to be anywhere: tap the map to move, or fast-forward to the next stop. Check-ins
            still count (and are marked as demo). Turning it on or off reloads the app.</span></span>
          <input type="checkbox" role="switch" className="switch" checked={demoOn()} onChange={(e) => { setDemo(e.target.checked); location.reload(); }} />
        </label>
      )}

      <h3>Achievements</h3>
      <Badges list={page.badges} />

      {self && openPlace && <SavedLists openPlace={openPlace} />}
      {self && openFriend && <FriendsSection profile={profile} onOpen={openFriend} />}
      {self && profile?.isAdmin && <AdminEdits />}
      {self && <Account refreshKey={refreshKey} profile={profile} onChange={onChange} />}

      {book && <Book onClose={() => setBook(null)} stamps={book.stamps} photos={book.photos} theme={look.theme} frame={look.frame}
        owner={{ nickname: page.nickname, colour: page.colour, avatar: self ? profile?.avatar : page.avatar, title: page.title, level: page.level,
          xp: page.xp, joined: page.joined, code: self ? page.friend_code : null }} />}
    </div>
  );
}

/** Profile tab: mine, or a friend's when one is opened (from the feed, friends list or a link). */
export default function ProfileTab({ profile, refreshKey, onChange, editAvatar, editName, friend, setFriend, openPlace }: {
  profile: Profile | null; refreshKey: number; onChange: () => void; editAvatar: () => void; editName: () => void;
  friend: string | null; setFriend: (id: string | null) => void; openPlace: (id: number) => void;
}) {
  const user = useUser();
  if (!user) return <div className="page-col"><p className="fine">Loading…</p></div>;
  return friend
    ? <ProfileView key={friend} id={friend} self={false} profile={profile} refreshKey={refreshKey} onBack={() => setFriend(null)} onChange={onChange} />
    : <ProfileView key="me" id={user.id} self profile={profile} refreshKey={refreshKey} editAvatar={editAvatar} editName={editName} onChange={onChange}
        openFriend={(id) => { setFriend(id); scrollTo({ top: 0 }); }} openPlace={openPlace} />;
}
