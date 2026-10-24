import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { type PassportStamp, photoUrls } from "../../lib/api";
import { useDialog } from "../../lib/useDialog";

const TIER = { 3: "Landmark", 2: "Worth a visit", 1: "Everyday" } as const;

/** Every place stamped, newest first, by day: the travel diary. The passport book keeps only provinces and landmarks. */
export default function Logbook({ owner, stamps, onClose }: { owner: string; stamps: PassportStamp[]; onClose: () => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const box = useDialog(onClose);
  const list = [...stamps].sort((a, b) => b.earned_at.localeCompare(a.earned_at));
  useEffect(() => { photoUrls(list.map((s) => s.photo).filter((p): p is string => !!p).slice(0, 120)).then(setUrls).catch(() => undefined); }, [stamps]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = new Map<string, PassportStamp[]>();
  for (const s of list) {
    const d = new Date(s.earned_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    days.set(d, [...(days.get(d) ?? []), s]);
  }
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={`${owner}'s logbook`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal logbook" ref={box} tabIndex={-1}>
        <header className="modal-head">
          <span><h2>Logbook</h2><span className="fine">{list.length} {list.length === 1 ? "place" : "places"}</span></span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        {!list.length && <p className="fine">Check in somewhere and it lands here, with your photo.</p>}
        {[...days].map(([day, rows]) => (
          <section key={day} className="log-day">
            <h4 className="eyebrow">{day} · {rows.length} {rows.length === 1 ? "place" : "places"}</h4>
            <ol className="log-list">
              {rows.map((s) => (
                <li key={s.place_id} className={`tier-${s.tier}`}>
                  {s.photo && urls[s.photo] ? <img src={urls[s.photo]} alt="" loading="lazy" /> : <span className="log-dot" aria-hidden />}
                  <span className="log-main"><b>{s.name}</b>
                    <span className="fine">{new Date(s.earned_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      {s.name_th ? ` · ${s.name_th}` : ""}</span></span>
                  <span className={`log-tier tier-${s.tier}`}>{TIER[s.tier]}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
