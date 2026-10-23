import { useEffect, useState } from "react";
import { Clock, Users, Zap } from "lucide-react";
import { ApiError } from "../lib/supabase";
import { type Challenge, claimQuests, type FriendQuest, getFriendQuest, getPassport, getSocial, nudge, type Profile, setFriendQuest,
  type Card } from "../lib/api";
import Avatar from "./social/Avatar";
import VerifyLocal from "./VerifyLocal";

const GROUPS: { kind: Challenge["kind"]; title: string; resets?: "day" | "week" }[] = [
  { kind: "daily", title: "Daily quests", resets: "day" }, { kind: "weekly", title: "Weekly quests", resets: "week" },
  { kind: "province", title: "Province sets" }, { kind: "collection", title: "Collections" },
];

// time left until the next Bangkok midnight (daily) or Monday 00:00 (weekly)
function left(resets: "day" | "week") {
  const bkk = new Date(Date.now() + 7 * 3600_000);
  const next = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate() + (resets === "day" ? 1 : ((8 - bkk.getUTCDay()) % 7 || 7))));
  const h = Math.floor((next.getTime() - bkk.getTime()) / 3600_000);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`;
}

/** Treasure chest: closed while in progress, open and glowing once claimed. */
function Chest({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 64 56" width="44" height="40" className={`chest${open ? " open" : ""}`} aria-hidden>
      <rect x="6" y="24" width="52" height="28" rx="5" fill="#c97d2b" /><rect x="6" y="24" width="52" height="7" fill="#a8621c" />
      <g className="lid"><path d="M6 24 C6 8 58 8 58 24 Z" fill="#e0953a" /><rect x="28" y="16" width="8" height="12" rx="2" fill="#f2c230" /></g>
      <rect x="27" y="30" width="10" height="10" rx="2" fill="#f2c230" />
      {open && <g fill="#ffd23f">{[[18, 8], [32, 3], [46, 8]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.5" />)}</g>}
    </svg>
  );
}

function Quest({ c }: { c: Challenge }) {
  return (
    <li className={`quest${c.claimed ? " done" : ""}`}>
      <Chest open={c.claimed} />
      <div className="quest-main">
        <b>{c.title_en}</b><span className="fine">{c.title_th}</span>
        <div className="quest-bar"><span style={{ width: `${(100 * c.have) / c.need}%` }} /><em className="num">{c.have} / {c.need}</em></div>
      </div>
      <span className="quest-reward num">{c.claimed ? "Claimed" : <>+{c.xp} XP<br />+{c.coins} coins</>}</span>
    </li>
  );
}

/** Quests tab (Duolingo-style): the friends quest, daily and weekly quests with reset timers, province sets, collections. */
export default function Quests({ profile, refreshKey, onChange }: { profile: Profile | null; refreshKey: number; onChange: () => void }) {
  const [list, setList] = useState<Challenge[]>([]);
  const [fq, setFq] = useState<FriendQuest | null | undefined>(undefined);
  const [friends, setFriends] = useState<Card[]>([]);
  const [opened, setOpened] = useState<string[]>([]);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const claimed = await claimQuests().catch(() => []);   // opening the tab opens any finished chests
    if (claimed.length) { setOpened(claimed.map((c) => c.title)); onChange(); }
    const [p, q] = await Promise.all([getPassport(), getFriendQuest()]);
    setList(p.challenges); setFq(q);
    if (!q) getSocial().then((s) => setFriends(s.friends)).catch(() => undefined);
  };
  useEffect(() => { load().catch(() => setMsg("Couldn't load quests.")); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pair = (id: string) => setFriendQuest(id).then(load)
    .catch((e) => setMsg(e instanceof ApiError && e.code === "already_paired" ? "One of you already has a partner this week." : "Couldn't start the quest."));
  const fqDone = list.find((c) => c.slug === "friend-quest");

  return (
    <div className="page-col stack">
      <header className="page-hero quests-hero"><Chest open={opened.length > 0} /><h1>Quests</h1>
        <p className="fine">Finish quests to open chests full of XP and coins{profile?.member ? "" : " (coins and levels come with membership)"}.</p></header>
      {opened.length > 0 && <p className="hint chest-pop" role="status">Chest opened: {opened.join(", ")}</p>}
      {msg && <p className="fine" role="status">{msg}</p>}

      <VerifyLocal />
      <section className="friend-quest glass">
        <div className="row between"><h3><Users size={18} aria-hidden /> Friends Quest</h3>{<span className="chip"><Clock size={12} aria-hidden /> {left("week")}</span>}</div>
        {fq === undefined ? <p className="fine">Loading…</p> : fq ? <>
          <div className="fq-pair">
            <span className="fq-person"><Avatar name={profile?.nickname ?? "You"} colour={profile?.colour ?? "marigold"} avatar={profile?.avatar} size={56} /><b>You</b><span className="num">{fq.me}</span></span>
            <span className="fq-plus">+</span>
            <span className="fq-person"><Avatar name={fq.partner.nickname} colour={fq.partner.colour} avatar={fq.partner.avatar} size={56} /><b>{fq.partner.nickname}</b><span className="num">{fq.them}</span></span>
          </div>
          <p className="fine center">Collect 10 new stamps between you this week. Both get +150 XP and +40 coins.</p>
          <div className="quest-bar big"><span style={{ width: `${Math.min(100, 10 * (fq.me + fq.them))}%` }} /><em className="num">{Math.min(10, fq.me + fq.them)} / 10</em></div>
          {fqDone?.claimed ? <p className="badge-earned center">Quest complete!</p>
            : <button type="button" className="btn soft" onClick={() => nudge(fq.partner.id).then(() => setMsg(`Nudged ${fq.partner.nickname}.`))
                .catch(() => setMsg("You nudged them today already."))}><Zap size={15} aria-hidden /> Nudge {fq.partner.nickname}</button>}
        </> : friends.length ? <>
          <p className="fine">Team up with one friend this week: 10 new stamps between you and you both win.</p>
          <ul className="fq-pick">{friends.map((f) => <li key={f.id}>
            <button type="button" className="tile" onClick={() => pair(f.id)}><Avatar name={f.nickname} colour={f.colour} avatar={f.avatar} size={52} /><span>{f.nickname}</span></button>
          </li>)}</ul>
        </> : <p className="fine">Add a friend on your Profile to unlock Friends Quests.</p>}
      </section>

      {GROUPS.map((g) => {
        const items = list.filter((c) => c.kind === g.kind);
        if (!items.length) return null;
        return (
          <section key={g.kind}>
            <div className="row between"><h3>{g.title}</h3>{g.resets && <span className="chip"><Clock size={12} aria-hidden /> {left(g.resets)}</span>}</div>
            <ul className="quest-list">{items.map((c) => <Quest key={`${c.slug}-${c.period ?? ""}`} c={c} />)}</ul>
          </section>
        );
      })}
    </div>
  );
}
