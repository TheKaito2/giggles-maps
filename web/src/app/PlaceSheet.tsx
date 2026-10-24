import { useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, CalendarCheck, Camera, Clock, Coins, Crown, ExternalLink, Flag, Globe, ImagePlus, MapPin, Navigation, Pencil, Phone, Share2,
  Sparkles, Star, Trash2, X } from "lucide-react";
import { errCode } from "../lib/supabase";
import { addPlacePhoto, createList, deletePlacePhoto, deleteReview, getMyLists, getPlaceExtras, getPlacePage, type PlaceExtras, type PlacePage, type PlacePhoto,
  photoUrls, placePhotoUrl, reportPlacePhoto, reportReview, REVIEW_SHAKE_CHARS, type PartnerTier, placesTiers, type SavedList, savePlace, shopPhotoUrl, SITE,
  suggestEdit, TIER_NAME, writeReview } from "../lib/api";
import { shrinkPhoto } from "../lib/photo";
import BookingSheet from "./BookingSheet";
import { GROUPS, kindOf } from "./kinds";
import { openNow } from "./hours";
import Avatar from "./social/Avatar";
import { SkelLines, SkelPlace } from "./Skeleton";
import Info from "./Info";
import { shareOrCopy } from "../lib/native";

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
      {!lists ? <SkelLines n={2} /> : lists.map((l) => (
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
const PHOTO_ERR: Record<string, string> = {
  check_in_first: "Check in here first: photos on a place come from people who've been.",
  photo_limit: "That's the most photos you can add here (3 per place, 20 a day).",
  bad_photo: "That photo didn't upload properly. Try again.",
  already_added: "You added that photo already.",
};
const photoSrc = (ph: PlacePhoto, urls: Record<string, string>) => ph.url?.startsWith("shop-photos/") ? shopPhotoUrl(ph.url)
  : ph.url?.startsWith("place-photos/") ? placePhotoUrl(ph.url) : ph.url ?? (ph.path ? urls[ph.path] : undefined);
const photoCredit = (ph: PlacePhoto) => ph.source === "wikimedia" ? `${ph.credit} · ${ph.licence} · Wikimedia` : ph.source === "owner" ? "From the owner"
  : `by ${ph.mine ? "you" : ph.credit}`;

export default function PlaceSheet({ id, onClose, onDirections, onCheckin, onCoins }: {
  id: number; onClose: () => void; onDirections: (p: PlacePage) => void; onCheckin: (p: PlacePage) => void;
  onCoins?: () => void;   // coins or a Siam Si shake earned here: the top bar refreshes
}) {
  const [page, setPage] = useState<PlacePage | null>(null);
  const [extras, setExtras] = useState<PlaceExtras | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<"save" | "edit" | "book" | null>(null);
  const [tier, setTier] = useState<PartnerTier | null>(null);   // a paying partner: labelled, and you can book it
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  // a late answer for the previous pin must not land on this one
  const shown = useRef(id);
  shown.current = id;
  const load = () => getPlacePage(id).then((p) => {
    if (shown.current !== id) return;
    if (!p) { setMsg("This place isn't on Giggles Maps. The link may be broken."); return; }   // was an endless skeleton
    setPage(p);
    const mine = p?.reviews.find((r) => r.mine);
    if (mine) { setRating(mine.rating); setBody(mine.body ?? ""); }
  }).catch(() => setMsg("Couldn't load this place."));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[aria-modal=true]")) onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => {
    setPage(null); setExtras(null); setMenu(null); setMsg(""); setRating(0); setBody(""); load();
    getPlaceExtras(id).then((x) => { if (shown.current === id) setExtras(x); }).catch(() => undefined);
    setTier(null); placesTiers([id]).then((m) => { if (shown.current === id) setTier(m.get(id) ?? null); }).catch(() => undefined);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // signed photo links: fetched when the photos change, not on every reload of the page (a saved review, a list toggle)
  const photoKey = (page?.photos ?? []).map((p) => p.path).filter(Boolean).join("|");
  useEffect(() => {
    if (photoKey) photoUrls(photoKey.split("|")).then(setUrls).catch(() => undefined);
  }, [photoKey]);

  if (!page) return <aside className="place-sheet glass" aria-busy="true"><button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="Close"><X size={18} /></button>{msg ? <p className="fine">{msg}</p> : <SkelPlace />}</aside>;
  const k = kindOf(page.kind, page.category);
  const open = openNow(page.opening_hours);
  const share = async () => {
    if (await shareOrCopy(page.name, `${SITE}/app/?place=${page.id}`) === "copied") setMsg("Link copied.");
  };
  const submitReview = () => writeReview(page.id, rating, body).then((r) => {
    setMsg(r.shake ? "Review saved. +1 Siam Si shake for writing it: shake it on your Profile." : r.xp ? `Review saved. +${r.xp} XP.` : "Review saved.");
    if (r.shake || r.xp) onCoins?.();
    load();
  }).catch((e) => setMsg(errCode(e) === "check_in_first" ? "Check in here first: reviews are from verified visits only." : "Couldn't save the review."));
  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    setAdding(true); setMsg("");
    try {
      const r = await addPlacePhoto(page.id, await shrinkPhoto(file));
      setMsg(r.coins_earned ? `Photo added. +${r.coins_earned} coins for your first photo here.` : "Photo added. Thanks!");
      if (r.coins_earned) onCoins?.();
      load();
    } catch (e) { setMsg(PHOTO_ERR[errCode(e)] ?? (e instanceof Error && !errCode(e) ? e.message : "Couldn't add the photo. Try again.")); }
    finally { setAdding(false); }
  };
  const removePhoto = (ph: PlacePhoto) => { if (confirm("Remove your photo from this place?")) deletePlacePhoto(ph).then(load).catch(() => setMsg("Couldn't remove it. Try again.")); };
  const reportPhoto = (ph: PlacePhoto) => reportPlacePhoto(ph.id!).then(() => setMsg("Reported. Thanks: three reports hide a photo until we check it."))
    .catch(() => setMsg("Couldn't report it. Try again."));
  const peak = page.busy ? Math.max(...page.busy, 1) : 1;
  const hourNow = new Date().getHours();

  return (
    <aside className="place-sheet glass" aria-label={page.name}>
      <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="Close place"><X size={18} /></button>
      {page.photos.length > 0 && (
        <ul className="photo-strip" aria-label="Photos">
          {page.photos.map((ph, i) => {
            const src = photoSrc(ph, urls);
            return <li key={ph.id ?? ph.url ?? ph.path ?? i}>{src ? <img src={src} alt={`${page.name} photo ${i + 1}`} loading="lazy" /> : <div className="ph" />}
              <span className="photo-credit">{photoCredit(ph)}</span>
              {ph.source === "traveller" && ph.id != null && (ph.mine
                ? <button type="button" className="photo-act" onClick={() => removePhoto(ph)} aria-label="Remove your photo"><Trash2 size={14} /></button>
                : <button type="button" className="photo-act" onClick={() => reportPhoto(ph)} aria-label="Report this photo"><Flag size={14} /></button>)}</li>;
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
            {tier && <span className={`chip tier-${tier}`}>{TIER_NAME[tier]}</span>}
            {page.tier === 3 && <span className="chip landmark">Landmark</span>}
            {page.otop && <span className="chip otop">OTOP{extras?.otop_stars ? ` ${"★".repeat(extras.otop_stars)}` : ""}</span>}
            {extras?.verified && <span className="chip">Verified shop</span>}
            {page.community && <span className="chip otop">Community enterprise</span>}
            {page.local && !page.otop && <span className="chip">Local</span>}
            {page.stamped && <span className="chip">Stamped</span>}
          </span>
        </div>
      </header>

      <div className="place-actions">
        {page.detour && <button type="button" className="btn gold small" onClick={() => onCheckin(page)}><Camera size={15} aria-hidden /> Check in</button>}
        <button type="button" className={`btn small${page.detour ? " soft" : ""}`} onClick={() => onDirections(page)}><Navigation size={15} aria-hidden /> Directions</button>
        {tier && <button type="button" className="btn gold small" onClick={() => setMenu(menu === "book" ? null : "book")}><CalendarCheck size={15} aria-hidden /> Book</button>}
        <button type="button" className="btn soft small" onClick={() => setMenu(menu === "save" ? null : "save")}>
          {page.saved_in.length ? <BookmarkCheck size={15} aria-hidden /> : <Bookmark size={15} aria-hidden />} {page.saved_in.length ? "Saved" : "Save"}</button>
        <button type="button" className="btn soft small" onClick={share}><Share2 size={15} aria-hidden /> Share</button>

        {page.stamped && <label className={`btn soft small${adding ? " busy" : ""}`} aria-disabled={adding}>
          {adding ? <span className="spinner" style={{ width: 14, height: 14 }} aria-hidden /> : <ImagePlus size={15} aria-hidden />}
          {adding ? "Adding…" : "Add a public photo"}{page.photo_reward && !adding && <span className="chip reward-chip"><Coins size={11} aria-hidden /> +10</span>}
          <input type="file" accept="image/*" className="sr-only" disabled={adding} onChange={(e) => { void addPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        </label>}
      </div>
      {menu === "save" && <SaveMenu page={page} onClose={() => setMenu(null)} onChange={load} />}
      {menu === "book" && <BookingSheet place={page.id} name={page.name} onClose={() => setMenu(null)} onDone={(m) => { setMenu(null); setMsg(m); }} />}
      {msg && <p className="fine" role="status">{msg}</p>}

      {extras?.description && <p className="place-about">{extras.description}</p>}
      {(page.otop || page.community) && <p className="local-note">{page.community
        ? "A community enterprise: your visit supports local makers directly."
        : "An OTOP producer (One Tambon One Product): local products made in this subdistrict."}</p>}
      {extras && extras.products.length > 0 && (
        <section aria-label="Products">
          <h4 className="eyebrow">Products</h4>
          <ul className="product-strip">{extras.products.map((pr) => <li key={pr.id}>
            {pr.photo ? <img src={shopPhotoUrl(pr.photo)} alt={pr.name} loading="lazy" /> : <div className="ph" />}
            <b>{pr.name}</b>{pr.price != null && <span className="num fine">฿{pr.price}</span>}</li>)}</ul>
        </section>
      )}
      <ul className="place-info">
        {page.opening_hours && <li><Clock size={16} aria-hidden />
          <span>{open === true ? <b className="open">Open now</b> : open === false ? <b className="closed">Closed now</b> : null} <span className="fine">{page.opening_hours}</span></span></li>}
        {page.phone && <li><Phone size={16} aria-hidden /><a href={`tel:${page.phone.split(";")[0].replace(/\s/g, "")}`}>{page.phone.split(";")[0]}</a></li>}
        {page.website && <li><Globe size={16} aria-hidden /><a href={page.website.startsWith("http") ? page.website : `https://${page.website}`} target="_blank" rel="noopener noreferrer">{page.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a></li>}
        {page.address && <li><MapPin size={16} aria-hidden /><span>{page.address}</span></li>}
      </ul>


      {page.regular && (
        <p className="place-regular"><Crown size={16} aria-hidden /> <b>Regular:</b>&nbsp;{page.regular.mine ? "you" : page.regular.who.nickname}
          <span className="fine">&nbsp;· {page.regular.visits} visit-days in 60 days</span></p>
      )}
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
            {page.review_shake && <p className={`fine shake-hint${body.trim().length >= REVIEW_SHAKE_CHARS ? " ready" : ""}`}><Sparkles size={13} aria-hidden />
              {body.trim().length >= REVIEW_SHAKE_CHARS ? "This review earns a Siam Si shake." : `Write ${REVIEW_SHAKE_CHARS - body.trim().length} more characters to earn a Siam Si shake.`}</p>}
            <div className="row">
              <button className="btn small" type="submit" disabled={!rating}>{page.reviews.some((r) => r.mine) ? "Update review" : "Post review · +20 XP"}</button>
              {page.reviews.some((r) => r.mine) && <button type="button" className="link" onClick={() => deleteReview(page.id).then(() => { setRating(0); setBody(""); load(); })}>Delete</button>}
            </div>
          </form>
        ) : <p className="fine">Check in here to leave a review. <Info label="About reviews">Every review on Giggles Maps comes from someone who was really
          there.</Info></p>}
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

      {/* other people's reviews and photos live elsewhere: we link to them, never copy them (Google's terms forbid
          showing its content on a non-Google map, and Wongnai's are its own) */}
      <section className="elsewhere" aria-labelledby="elsewhere-title">
        <h4 id="elsewhere-title" className="eyebrow">Reviews and photos elsewhere</h4>
        <div className="row tight">
          <a className="btn soft small" target="_blank" rel="noopener noreferrer"
            href={`https://www.google.com/maps/search/${encodeURIComponent(page.name)}/@${page.lat},${page.lng},17z`}>
            Google Maps <ExternalLink size={14} aria-hidden /></a>
          {k.group === "food" && <a className="btn soft small" target="_blank" rel="noopener noreferrer"
            href={`https://www.wongnai.com/businesses?q=${encodeURIComponent(page.name_th || page.name)}`}>
            Wongnai <ExternalLink size={14} aria-hidden /></a>}
        </div>
      </section>

      <div className="row">
        <button type="button" className="link" onClick={() => setMenu(menu === "edit" ? null : "edit")}><Pencil size={14} aria-hidden /> Suggest an edit</button>
        {extras && !extras.claimed && page.detour && <a className="link" href={`/shop/?claim=${page.id}`}>Own this place? Claim it free</a>}
      </div>
      {menu === "edit" && <EditForm page={page} onDone={(m) => { setMsg(m); setMenu(null); }} />}
    </aside>
  );
}
