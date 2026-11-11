import { useEffect, useState } from "react";
import { BarChart3, CalendarCheck, Flag, MapPin, Search, Sparkles, Star, Store } from "lucide-react";
import { type FoundPlace, PRICES, searchPlaces, sendSponsorLead, shopReach, type ShopReach } from "../lib/api";
import { errCode } from "../lib/supabase";

// The page a shop owner sees before they run a listing (Grab Merchant / Airbnb Host pattern): what they get, a real number
// for their own shop, what it would return, how to join, prices and an FAQ. Claiming and signing in sit right below it
// (#claim, #account). Thai shop owners read it first: /shop opens in Thai unless a language was picked (lib/i18n.ts).
// Proof (quotes and photos from the first shops) goes here after launch; never invented testimonials.
const REASONS = [
  { icon: Store, title: "A free listing", text: "Your photos, products and story on your place page." },
  { icon: Star, title: "Boosted on Plus routes", text: `Partners (฿${PRICES.partner} a month) come first on Giggles Plus travellers' routes, with a Partner badge.` },
  { icon: CalendarCheck, title: "Bookings", text: `Tables and visits cost ฿${PRICES.booking} per guest who shows up; stays ${PRICES.stayPct}% of the price you set.` },
  { icon: BarChart3, title: "Your numbers", text: "Every week: how often travellers saw you, verified visits, bookings and what they cost." },
];
const STEPS = [
  { title: "Claim your shop", text: "Search your name below, or add it while you're standing in it." },
  { title: "Print your sticker", text: "Your counter QR code. Visitors scan it to check in." },
  { title: "Get verified", text: "The first visitor scan verifies your shop." },
  { title: "Become a Partner", text: `฿${PRICES.partner} a month. Cancel any time: it simply runs out.` },
  { title: "Apply for Giggles Choice", text: "Partners can apply. We hand-pick the best." },
];
const FAQ = [
  { q: "Is the listing really free?", a: "Yes. A free listing stays on the map and in routes like any other place." },
  { q: "What does Partner change?", a: "Giggles Plus travellers see partners first. Everyone sees the Partner badge, so it's always clear." },
  { q: "How do I become Giggles Choice?", a: "Be a Partner, then apply in your dashboard. If we pick you, you can switch it on." },
  { q: "When do I pay for a visit or a booking?", a: `Only when the traveller checks in at your counter: ฿${PRICES.booking} from your prepaid credit (a stay: ${PRICES.stayPct}% of its price). Declines and no-shows are free.` },
  { q: "What do you share about visitors?", a: "A nickname, party size and their note. Never their phone or email." },
];

function Reach({ onReach }: { onReach: (r: ShopReach) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FoundPlace[]>([]);
  const [reach, setReach] = useState<ShopReach | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => searchPlaces(q).then((r) => setFound(r.filter((p) => p.id).slice(0, 5))).catch(() => undefined), 300);
    return () => clearTimeout(t);
  }, [q]);
  const pick = (p: FoundPlace) => { setQ(""); setFound([]); shopReach(p.id!).then((r) => { setReach(r); onReach(r); }).catch(() => undefined); };
  return (
    <div className="reach glass">
      <label className="reach-search"><Search size={18} aria-hidden />
        <input value={q} placeholder="Your shop's name" aria-label="Find your shop" onChange={(e) => setQ(e.target.value)} /></label>
      {found.length > 0 && <ul className="reach-results">{found.map((p) => <li key={p.id}><button type="button" onClick={() => pick(p)}>
        <MapPin size={15} aria-hidden /> {p.name}</button></li>)}</ul>}
      {reach ? <div className="reach-out">
        <span className="fine">{reach.name}, last 30 days</span>
        <span className="reach-nums">
          <span><b className="num">{reach.trips_near_30d}</b><span className="fine">trips planned within 20 km</span></span>
          <span><b className="num">{reach.shown_30d}</b><span className="fine">times on a traveller's route</span></span>
        </span>
      </div> : <p className="fine">See how many Giggles Maps trips already pass near you.</p>}
    </div>
  );
}

/** What being a Partner would return: the shop's own average bill × the verified visits it expects, against the fees. */
function Calculator({ reach }: { reach: ShopReach | null }) {
  const [bill, setBill] = useState(250);
  const [visits, setVisits] = useState(20);
  const [stay, setStay] = useState(false);   // hotels and homestays pay 10% of each completed stay, not ฿25 a visit
  const sales = bill * visits;
  const perVisit = stay ? Math.max(Math.round((bill * PRICES.stayPct) / 100), PRICES.booking) : PRICES.booking;
  const cost = PRICES.partner + perVisit * visits;
  // what Giggles data says so far: this shop's route appearances × how often a shown stop gets visited, all shops
  const fromData = reach?.visit_rate != null ? Math.round(reach.shown_30d * reach.visit_rate) : null;
  return (
    <div className="calc">
      <div className="booking-fields">
        <label className="field"><span>{stay ? "Your average stay (฿)" : "Your average bill (฿)"}</span><input type="number" inputMode="numeric" min={0} value={bill}
          onChange={(e) => setBill(Math.max(0, Number(e.target.value) || 0))} /></label>
        <label className="field"><span>{stay ? "Completed stays a month" : "Verified visits a month"}</span><input type="number" inputMode="numeric" min={0} max={10000} value={visits}
          onChange={(e) => setVisits(Math.max(0, Math.min(10000, Number(e.target.value) || 0)))} /></label>
      </div>
      <label className="row tight"><input type="checkbox" checked={stay} onChange={(e) => setStay(e.target.checked)} /> We're a hotel or homestay</label>
      <div className="calc-out">
        <span className="fine">About</span>
        <b>฿{sales.toLocaleString()} of sales for ฿{cost.toLocaleString()}</b>
        <span className="fine">{stay
          ? `Partner ฿${PRICES.partner} a month + ${PRICES.stayPct}% of each of the ${visits} completed stays (at least ฿${PRICES.booking} each).`
          : `Partner ฿${PRICES.partner} a month + ฿${PRICES.booking} for each of the ${visits} verified visits.`}</span>
      </div>
      <p className="fine">An estimate, not a promise: it assumes every visitor spends your average bill, and you choose the number of visits.
        {fromData != null && ` For ${reach!.name}, Giggles trips so far point to about ${fromData} a month (${reach!.shown_30d} times on a route × how often shown stops get visited).`}</p>
    </div>
  );
}

/** Provinces, tourism offices and brands: a sponsored quest (a stamp trail through a province), sold by hand. */
function Sponsors() {
  const [org, setOrg] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const send = () => {
    setBusy(true); setMsg("");
    sendSponsorLead(org, contact, message)
      .then(() => { setMsg("Thanks! We'll get back to you within two working days."); setOrg(""); setContact(""); setMessage(""); })
      .catch((e) => setMsg(errCode(e) === "try_tomorrow" ? "Lots of messages today. Please try again tomorrow." : "Couldn't send that. Try again."))
      .finally(() => setBusy(false));
  };
  return (
    <section aria-labelledby="sponsor-h">
      <h2 id="sponsor-h"><Flag size={22} aria-hidden /> For provinces and brands</h2>
      <p>A sponsored quest is a stamp trail through your province or your shops. Travellers plan detours to collect every stamp, and you
        see each verified visit. About ฿150,000 a season, planned with you.</p>
      <form className="calc" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="field"><span>Organisation</span><input required minLength={2} maxLength={120} value={org} onChange={(e) => setOrg(e.target.value)} /></label>
        <label className="field"><span>Email, phone or LINE ID</span><input required minLength={3} maxLength={160} value={contact} onChange={(e) => setContact(e.target.value)} /></label>
        <label className="field"><span>What do you have in mind?</span><textarea maxLength={1000} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
        <p className="fine">We use these details only to reply to you.</p>
        {msg && <p className="fine" role="status">{msg}</p>}
        <button className="btn" disabled={busy}>Send</button>
      </form>
    </section>
  );
}

export default function Pitch() {
  const [reach, setReach] = useState<ShopReach | null>(null);
  return (
    <div className="pitch">
      <section className="pitch-hero">
        <p className="eyebrow">Giggles Maps for shops</p>
        <h1>Grow with travellers passing your door</h1>
        <p className="lede">Travellers tell us how much extra time they have. We fill it with stops worth it. Be one of them.</p>
        <div className="row">
          <a className="btn gold big" href="#claim">Claim your shop free</a>
          <a className="link" href="#account">Already listed? Sign in</a>
        </div>
        <Reach onReach={setReach} />
      </section>

      <section aria-labelledby="why-h">
        <h2 id="why-h">Why Giggles Maps</h2>
        <ol className="reasons">{REASONS.map((r, i) => <li key={r.title}><span className="reason-n num">{i + 1}</span><r.icon size={22} aria-hidden />
          <b>{r.title}</b><span className="fine">{r.text}</span></li>)}</ol>
      </section>

      <section aria-labelledby="price-h">
        <h2 id="price-h">Prices</h2>
        <div className="ladder">
          <article><span className="eyebrow">Listing</span><b className="num">Free</b><span className="fine">On the map and in routes, with your sticker and numbers.</span></article>
          <article className="hot"><span className="eyebrow">Partner</span><b className="num">฿{PRICES.partner.toLocaleString()}<small>/month</small></b>
            <span className="fine">First on Plus routes, a Partner badge, bookings and your weekly numbers.</span></article>
          <article><span className="eyebrow">Giggles Choice</span><b className="num">฿{PRICES.choice.toLocaleString()}<small>/month</small></b>
            <span className="fine"><Sparkles size={13} aria-hidden /> By invitation. Partners apply; the ones we choose get a Choice badge, ×2 on Plus routes and the Partner picks plan.</span></article>
        </div>
        <p className="fine">On top: ฿{PRICES.booking} per verified visit or booked table, {PRICES.stayPct}% of a completed stay, paid from prepaid credit. Card or PromptPay.</p>
      </section>

      <section aria-labelledby="calc-h">
        <h2 id="calc-h">What would it bring you?</h2>
        <Calculator reach={reach} />
        <p className="fine">For comparison, a LINE Official Account basic plan is ฿1,280 a month (LINE's price list), whether or not anyone
          comes in. With Giggles Maps the per-visit part is only paid when a traveller checks in at your counter.</p>
      </section>

      <section aria-labelledby="join-h">
        <h2 id="join-h">How to join</h2>
        <ol className="join-steps">{STEPS.map((s, i) => <li key={s.title}><span className="join-dot num">{i + 1}</span>
          <span><b>{s.title}</b><span className="fine">{s.text}</span></span></li>)}</ol>
      </section>

      <Sponsors />

      <section aria-labelledby="faq-h">
        <h2 id="faq-h">Questions</h2>
        <div className="faq">{FAQ.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
      </section>
    </div>
  );
}
