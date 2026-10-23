import { useEffect, useState } from "react";
import { Award, Bell, PartyPopper, Trophy, Zap } from "lucide-react";
import { type Card, type FeedItem, getFeed, getSocial, getSpotlight, photoUrls, type Profile, react, type Reaction, type Spotlight } from "../lib/api";
import Avatar from "./social/Avatar";
import ProvinceStamp from "./passport/ProvinceStamp";
import { useProvinces } from "./passport/useProvinces";
import { BadgeIcon } from "./Badges";

const EMOJI: Record<Reaction, string> = { heart: "❤️", fire: "🔥", clap: "👏", wow: "😍" };
const TIER = { 3: "Landmark", 2: "Worth a visit", 1: "Everyday" } as const;
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function line(it: FeedItem): string {
  const name = it.mine ? "You" : it.who.nickname;
  const d = it.data as Record<string, string | number>;
  switch (it.kind) {
    case "stamp": return `${name} got a stamp at ${it.place?.name ?? "a place"}${d.group_bonus ? " with their ride-along crew" : ""}`;
    case "province": return `${name} entered ${it.province?.name_en ?? "a new province"}`;
    case "level": return `${name} reached level ${d.level}`;
    case "challenge": return `${name} finished “${d.title}”`;
    case "badge": return `${name} earned ${d.name_en} ${["", "I", "II", "III", "IV", "V"][Number(d.tier)]}`;
    case "nudge": return it.mine ? `You nudged ${it.to?.nickname}` : `${it.who.nickname} nudged you: time for a stamp!`;
  }
}

function Item({ it, url, onReact }: { it: FeedItem; url?: string; onReact: (r: Reaction | null) => void }) {
  const features = useProvinces();
  const [picking, setPicking] = useState(false);
  const f = it.province && features.find((x) => x.id === it.province!.id);
  const d = it.data as Record<string, string | number>;
  const counts = Object.entries(it.reactions) as [Reaction, number][];
  return (
    <li className={`feed-item kind-${it.kind}`}>
      <header>
        <Avatar name={it.who.nickname} colour={it.who.colour} avatar={it.who.avatar} size={44} />
        <span className="person-main"><b>{line(it)}</b><span className="fine">{ago(it.at)}</span></span>
      </header>
      <div className="feed-body">
        {it.kind === "province" && f && <ProvinceStamp f={f} earnedAt={it.at} size={170} />}
        {it.kind === "stamp" && it.place && <div className={`entry big tier-${it.place.tier}`}><span className="entry-tier">{TIER[it.place.tier].toUpperCase()}</span>
          <b>{it.place.name}</b>{it.place.name_th && <span>{it.place.name_th}</span>}</div>}
        {it.kind === "stamp" && url && <figure className="feed-photo"><img src={url} alt={it.caption ?? `Photo at ${it.place?.name}`} loading="lazy" />
          {it.caption && <figcaption>{it.caption}</figcaption>}</figure>}
        {it.kind === "level" && <div className="feed-big"><Trophy size={40} aria-hidden /><b className="num">Level {d.level}</b></div>}
        {it.kind === "challenge" && <div className="feed-big"><Award size={40} aria-hidden /><span className="num">+{d.xp} XP · +{d.coins} coins</span></div>}
        {it.kind === "badge" && <div className="feed-big"><BadgeIcon b={{ icon: String(d.icon), tier: Number(d.tier) }} size={64} /></div>}
        {it.kind === "nudge" && <div className="feed-big"><Zap size={36} aria-hidden /></div>}
      </div>
      {it.kind !== "nudge" && (!it.mine || counts.length > 0) && <footer className="feed-react">
        {counts.map(([r, n]) => <span key={r} className={`react-count${it.my_reaction === r ? " mine" : ""}`}>{EMOJI[r]} {n}</span>)}
        <span className="grow" />
        {picking && <span className="react-pick" role="group" aria-label="Pick a reaction">
          {(Object.keys(EMOJI) as Reaction[]).map((r) => <button key={r} type="button" aria-label={r} aria-pressed={it.my_reaction === r}
            onClick={() => { onReact(it.my_reaction === r ? null : r); setPicking(false); }}>{EMOJI[r]}</button>)}
        </span>}
        {!it.mine && <button type="button" className={`btn small ${it.my_reaction ? "soft" : "gold"}`} onClick={() => setPicking((p) => !p)}>
          <PartyPopper size={15} aria-hidden /> {it.my_reaction ? "Celebrated" : "Celebrate"}</button>}
      </footer>}
    </li>
  );
}

/** Feed tab (Duolingo "Friend updates"): stamps, provinces, level-ups, quests, badges and nudges from you and your friends. */
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
  useEffect(() => { getFeed(scope).then(setItems).catch(() => setItems([])); }, [scope, refreshKey]);
  useEffect(() => { getSocial().then((s) => setFriends(s.friends)).catch(() => undefined); }, [refreshKey]);
  useEffect(() => {
    const paths = (items ?? []).map((i) => i.photo).filter((p): p is string => !!p);
    if (paths.length) photoUrls(paths).then(setUrls).catch(() => undefined);
  }, [items]);

  const onReact = (id: number, r: Reaction | null) => {
    setItems((list) => list?.map((it) => {
      if (it.id !== id) return it;
      const reactions = { ...it.reactions };
      if (it.my_reaction) reactions[it.my_reaction] = (reactions[it.my_reaction] ?? 1) - 1 || undefined;
      if (r) reactions[r] = (reactions[r] ?? 0) + 1;
      return { ...it, my_reaction: r, reactions };
    }) ?? null);
    react(id, r).catch(() => getFeed(scope).then(setItems));
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
        <ul className="feed">{items.map((it) => <Item key={it.id} it={it} url={it.photo ? urls[it.photo] : undefined} onReact={(r) => onReact(it.id, r)} />)}</ul>
      ) : (
        <div className="empty glass">
          <b>{friends.length ? "Nothing new yet" : "Your feed is waiting"}</b>
          <p className="fine">{friends.length ? "Check in somewhere and your stamps show up here for your friends to celebrate."
            : `Add friends with your code ${profile?.friendCode ?? ""} to see their stamps and celebrate them here.`}</p>
          {!friends.length && <button type="button" className="btn" onClick={goProfile}>Add friends</button>}
        </div>
      )}
    </div>
  );
}
