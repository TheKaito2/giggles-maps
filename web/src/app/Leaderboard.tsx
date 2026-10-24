import { useEffect, useState } from "react";
import { Crown, Share2 } from "lucide-react";
import { type Board, type BoardMetric, type BoardPeriod, type BoardRow, type BoardScope, type Champion, getBoard, getChampions, type Profile,
  setMe, SITE } from "../lib/api";
import Avatar from "./social/Avatar";
import ProvinceStamp from "./passport/ProvinceStamp";
import { useProvinces } from "./passport/useProvinces";
import { SkelBoard, SkelTiles } from "./Skeleton";
import Info from "./Info";

const METRICS: { id: BoardMetric; label: string; unit: (n: number) => string }[] = [
  { id: "xp", label: "XP", unit: () => "XP" },
  { id: "provinces", label: "Provinces", unit: (n) => n === 1 ? "province" : "provinces" },
  { id: "landmarks", label: "Landmarks", unit: (n) => n === 1 ? "landmark" : "landmarks" },
  { id: "temples", label: "Temples", unit: (n) => n === 1 ? "temple" : "temples" },
  { id: "food", label: "Food", unit: (n) => n === 1 ? "food stop" : "food stops" },
];
const left = (iso: string) => {
  const h = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 3600_000));
  return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h`;
};

function Row({ c, unit, me, pinned }: { c: BoardRow; unit: (n: number) => string; me?: boolean; pinned?: boolean }) {
  return (
    <li className={`board-row${me ? " me" : ""}${pinned ? " pinned" : ""}`}>
      <span className="rank num">{c.rank ?? "–"}</span>
      <Avatar name={c.nickname} colour={c.colour} avatar={c.avatar} size={40} />
      <span className="person-main"><b className={`flair flair-${c.look.flair ?? "none"}`}>{c.nickname}</b>
        <span className="fine">{c.title ? `${c.title} · ` : ""}Lv {c.level} · {c.provinces}/77 provinces</span></span>
      <span className="num xp">{c.value} {unit(c.value)}</span>
    </li>
  );
}

/** "120 XP to pass Mai": how far you are from the player just above you. */
function Chase({ board, unit }: { board: Board; unit: (n: number) => string }) {
  const me = board.me;
  if (!me) return null;
  const when = board.period === "week" ? " this week" : "";
  if (!me.value) return <p className="chase fine">Earn your first {unit(1)}{when} to get on this board.</p>;
  if (!board.next) return <p className="chase lead"><Crown size={16} aria-hidden /> You're #1{when}. Keep it up!</p>;
  const gap = board.next.value - me.value + 1;
  return (
    <div className="chase">
      <span><b className="num">{gap} {unit(gap)}</b> to pass <b>{board.next.nickname}</b> for #{board.next.rank}</span>
      <progress value={me.value} max={board.next.value + 1} aria-label={`${me.value} of ${board.next.value + 1}`} />
    </div>
  );
}

function Champions({ list }: { list: Champion[] }) {
  const features = useProvinces();
  if (!list.length) return <p className="fine">No champions yet.</p>;
  return (
    <ul className="champ-row" aria-label="Province champions">
      {list.map((c) => {
        const f = features.find((x) => x.id === c.province.id);
        return (
          <li key={c.province.id} className={`champ${c.mine ? " mine" : ""}`}>
            {f && <ProvinceStamp f={f} earnedAt={new Date().toISOString()} size={72} tilt={false} />}
            <b>{c.province.name_en}</b>
            <span className="champ-who"><Crown size={14} aria-hidden /><Avatar name={c.champion.nickname} colour={c.champion.colour} avatar={c.champion.avatar} size={22} />
              {c.mine ? "You" : c.champion.nickname}</span>
            <span className="fine num">{c.visits} visit-days in 90 days</span>
            {!c.mine && c.my_visits > 0 && <span className="champ-need num">{c.need} more to take it</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Weekly and all-time boards, everyone or just friends, by XP or by what you've collected; province champions below. */
export default function Leaderboard({ profile, onChange }: { profile: Profile | null; onChange: () => void }) {
  const [period, setPeriod] = useState<BoardPeriod>("week");
  const [scope, setScope] = useState<BoardScope>("everyone");
  const [metric, setMetric] = useState<BoardMetric>("xp");
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState(false);
  const [champs, setChamps] = useState<Champion[] | null>(null);
  useEffect(() => {
    let live = true;
    setError(false);
    getBoard(scope, period, metric).then((b) => live && setBoard(b)).catch(() => live && setError(true));
    return () => { live = false; };
  }, [scope, period, metric, profile?.onLeaderboard, profile?.nickname, profile?.xp]);
  useEffect(() => { getChampions().then(setChamps).catch(() => setChamps([])); }, [profile?.xp]);
  const unit = METRICS.find((m) => m.id === metric)!.unit;
  const current = board && board.scope === scope && board.period === period && board.metric === metric ? board : null;
  const meInTop = current?.me && current.top.some((c) => c.id === current.me!.id);
  const podium = current?.top.slice(0, 3) ?? [];
  const invite = async () => {
    const url = `${SITE}/app/?friend=${profile?.friendCode ?? ""}`;
    const text = "Race me on Giggles Maps: stamps, provinces and weekly prizes.";
    if (navigator.share) await navigator.share({ title: "Giggles Maps", text, url }).catch(() => undefined);
    else await navigator.clipboard?.writeText(`${text} ${url}`);
  };

  return (
    <div className="page-col stack">
      <header className="page-hero board-hero">
        <Crown size={34} aria-hidden />
        <h1>Leaderboard</h1>
        <p className="fine">{period === "week" ? "This week's explorers" : "All-time explorers"}{current ? ` · ${current.total} on the board` : ""}</p>
      </header>
      <div className="row board-tabs">
        <div className="seg" role="tablist" aria-label="Period">
          {(["week", "all"] as const).map((p) => <button key={p} type="button" role="tab" aria-selected={period === p} className={period === p ? "on" : ""}
            onClick={() => setPeriod(p)}>{p === "week" ? "This week" : "All-time"}</button>)}
        </div>
        <div className="seg" role="tablist" aria-label="Who">
          {(["everyone", "friends"] as const).map((s) => <button key={s} type="button" role="tab" aria-selected={scope === s} className={scope === s ? "on" : ""}
            onClick={() => setScope(s)}>{s === "everyone" ? "Everyone" : "Friends"}</button>)}
        </div>
      </div>
      <div className="chips-scroll board-metrics" role="radiogroup" aria-label="Ranked by">
        {METRICS.map((m) => <button key={m.id} type="button" role="radio" aria-checked={metric === m.id} className={`chip-btn${metric === m.id ? " on" : ""}`}
          onClick={() => setMetric(m.id)}>{m.label}</button>)}
      </div>
      {period === "week" && current?.ends && <p className="week-note fine">Resets in <b className="num">{left(current.ends)}</b>
        <Info label="Weekly prizes">Every Monday the top 3 get +100, +60 and +40 coins, and whoever leads their friends gets +30. Each winner also
          gets a Siam Si shake. Demo check-ins don't count.</Info></p>}

      {error ? <p className="fine">Couldn't load the board. Try again.</p> : !current ? <SkelBoard /> : <>
        {podium.length > 0 && <ol className="podium" aria-label="Top 3">
          {[podium[1], podium[0], podium[2]].filter(Boolean).map((c) => (
            <li key={c.id} className={`place-${c.rank}`}>
              <div className="podium-who">
                <Avatar name={c.nickname} colour={c.colour} avatar={c.avatar} size={c.rank === 1 ? 76 : 60} />
                <b>{c.nickname}</b><span className="num fine">{c.value} {unit(c.value)}</span>
              </div>
              <span className="podium-block num">{c.rank}</span>
            </li>
          ))}
        </ol>}
        {!podium.length && <p className="fine center">Nobody's on this board yet{period === "week" ? " this week" : ""}. First stamp takes #1.</p>}
        <ol className="board">
          {current.top.slice(3).map((c) => <Row key={c.id} c={c} unit={unit} me={c.id === current.me?.id} />)}
          {current.me && !meInTop && current.me.rank != null && <Row c={current.me} unit={unit} me pinned />}
        </ol>
        <Chase board={current} unit={unit} />
        {current.total < 5 && <section className="invite-card glass">
          <b>{scope === "friends" ? "Your friends board is quiet" : "The board needs rivals"}</b>
          <p className="fine">Your code: <b className="num">{profile?.friendCode}</b></p>
          <button type="button" className="btn" onClick={invite}><Share2 size={16} aria-hidden /> Invite friends</button>
        </section>}
      </>}
      {current && !current.me && scope === "everyone" && <p className="fine">{profile?.onLeaderboard === false ? "You're hidden from the everyone board."
        : "Pick a name to get on the board."}</p>}

      <h3><Crown size={18} aria-hidden /> Province champions <Info label="About province champions">Whoever checks in around a province on the most
        different days in 90 days wears its crown. One check-in a day counts, wherever you go in the province.</Info></h3>
      {champs === null ? <SkelTiles n={3} h={150} min={150} /> : <Champions list={champs} />}

      <label className="toggle">
        <input type="checkbox" checked={profile?.onLeaderboard ?? true} onChange={(e) => setMe({ onLeaderboard: e.target.checked }).then(onChange)} />
        <span>Show me on the leaderboard (name, avatar and counts only, never photos)</span>
      </label>
    </div>
  );
}
