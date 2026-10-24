import { useEffect, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal, Plus, Repeat, Trash2, Camera } from "lucide-react";
import { type AlongPlace, type CheckinTarget, KIND_NAME, type Meal, type RouteStop } from "../../lib/api";
import { GROUPS, kindOf } from "../kinds";
import { budgetLabel, hhmm, MEALS } from "../prefs";
import { type Detour, PRESETS } from "./useDetour";
import { arrive } from "./Choose";
import PlanProgress from "./PlanProgress";
import Info from "../Info";

const MEAL_NAME: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const PARTNER_TIP = "This shop pays Giggles Maps when you visit. It's ranked like every other place; paying never moves it up.";
const MAX_STOPS = 6;

/** A place's photo, or its kind icon on its group colour. */
export function Thumb({ s, size = 48 }: { s: { name: string; category: string; photo?: string | null }; size?: number }) {
  const k = kindOf(null, s.category);
  return s.photo
    ? <img className="thumb" src={s.photo} alt="" width={size} height={size} loading="lazy" />
    : <span className="thumb" style={{ width: size, height: size, background: GROUPS[k.group].colour }}><k.icon size={size * 0.45} aria-hidden /></span>;
}

// at most two badges per stop, the most telling first
function badges(s: RouteStop): { text: string; cls: string; title?: string }[] {
  const all = [
    s.picked && { text: "You picked", cls: "picked" },
    s.pit_stop && { text: "Pit stop", cls: "pit", title: "A quick stop for snacks, a drink or the toilet" },
    s.meal && { text: s.meal_late ? `Late ${MEAL_NAME[s.meal].toLowerCase()}` : MEAL_NAME[s.meal], cls: "meal" },
    s.tier === 3 && { text: "Landmark", cls: "landmark" },
    (s.otop || s.community) && { text: s.otop ? "OTOP" : "Community", cls: "otop" },
    !s.otop && !s.community && s.local && { text: "Local", cls: "" },
    s.is_partner && { text: s.is_demo ? "Example partner" : "Partner", cls: "partner", title: PARTNER_TIP },
    !!s.min_level && s.exclusive_kind && { text: `${KIND_NAME[s.exclusive_kind]} · Lv ${s.min_level}`, cls: "exclusive" },
  ].filter(Boolean) as { text: string; cls: string; title?: string }[];
  return all.slice(0, 2);
}

const ALONG_GROUPS: { id: string; label: string; cats: string[] }[] = [
  { id: "all", label: "All", cats: [] },
  { id: "food", label: "Food", cats: ["food"] },
  { id: "coffee", label: "Coffee", cats: ["cafe"] },
  { id: "sights", label: "Sights", cats: ["temple", "museum", "art", "viewpoint"] },
  { id: "nature", label: "Nature", cats: ["park", "viewpoint"] },
  { id: "shops", label: "Shops", cats: ["craft", "market"] },
];

function StopRow({ s, i, d, sel, onOpen, onCheckin }: { s: RouteStop; i: number; d: Detour; sel: boolean; onOpen: (s: RouteStop) => void; onCheckin: (t: CheckinTarget) => void }) {
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLDivElement>(null);
  // the menu closes on Escape or a tap anywhere else
  useEffect(() => {
    if (!menu) return;
    const out = (e: Event) => { if (!more.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); more.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc);
    more.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [menu]);
  return (
    <li className={`stop-row${sel ? " sel" : ""}`} id={`stop-${s.id}`}>
      <button type="button" className="stop-main" onClick={() => onOpen(s)}>
        <span className="stop-num" aria-hidden>{i + 1}</span>
        <Thumb s={s} />
        <span className="stop-text">
          <b>{s.name}</b>
          <span className="stop-meta"><b className="num">{hhmm(s.eta_min)}</b>{s.extra_min != null && <b className="num extra">+{s.extra_min} min</b>}
            <span className="fine">{kindOf(s.pit_stop ? "convenience" : null, s.category).en}{s.rating != null && ` · ★ ${s.rating.toFixed(1)}`}</span></span>
          {badges(s).length > 0 && <span className="row tight">{badges(s).map((b) => <span key={b.text} className={`chip ${b.cls}`} title={b.title}>{b.text}</span>)}</span>}
        </span>
      </button>
      <div className="stop-more" ref={more}>
        <button type="button" className="icon-btn" aria-label={`More for ${s.name}`} aria-expanded={menu} aria-haspopup="menu" disabled={d.editing} onClick={() => setMenu(!menu)}><MoreHorizontal size={18} /></button>
        {menu && <div className="menu glass" role="menu" onClick={() => setMenu(false)}>
          <button type="button" role="menuitem" onClick={() => onCheckin(s)}><Camera size={16} aria-hidden /> Check in</button>
          <button type="button" role="menuitem" onClick={() => d.swapStop(s.id)}><Repeat size={16} aria-hidden /> Swap for another</button>
          <button type="button" role="menuitem" onClick={() => d.removeStop(s.id)}><Trash2 size={16} aria-hidden /> Remove</button>
        </div>}
      </div>
    </li>
  );
}

function Along({ places, d, full }: { places: AlongPlace[]; d: Detour; full: boolean }) {
  const [picked, setGroup] = useState("all");
  const groups = ALONG_GROUPS.filter((g) => g.id === "all" || places.some((p) => g.cats.includes(p.category)));
  const group = groups.some((g) => g.id === picked) ? picked : "all";   // a re-plan can leave the chosen kind empty
  const list = places.filter((p) => group === "all" || ALONG_GROUPS.find((g) => g.id === group)!.cats.includes(p.category)).slice(0, 8);
  if (!places.length) return null;
  return (
    <section className="along" aria-labelledby="along-title">
      <h3 id="along-title" className="eyebrow">Add along your route</h3>
      <div className="chips-scroll" role="radiogroup" aria-label="Kind of place">
        {groups.map((g) => <button key={g.id} type="button" role="radio" aria-checked={group === g.id} className={`pill ${group === g.id ? "on" : ""}`}
          onClick={() => setGroup(g.id)}>{g.label}</button>)}
      </div>
      <ul className="along-list">
        {list.map((p) => (
          <li key={p.id}>
            <Thumb s={p} size={40} />
            <span className="stop-text"><b>{p.name}</b><span className="fine num">{kindOf(null, p.category).en} · about +{p.extra_min} min{p.rating != null && ` · ★ ${p.rating.toFixed(1)}`}</span></span>
            <button type="button" className="btn soft small" disabled={full || d.editing} onClick={() => d.addStop(p.id, p.extra_min)} aria-label={`Add ${p.name}`}><Plus size={15} aria-hidden /> Add</button>
          </li>
        ))}
      </ul>
      {full && <p className="fine">That's {MAX_STOPS} stops, the most a plan holds. Remove one to add another.</p>}
    </section>
  );
}

/** Step 3: plan cards to compare, then the stops you can remove, swap or add to. */
export default function Results({ d, selected, onOpen, onCheckin }: { d: Detour; selected: number | null; onOpen: (s: RouteStop) => void; onCheckin: (t: CheckinTarget) => void }) {
  const [details, setDetails] = useState(false);
  const { response, plan } = d;
  const presetBar = (
    <div className="seg presets-mini" role="radiogroup" aria-label="Extra time">
      {[...PRESETS, ...(d.preset === "custom" ? [{ id: "custom" as const, label: "Custom", min: d.budgetOf("custom") }] : [])].map((p) => (
        <button key={p.id} type="button" role="radio" aria-checked={d.preset === p.id} className={d.preset === p.id ? "on" : ""}
          onClick={() => d.setPreset(p.id)}>{p.label} <span className="fine num">{p.min === "auto" ? "Auto" : `+${budgetLabel(p.min)}`}</span></button>
      ))}
    </div>
  );
  // this option is still planning or failed: keep the switcher so you're never stuck here
  if (!response || !plan) {
    const r = d.preset ? d.results[d.preset] : undefined;
    return (
      <div className="stack results">
        {presetBar}
        {r && typeof r === "object" && "error" in r
          ? <p className="fine" role="status">{r.error} <button type="button" className="link" onClick={() => d.preset && d.retry(d.preset)}>Try again</button></p>
          : <p className="fine" role="status">Planning your detour…</p>}
      </div>
    );
  }
  const plans = response.plans ?? [];
  const current = plans.find((p) => p.id === d.choice) ?? plans[0];
  return (
    <div className={`stack results${d.editing ? " updating" : ""}`} aria-busy={d.editing}>
      {d.editing && <PlanProgress editing />}
      {presetBar}

      {plans.length > 1 && (
        <div className="plan-cards" role="radiogroup" aria-label="Plans">
          {plans.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={p.id === current?.id} className={`plan-card${p.id === current?.id ? " on" : ""}`}
              onClick={() => d.setChoice(p.id)}>
              <span className="thumbs" aria-hidden>{p.stops.slice(0, 4).map((s) => <Thumb key={s.id} s={s} size={30} />)}</span>
              <b>{p.name}</b>
              <span className="preset-stats"><span><b className="num">{p.stops.length}</b> <small>{p.stops.length === 1 ? "stop" : "stops"}</small></span>
                <span><b className="num">+{p.extra_min}</b> <small>min</small></span></span>
            </button>
          ))}
        </div>
      )}

      <div className="trip-sum">
        <p className="trip-figures">
          <span><b className="num big">{arrive(d.prefs, plan)}</b> <small>arrive</small></span>
          <span><b className="num">{plan.total_min}</b> <small>min trip</small></span>
          <span><b className="num">+{plan.extra_min}</b> <small>min vs straight</small></span>
          {plan.road_extra_min != null && plan.stops.length > 0 && <button type="button" className="link small-link" aria-expanded={details} onClick={() => setDetails(!details)}>
            Details <ChevronDown size={14} aria-hidden /></button>}</p>
        {details && plan.road_extra_min != null && (
          <p className="fine num">+{plan.road_extra_min} min on the road · {plan.stop_min} min at stops{plan.wait_min ? ` · ${plan.wait_min} min waiting for a meal time` : ""} · straight there {plan.base_min} min</p>
        )}
        {current?.missed_meals?.length ? <p className="fine" role="status">No restaurant fits {current.missed_meals.map((m) => `${MEAL_NAME[m].toLowerCase()} (${MEALS.find((x) => x.id === m)!.window})`).join(", ")}. Try more time or another start time.</p> : null}
        {current?.unfit_required?.length ? <p className="fine" role="status">A place you picked didn't fit this much time. Try a longer option.</p> : null}
        {d.bump > 0 && <p className="fine" role="status">Extra time stretched to +{budgetLabel(response.budget_min)} so your added stops fit.</p>}
        {plan.routing === "estimate" && <p className="fine" role="status">Road directions are unavailable, so times are estimates.</p>}
      </div>

      {plan.stops.length === 0
        ? <p className="fine">{plan.warnings?.some((w) => w === "places_unavailable" || w === "some_detours_unavailable")
            ? "Couldn't check road times right now. Try again in a moment." : "No stops fit this much time. Try a longer option or fewer filters."}</p>
        : <ol className="stop-rows">{plan.stops.filter((s) => !d.hidden.includes(s.id)).map((s, i) => <StopRow key={s.id} s={s} i={i} d={d} sel={selected === s.id} onOpen={onOpen} onCheckin={onCheckin} />)}</ol>}

      <Along places={current?.along ?? []} d={d} full={plan.stops.length >= MAX_STOPS} />
      <p className="fine">How stops are picked <Info label="How stops are picked">Stops are picked on quality, opening hours and how little time they
        add. Partner shops rank like everyone else.</Info></p>
    </div>
  );
}
