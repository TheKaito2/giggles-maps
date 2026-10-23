import type { Challenge } from "../../lib/api";

const GROUPS: { kind: Challenge["kind"]; title: string }[] = [
  { kind: "daily", title: "Today" }, { kind: "weekly", title: "This week" },
  { kind: "province", title: "Province sets" }, { kind: "collection", title: "Collections" },
];

/** Daily and weekly quests, province sets and themed collections, with progress. Claimed automatically on check-in. */
export default function Challenges({ list, member }: { list: Challenge[]; member: boolean }) {
  return (
    <div className="challenges">
      {!member && <p className="fine">Challenges count for everyone; their XP and coins unlock when you become a member.</p>}
      {GROUPS.map((g) => {
        const items = list.filter((c) => c.kind === g.kind);
        if (!items.length) return null;
        return (
          <section key={g.kind}>
            <h4 className="eyebrow">{g.title}</h4>
            <ul className="challenge-list">
              {items.map((c) => (
                <li key={c.slug} className={c.claimed ? "done" : ""}>
                  <div className="row between">
                    <span><b>{c.title_en}</b> <span className="fine">{c.title_th}</span></span>
                    <span className="num fine">{c.claimed ? "✓ done" : `+${c.xp} XP · +${c.coins}`}</span>
                  </div>
                  <progress value={c.have} max={c.need} aria-label={`${c.have} of ${c.need}`} />
                  <span className="fine num">{c.have} / {c.need}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
