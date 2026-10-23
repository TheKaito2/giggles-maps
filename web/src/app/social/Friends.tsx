import { useEffect, useState } from "react";
import { ArrowLeft, UserPlus } from "lucide-react";
import { ApiError } from "../../lib/supabase";
import { addFriend, answerFriend, type Card, type FriendPassport, getFriendPassport, getLeaderboard, getSocial, type Profile,
  removeFriend, setMe, SITE, type Social } from "../../lib/api";
import Avatar from "./Avatar";
import QrLink from "./QrLink";
import RideAlong, { type TripState } from "./RideAlong";
import ProvinceMap from "../passport/ProvinceMap";
import Stamps from "../passport/Stamps";
import Album from "../passport/Album";

const ADD_TEXT: Record<string, string> = {
  code_not_found: "No one has that code. Check it and try again.",
  own_code: "That's your own code.",
  nickname_required: "Pick a name first, so they know who's asking.",
};

function Person({ c, children, onOpen }: { c: Card; children?: React.ReactNode; onOpen?: () => void }) {
  const body = (<>
    <Avatar name={c.nickname} colour={c.colour} />
    <span className="person-main">
      <b className={`flair flair-${c.look.flair ?? "none"}`}>{c.nickname}</b>
      <span className="fine">{c.title ? `${c.title} · ` : ""}Lv {c.level} · {c.stamps} stamps · {c.provinces} provinces</span>
    </span>
  </>);
  return (
    <li className="person">
      {onOpen ? <button type="button" className="person-open" onClick={onOpen}>{body}</button> : body}
      {children}
    </li>
  );
}

function FriendView({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<FriendPassport | null>(null);
  const [province, setProvince] = useState<number | null>(null);
  const [tab, setTab] = useState<"stamps" | "photos">("stamps");
  const [msg, setMsg] = useState("");
  useEffect(() => { getFriendPassport(id).then(setData).catch(() => setMsg("Couldn't open this passport.")); }, [id]);
  const counts = new Map(data?.provinces.map((p) => [p.id, p.stamps]) ?? []);
  const provinceName = (pid: number | null) => data?.provinces.find((p) => p.id === pid)?.name_en ?? "";
  const stamps = data?.stamps.filter((s) => province == null || s.province_id === province) ?? [];
  const photos = data?.photos.filter((p) => province == null || p.province_id === province) ?? [];
  return (
    <div className="stack">
      <button type="button" className="link" onClick={onBack}><ArrowLeft size={16} aria-hidden /> Friends</button>
      {msg && <p className="error">{msg}</p>}
      {data && <>
        <section className={`level-card theme-${data.card.look.theme ?? "classic"}`}>
          <div className="row"><Avatar name={data.card.nickname} colour={data.card.colour} size={48} />
            <div className="level-info"><b className={`flair flair-${data.card.look.flair ?? "none"}`}>{data.card.nickname}</b>
              <span className="fine">{data.card.title ?? "Traveller"} · Level {data.card.level} · {data.card.xp} XP</span></div></div>
        </section>
        <ProvinceMap counts={counts} selected={province} onSelect={setProvince} />
        <div className="seg" role="tablist" aria-label="Passport pages">
          <button type="button" role="tab" aria-selected={tab === "stamps"} className={tab === "stamps" ? "on" : ""} onClick={() => setTab("stamps")}>Stamps ({stamps.length})</button>
          <button type="button" role="tab" aria-selected={tab === "photos"} className={tab === "photos" ? "on" : ""} onClick={() => setTab("photos")}>Photos ({photos.length})</button>
        </div>
        {tab === "stamps" ? <Stamps stamps={stamps} provinceName={provinceName} /> : <Album photos={photos} frame={data.card.look.frame} />}
      </>}
    </div>
  );
}

function BoardRow({ c, me, pinned }: { c: Card; me?: boolean; pinned?: boolean }) {
  return (
    <li className={`board-row${me ? " me" : ""}${pinned ? " pinned" : ""}`}>
      <span className="rank num">{c.rank}</span>
      <Avatar name={c.nickname} colour={c.colour} size={32} />
      <span className="person-main"><b className={`flair flair-${c.look.flair ?? "none"}`}>{c.nickname}</b>
        <span className="fine">{c.title ? `${c.title} · ` : ""}Lv {c.level} · {c.stamps} stamps · {c.provinces} prov.</span></span>
      <span className="num xp">{c.xp} XP</span>
    </li>
  );
}

function Leaderboard({ profile, onChange }: { profile: Profile | null; onChange: () => void }) {
  const [board, setBoard] = useState<{ top: Card[]; me: Card | null; total: number } | null>(null);
  useEffect(() => { getLeaderboard().then(setBoard).catch(() => setBoard(null)); }, [profile?.onLeaderboard, profile?.nickname]);
  const meInTop = board?.me && board.top.some((c) => c.id === board.me!.id);
  return (
    <div className="stack">
      <p className="fine">All-time explorers, ranked by XP. Names and counts only, never photos.</p>
      {!board ? <p className="fine">Loading…</p> : <ol className="board">
        {board.top.map((c) => (
          <BoardRow key={c.id} c={c} me={c.id === board.me?.id} />
        ))}
        {board.me && !meInTop && <BoardRow c={board.me} me pinned />}
      </ol>}
      {board && !board.me && <p className="fine">{profile?.onLeaderboard === false ? "You're hidden from the leaderboard." : "Check in somewhere with a name set to get on the board."}</p>}
      <label className="toggle">
        <input type="checkbox" checked={profile?.onLeaderboard ?? true} onChange={(e) => setMe({ onLeaderboard: e.target.checked }).then(onChange)} />
        <span>Show me on the leaderboard</span>
      </label>
    </div>
  );
}

export default function Friends({ profile, trip, onChange, editName }: {
  profile: Profile | null; trip: TripState; onChange: () => void; editName: () => void;
}) {
  const [tab, setTab] = useState<"friends" | "board" | "trip">(trip.trip ? "trip" : "friends");
  const [social, setSocial] = useState<Social | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const load = () => getSocial().then(setSocial).catch(() => setMsg("Couldn't load friends. Check your connection."));
  useEffect(() => { load(); }, [profile?.nickname]);

  const add = async () => {
    setMsg("");
    try { setMsg((await addFriend(code)) === "friends" ? "You're friends now." : "Request sent. They'll see it next time they open Friends."); setCode(""); load(); }
    catch (e) { setMsg(ADD_TEXT[e instanceof ApiError ? e.code : ""] ?? "Couldn't add that code. Try again."); }
  };

  if (open) return <FriendView id={open} onBack={() => setOpen(null)} />;
  return (
    <div className="stack friends">
      <h2>Friends</h2>
      <div className="seg" role="tablist" aria-label="Friends pages">
        {([["friends", "Friends"], ["board", "Leaderboard"], ["trip", trip.trip ? "Ride along ●" : "Ride along"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "board" && <Leaderboard profile={profile} onChange={onChange} />}
      {tab === "trip" && <RideAlong trip={trip} profile={profile} />}
      {tab === "friends" && <>
        <section className="me-card glass">
          <div className="row between">
            <span className="row"><Avatar name={profile?.nickname ?? "?"} colour={profile?.colour ?? "marigold"} size={44} />
              <span className="person-main"><b>{profile?.nickname ?? "No name yet"}</b><span className="fine">Your friend code <b className="num">{profile?.friendCode}</b></span></span></span>
            <button type="button" className="link" onClick={editName}>Edit</button>
          </div>
          {profile?.friendCode && <QrLink url={`${SITE}/app/?friend=${profile.friendCode}`} label="Your friend QR code" />}
          <p className="fine">Friends scan this with their phone camera, or type your code. Friends can see your passport: stamps, map and photos you haven't hidden.</p>
        </section>

        <form className="row add-friend" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input className="text-in code-in" value={code} maxLength={8} placeholder="Friend code" aria-label="Friend code" autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
          <button className="btn" type="submit" disabled={code.length !== 8}><UserPlus size={16} aria-hidden /> Add</button>
        </form>
        {msg && <p className="fine" role="status">{msg}</p>}

        {!!social?.incoming.length && <section><h4 className="eyebrow">Wants to be friends</h4><ul className="people">
          {social.incoming.map((c) => <Person key={c.id} c={c}>
            <span className="row">
              <button type="button" className="btn soft" onClick={() => answerFriend(c.id, true).then(load)}>Accept</button>
              <button type="button" className="link" onClick={() => answerFriend(c.id, false).then(load)}>Decline</button>
            </span>
          </Person>)}
        </ul></section>}

        <section><h4 className="eyebrow">Your friends ({social?.friends.length ?? 0})</h4>
          {social?.friends.length ? <ul className="people">
            {social.friends.map((c) => <Person key={c.id} c={c} onOpen={() => setOpen(c.id)}>
              <button type="button" className="link" onClick={() => { if (confirm(`Remove ${c.nickname} from your friends?`)) removeFriend(c.id).then(load); }}>Remove</button>
            </Person>)}
          </ul> : <p className="fine">No friends yet. Share your code or scan theirs.</p>}
        </section>

        {!!social?.outgoing.length && <section><h4 className="eyebrow">Waiting for them</h4><ul className="people">
          {social.outgoing.map((c) => <Person key={c.id} c={c}><span className="fine">Sent</span></Person>)}
        </ul></section>}
      </>}
    </div>
  );
}
