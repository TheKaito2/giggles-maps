import { useEffect, useState } from "react";
import { Bookmark, Share2, Trash2 } from "lucide-react";
import { getMyLists, type SavedList, updateList } from "../lib/api";
import { GROUPS, kindOf } from "./kinds";
import { SkelRows } from "./Skeleton";

/** Saved places (Google-Maps-style lists): tap a place to open it on the map; share a list with friends. */
export default function SavedLists({ openPlace }: { openPlace: (id: number) => void }) {
  const [lists, setLists] = useState<SavedList[] | null>(null);
  const load = () => getMyLists().then(setLists).catch(() => setLists([]));
  useEffect(() => { load(); }, []);
  if (!lists) return <section className="stack saved-lists" aria-label="Saved places"><h3>Saved</h3><SkelRows n={2} avatar={0} /></section>;
  return (
    <section className="stack saved-lists" aria-label="Saved places">
      <h3>Saved</h3>
      {lists.map((l, i) => (
        <details key={l.id} className="saved-list" open={i === 0 && l.places.length > 0}>
          <summary><Bookmark size={16} aria-hidden /> <b>{l.name}</b> <span className="fine">{l.places.length} places</span>
            {l.shared && <span className="chip">Shared with friends</span>}</summary>
          {l.places.length ? <ul className="people">{l.places.map((p) => {
            const k = kindOf(p.kind, p.category);
            return <li key={p.id} className="person"><button type="button" className="person-open" onClick={() => openPlace(p.id)}>
              <span className="result-icon" style={{ background: GROUPS[k.group].colour }}><k.icon size={15} aria-hidden /></span>
              <span className="person-main"><b>{p.name}</b><span className="fine">{k.en}</span></span></button></li>;
          })}</ul> : <p className="fine">Nothing saved yet. Tap Save on any place.</p>}
          <div className="row">
            <button type="button" className="btn soft small" onClick={() => updateList(l.id, { shared: !l.shared }).then(load)}>
              <Share2 size={14} aria-hidden /> {l.shared ? "Stop sharing" : "Share with friends"}</button>
            {i > 1 && <button type="button" className="btn ghost small" onClick={() => { if (confirm(`Delete the list ${l.name}?`)) updateList(l.id, { remove: true }).then(load); }}>
              <Trash2 size={14} aria-hidden /> Delete</button>}
          </div>
        </details>
      ))}
    </section>
  );
}
