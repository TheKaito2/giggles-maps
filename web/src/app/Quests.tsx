import { useEffect, useState } from "react";
import { Clock, Sparkles, Users, Zap } from "lucide-react";
import { useDialog } from "../lib/useDialog";
import { ApiError } from "../lib/supabase";
import { type Challenge, claimQuest, type FriendQuest, type QuestReward, getFriendQuest, getPassport, getSocial, nudge, type Profile, setFriendQuest,
  type Card } from "../lib/api";
import Avatar from "./social/Avatar";
import VerifyLocal from "./VerifyLocal";
import { SkelRows, Spinner } from "./Skeleton";

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

/** Treasure chest: closed while in progress, wobbling when ready to claim, open and glowing once claimed. */
function Chest({ open, ready = false, size = 44 }: { open: boolean; ready?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 64 56" width={size} height={size * 56 / 64} className={`chest${open ? " open" : ""}${ready ? " ready" : ""}`} aria-hidden>
      <rect x="6" y="24" width="52" height="28" rx="5" fill="#c97d2b" /><rect x="6" y="24" width="52" height="7" fill="#a8621c" />
      <g className="lid"><path d="M6 24 C6 8 58 8 58 24 Z" fill="#e0953a" /><rect x="28" y="16" width="8" height="12" rx="2" fill="#f2c230" /></g>
      <rect x="27" y="30" width="10" height="10" rx="2" fill="#f2c230" />
      {open && <g fill="#ffd23f">{[[18, 8], [32, 3], [46, 8]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.5" />)}</g>}
    </svg>
  );
}

function Quest({ c, onClaim }: { c: Challenge; onClaim: (c: Challenge) => void }) {
  const ready = !c.claimed && c.have >= c.need;
  return (
    <li className={`quest${c.claimed ? " done" : ""}${ready ? " ready" : ""}`}>
      <Chest open={c.claimed} ready={ready} />
      <div className="quest-main">
        <b>{c.title_en}</b><span className="fine">{c.title_th}</span>
        <div className="quest-bar"><span style={{ width: `${Math.min(100, (100 * c.have) / c.need)}%` }} /><em className="num">{Math.min(c.have, c.need)} / {c.need}</em></div>
      </div>
      {ready ? <button type="button" className="btn gold small claim-btn" onClick={() => onClaim(c)}>Claim</button>
        : <span className="quest-reward num">{c.claimed ? "Claimed" : <>+{c.xp} XP<br />+{c.coins} coins</>}</span>}
    </li>
  );
}

/** The chest ceremony: it shakes while the claim goes through, bursts open, and the rewards pop out. */
function ChestOpen({ quest, onClose, onClaimed }: { quest: Challenge; onClose: () => void; onClaimed: () => void }) {
  const box = useDialog(onClose);
  const [reward, setReward] = useState<QuestReward | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wait = new Promise((r) => setTimeout(r, calm ? 0 : 1100));
    navigator.vibrate?.([40, 60, 40, 60, 40]);
    Promise.all([claimQuest(quest.slug), wait]).then(([r]) => {
      if (!live) return;
      setReward(r); onClaimed(); navigator.vibrate?.(120);
    }).catch((e) => live && setError(e instanceof ApiError && e.message === "not_ready" ? "This chest was already opened." : "Couldn't open the chest. Try again."));
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="chest-stage" role="dialog" aria-modal="true" aria-labelledby="chest-title" ref={box} tabIndex={-1}>
      <h2 id="chest-title" className="chest-title">{quest.title_en}<span lang="th">{quest.title_th}</span></h2>
      <div className={`chest-big${reward ? " burst" : error ? "" : " shaking"}`}>
        {reward && <span className="chest-rays" aria-hidden />}
        <Chest open={!!reward} size={200} />
      </div>
      {reward ? (
        <div className="chest-rewards" role="status">
          <span className="reward-pop num" style={{ animationDelay: ".05s" }}>+{reward.xp} XP</span>
          {reward.member ? <span className="reward-pop num" style={{ animationDelay: ".2s" }}>+{reward.coins} coins</span>
            : <span className="reward-pop fine" style={{ animationDelay: ".2s" }}>Coins come with membership</span>}
          <span className="reward-pop" style={{ animationDelay: ".35s" }}><Sparkles size={18} aria-hidden /> +1 Siam Si shake</span>
          {reward.level_up && <span className="reward-pop level" style={{ animationDelay: ".5s" }}>Level up! Level {reward.level}</span>}
        </div>
      ) : <p className="chest-hint" role="status">{error || <><Spinner /> Opening…</>}</p>}
      {(reward || error) && <button type="button" className="btn big" onClick={onClose}>{reward ? "Nice!" : "Close"}</button>}
    </div>
  );
}

/** Quests tab (Duolingo-style): the friends quest, daily and weekly quests with reset timers, province sets, collections. */
export default function Quests({ profile, refreshKey, onChange, onShop }: { profile: Profile | null; refreshKey: number; onChange: () => void; onShop: () => void }) {
  const [list, setList] = useState<Challenge[] | null>(null);   // null while loading
  const [fq, setFq] = useState<FriendQuest | null | undefined>(undefined);
  const [friends, setFriends] = useState<Card[]>([]);
  const [opening, setOpening] = useState<Challenge | null>(null);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const [p, q] = await Promise.all([getPassport(), getFriendQuest()]);
    setList(p.challenges); setFq(q);
    if (!q) getSocial().then((s) => setFriends(s.friends)).catch(() => undefined);
  };
  useEffect(() => { load().catch(() => setMsg("Couldn't load quests.")); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pair = (id: string) => setFriendQuest(id).then(load)
    .catch((e) => setMsg(e instanceof ApiError && e.code === "already_paired" ? "One of you already has a partner this week." : "Couldn't start the quest."));
  const fqDone = list?.find((c) => c.slug === "friend-quest");
  const ready = (list ?? []).filter((c) => !c.claimed && c.have >= c.need).length;

  return (
    <div className="page-col stack">
      <header className="page-hero quests-hero"><Chest open={false} ready={ready > 0} /><h1>Quests</h1>
        <p className="fine">Finish quests to open chests full of XP and coins{profile?.member ? "" : " (coins and levels come with membership)"}.</p></header>
      {ready > 0 && <p className="hint chest-pop" role="status">{ready === 1 ? "A chest is" : `${ready} chests are`} ready to open: tap Claim.</p>}
      {msg && <p className="fine" role="status">{msg}</p>}

      <VerifyLocal />
      <section className="friend-quest glass">
        <div className="row between"><h3><Users size={18} aria-hidden /> Friends Quest</h3>{<span className="chip"><Clock size={12} aria-hidden /> {left("week")}</span>}</div>
        {fq === undefined ? <SkelRows n={1} avatar={56} /> : fq ? <>
          <div className="fq-pair">
            <span className="fq-person"><Avatar name={profile?.nickname ?? "You"} colour={profile?.colour ?? "marigold"} avatar={profile?.avatar} size={56} /><b>You</b><span className="num">{fq.me}</span></span>
            <span className="fq-plus">+</span>
            <span className="fq-person"><Avatar name={fq.partner.nickname} colour={fq.partner.colour} avatar={fq.partner.avatar} size={56} /><b>{fq.partner.nickname}</b><span className="num">{fq.them}</span></span>
          </div>
          <p className="fine center">Collect 10 new stamps between you this week. Both get +150 XP and +40 coins.</p>
          <div className="quest-bar big"><span style={{ width: `${Math.min(100, 10 * (fq.me + fq.them))}%` }} /><em className="num">{Math.min(10, fq.me + fq.them)} / 10</em></div>
          {fqDone?.claimed ? <p className="badge-earned center">Quest complete!</p>
            : fqDone && fqDone.have >= fqDone.need ? <button type="button" className="btn gold claim-btn" onClick={() => setOpening(fqDone)}>Claim your chest</button>
            : <button type="button" className="btn soft" onClick={() => nudge(fq.partner.id).then(() => setMsg(`Nudged ${fq.partner.nickname}.`))
                .catch(() => setMsg("You nudged them today already."))}><Zap size={15} aria-hidden /> Nudge {fq.partner.nickname}</button>}
        </> : friends.length ? <>
          <p className="fine">Team up with one friend this week: 10 new stamps between you and you both win.</p>
          <ul className="fq-pick">{friends.map((f) => <li key={f.id}>
            <button type="button" className="tile" onClick={() => pair(f.id)}><Avatar name={f.nickname} colour={f.colour} avatar={f.avatar} size={52} /><span>{f.nickname}</span></button>
          </li>)}</ul>
        </> : <p className="fine">Add a friend on your Profile to unlock Friends Quests.</p>}
      </section>

      {!list && !msg && <><h3>Daily quests</h3><SkelRows n={3} square avatar={44} /></>}
      {list && GROUPS.map((g) => {
        const items = list.filter((c) => c.kind === g.kind);
        if (!items.length) return null;
        return (
          <section key={g.kind}>
            <div className="row between"><h3>{g.title}</h3>{g.resets && <span className="chip"><Clock size={12} aria-hidden /> {left(g.resets)}</span>}</div>
            <ul className="quest-list">{items.map((c) => <Quest key={`${c.slug}-${c.period ?? ""}`} c={c} onClaim={setOpening} />)}</ul>
          </section>
        );
      })}
      {opening && <ChestOpen quest={opening} onClaimed={() => { load().catch(() => undefined); onChange(); }} onClose={() => setOpening(null)} />}
      {profile?.member && <button type="button" className="link center" onClick={onShop}>Spend your coins in the shop</button>}
    </div>
  );
}
