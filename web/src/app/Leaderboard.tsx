import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { type Card, getLeaderboard, type Profile, setMe } from "../lib/api";
import Avatar from "./social/Avatar";

function Row({ c, me, pinned }: { c: Card; me?: boolean; pinned?: boolean }) {
  return (
    <li className={`board-row${me ? " me" : ""}${pinned ? " pinned" : ""}`}>
      <span className="rank num">{c.rank}</span>
      <Avatar name={c.nickname} colour={c.colour} avatar={c.avatar} size={40} />
      <span className="person-main"><b className={`flair flair-${c.look.flair ?? "none"}`}>{c.nickname}</b>
        <span className="fine">{c.title ? `${c.title} · ` : ""}Lv {c.level} · {c.provinces}/77 provinces</span></span>
      <span className="num xp">{c.xp} XP</span>
    </li>
  );
}

/** All-time leaderboard: podium for the top 3, then the list, with your own row pinned when you're further down. */
export default function Leaderboard({ profile, onChange }: { profile: Profile | null; onChange: () => void }) {
  const [board, setBoard] = useState<{ top: Card[]; me: Card | null; total: number } | null>(null);
  useEffect(() => { getLeaderboard().then(setBoard).catch(() => setBoard(null)); }, [profile?.onLeaderboard, profile?.nickname, profile?.xp]);
  const meInTop = board?.me && board.top.some((c) => c.id === board.me!.id);
  const podium = board?.top.slice(0, 3) ?? [];
  return (
    <div className="page-col stack">
      <header className="page-hero board-hero">
        <Crown size={34} aria-hidden />
        <h1>Leaderboard</h1>
        <p className="fine">All-time explorers by XP{board ? ` · ${board.total} on the board` : ""}</p>
      </header>
      {!board ? <p className="fine">Loading…</p> : <>
        {podium.length > 0 && <ol className="podium" aria-label="Top 3">
          {[podium[1], podium[0], podium[2]].filter(Boolean).map((c) => (
            <li key={c.id} className={`place-${c.rank}`}>
              <div className="podium-who">
                <Avatar name={c.nickname} colour={c.colour} avatar={c.avatar} size={c.rank === 1 ? 76 : 60} />
                <b>{c.nickname}</b><span className="num fine">{c.xp} XP</span>
              </div>
              <span className="podium-block num">{c.rank}</span>
            </li>
          ))}
        </ol>}
        <ol className="board">
          {board.top.slice(3).map((c) => <Row key={c.id} c={c} me={c.id === board.me?.id} />)}
          {board.me && !meInTop && <Row c={board.me} me pinned />}
        </ol>
      </>}
      {board && !board.me && <p className="fine">{profile?.onLeaderboard === false ? "You're hidden from the leaderboard." : "Pick a name and earn XP to get on the board."}</p>}
      <label className="toggle">
        <input type="checkbox" checked={profile?.onLeaderboard ?? true} onChange={(e) => setMe({ onLeaderboard: e.target.checked }).then(onChange)} />
        <span>Show me on the leaderboard (name, avatar and counts only, never photos)</span>
      </label>
    </div>
  );
}
