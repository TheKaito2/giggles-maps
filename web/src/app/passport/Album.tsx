import { useEffect, useState } from "react";
import { type PassportPhoto, photoUrls } from "../../lib/api";

/** Check-in photos, newest first, grouped by day (a ride-along's shared album). */
export default function Album({ photos, frame = "none", by }: {
  photos: PassportPhoto[]; frame?: string; by?: (p: PassportPhoto) => string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // keyed on the paths: the caller rebuilds the array on every position update
  const key = photos.map((p) => p.path).join("|");
  useEffect(() => { if (key) photoUrls(key.split("|")).then(setUrls).catch(() => undefined); }, [key]);
  if (!photos.length) return <p className="fine">No photos yet.</p>;

  const days = new Map<string, PassportPhoto[]>();
  for (const p of photos) {
    const d = new Date(p.at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    days.set(d, [...(days.get(d) ?? []), p]);
  }
  return (
    <div className="album">
      {[...days].map(([day, list]) => (
        <section key={day}>
          <h4 className="eyebrow">{day}</h4>
          <ul className={`album-grid frame-${frame}`}>
            {list.map((p) => (
              <li key={p.checkin_id}>
                {urls[p.path] ? <img src={urls[p.path]} alt={p.caption ?? `Photo at ${p.place}`} loading="lazy" /> : <div className="ph" />}
                <div className="album-cap"><span>{by && <>{by(p)} · </>}<b>{p.place}</b>{p.caption && <> · {p.caption}</>}</span></div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
