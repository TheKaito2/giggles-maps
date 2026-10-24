import { useEffect, useRef, useState } from "react";
import { Award, Bell, MessageCircle, Share2, Trash2, Trophy, Zap } from "lucide-react";
import { ApiError } from "../lib/supabase";
import { addComment, type Card, type Comment, deleteComment, type FeedItem, getComments, getFeed, getSocial, getSpotlight, photoUrls,
  type Profile, react, type Reaction, type Spotlight } from "../lib/api";
import Avatar from "./social/Avatar";
import ProvinceStamp from "./passport/ProvinceStamp";
import { useProvinces } from "./passport/useProvinces";
import { BadgeIcon, TIER_COLOURS } from "./Badges";
import { type FeedGroup, groupFeed } from "./feedGroups";
import ShareSheet, { type CardOption } from "./share/ShareSheet";

const EMOJI: Record<Reaction, string> = { heart: "❤️", fire: "🔥", clap: "👏", wow: "😍" };
const TIER = { 3: "Landmark", 2: "Worth a visit", 1: "Everyday" } as const;
const WHAT: Record<string, string> = { stamp: "stamp", province: "new province", level: "level-up", challenge: "quest", badge: "badge", fortune: "Siam Si stick" };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function line(g: FeedGroup): string {
  const it = g.items[0];
  const name = it.mine ? "You" : it.who.nickname;
  const d = it.data as Record<string, string | number>;
  if (g.items.length > 1) {
    const prov = g.items.find((x) => x.province)?.province?.name_en;
    return `${name} stamped ${g.items.length} places${prov ? ` in ${prov}` : ""}`;
  }
  switch (it.kind) {
    case "stamp": return `${name} got a stamp at ${it.place?.name ?? "a place"}${d.group_bonus ? " with their ride-along crew" : ""}`;
    case "province": return `${name} entered ${it.province?.name_en ?? "a new province"}`;
    case "level": return `${name} reached level ${d.level}`;
    case "challenge": return `${name} finished “${d.title}”`;
    case "badge": return `${name} earned ${d.name_en} ${["", "I", "II", "III", "IV", "V"][Number(d.tier)]}`;
    case "fortune": return `${name} drew a ${d.rarity === "legendary" ? "Legendary" : "Epic"} Siam Si stick${d.item ? `: ${d.item}` : ""}`;
    case "nudge": return it.mine ? `You nudged ${it.to?.nickname}` : `${it.who.nickname} nudged you: time for a stamp!`;
    case "comment": return it.mine ? `You commented on ${it.to?.nickname}'s ${WHAT[String(d.what)] ?? "post"}`
      : `${it.who.nickname} commented on your ${WHAT[String(d.what)] ?? "post"}: “${d.body}”`;
  }
}

/** What you can share from one of your own posts. */
function shareOptions(it: FeedItem, url: string | undefined, name: string): CardOption[] {
  const d = it.data as Record<string, string | number>, at = new Date(it.at);
  switch (it.kind) {
    case "stamp": {
      if (!it.place) return [];
      const base = { place: it.place.name, placeTh: it.place.name_th, tier: it.place.tier, province: it.province?.name_en ?? null, at, level: null };
      return [{ id: "story", label: "Story", card: { kind: "photo", ...base, photo: url } }, { id: "sticker", label: "Sticker", card: { kind: "sticker", ...base } }];
    }
    case "province": return it.province ? [{ id: "province", label: "New province", card: { kind: "milestone", what: "province", province: it.province.id, at, name } }] : [];
    case "level": return [{ id: "level", label: "Level up", card: { kind: "milestone", what: "level", level: Number(d.level), name } }];
    case "badge": return [{ id: "badge", label: "Badge", card: { kind: "milestone", what: "badge", title: String(d.name_en), tier: Number(d.tier),
      colour: TIER_COLOURS[Number(d.tier)], name } }];
    case "fortune": return [{ id: "fortune", label: "Siam Si", card: { kind: "milestone", what: "fortune", rarity: d.rarity === "legendary" ? "Legendary" : "Epic",
      prize: String(d.item ?? "A rare prize"), stick: Number(d.stick ?? 1), name } }];
    default: return [];
  }
}

function Comments({ it, onCount }: { it: FeedItem; onCount: (n: number) => void }) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { getComments(it.id).then(setList).catch(() => { setList([]); setMsg("Couldn't load comments."); }); }, [it.id]);
  useEffect(() => { if (list) onCount(list.length); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setMsg("");
    try {
      const c = await addComment(it.id, text);
      setList((l) => [...(l ?? []), c]); setText("");
    } catch (e) {
      const code = e instanceof ApiError ? e.message : "";
      setMsg(code === "comment_limit" ? "That's 30 comments today, the daily most." : "Couldn't post that. Try again.");
    } finally { setBusy(false); }
  };
  const remove = async (c: Comment) => {
    await deleteComment(c.id).then(() => setList((l) => (l ?? []).filter((x) => x.id !== c.id))).catch(() => setMsg("Couldn't delete that."));
  };
  return (
    <div className="comments">
      {list === null ? <p className="fine">Loading…</p> : list.map((c) => (
        <div key={c.id} className="comment">
          <Avatar name={c.who.nickname} colour={c.who.colour} avatar={c.who.avatar} size={30} />
          <p><b>{c.mine ? "You" : c.who.nickname}</b> {c.body} <span className="fine">{ago(c.at)}</span></p>
          {(c.mine || it.mine) && <button type="button" className="icon-btn" onClick={() => remove(c)} aria-label="Delete comment"><Trash2 size={14} /></button>}
        </div>
      ))}
      <form className="comment-form" onSubmit={(e) => { e.preventDefault(); post(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={280} placeholder="Say something nice…" aria-label="Write a comment" />
        <button type="submit" className="btn small" disabled={!text.trim() || busy}>Post</button>
      </form>
      {msg && <p className="fine" role="status">{msg}</p>}
    </div>
  );
}

function Post({ g, urls, onReact, onComments, onShare }: {
  g: FeedGroup; urls: Record<string, string>; onReact: (r: Reaction | null) => void; onComments: (n: number) => void; onShare: (o: CardOption[]) => void;
}) {
  const features = useProvinces();
  const [open, setOpen] = useState(false);
  const it = g.items[0];
  const f = it.province && features.find((x) => x.id === it.province!.id);
  const d = it.data as Record<string, string | number>;
  const url = it.photo ? urls[it.photo] : undefined;
  const photos = g.items.map((x) => x.photo && urls[x.photo]).filter((x): x is string => !!x);
  const social = it.kind !== "nudge" && it.kind !== "comment";
  const share = it.mine && g.items.length === 1 ? shareOptions(it, url, it.who.nickname) : [];
  return (
    <li className={`feed-item kind-${it.kind}${g.items.length > 1 ? " group" : ""}`}>
      <header>
        <Avatar name={it.who.nickname} colour={it.who.colour} avatar={it.who.avatar} size={44} />
        <span className="person-main"><b>{line(g)}</b><span className="fine">{ago(it.at)}</span></span>
      </header>
      <div className="feed-body">
        {g.items.length > 1 ? <>
          {photos.length > 0 && <div className={`photo-strip n${Math.min(4, photos.length)}`}>
            {photos.slice(0, 4).map((p, i) => <span key={p} className="strip-cell"><img src={p} alt="" loading="lazy" />
              {i === 3 && photos.length > 4 && <b className="more">+{photos.length - 4}</b>}</span>)}
          </div>}
          <ul className="place-chips">{g.items.map((x) => x.place && <li key={x.id} className={`tier-${x.place.tier}`}>{x.place.name}</li>)}</ul>
        </> : <>
          {it.kind === "province" && f && <ProvinceStamp f={f} earnedAt={it.at} size={170} />}
          {it.kind === "stamp" && it.place && <div className={`entry big tier-${it.place.tier}`}><span className="entry-tier">{TIER[it.place.tier].toUpperCase()}</span>
            <b>{it.place.name}</b>{it.place.name_th && <span>{it.place.name_th}</span>}</div>}
          {it.kind === "stamp" && url && <figure className="feed-photo"><img src={url} alt={it.caption ?? `Photo at ${it.place?.name}`} loading="lazy" />
            {it.caption && <figcaption>{it.caption}</figcaption>}</figure>}
          {it.kind === "level" && <div className="feed-big"><Trophy size={40} aria-hidden /><b className="num">Level {d.level}</b></div>}
          {it.kind === "challenge" && <div className="feed-big"><Award size={40} aria-hidden /><span className="num">+{d.xp} XP · +{d.coins} coins</span></div>}
          {it.kind === "badge" && <div className="feed-big"><BadgeIcon b={{ icon: String(d.icon), tier: Number(d.tier) }} size={64} /></div>}
          {it.kind === "nudge" && <div className="feed-big"><Zap size={36} aria-hidden /></div>}
        </>}
      </div>
      {social && <footer className="feed-react">
        <span className="react-row" role="group" aria-label="React">
          {(Object.keys(EMOJI) as Reaction[]).map((r) => {
            const n = it.reactions[r] ?? 0, on = it.my_reaction === r;
            if (it.mine && !n) return null;   // you can't react to your own post: show only what friends sent
            return <button key={r} type="button" className={`react${on ? " on" : ""}`} aria-pressed={on} aria-label={`${r}${n ? `, ${n}` : ""}`}
              disabled={it.mine} onClick={() => onReact(on ? null : r)}>{EMOJI[r]}{n > 0 && <span className="num">{n}</span>}</button>;
          })}
        </span>
        <span className="grow" />
        <button type="button" className={`react${open ? " on" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`Comments, ${it.comments}`}>
          <MessageCircle size={17} aria-hidden />{it.comments > 0 && <span className="num">{it.comments}</span>}</button>
        {share.length > 0 && <button type="button" className="react" onClick={() => onShare(share)} disabled={!!it.photo && !url} aria-label="Share"><Share2 size={17} aria-hidden /></button>}
      </footer>}
      {social && open && <Comments it={it} onCount={onComments} />}
    </li>
  );
}

/** Feed tab (Duolingo "Friend updates", Strava-style day cards): stamps, provinces, level-ups, quests, badges, nudges and comments. */
export default function Feed({ profile, refreshKey, openFriend, goProfile, openPlace }: {
  profile: Profile | null; refreshKey: number; openFriend: (id: string) => void; goProfile: () => void; openPlace: (id: number) => void;
}) {
  const [spot, setSpot] = useState<Spotlight | null>(null);
  // this week's local spotlight: where you are if location is already allowed, else Sakon Nakhon
  useEffect(() => {
    const get = (lat: number, lng: number) => getSpotlight({ lat, lng }).then(setSpot).catch(() => undefined);
    navigator.permissions?.query({ name: "geolocation" }).then((st) => st.state === "granted"
      ? navigator.geolocation.getCurrentPosition((p) => get(p.coords.latitude, p.coords.longitude), () => get(17.163, 104.149))
      : get(17.163, 104.149)).catch(() => get(17.163, 104.149));
  }, []);
  const [scope, setScope] = useState<"all" | "friends" | "me">("all");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [friends, setFriends] = useState<Card[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [sharing, setSharing] = useState<CardOption[] | null>(null);
  const scopeNow = useRef(scope);
  scopeNow.current = scope;
  useEffect(() => {
    let live = true;   // a slow answer for the scope you just left must not overwrite the new one
    getFeed(scope).then((x) => live && setItems(x)).catch(() => live && setItems([]));
    return () => { live = false; };
  }, [scope, refreshKey]);
  useEffect(() => { getSocial().then((s) => setFriends(s.friends)).catch(() => undefined); }, [refreshKey]);
  useEffect(() => {
    const paths = (items ?? []).map((i) => i.photo).filter((p): p is string => !!p);
    if (paths.length) photoUrls(paths).then(setUrls).catch(() => undefined);
  }, [items]);

  const patch = (id: number, f: (it: FeedItem) => FeedItem) => setItems((list) => list?.map((it) => (it.id === id ? f(it) : it)) ?? null);
  const onReact = (id: number, r: Reaction | null) => {
    patch(id, (it) => {
      const reactions = { ...it.reactions };
      if (it.my_reaction) reactions[it.my_reaction] = (reactions[it.my_reaction] ?? 1) - 1 || undefined;
      if (r) reactions[r] = (reactions[r] ?? 0) + 1;
      return { ...it, my_reaction: r, reactions };
    });
    const was = scope;
    react(id, r).catch(() => getFeed(was).then((x) => { if (was === scopeNow.current) setItems(x); }));
  };

  return (
    <div className="page-col stack">
      <header className="page-hero"><Bell size={30} aria-hidden /><h1>Feed</h1><p className="fine">What you and your friends found lately</p></header>
      <ul className="friend-row" aria-label="Your friends">
        <li><button type="button" className="friend-chip add" onClick={goProfile}><span className="plus">+</span><span>Add</span></button></li>
        {friends.map((f) => <li key={f.id}><button type="button" className="friend-chip" onClick={() => openFriend(f.id)}>
          <Avatar name={f.nickname} colour={f.colour} avatar={f.avatar} size={56} /><span>{f.nickname}</span></button></li>)}
      </ul>
      {spot && <button type="button" className="spotlight" onClick={() => openPlace(spot.id)}>
        {spot.photo ? <img src={spot.photo} alt="" /> : <span className="spotlight-ph" aria-hidden>★</span>}
        <span className="person-main"><span className="eyebrow">Local spotlight{spot.province ? ` · ${spot.province}` : ""}</span>
          <b>{spot.name}</b><span className="fine">{spot.otop ? "OTOP producer" : "Community enterprise"}{spot.visits ? ` · ${spot.visits} visits this week` : ""}</span></span>
      </button>}
      <div className="seg" role="tablist" aria-label="Show">
        {(["all", "friends", "me"] as const).map((s) => <button key={s} type="button" role="tab" aria-selected={scope === s} className={scope === s ? "on" : ""}
          onClick={() => setScope(s)}>{s === "all" ? "All" : s === "friends" ? "Friends" : "Me"}</button>)}
      </div>
      {items === null ? <p className="fine">Loading…</p> : items.length ? (
        <ul className="feed">{groupFeed(items).map((g) => <Post key={g.key} g={g} urls={urls} onReact={(r) => onReact(g.items[0].id, r)}
          onComments={(n) => patch(g.items[0].id, (it) => ({ ...it, comments: n }))} onShare={setSharing} />)}</ul>
      ) : (
        <div className="empty glass">
          <b>{friends.length ? "Nothing new yet" : "Your feed is waiting"}</b>
          <p className="fine">{friends.length ? "Check in somewhere and your stamps show up here for your friends to celebrate."
            : `Add friends with your code ${profile?.friendCode ?? ""} to see their stamps and celebrate them here.`}</p>
          {!friends.length && <button type="button" className="btn" onClick={goProfile}>Add friends</button>}
        </div>
      )}
      {sharing && <ShareSheet options={sharing} hasPlus={!!profile?.plusUntil} onClose={() => setSharing(null)} />}
    </div>
  );
}
