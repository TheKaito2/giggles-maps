import { useEffect, useState } from "react";
import { BarChart3, CalendarCheck, MapPin, Search, Sparkles, Star, Store } from "lucide-react";
import { type FoundPlace, PRICES, searchPlaces, shopReach, type ShopReach } from "../lib/api";

// The page a shop owner sees before they run a listing (Grab Merchant / Airbnb Host pattern): what they get, a real number
// for their own shop, how to join, prices and an FAQ. Claiming and signing in sit right below it (#claim, #account).
const REASONS = [
  { icon: Store, title: "A free listing", text: "Your hours, photos, products and story on your place page." },
  { icon: Star, title: "First on members' routes", text: `Partners (฿${PRICES.partner} a month) come first for members, with a Partner badge.` },
  { icon: CalendarCheck, title: "Bookings", text: `Partners take bookings through Giggles. ฿${PRICES.booking} per guest who shows up.` },
  { icon: BarChart3, title: "Your numbers", text: "How often travellers saw you, and who checked in." },
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
  { q: "What does Partner change?", a: "Members (people who bought Giggles membership) see partners first. Everyone sees the Partner badge, so it's always clear." },
  { q: "How do I become Giggles Choice?", a: "Be a Partner, then apply in your dashboard. If we pick you, you can switch it on." },
  { q: "When do I pay for a booking?", a: `Only when the guest checks in at your shop: ฿${PRICES.booking} from your prepaid credit. Declines and no-shows are free.` },
  { q: "What do you share about visitors?", a: "A nickname, party size and their note. Never their phone or email." },
];

function Reach() {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FoundPlace[]>([]);
  const [reach, setReach] = useState<ShopReach | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => searchPlaces(q).then((r) => setFound(r.filter((p) => p.id).slice(0, 5))).catch(() => undefined), 300);
    return () => clearTimeout(t);
  }, [q]);
  const pick = (p: FoundPlace) => { setQ(""); setFound([]); shopReach(p.id!).then(setReach).catch(() => undefined); };
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

export default function Pitch() {
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
        <Reach />
      </section>

      <section aria-labelledby="why-h">
        <h2 id="why-h">Why Giggles Maps</h2>
        <ol className="reasons">{REASONS.map((r, i) => <li key={r.title}><span className="reason-n num">{i + 1}</span><r.icon size={22} aria-hidden />
          <b>{r.title}</b><span className="fine">{r.text}</span></li>)}</ol>
      </section>

      <section aria-labelledby="join-h">
        <h2 id="join-h">How to join</h2>
        <ol className="join-steps">{STEPS.map((s, i) => <li key={s.title}><span className="join-dot num">{i + 1}</span>
          <span><b>{s.title}</b><span className="fine">{s.text}</span></span></li>)}</ol>
      </section>

      <section aria-labelledby="price-h">
        <h2 id="price-h">Prices</h2>
        <div className="ladder">
          <article><span className="eyebrow">Listing</span><b className="num">Free</b><span className="fine">On the map and in routes, with your sticker and numbers.</span></article>
          <article className="hot"><span className="eyebrow">Partner</span><b className="num">฿{PRICES.partner}<small>/month</small></b>
            <span className="fine">First on members' routes, Partner badge, bookings.</span></article>
          <article><span className="eyebrow">Giggles Choice</span><b><Sparkles size={18} aria-hidden /> By invitation</b>
            <span className="fine">Partners apply; the ones we choose can switch it on (฿{PRICES.choice}/month) and join the Partner picks plan.</span></article>
        </div>
        <p className="fine">Prepaid credit pays for bookings (฿{PRICES.booking} each) and verified visits. Card or PromptPay.</p>
      </section>

      <section aria-labelledby="faq-h">
        <h2 id="faq-h">Questions</h2>
        <div className="faq">{FAQ.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
      </section>
    </div>
  );
}
