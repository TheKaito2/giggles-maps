import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { approveChoice, choiceRequests, getAdminEdits, getLocalStats, type LocalStat, type PendingEdit, reviewEdit } from "../lib/api";

/** Admin only: suggested edits and missing places waiting for review. Approving applies it and pays the author 50 XP. */
export default function AdminEdits() {
  const [edits, setEdits] = useState<PendingEdit[] | null>(null);
  const [stats, setStats] = useState<LocalStat[] | null>(null);
  useEffect(() => { getLocalStats().then(setStats).catch(() => setStats(null)); }, []);
  const load = () => getAdminEdits().then(setEdits).catch(() => setEdits([]));
  useEffect(() => { load(); }, []);
  // shops applying for Giggles Choice (hand-picked partners)
  const [choice, setChoice] = useState<Awaited<ReturnType<typeof choiceRequests>>>([]);
  const loadChoice = () => choiceRequests().then(setChoice).catch(() => setChoice([]));
  useEffect(() => { loadChoice(); }, []);
  if (!edits) return null;
  return (
    <section className="stack" aria-label="Edits to review">
      {choice.length > 0 && <>
        <h3>Giggles Choice applications ({choice.length})</h3>
        {choice.map((c) => (
          <article key={c.shop} className="glass admin-edit">
            <b>{c.name}</b><span className="fine">{c.tier ? `Paying ${c.tier}` : "Not a partner yet"} · applied {new Date(c.at).toLocaleDateString("en-GB")}</span>
            <div className="row">
              <button type="button" className="btn small" onClick={() => approveChoice(c.shop, true).then(loadChoice)}><Check size={14} aria-hidden /> Approve</button>
              <button type="button" className="btn ghost small" onClick={() => approveChoice(c.shop, false).then(loadChoice)}><X size={14} aria-hidden /> Turn down</button>
            </div>
          </article>
        ))}
      </>}
      <h3>Edits to review ({edits.length})</h3>
      {edits.length === 0 && <p className="fine">Nothing waiting.</p>}
      {edits.map((e) => (
        <article key={e.id} className="glass admin-edit">
          <b>{e.place ? `Edit: ${e.place.name}` : "New place"}</b>
          <span className="fine">by {e.who.nickname} · {new Date(e.at).toLocaleString("en-GB")}</span>
          <dl>{Object.entries(e.payload).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{String(v)}{e.place && k in e.place ? <span className="fine"> (was {String((e.place as Record<string, unknown>)[k] ?? "empty")})</span> : null}</dd></div>
          ))}</dl>
          {e.payload.lat != null && <a className="link" href={`https://www.openstreetmap.org/?mlat=${e.payload.lat}&mlon=${e.payload.lng}#map=18/${e.payload.lat}/${e.payload.lng}`} target="_blank" rel="noopener noreferrer">See the spot on OpenStreetMap</a>}
          <div className="row">
            <button type="button" className="btn small" onClick={() => reviewEdit(e.id, true).then(load)}><Check size={14} aria-hidden /> Approve</button>
            <button type="button" className="btn ghost small" onClick={() => reviewEdit(e.id, false).then(load)}><X size={14} aria-hidden /> Reject</button>
          </div>
        </article>
      ))}
      {stats && <>
        <h3>Local first, last 30 days</h3>
        <div className="table-wrap"><table className="stats">
          <thead><tr><th>Province</th><th>OTOP/community visits</th><th>New shops</th><th>Nominations</th><th>Local share of stops</th></tr></thead>
          <tbody>{stats.filter((r) => r.local_visits_30d || r.new_shops_30d || r.nominations_30d || r.local_stop_share_pct != null).map((r) => <tr key={r.province}>
            <td>{r.province}</td><td className="num">{r.local_visits_30d}</td><td className="num">{r.new_shops_30d}</td><td className="num">{r.nominations_30d}</td>
            <td className="num">{r.local_stop_share_pct == null ? "–" : `${r.local_stop_share_pct}%`}</td></tr>)}</tbody>
        </table></div>
      </>}
    </section>
  );
}
