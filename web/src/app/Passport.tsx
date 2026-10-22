import { useEffect, useState } from "react";
import { callFn, ensureSession, supabase } from "../lib/supabase";

interface Collection { id: number; slug: string; name: string; description: string; required_count: number; collection_places: { place_id: number }[] }

export default function Passport({ refreshKey }: { refreshKey: number }) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [visited, setVisited] = useState<Set<number>>(new Set());
  const [badges, setBadges] = useState<Set<number>>(new Set());
  const [recent, setRecent] = useState<{ id: string; status: string; created_at: string; places: { name: string } | null }[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      await ensureSession();
      const [c, ch, b] = await Promise.all([
        supabase.from("collections").select("id, slug, name, description, required_count, collection_places(place_id)").order("id"),
        supabase.from("checkins").select("id, place_id, status, rewarded, created_at, places(name)").order("created_at", { ascending: false }).limit(50),
        supabase.from("user_badges").select("collection_id"),
      ]);
      setCollections((c.data ?? []) as Collection[]);
      const rows = (ch.data ?? []) as unknown as { id: string; place_id: number; status: string; rewarded: boolean; created_at: string; places: { name: string } | null }[];
      setVisited(new Set(rows.filter((r) => r.rewarded).map((r) => r.place_id)));
      setRecent(rows.slice(0, 8));
      setBadges(new Set((b.data ?? []).map((r) => r.collection_id as number)));
    })().catch(() => setMsg("Couldn't load your passport. Check your connection."));
  }, [refreshKey]);

  const deleteAccount = async () => {
    try {
      await callFn("delete-account", {});
      await supabase.auth.signOut();
      setMsg("Account deleted. A fresh guest passport starts next time you plan a route.");
      setRecent([]); setVisited(new Set()); setBadges(new Set());
    } catch { setMsg("Couldn't delete the account. Try again."); }
    setConfirmDelete(false);
  };

  return (
    <div className="stack passport">
      <h2>Your passport</h2>
      <div className="collections">
        {collections.map((c) => {
          const have = c.collection_places.filter((p) => visited.has(p.place_id)).length;
          const done = badges.has(c.id);
          return (
            <article key={c.id} className={`collection ${done ? "done" : ""}`}>
              <div className="collection-top">
                <h3>{c.name}</h3>
                {done && <span className="mini-stamp">Earned</span>}
              </div>
              <p className="fine">{c.description}</p>
              <div className="dots" aria-label={`${Math.min(have, c.required_count)} of ${c.required_count}`}>
                {Array.from({ length: c.required_count }, (_, i) => <span key={i} className={i < have ? "on" : ""} />)}
              </div>
            </article>
          );
        })}
      </div>

      <h3>Recent check-ins</h3>
      {recent.length === 0
        ? <p className="fine">No check-ins yet. Plan a route and check in at a stop to get your first stamp.</p>
        : <ul className="recent">{recent.map((r) => (
            <li key={r.id}><span>{r.places?.name ?? "Place"}</span><span className={`chip ${r.status}`}>{r.status}</span></li>
          ))}</ul>}

      <div className="danger">
        {!confirmDelete
          ? <button className="btn ghost" onClick={() => setConfirmDelete(true)}>Delete my account</button>
          : <div className="stack">
              <p>This deletes your account, check-ins, badges and selfies. It can't be undone.</p>
              <div className="row">
                <button className="btn danger-btn" onClick={deleteAccount}>Delete everything</button>
                <button className="btn ghost" onClick={() => setConfirmDelete(false)}>Keep my account</button>
              </div>
            </div>}
        {msg && <p className="fine" role="status">{msg}</p>}
      </div>
    </div>
  );
}
