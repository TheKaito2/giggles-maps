import { useEffect, useState } from "react";
import { EyeOff } from "lucide-react";
import { type PassportPhoto, photoUrls, setPhoto } from "../../lib/api";

/** Your check-in photos, newest first, grouped by day. Hiding one removes it from the passport. */
export default function Album({ photos, onChange }: { photos: PassportPhoto[]; onChange: () => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => { photoUrls(photos.map((p) => p.path)).then(setUrls).catch(() => undefined); }, [photos]);
  if (!photos.length) return <p className="fine">Your check-in photos show up here: the views, the food, the people you went with.</p>;

  const days = new Map<string, PassportPhoto[]>();
  for (const p of photos) {
    const d = new Date(p.at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    days.set(d, [...(days.get(d) ?? []), p]);
  }
  const hide = async (p: PassportPhoto) => { await setPhoto(p.checkin_id, true, p.caption ?? undefined).catch(() => undefined); onChange(); };
  return (
    <div className="album">
      {[...days].map(([day, list]) => (
        <section key={day}>
          <h4 className="eyebrow">{day}</h4>
          <ul className="album-grid">
            {list.map((p) => (
              <li key={p.checkin_id}>
                {urls[p.path] ? <img src={urls[p.path]} alt={p.caption ?? `Photo at ${p.place}`} loading="lazy" /> : <div className="ph" />}
                <div className="album-cap">
                  <span><b>{p.place}</b>{p.caption && <> · {p.caption}</>}</span>
                  <button type="button" className="icon-btn" onClick={() => hide(p)} aria-label={`Hide photo at ${p.place}`} title="Hide from passport">
                    <EyeOff size={15} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
