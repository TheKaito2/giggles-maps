import { type ReactNode, useEffect, useState } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight, Crown, Languages, LogIn, LogOut, RotateCcw, ShieldCheck, Sparkles, SunMoon, Trash2, Volume2, Wand2, X } from "lucide-react";
import { callFn, ensureSession, supabase } from "../lib/supabase";
import { type Booking, cancelBooking, getMonthlyStamps, myBookings, PRICES, type Profile } from "../lib/api";
import { isNative, purchase, purchaseErrorText, restorePurchases } from "../lib/native";
import { isGuest, useUser } from "../lib/auth";
import { demoOn, setDemo, startDemo } from "../lib/demoGps";
import { setSound, soundOn } from "../lib/sfx";
import { type Appearance, setAppearance, useAppearance } from "../lib/theme";
import { lang, setLang } from "../lib/i18n";
import Avatar from "./social/Avatar";
import SignIn from "./SignIn";
import AdminEdits from "./AdminEdits";
import Info from "./Info";
import { useBack } from "../lib/useDialog";
import { forgetTrip } from "./detour/useDetour";
import { PlusTerm } from "./Upgrade";

// Settings, iOS / Android style: an account card, then short titled groups of rows. Switches act at once; anything bigger
// opens its own page inside the sheet (‹ back). Destructive actions sit last and ask first.
type Page = "home" | "appearance" | "membership" | "plus" | "bookings" | "signin" | "admin" | "delete";
const BOOKING_STATUS: Record<Booking["status"], string> = { requested: "Waiting for the shop", accepted: "Confirmed", declined: "Declined",
  completed: "Done", cancelled: "Cancelled" };
const monthName = (m: string) => new Date(`${m}T00:00:00+07:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const LOOKS: { id: Appearance; label: string }[] = [{ id: "light", label: "Light" }, { id: "dark", label: "Dark" }, { id: "auto", label: "Auto" }];
const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** One row: a coloured icon tile, a label, an optional value, and a chevron (or a control on the right). */
function Row({ icon, tone, label, value, onClick, danger, children }: {
  icon: ReactNode; tone: string; label: ReactNode; value?: ReactNode; onClick?: () => void; danger?: boolean; children?: ReactNode;
}) {
  const body = <>
    <span className={`set-icon t-${tone}`} aria-hidden>{icon}</span>
    <span className="set-label">{label}</span>
    {value != null && <span className="set-value">{value}</span>}
    {children ?? (onClick && <ChevronRight size={18} className="set-chev" aria-hidden />)}
  </>;
  return onClick
    ? <button type="button" className={`set-row${danger ? " danger" : ""}`} onClick={onClick}>{body}</button>
    : <label className="set-row">{body}</label>;
}
const Group = ({ title, foot, children }: { title?: string; foot?: ReactNode; children: ReactNode }) => (
  <section className="set-section">
    {title && <h4 className="eyebrow">{title}</h4>}
    <div className="set-group">{children}</div>
    {foot && <p className="fine set-foot">{foot}</p>}
  </section>
);

export default function Settings({ refreshKey, profile, onChange, onClose }: {
  refreshKey: number; profile: Profile | null; onChange: () => void; onClose: () => void;
}) {
  const user = useUser();
  const guest = isGuest(user);
  const member = profile?.member ?? false;
  const plusUntil = profile?.plusUntil ?? null;
  const [page, setPage] = useState<Page>("home");
  useBack(() => setPage("home"), page !== "home", page);   // Back from Membership, Appearance… returns to the list
  const [msg, setMsg] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [stamps, setStamps] = useState<string[]>([]);
  const [plusYear, setPlusYear] = useState(false);   // yearly Plus picked (web only)
  const [sound, setSoundState] = useState(soundOn);
  const look = useAppearance();

  const [paidMsg] = useState(() => new URLSearchParams(location.search).get("paid") === "success"
    ? "Payment received. It switches on in a few seconds (PromptPay can take a minute)." : "");
  // back from Stripe: the webhook switches it on a few seconds later, so reload the profile once
  useEffect(() => {
    if (!paidMsg) return;
    const t = setTimeout(onChange, 5000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      await ensureSession();
      setStamps(await getMonthlyStamps());
      if (!isGuest(user)) setBookings(await myBookings());
    })().catch(() => setMsg("Couldn't load your account. Check your connection."));
  }, [refreshKey, user?.id, !!plusUntil]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (p: Page) => { setMsg(""); setPage(p); };
  const buy = async (kind: "plus" | "plus_year" | "membership") => {
    setMsg("");
    try { if (await purchase(kind, user?.id)) { setMsg("Thanks! It switches on in a moment."); setTimeout(onChange, 1500); } }
    catch (e) { setMsg(purchaseErrorText(e)); }
  };
  const deleteAccount = async () => {
    try {
      await callFn("delete-account", {});
      forgetTrip();
      await supabase.auth.signOut();
      setMsg("Account deleted. You're a fresh guest now, with an empty passport.");
      setPage("home");
    } catch { setMsg("Couldn't delete the account. Try again."); }
  };

  const TITLES: Record<Page, string> = { home: "Settings", appearance: "Appearance", membership: "Membership", plus: "Giggles Plus", bookings: "Your bookings",
    signin: "Sign in", admin: "Admin", delete: "Delete account" };
  const open = bookings.filter((b) => b.status === "requested" || b.status === "accepted").length;

  return (
    <div className="settings-sheet">
      <header className="modal-head set-head">
        {page === "home" ? <h2>Settings</h2>
          : <button type="button" className="set-back" onClick={() => go("home")}><ChevronLeft size={20} aria-hidden /> Settings</button>}
        {page !== "home" && <h2 className="set-title">{TITLES[page]}</h2>}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </header>
      {(paidMsg || msg) && <p className="notice-line" role="status">{paidMsg || msg}</p>}

      {page === "home" && <div className="set-page" key="home">
        <section className="set-me">
          <Avatar name={profile?.nickname ?? "Explorer"} colour={profile?.colour ?? "marigold"} avatar={profile?.avatar} size={56} />
          <span className="set-me-text">
            <b>{profile?.nickname ?? "Explorer"}</b>
            <span className="fine">{guest ? "Guest · not signed in" : user?.email ?? "Signed in"}</span>
          </span>
          <span className="set-badges">
            {member && <span className="chip member-chip"><Crown size={12} aria-hidden /> Member</span>}
            {plusUntil && <span className="chip plus-chip">Plus</span>}
            {!member && !plusUntil && <span className="chip">Free</span>}
          </span>
        </section>
        {guest && <Group foot="Your stamps, coins and photos move to your account.">
          <Row icon={<LogIn size={17} />} tone="indigo" label={<b>Sign in to keep your stamps</b>} onClick={() => go("signin")} />
        </Group>}

        <Group title="Your plan">
          <Row icon={<Crown size={17} />} tone="marigold" label="Membership" value={member ? "Lifetime" : `฿${PRICES.membership} once`} onClick={() => go("membership")} />
          <Row icon={<Sparkles size={17} />} tone="grape" label="Giggles Plus" value={plusUntil ? `Until ${shortDate(plusUntil)}` : `฿${PRICES.plus}/month`} onClick={() => go("plus")} />
          {isNative && !guest && <Row icon={<RotateCcw size={17} />} tone="slate" label="Restore purchases" onClick={() => restorePurchases()
            .then((n) => { setMsg(n ? "Purchases restored." : "Nothing to restore on this Apple ID."); onChange(); })
            .catch(() => setMsg("Couldn't restore. Try again."))} />}
          {bookings.length > 0 && <Row icon={<CalendarCheck size={17} />} tone="good" label="Bookings" value={open ? `${open} open` : bookings.length} onClick={() => go("bookings")} />}
        </Group>

        <Group title="App" foot="Switching language or demo mode reloads the app.">
          <Row icon={<SunMoon size={17} />} tone="night" label="Appearance" value={LOOKS.find((l) => l.id === look)!.label} onClick={() => go("appearance")} />
          <Row icon={<Languages size={17} />} tone="sky" label="Language">
            {/* each language named in itself, never translated */}
            <span className="seg lang-seg" role="radiogroup" aria-label="Language" translate="no">
              {(["en", "th"] as const).map((l) => <button key={l} type="button" role="radio" aria-checked={lang() === l} className={lang() === l ? "on" : ""}
                onClick={() => { if (lang() !== l) setLang(l); }}>{l === "en" ? "English" : "ไทย"}</button>)}
            </span>
          </Row>
          <Row icon={<Volume2 size={17} />} tone="marigold" label="Sounds">
            <input type="checkbox" role="switch" className="switch" checked={sound} aria-label="Sounds for chests and Siam Si"
              onChange={(e) => { setSound(e.target.checked); setSoundState(e.target.checked); }} />
          </Row>
          <Row icon={<Wand2 size={17} />} tone="sky" label={<>Demo mode <Info label="About demo mode">Try a trip without going anywhere: start
            directions, then the Demo button drives you to each stop. Check-ins still count, marked as demo, and never on the leaderboard.
            Other travellers, reviews and partners you see are pretend.</Info></>}>
            <input type="checkbox" role="switch" className="switch" checked={demoOn()} aria-label="Demo mode"
              onChange={(e) => { if (e.target.checked) startDemo(); else setDemo(false); location.reload(); }} />
          </Row>
        </Group>

        {profile?.isAdmin && <Group title="Admin">
          <Row icon={<ShieldCheck size={17} />} tone="indigo" label="Review edits and applications" onClick={() => go("admin")} />
        </Group>}

        <Group title="Account">
          {!guest && <Row icon={<LogOut size={17} />} tone="slate" label="Sign out" onClick={() => { forgetTrip(); void supabase.auth.signOut().then(onClose); }} />}
          <Row icon={<Trash2 size={17} />} tone="bad" label="Delete account" danger onClick={() => go("delete")} />
        </Group>
        <p className="fine set-legal"><a href="/privacy.html">Privacy</a> · Giggles Maps</p>
      </div>}

      {page === "appearance" && <div className="set-page" key="appearance">
        <div className="looks" role="radiogroup" aria-label="Appearance">
          {LOOKS.map((l) => <button key={l.id} type="button" role="radio" aria-checked={look === l.id} className={`look-opt${look === l.id ? " on" : ""}`}
            onClick={() => setAppearance(l.id)}>
            <span className={`look-phone look-${l.id}`} aria-hidden><i /><i /><i /></span>
            <b>{l.label}</b>
          </button>)}
        </div>
        <p className="fine set-foot">Auto follows your phone: light by day, dark when your phone switches to dark. The map goes dark with it.</p>
      </div>}

      {page === "membership" && <div className="set-page" key="membership">
        <div className="set-hero t-marigold"><Crown size={28} aria-hidden /><b>{member ? "You're a member" : `฿${PRICES.membership}, once`}</b>
          <span className="fine">{member ? "Thanks for backing Giggles Maps." : "Yours for good. No subscription."}</span></div>
        <ul className="perks">
          <li>No ads, forever</li>
          <li>Unlimited detours and added stops</li>
          <li>Up to 15 stops a plan (free plans hold 3)</li>
          <li>Partner and Giggles Choice stops first</li>
          <li>Member perks at partner shops</li>
          <li>3 months of Plus free</li>
        </ul>
        {!member && (guest
          ? <button type="button" className="btn" onClick={() => go("signin")}><LogIn size={16} aria-hidden /> Sign in first</button>
          : <button type="button" className="btn gold" onClick={() => buy("membership")}>Become a member · ฿{PRICES.membership}</button>)}
        {!isNative && <p className="fine">Card or PromptPay.</p>}
      </div>}

      {page === "plus" && <div className="set-page" key="plus">
        <div className="set-hero t-grape"><Sparkles size={28} aria-hidden /><b>{plusUntil ? `Plus until ${shortDate(plusUntil)}` : isNative ? `฿${PRICES.plus} a month` : `฿${PRICES.plus} a month or ฿${PRICES.plusYear} a year`}</b>
          <span className="fine">{plusUntil ? "Every Plus perk is on." : isNative ? "Renews monthly. Cancel any time in your Apple ID settings." : "No auto-renew: it simply runs out."}</span></div>
        <ul className="perks">
          <li>No ads</li>
          <li>Up to 15 stops a plan (free plans hold 3)</li>
          <li>+20 coins every day you open the app</li>
          <li>The Plus shelf: covers, frames, flair and the Plus explorer title</li>
          <li>25% more coins from quests, a stamp every month</li>
        </ul>
        {plusUntil && stamps.length > 0 && <div className="field"><span>Monthly stamps</span>
          <div className="month-stamps">{stamps.map((m) => <span key={m} className="month-stamp">{monthName(m)}</span>)}</div></div>}
        {guest ? <button type="button" className="btn" onClick={() => go("signin")}><LogIn size={16} aria-hidden /> Sign in first</button>
          : <>
            <PlusTerm year={plusYear} setYear={setPlusYear} />
            <button type="button" className="btn gold" onClick={() => buy(plusYear ? "plus_year" : "plus")} disabled={isNative && !!plusUntil}>
              {plusUntil ? isNative ? "You have Plus" : plusYear ? "Add a year" : "Add 30 days" : "Get Plus"} · ฿{plusYear ? PRICES.plusYear : PRICES.plus}</button>
          </>}
        {!isNative && <p className="fine">Card or PromptPay.</p>}
      </div>}

      {page === "bookings" && <div className="set-page" key="bookings">
        <ul className="bookings">{bookings.map((b) => (
          <li key={b.id}>
            <span className="person-main"><b>{b.place}</b>
              <span className="fine num">{new Date(`${b.day}T00:00:00+07:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {b.party} {b.party === 1 ? "person" : "people"}</span></span>
            <span className={`chip booking-${b.status}`}>{BOOKING_STATUS[b.status]}</span>
            {(b.status === "requested" || b.status === "accepted") && <button type="button" className="link"
              onClick={() => cancelBooking(b.id).then(myBookings).then(setBookings).catch(() => setMsg("Couldn't cancel. Try again."))}>Cancel</button>}
          </li>
        ))}</ul>
      </div>}

      {page === "signin" && <div className="set-page" key="signin">
        {guest ? <SignIn why="Sign in to keep your stamps, coins and photos on any device." />
          : <p className="fine">You're signed in as <b>{user?.email}</b>.</p>}
      </div>}

      {page === "admin" && <div className="set-page" key="admin"><AdminEdits /></div>}

      {page === "delete" && <div className="set-page" key="delete">
        <div className="set-hero t-bad"><Trash2 size={28} aria-hidden /><b>Delete your account?</b>
          <span className="fine">This deletes your account, check-ins, stamps, photos and coins. It can't be undone.</span></div>
        <button type="button" className="btn danger-btn" onClick={deleteAccount}>Delete everything</button>
        <button type="button" className="btn ghost" onClick={() => go("home")}>Keep my account</button>
      </div>}
    </div>
  );
}
