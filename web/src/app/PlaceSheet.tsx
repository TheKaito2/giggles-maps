import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, Camera, Clock, Flag, Globe, MapPin, Navigation, Pencil, Phone, Share2, Star, X } from "lucide-react";
import { ApiError } from "../lib/supabase";
import { createList, deleteReview, getMyLists, getPlacePage, type PlacePage, photoUrls, reportReview, type SavedList, savePlace,
  SITE, suggestEdit, writeReview } from "../lib/api";
import { GROUPS, kindOf } from "./kinds";
import { openNow } from "./hours";
import Avatar from "./social/Avatar";

const ago = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Stars({ value, onPick, size = 16 }: { value: number; onPick?: (n: number) => void; size?: number }) {
  return (
    <span className="stars" role={onPick ? "radiogroup" : "img"} aria-label={onPick ? "Your rating" : `${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => onPick
        ? <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} stars`} onClick={() => onPick(n)}>
            <Star size={size} className={n <= value ? "on" : ""} /></button>
        : <Star key={n} size={size} className={n <= Math.round(value) ? "on" : ""} aria-hidden />)}
    </span>
  );
}

function SaveMenu({ page, onClose, onChange }: { page: PlacePage; onClose: () => void; onChange: () => void }) {
  const [lists, setLists] = useState<SavedList[] | null>(null);
  const [name, setName] = useState("");
  const load = () => getMyLists().then(setLists).catch(() => setLists([]));
  useEffect(() => { load(); }, []);
  const toggle = (l: SavedList) => savePlace(l.id, page.id, !l.places.some((p) => p.id === page.id)).then(() => { load(); onChange(); });
  return (
    <div className="save-menu glass" role="dialog" aria-label="Save to a list">
      <div className="row between"><b>Save to…</b><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
      {!lists ? <p className="fine">Loading…</p> : lists.map((l) => (
        <label key={l.id} className="toggle"><input type="checkbox" checked={l.places.some((p) => p.id === page.id)} onChange={() => toggle(l)} />
          <span>{l.name} <span className="fine">({l.places.length})</span></span></label>
      ))}
      <form className="row add-friend" onSubmit={(e) => { e.preventDefault(); if (name.trim()) createList(name).then(() => { setName(""); load(); }).catch(() => undefined); }}>
        <input className="text-in" value={name} maxLength={40} placeholder="New list" aria-label="New list name" onChange={(e) => setName(e.target.value)} />
        <button className="btn soft small" type="submit">Add</button>
      </form>
    </div>
  );
}

function EditForm({ page, onDone }: { page: PlacePage; onDone: (msg: string) => void }) {
  const [hours, setHours] = useState(page.opening_hours ?? "");
  const [phone, setPhone] = useState(page.phone ?? "");
  const [website, setWebsite] = useState(page.website ?? "");
  const [closed, setClosed] = useState(false);
  const send = () => {
    const payload = closed ? { closed: true } : Object.fromEntries(Object.entries({ opening_hours: hours, phone, website })
      .filter(([k, v]) => v.trim() && v.trim() !== (page as unknown as Record<string, string | null>)[k]));
    if (!Object.keys(payload).length) { onDone("Nothing changed."); return; }
    suggestEdit(page.id, payload).then(() => onDone("Thanks! We'll check it and update the place. +50 XP when it's approved."))
      .catch(() => onDone("Couldn't send that. Try again."));
  };
  return (
    <form className="stack edit-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <label className="field"><span>Opening hours</span><input className="text-in" value={hours} placeholder="Mo-Su 08:00-17:00" onChange={(e) => setHours(e.target.value)} /></label>
      <label className="field"><span>Phone</span><input className="text-in" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} /></label>
      <label className="field"><span>Website</span><input className="text-in" value={website} inputMode="url" onChange={(e) => setWebsite(e.target.value)} /></label>
      <label className="toggle"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /><span>This place has closed for good</span></label>
      <button className="btn small" type="submit">Send suggestion</button>
    </form>
  );
}

/** Google-Maps-style place page: photos, rating, actions, details, busy times, verified reviews, suggest an edit. */
export default function PlaceSheet({ id, onClose, onDirections, onCheckin }: {
  id: number; onClose: () => void; onDirections: (p: PlacePage) => void; onCheckin: (p: PlacePage) => void;
}) {
  const [page, setPage] = useState<PlacePage | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<"save" | "edit" | null>(null);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState("");
  const load = () => getPlacePage(id).then((p) => {
    setPage(p);
    const mine = p?.reviews.find((r) => r.mine);
    if (mine) { setRating(mine.rating); setBody(mine.body ?? ""); }
  }).catch(() => setMsg("Couldn't load this place."));
  useEffect(() => { setPage(null); setMenu(null); setMsg(""); setRating(0); setBody(""); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const paths = (page?.photos ?? []).map((p) => p.path).filter((p): p is string => !!p);
    if (paths.length) photoUrls(paths).then(setUrls).catch(() => undefined);
  }, [page]);

  if (!page) return <aside className="place-sheet glass" aria-busy="true"><button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="Close"><X size={18} /></button><p className="fine">{msg || "Loading…"}</p></aside>;
  const k = kindOf(page.kind, page.category);
  const open = openNow(page.opening_hours);
  const share = () => {
    const url = `${SITE}/app/?place=${page.id}`;
    if (typeof navigator.share === "function") navigator.share({ title: page.name, url }).catch(() => undefined);
    else navigator.clipboard?.writeText(url).then(() => setMsg("Link copied."));
  };
  const submitReview = () => writeReview(page.id, rating, body).then(() => { setMsg("Review saved."); load(); })
    .catch((e) => setMsg(e instanceof ApiError && e.code === "check_in_first" ? "Check in here first: reviews are from verified visits only." : "Couldn't save the review."));
  const peak = page.busy ? Math.max(...page.busy, 1) : 1;
  const hourNow = new Date().getHours();

  return (
    <aside className="place-sheet glass" aria-label={page.name}>
      <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="Close place"><X size={18} /></button>
      {page.photos.length > 0 && (
        <ul className="photo-strip" aria-label="Photos">
          {page.photos.map((ph, i) => {
            const src = ph.url ?? (ph.path ? urls[ph.path] : undefined);
            return <li key={i}>{src ? <img src={src} alt={`${page.name} photo ${i + 1}`} loading="lazy" /> : <div className="ph" />}
              <span className="photo-credit">{ph.source === "wikimedia" ? `${ph.credit} · ${ph.licence} · Wikimedia` : `by ${ph.credit}`}</span></li>;
          })}
        </ul>
      )}
      <header className="place-head">
        <span className="place-card-icon big" style={{ background: GROUPS[k.group].colour }}><k.icon size={22} aria-hidden /></span>
        <div className="person-main">
          <h2>{page.name}</h2>
          {page.name_th && page.name_th !== page.name && <span className="fine">{page.name_th}</span>}
          <span className="row tight">
            {page.rating != null ? <><b className="num">{page.rating}</b><Stars value={page.rating} /><span className="fine">({page.review_count})</span></>
              : <span className="fine">{page.review_count ? `${page.review_count} review${page.review_count > 1 ? "s" : ""}` : "No reviews yet"}</span>}
            <span className="fine">· {k.en}</span>
          </span>
          <span className="row tight">
            {page.tier === 3 && <span className="chip landmark">Landmark</span>}
            {page.otop && <span className="chip otop">OTOP</span>}
            {page.community && <span className="chip otop">Community enterprise</span>}
            {page.local && !page.otop && <span className="chip">Local</span>}
            {page.stamped && <span className="chip">Stamped</span>}
          </span>
        </div>
      </header>

      <div className="place-actions">
        <button type="button" className="btn small" onClick={() => onDirections(page)}><Navigation size={15} aria-hidden /> Directions</button>
        <button type="button" className="btn soft small" onClick={() => setMenu(menu === "save" ? null : "save")}>
          {page.saved_in.length ? <BookmarkCheck size={15} aria-hidden /> : <Bookmark size={15} aria-hidden />} {page.saved_in.length ? "Saved" : "Save"}</button>
        <button type="button" className="btn soft small" onClick={share}><Share2 size={15} aria-hidden /> Share</button>
        {page.detour && <button type="button" className="btn soft small" onClick={() => onCheckin(page)}><Camera size={15} aria-hidden /> Check in</button>}
      </div>
      {menu === "save" && <SaveMenu page={page} onClose={() => setMenu(null)} onChange={load} />}
      {msg && <p className="fine" role="status">{msg}</p>}

      <ul className="place-info">
        {page.opening_hours && <li><Clock size={16} aria-hidden />
          <span>{open === true ? <b className="open">Open now</b> : open === false ? <b className="closed">Closed now</b> : null} <span className="fine">{page.opening_hours}</span></span></li>}
        {page.phone && <li><Phone size={16} aria-hidden /><a href={`tel:${page.phone.split(";")[0].replace(/\s/g, "")}`}>{page.phone.split(";")[0]}</a></li>}
        {page.website && <li><Globe size={16} aria-hidden /><a href={page.website.startsWith("http") ? page.website : `https://${page.website}`} target="_blank" rel="noopener noreferrer">{page.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a></li>}
        {page.address && <li><MapPin size={16} aria-hidden /><span>{page.address}</span></li>}
      </ul>

      {page.busy && (
        <section aria-label="Busy times">
          <h4 className="eyebrow">Busy times today</h4>
          <div className="busy-bars">{page.busy.map((n, i) => (
            <span key={i} className={i + 6 === hourNow ? "now" : ""} style={{ height: `${8 + (n / peak) * 56}px` }} title={`${i + 6}:00 · ${n} check-ins`} />
          ))}</div>
          <div className="busy-axis fine"><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
        </section>
      )}

      <section aria-label="Reviews" className="stack">
        <h4 className="eyebrow">Reviews · verified visits only</h4>
        {page.checked_in ? (
          <form className="review-form stack" onSubmit={(e) => { e.preventDefault(); if (rating) submitReview(); }}>
            <Stars value={rating} onPick={setRating} size={26} />
            <textarea className="text-in" rows={3} maxLength={1000} value={body} placeholder="What was it like? (optional)" onChange={(e) => setBody(e.target.value)} />
            <div className="row">
              <button className="btn small" type="submit" disabled={!rating}>{page.reviews.some((r) => r.mine) ? "Update review" : "Post review · +20 XP"}</button>
              {page.reviews.some((r) => r.mine) && <button type="button" className="link" onClick={() => deleteReview(page.id).then(() => { setRating(0); setBody(""); load(); })}>Delete</button>}
            </div>
          </form>
        ) : <p className="fine">Check in here to leave a review. Every review on Giggles Maps comes from someone who was really there.</p>}
        {page.reviews.map((r, i) => (
          <article key={i} className="review">
            <header className="row tight"><Avatar name={r.who.nickname} colour={r.who.colour} avatar={r.who.avatar} size={32} />
              <b>{r.who.nickname}</b><Stars value={r.rating} size={13} /><span className="fine">{ago(r.at)}</span>
              {!r.mine && <button type="button" className="icon-btn" aria-label="Report review" title="Report"
                onClick={() => reportReview(r.who.id, page.id).then(() => setMsg("Reported. Thanks."))}><Flag size={14} /></button>}
            </header>
            {r.body && <p>{r.body}</p>}
          </article>
        ))}
      </section>

      <button type="button" className="link" onClick={() => setMenu(menu === "edit" ? null : "edit")}><Pencil size={14} aria-hidden /> Suggest an edit</button>
      {menu === "edit" && <EditForm page={page} onDone={(m) => { setMsg(m); setMenu(null); }} />}
    </aside>
  );
}
