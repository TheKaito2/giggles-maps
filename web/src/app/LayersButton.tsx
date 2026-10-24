import { useEffect, useState } from "react";
import { Check, CloudDownload, Layers, Trash2, X } from "lucide-react";
import { deletePack, downloadPack, type MapLook, type Night, type Pack, PACKS_URL, savedPacks } from "./mapLayers";
import { SkelRows } from "./Skeleton";
import Info from "./Info";
import Modal from "./Modal";

const NIGHTS: { id: Night; label: string }[] = [{ id: "auto", label: "Auto" }, { id: "on", label: "On" }, { id: "off", label: "Off" }];
const mb = (b: number) => `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`;

interface Listed extends Pack { name_en: string; name_th: string }

/** Download a province's map so the map still works with no signal (planning and directions still need a connection). */
function OfflineMaps({ onClose }: { onClose: () => void }) {
  const [all, setAll] = useState<Listed[] | null>(null);
  const [saved, setSaved] = useState(savedPacks().map((p) => p.iso));
  const [busy, setBusy] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    fetch(`${PACKS_URL}/index.json`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => setAll(Array.isArray(d) ? d : [])).catch(() => { setAll([]); setMsg("Couldn't load the list. Check your connection."); });
  }, []);
  const get = async (p: Listed) => {
    setBusy((b) => ({ ...b, [p.iso]: 0 }));
    navigator.storage?.persist?.().catch(() => undefined);   // ask the browser not to clear saved maps
    try {
      await downloadPack(p, (done) => setBusy((b) => ({ ...b, [p.iso]: done / p.bytes })));
      setSaved(savedPacks().map((x) => x.iso)); setMsg("");
    } catch (e) {
      setMsg(e instanceof DOMException && e.name === "QuotaExceededError" ? "Not enough space on this device. Delete a saved map first."
        : `Couldn't download ${p.name_en}. Try again on Wi-Fi.`);
    }
    setBusy(({ [p.iso]: _, ...rest }) => rest);
  };
  const drop = (iso: string) => deletePack(iso).then(() => { setSaved(savedPacks().map((x) => x.iso)); setMsg(""); })
    .catch(() => setMsg("Couldn't delete that map."));
  const query = q.trim().toLowerCase();
  const list = (all ?? []).filter((p) => !query || p.name_en.toLowerCase().includes(query) || p.name_th.includes(q.trim()))
    .sort((a, b) => Number(saved.includes(b.iso)) - Number(saved.includes(a.iso)) || a.name_en.localeCompare(b.name_en));
  return (
    <Modal labelledBy="offline-title" className="offline-maps" onClose={onClose}>
        <header className="modal-head"><h2 id="offline-title">Offline maps <Info label="About offline maps">Save a province to see its map with no signal. Planning, directions and
          check-ins still need a connection.</Info></h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        <input className="text-in" value={q} placeholder="Search provinces" aria-label="Search provinces" onChange={(e) => setQ(e.target.value)} />
        {all === null ? <SkelRows n={4} avatar={0} /> : <ul className="people">
          {list.map((p) => <li key={p.iso} className="person"><span className="person-main"><b>{p.name_en}</b><span className="fine">{p.name_th} · {mb(p.bytes)}</span></span>
            {p.iso in busy ? <span className="num fine" role="status">{Math.round(busy[p.iso] * 100)}%</span>
              : saved.includes(p.iso) ? <span className="row"><Check size={18} aria-label="Saved" className="ok" />
                  <button type="button" className="icon-btn" onClick={() => drop(p.iso)} aria-label={`Delete ${p.name_en} map`}><Trash2 size={17} /></button></span>
              : <button type="button" className="btn soft small" onClick={() => get(p)}><CloudDownload size={15} aria-hidden /> Save</button>}
          </li>)}
        </ul>}
        {msg && <p className="fine" role="status">{msg}</p>}
    </Modal>
  );
}

/** Layers button on the map: night map and offline maps. */
export default function LayersButton({ look, setLook }: { look: MapLook; setLook: (patch: Partial<MapLook>) => void }) {
  const [open, setOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  return (
    <>
      <button type="button" className="layers-btn" aria-label="Map layers" aria-expanded={open} onClick={() => setOpen(!open)}><Layers size={20} /></button>
      {open && <Modal labelledBy="layers-title" className="layers-pop" onClose={() => setOpen(false)}>
        <header className="modal-head"><h2 id="layers-title">Map</h2>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={20} /></button></header>
        <b>Night map</b>
        <p className="fine">Auto: dark when the app is (Settings › Appearance).</p>
        <div className="seg" role="radiogroup" aria-label="Night map">
          {NIGHTS.map((n) => <button key={n.id} type="button" role="radio" aria-checked={look.night === n.id} className={look.night === n.id ? "on" : ""}
            onClick={() => setLook({ night: n.id })}>{n.label}</button>)}
        </div>
        <button type="button" className="btn soft small" onClick={() => { setOpen(false); setOffline(true); }}><CloudDownload size={15} aria-hidden /> Offline maps</button>
      </Modal>}
      {offline && <OfflineMaps onClose={() => setOffline(false)} />}
    </>
  );
}
