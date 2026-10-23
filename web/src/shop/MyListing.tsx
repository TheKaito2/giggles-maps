import { useEffect, useState } from "react";
import { ApiError } from "../lib/supabase";
import { addOwnerPhoto, addShop, claimShop, deleteOwnerPhoto, deleteProduct, type FoundPlace, getMyPlaces, type OwnedPlace,
  saveProduct, searchPlaces, shopPhotoUrl, suggestEdit, updateMyPlace, uploadShopPhoto } from "../lib/api";
import { KINDS } from "../app/kinds";

const ERR: Record<string, string> = {
  sign_in_required: "Sign in first (below) so the listing belongs to your account.",
  already_claimed: "Someone already runs this listing. Contact us if it's yours.",
  be_there: "Add your shop while you're standing in it: we pin it where you are.",
  too_many_shops: "One account can run up to 10 listings.",
  not_claimable: "Only shops can be claimed (not temples, parks or landmarks). Contact us if this is yours.",
  already_listed: "Your shop is already on the map: search for it above and claim it.",
};
const err = (e: unknown, fallback: string) => ERR[e instanceof ApiError ? e.code : ""] ?? fallback;
const here = () => new Promise<{ lat: number; lng: number }>((ok, fail) => navigator.geolocation.getCurrentPosition(
  (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), fail, { enableHighAccuracy: true, timeout: 15000 }));

function Listing({ p, onChange }: { p: OwnedPlace; onChange: () => void }) {
  const [f, setF] = useState({ opening_hours: p.opening_hours ?? "", phone: p.phone ?? "", website: p.website ?? "", description: p.description ?? "" });
  const [otop, setOtop] = useState(p.otop);
  const [stars, setStars] = useState<number | null>(p.otop_stars);
  const [community, setCommunity] = useState(p.community);
  const [product, setProduct] = useState({ name: "", price: "" });
  const [msg, setMsg] = useState("");
  const save = () => updateMyPlace(p.id, f)
    .then(() => { setMsg("Saved. Travellers see it on your place page now."); onChange(); })
    .catch(() => setMsg("Couldn't save. Check the website (e.g. facebook.com/yourshop) and phone (digits only)."));
  // OTOP and community status earn travellers extra rewards, so we check them before they show
  const askOtop = () => suggestEdit(p.id, { ...(otop ? { otop: true } : {}), ...(otop && stars ? { otop_stars: stars } : {}), ...(community ? { community: true } : {}) })
    .then(() => setMsg("Sent! We check OTOP and community enterprise status (usually against the CDD register) before it shows."))
    .catch(() => setMsg("Couldn't send that request."));
  const upload = async (file: File | undefined, then: (path: string) => Promise<void>) => {
    if (!file) return;
    try { await then(await uploadShopPhoto(file)); onChange(); } catch { setMsg("Couldn't upload that photo (JPG/PNG/WebP up to 3 MB)."); }
  };
  return (
    <article className="listing glass">
      <div className="row between"><h3>{p.name}</h3>
        {p.verified ? <span className="chip">Verified shop</span> : <span className="chip review">Verified after the first QR scan</span>}</div>
      <a className="link" href={`/app/?place=${p.id}`} target="_blank" rel="noreferrer">See your place page</a>
      <div className="listing-grid">
        <label className="field"><span>Opening hours</span><input className="text-in" value={f.opening_hours} placeholder="Mo-Su 08:00-17:00" onChange={(e) => setF({ ...f, opening_hours: e.target.value })} /></label>
        <label className="field"><span>Phone</span><input className="text-in" value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="field"><span>Website or Facebook</span><input className="text-in" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label>
        <label className="field wide"><span>About your shop (shown to travellers)</span>
          <textarea className="text-in" rows={3} maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      </div>
      <div className="row">
        <label className="toggle"><input type="checkbox" checked={otop} onChange={(e) => setOtop(e.target.checked)} /><span>OTOP product (หนึ่งตำบล หนึ่งผลิตภัณฑ์)</span></label>
        {otop && <label className="field"><span>OTOP star level</span>
          <select className="text-in" value={stars ?? ""} onChange={(e) => setStars(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Not rated</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
          </select></label>}
        <label className="toggle"><input type="checkbox" checked={community} onChange={(e) => setCommunity(e.target.checked)} /><span>Community enterprise (วิสาหกิจชุมชน)</span></label>
      </div>
      <div className="row">
        <button type="button" className="btn small" onClick={save}>Save details</button>
        {(otop !== p.otop || community !== p.community || (otop && stars !== p.otop_stars)) && (otop || community) &&
          <button type="button" className="btn soft small" onClick={askOtop}>Ask us to confirm OTOP / community status</button>}
      </div>

      <h4>Products</h4>
      <ul className="product-grid">
        {p.products.map((pr) => <li key={pr.id}>
          {pr.photo ? <img src={shopPhotoUrl(pr.photo)} alt={pr.name} /> : <div className="ph" />}
          <b>{pr.name}</b>{pr.price != null && <span className="num">฿{pr.price}</span>}
          <button type="button" className="link" onClick={() => deleteProduct(p.id, pr.id).then(onChange)}>Remove</button>
        </li>)}
      </ul>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        const file = (e.currentTarget.elements.namedItem("photo") as HTMLInputElement).files?.[0];
        const go = (photo: string | null) => saveProduct(p.id, null, product.name, product.price ? Number(product.price) : null, photo)
          .then(() => { setProduct({ name: "", price: "" }); onChange(); }).catch(() => setMsg("Couldn't add the product."));
        if (file) upload(file, (path) => go(path)); else go(null);
      }}>
        <input className="text-in" required maxLength={80} placeholder="Product, e.g. Indigo scarf" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} />
        <input className="text-in price-in" inputMode="decimal" placeholder="฿ price" value={product.price} onChange={(e) => setProduct({ ...product, price: e.target.value.replace(/[^\d.]/g, "") })} />
        <input name="photo" type="file" accept="image/*" aria-label="Product photo" />
        <button className="btn soft small" type="submit">Add product</button>
      </form>

      <h4>Photos</h4>
      <ul className="product-grid">{p.photos.map((ph) => <li key={ph.id}><img src={shopPhotoUrl(ph.url)} alt="" />
        <button type="button" className="link" onClick={() => deleteOwnerPhoto(p.id, ph.id).then(onChange)}>Remove</button></li>)}</ul>
      <label className="btn soft small">Add a photo<input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0], (path) => addOwnerPhoto(p.id, path))} /></label>
      {msg && <p className="fine" role="status">{msg}</p>}
    </article>
  );
}

/** Free listing for local shops: claim the place we already show, or add yours, then manage hours, OTOP stars, products and photos. */
export default function MyListing({ signedIn }: { signedIn: boolean }) {
  const [mine, setMine] = useState<OwnedPlace[] | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FoundPlace[]>([]);
  const [adding, setAdding] = useState({ name: "", kind: "craft" });
  const [msg, setMsg] = useState("");
  const load = () => getMyPlaces().then(setMine).catch(() => setMine([]));
  useEffect(() => { if (signedIn) load(); }, [signedIn]);
  useEffect(() => {
    const claim = Number(new URLSearchParams(location.search).get("claim"));
    if (claim && signedIn) claimShop(claim).then(() => { setMsg("Claimed! Your listing is below."); load(); }).catch((e) => setMsg(err(e, "Couldn't claim that place.")));
  }, [signedIn]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => searchPlaces(q).then((r) => setFound(r.slice(0, 6))).catch(() => undefined), 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <section className="stack my-listing" aria-label="Your listing">
      <h2>Your shop on Giggles Maps (free)</h2>
      <p className="fine">Local shops, OTOP producers and community enterprises get a free listing and a boost: our planner prefers independent and community businesses for everyone, and nobody can pay to beat that.</p>
      {!signedIn ? <p className="notice">Sign in at the bottom of this page to claim or add your shop.</p> : <>
        {mine?.map((p) => <Listing key={p.id} p={p} onChange={load} />)}
        <div className="glass listing">
          <h3>Claim your shop</h3>
          <input className="text-in" value={q} placeholder="Search your shop's name" aria-label="Search your shop" onChange={(e) => setQ(e.target.value)} />
          <ul className="people">{found.map((p) => <li key={p.id} className="person"><span className="person-main"><b>{p.name}</b>
            <span className="fine">{KINDS[p.kind ?? ""]?.en ?? p.category}</span></span>
            <button type="button" className="btn small" onClick={() => p.id && claimShop(p.id).then(() => { setQ(""); setMsg("Claimed!"); load(); }).catch((e) => setMsg(err(e, "Couldn't claim that place.")))}>This is mine</button></li>)}</ul>
          <h3>Not on the map? Add it</h3>
          <form className="row" onSubmit={(e) => { e.preventDefault(); setMsg("Getting your location…");
            here().then((at) => addShop(adding.name, adding.kind, at, at)).then(() => { setAdding({ name: "", kind: "craft" }); setMsg("Added! It's on the map now."); load(); })
              .catch((e) => setMsg(err(e, "We need your location: add your shop while you're in it."))); }}>
            <input className="text-in" required maxLength={80} placeholder="Shop name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
            <select className="text-in" value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })}>
              {["craft", "souvenir", "restaurant", "cafe", "bakery", "dessert", "market", "guesthouse"].map((k) =>
                <option key={k} value={k}>{KINDS[k].en} · {KINDS[k].th}</option>)}
            </select>
            <button className="btn small" type="submit">Add my shop here</button>
          </form>
        </div>
        {msg && <p className="notice" role="status">{msg}</p>}
      </>}
    </section>
  );
}
