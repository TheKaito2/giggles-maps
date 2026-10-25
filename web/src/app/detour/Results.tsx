import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, Flag, GripVertical, MoreHorizontal, Plus, Search, Trash2, Camera, X } from "lucide-react";
import Modal from "../Modal";
import { type AlongPlace, type CheckinTarget, type FoundPlace, type Meal, type RouteStop, routePlaces, searchPlaces, TIER_NAME } from "../../lib/api";
import { CHIPS } from "../ExploreChips";
import { SkelRows } from "../Skeleton";
import { GROUPS, kindOf } from "../kinds";
import { budgetLabel, hhmm, MEALS, startMin } from "../prefs";
import { type Detour, PRESETS } from "./useDetour";
import PlanProgress from "./PlanProgress";
import Info from "../Info";
import { metres } from "../nav/progress";
import { nameOf } from "../../lib/i18n";

const MEAL_NAME: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const PARTNER_TIP = "This shop pays Giggles Maps when you visit.";
// paid placement is always labelled: members' plans put these places first
const TIER_TIP = { partner: "A verified shop that pays Giggles Maps monthly. Members' plans put partners first.",
  choice: "Hand-picked by Giggles and pays monthly. Members' plans put it first; the Partner picks plan uses only these." } as const;

/** A place's photo, or its kind icon on its group colour. */
export function Thumb({ s, size = 48 }: { s: { name: string; category: string; photo?: string | null }; size?: number }) {
  const k = kindOf(null, s.category);
  const [broken, setBroken] = useState<string | null>(null);   // a photo that didn't load (moved, removed) shows the kind icon
  return s.photo && s.photo !== broken
    ? <img className="thumb" src={s.photo} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(s.photo!)} />
    : <span className="thumb" style={{ width: size, height: size, background: GROUPS[k.group].colour }}><k.icon size={size * 0.45} aria-hidden /></span>;
}

// at most two badges per stop, the most telling first
function badges(s: RouteStop): { text: string; cls: string; title?: string }[] {
  const all = [
    s.closed && { text: "Closed then", cls: "closed", title: "You added it, but it's closed when you get there" },
    s.partner_tier && { text: TIER_NAME[s.partner_tier], cls: `tier-${s.partner_tier}`, title: TIER_TIP[s.partner_tier] },
    s.picked && { text: "You picked", cls: "picked" },
    s.pit_stop && { text: "Pit stop", cls: "pit", title: "A quick stop for snacks, a drink or the toilet" },
    s.meal && { text: s.meal_late ? `Late ${MEAL_NAME[s.meal].toLowerCase()}` : MEAL_NAME[s.meal], cls: "meal" },
    s.tier === 3 && { text: "Landmark", cls: "landmark" },
    (s.otop || s.community) && { text: s.otop ? "OTOP" : "Community", cls: "otop" },
    !s.otop && !s.community && s.local && { text: "Local", cls: "" },
    !s.partner_tier && s.is_partner && { text: s.is_demo ? "Example partner" : "Partner", cls: "partner", title: PARTNER_TIP },
  ].filter(Boolean) as { text: string; cls: string; title?: string }[];
  return all.slice(0, 2);
}

// "Suggested" is the planner's own list (exact minutes); the rest are the map's chips, places of those kinds nearest the route
const STOP_CATS = new Set(["temple", "museum", "art", "park", "viewpoint", "food", "market", "cafe", "craft"]);   // "elsewhere" in Suggested
const SPEED_M_PER_MIN = { pedestrian: 80, bicycle: 250, auto: 500 } as const;   // town speeds, for an off-route estimate
interface Row { id: number; name: string; name_th: string | null; category: string; kind: string | null; photo: string | null;
  extra: number; estimate: boolean; rating: number | null }

const MOVE = { pedestrian: "walk", bicycle: "ride", auto: "drive" } as const;
/** "12 min drive · 20 min wait · 45 min there · leave 12:31": how you get to a stop, any wait for a meal time, and how long you have
 *  there. `gap` = minutes from leaving the last stop to arriving here; `travel` = the road part of it, when the plan says. */
const legLine = (gap: number, mode: keyof typeof MOVE, travel?: number, dwell?: number, leave?: number) => {
  const road = Math.max(0, Math.round(travel ?? gap)), wait = Math.round(gap - road);
  return [`${road} min ${MOVE[mode]}`, wait >= 2 && `${wait} min wait`, dwell != null && `${dwell} min there`, leave != null && `leave ${hhmm(leave)}`]
    .filter(Boolean).join(" · ");
};

function StopRow({ s, i, d, sel, dragging, travel, roadMin, onDrag, onStep, onOpen, onCheckin }: { s: RouteStop; i: number; d: Detour; sel: boolean; dragging: boolean; travel: number | null; roadMin?: number;
  onDrag: (e: React.PointerEvent) => void; onStep: (by: number) => void; onOpen: (s: RouteStop) => void; onCheckin: (t: CheckinTarget) => void }) {
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
  const tags = badges(s);
  return (
    <li className={`stop-row${sel ? " sel" : ""}${dragging ? " dragging" : ""}`} id={`stop-${s.id}`}>
      <button type="button" className="drag-handle" aria-label={`Move ${s.name}: hold and drag, or use the arrow keys`} aria-disabled={d.editing}
        onPointerDown={onDrag} onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); onStep(e.key === "ArrowUp" ? -1 : 1); } }}>
        <GripVertical size={16} aria-hidden /></button>
      <button type="button" className="stop-main" onClick={() => onOpen(s)}>
        <span className="stop-num" aria-hidden>{i + 1}</span>
        <Thumb s={s} />
        <span className="stop-text">
          <b>{nameOf(s)}</b>
          <span className="stop-meta"><b className="num" aria-label={`Arrive ${hhmm(s.eta_min)}`}>{hhmm(s.eta_min)}</b>{s.extra_min != null && <b className="num extra">+{s.extra_min} min</b>}
            <span className="fine">{kindOf(s.pit_stop ? "convenience" : null, s.category).en}{s.rating != null && ` · ★ ${s.rating.toFixed(1)}`}</span></span>
          {/* mid-drag the numbers are stale: hidden, but keeping their space so rows don't jump under your finger */}
          <span className={`fine num stop-leg${travel == null ? " stale" : ""}`}>{legLine(travel ?? 0, d.prefs.mode, roadMin, s.dwell_min, s.eta_min + s.dwell_min)}</span>
          {tags.length > 0 && <span className="row tight">{tags.map((b) => <span key={b.text} className={`chip ${b.cls}`} title={b.title}>{b.text}</span>)}</span>}
        </span>
      </button>
      <div className="stop-more" ref={more}>
        <button type="button" className="icon-btn" aria-label={`More for ${s.name}`} aria-expanded={menu} aria-haspopup="menu" disabled={d.editing} onClick={() => setMenu(!menu)}><MoreHorizontal size={18} /></button>
        {menu && <div className="menu glass" role="menu" onClick={() => setMenu(false)}>
          <button type="button" role="menuitem" onClick={() => onCheckin(s)}><Camera size={16} aria-hidden /> Check in</button>
          <button type="button" role="menuitem" onClick={() => d.removeStop(s.id)}><Trash2 size={16} aria-hidden /> Remove</button>
        </div>}
      </div>
    </li>
  );
}

const LEG_REACH_M = 1500;   // a place this close to the stretch between two stops counts as on it (= route_places' corridor)
const pt = ([lng, lat]: [number, number]) => ({ lat, lng });
/** The road between the stops either side of gap `at` (0 = start to the first stop): the plan's line cut at its stops,
 *  walking forward so a road that passes a spot twice is cut in order. */
function stretch(line: [number, number][], stops: { lat: number; lng: number }[], at: number): [number, number][] {
  const cuts = [0];
  for (const s of stops) {
    let best = cuts.at(-1)!, d = Infinity;
    for (let k = best; k < line.length; k++) { const m = metres(pt(line[k]), s); if (m < d) { d = m; best = k; } }
    cuts.push(best);
  }
  cuts.push(line.length - 1);
  return line.slice(cuts[at], cuts[at + 1] + 1);
}
const offLine = (p: { lat: number; lng: number }, line: [number, number][]) => Math.min(...line.map((v) => metres(pt(v), p)));

/** Places you can add: the planner's suggestions or a map kind (convenience, gas, ATMs...) near the route, plus a search that also finds
 * places elsewhere. Rows are one height and the list keeps its size, so nothing moves under your pointer while you search or filter. */
function AlongList({ places, d, full, limit, at, leg, onAdded }: { places: AlongPlace[]; d: Detour; full: boolean; limit: number; at?: number;
  leg?: [number, number][]; onAdded?: () => void }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("suggested");
  const [byKind, setByKind] = useState<Row[] | null>(null);
  const [elsewhere, setElsewhere] = useState<FoundPlace[]>([]);
  const chip = CHIPS.find((c) => c.id === kind);
  const inPlan = new Set(d.plan?.stops.map((s) => s.id) ?? []);
  // the + between two stops: only what's on the road between them (`leg`); otherwise the whole route
  const geometry = leg ?? d.plan?.geometry;
  // a map kind: its places nearest the route, minutes estimated from how far off the road they are (+5 there)
  useEffect(() => {
    if (!chip || !geometry) { setByKind(null); return; }
    let live = true;
    setByKind(null);
    routePlaces(geometry, chip.kinds).then((r) => live && setByKind(r.filter((x) => !inPlan.has(x.id)).map((x) => ({ ...x, photo: null, estimate: true,
      extra: Math.round((2 * x.distance_m) / SPEED_M_PER_MIN[d.prefs.mode]) + 5 })))).catch(() => live && setByKind([]));
    return () => { live = false; };
  }, [kind, geometry]); // eslint-disable-line react-hooks/exhaustive-deps
  const needle = q.trim().toLowerCase();
  const all: Row[] = chip ? byKind ?? [] : leg
    ? places.map((p) => ({ p, off: offLine(p, leg) })).filter(({ off }) => off <= LEG_REACH_M)
      .map(({ p, off }) => ({ ...p, kind: null, photo: p.photo, extra: Math.round((2 * off) / SPEED_M_PER_MIN[d.prefs.mode]) + 5, estimate: true }))
    : places.map((p) => ({ ...p, kind: null, photo: p.photo, extra: p.extra_min, estimate: false }));
  const list = all.filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.name_th ?? "").includes(q.trim())).slice(0, limit);
  // 2+ letters: also search everywhere near the destination, after a short pause
  useEffect(() => {
    if (needle.length < 2 || leg) { setElsewhere([]); return; }   // a stretch shows only what's on it
    let live = true;
    const t = setTimeout(() => searchPlaces(q.trim(), d.dest?.point).then((r) => {
      if (!live) return;
      const shown = new Set([...all.map((p) => p.id), ...inPlan]);
      setElsewhere(r.filter((x) => x.id != null && !shown.has(x.id) && (chip ? chip.kinds.includes(x.kind ?? "") : STOP_CATS.has(x.category ?? ""))).slice(0, 6));
    }).catch(() => live && setElsewhere([])), 300);
    return () => { live = false; clearTimeout(t); };
  }, [needle, kind, byKind]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (id: number) => { d.addStop(id, at); onAdded?.(); };
  // closed when you'd pass it: say when it opens (usual hours when none are listed)
  const closedNote = (p: object) => {
    const { closed, opens_min: opens } = p as { closed?: boolean; opens_min?: number | null };
    return closed && <span className="chip closed" title="Probably closed when you pass it">{opens != null ? <><span className="opens-word">Opens </span>{hhmm(opens)}</> : "Closed then"}</span>;
  };
  const row = (p: Row | FoundPlace, extra: string, off = false) => (
    <li key={`${off ? "e" : ""}${p.id}`}>
      <Thumb s={{ name: p.name, category: p.category ?? "", photo: "photo" in p ? p.photo ?? null : null }} size={40} />
      <span className="stop-text"><b>{nameOf(p)}</b>
        <span className="stop-meta"><b className={`num extra${off ? " off" : ""}`}>{extra}</b>
          {/* closed then: when it opens takes the kind's place, so the row stays one line and "+NN min" stays visible */}
          {closedNote(p) || <span className="fine">{kindOf(p.kind ?? null, p.category ?? "").en}{p.rating != null && ` · ★ ${p.rating.toFixed(1)}`}</span>}</span></span>
      <button type="button" className="btn soft small add-btn" disabled={full || d.editing} onClick={() => add(p.id!)}
        aria-label={`Add ${p.name}`}><Plus size={15} aria-hidden /> Add</button>
    </li>
  );
  return (
    <>
      <div className="along-controls">
        <label className="along-search"><Search size={16} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search places" aria-label="Search places to add" /></label>
        <label className="along-kind">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of place">
            <option value="suggested">Suggested</option>
            {CHIPS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select></label>
      </div>
      <ul className="along-list">
        {chip && byKind === null ? <li className="along-empty"><SkelRows n={3} avatar={40} square /></li> : <>
          {list.map((p) => row(p, `${p.estimate ? "~" : ""}+${p.extra} min`))}
          {!list.length && !elsewhere.length && <li className="along-empty fine">{leg ? "Nothing on this stretch." : needle ? "Nothing matches near your route." : "None near your route."}</li>}
          {elsewhere.length > 0 && <li className="along-sep eyebrow">Elsewhere</li>}
          {elsewhere.map((p) => row(p, "off route", true))}
        </>}
      </ul>
      {full && <p className="fine">That's {d.cap} stops, the most a plan holds.{d.response?.member ? "" : " Members can have 15."} Remove one to add another.</p>}
    </>
  );
}

function Along({ places, d, full }: { places: AlongPlace[]; d: Detour; full: boolean }) {
  if (!places.length) return null;
  return (
    <section className="along" aria-labelledby="along-title">
      <h3 id="along-title" className="eyebrow">Add along your route</h3>
      <AlongList places={places} d={d} full={full} limit={8} />
    </section>
  );
}

/** The sheet the + between stops opens: only places on the road between those two stops; the pick goes right there and the
 *  route goes through it. */
function AddStopSheet({ places, d, full, at, onClose }: { places: AlongPlace[]; d: Detour; full: boolean; at: number; onClose: () => void }) {
  const stops = d.plan?.stops ?? [];
  const where = at === 0 ? `before ${stops[0]?.name ?? "your first stop"}` : at >= stops.length ? `after ${stops.at(-1)?.name ?? "your last stop"}`
    : `between ${stops[at - 1].name} and ${stops[at].name}`;
  const leg = d.plan?.geometry?.length ? stretch(d.plan.geometry, stops, at) : [];
  return (
    <Modal label="Add a stop" className="add-stop" onClose={onClose}>
      <header className="modal-head"><span><h2>Add a stop</h2><span className="fine">It goes right here, {where}.</span></span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
      {leg.length > 1 ? <AlongList places={places} d={d} full={full} limit={30} at={at} leg={leg} onAdded={onClose} /> : <p className="fine">Nothing on this stretch.</p>}
    </Modal>
  );
}

/** The small + between stops: shows when you hover the stop next to it (always, faintly, on touch screens). */
const AddGap = ({ onAdd, hidden }: { onAdd: () => void; hidden: boolean }) =>
  <li className="add-gap" hidden={hidden}><button type="button" className="add-here" onClick={onAdd} aria-label="Add a stop here"><Plus size={14} aria-hidden /></button></li>;

/** Step 3: plan cards to compare, then the stops you can remove (the plan refills the gap) or add to. */
export default function Results({ d, selected, onOpen, onCheckin }: { d: Detour; selected: number | null; onOpen: (s: RouteStop) => void; onCheckin: (t: CheckinTarget) => void }) {
  const [details, setDetails] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);   // the "Add a stop" sheet: the gap its + sits in (0 = before the first stop)
  const { response, plan } = d;
  // hold a stop's handle and drag it: the list reorders as you move, and letting go reroutes in that order
  const [order, setOrder] = useState<number[] | null>(null);   // stop ids while dragging, then until the new route arrives
  const [dragId, setDragId] = useState<number | null>(null);
  const rows = useRef<HTMLOListElement>(null);
  useEffect(() => { if (!d.editing && dragId == null) setOrder(null); }, [plan, d.editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = plan?.stops.filter((s) => !d.hidden.includes(s.id)) ?? [];
  // when the trip leaves: the first leg's travel time and the arrival below count from it ("now" was fixed when it was planned)
  const start = response?.start_min ?? startMin(d.prefs);
  const shown = order ? order.map((id) => visible.find((s) => s.id === id)).filter((s): s is RouteStop => !!s) : visible;
  const commit = (next: number[]) => { if (next.join() !== visible.map((s) => s.id).join()) d.reorder(next); else setOrder(null); };
  const drag = (id: number, e: React.PointerEvent) => {
    if (d.editing || e.button > 0) return;
    e.preventDefault();
    let cur = visible.map((s) => s.id);
    setOrder(cur); setDragId(id);
    const move = (ev: PointerEvent) => {
      // the dragged stop goes before the first other row whose middle is below the pointer
      const others = [...rows.current!.querySelectorAll<HTMLElement>("li.stop-row")].filter((r) => r.id !== `stop-${id}`);
      const k = others.filter((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < ev.clientY; }).length;
      const next = cur.filter((x) => x !== id);
      next.splice(k, 0, id);
      if (next.join() !== cur.join()) { cur = next; setOrder(next); }
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      setDragId(null); commit(cur);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };
  const step = (id: number, by: number) => {
    if (d.editing) return;
    const cur = visible.map((s) => s.id), at = cur.indexOf(id), to = at + by;
    if (to < 0 || to >= cur.length) return;
    const next = [...cur]; next.splice(at, 1); next.splice(to, 0, id);
    setOrder(next); commit(next);
  };
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
          ? <p className="fine" role="status">{r.error} {r.gate?.startsWith("sign_in")
              ? <button type="button" className="link" onClick={() => d.setGate(r.gate!)}>Sign in</button>
              : <button type="button" className="link" onClick={() => d.preset && d.retry(d.preset)}>Try again</button>}</p>
          : <PlanProgress />}
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
          <span><b className="num big">{hhmm(start + plan.total_min)}</b> <small>arrive</small></span>
          <span><b className="num">{plan.total_min}</b> <small>min trip</small></span>
          <span><b className="num">+{plan.extra_min}</b> <small>min vs straight</small></span>
          {plan.road_extra_min != null && plan.stops.length > 0 && <button type="button" className="link small-link" aria-expanded={details} onClick={() => setDetails(!details)}>
            Details <ChevronDown size={14} aria-hidden /></button>}</p>
        {details && plan.road_extra_min != null && (
          <p className="fine num">+{plan.road_extra_min} min on the road · {plan.stop_min} min at stops{plan.wait_min ? ` · ${plan.wait_min} min waiting for a meal time` : ""} · straight there {plan.base_min} min</p>
        )}
        {current?.missed_meals?.length ? <p className="fine" role="status">No restaurant fits {current.missed_meals.map((m) => `${MEAL_NAME[m].toLowerCase()} (${MEALS.find((x) => x.id === m)!.window})`).join(", ")}. Try more time or another start time.</p> : null}
        {current?.unfit_required?.length ? <p className="fine" role="status">A place you picked has no road to it, so it's not in this plan.</p> : null}
        {plan.routing === "estimate" && <p className="fine" role="status">Road directions are unavailable, so times are estimates.</p>}
      </div>

      {plan.stops.length === 0
        ? <p className="fine">{plan.warnings?.some((w) => w === "places_unavailable" || w === "some_detours_unavailable")
            ? "Couldn't check road times right now. Try again in a moment."
            : start % 1440 >= 21 * 60 || start % 1440 < 6 * 60   // at night it's closing hours, not too little time
              ? <>Most places are closed at this hour. <button type="button" className="link" onClick={() => d.set({ depart: "custom", time: "08:00" })}>Leave at 08:00 instead</button></>
              : "No stops fit this much time. Try a longer option or fewer filters."}</p>
        : <ol className="stop-rows" ref={rows}>
            {shown.map((s, i) => <Fragment key={s.id}>
              {i === 0 && <AddGap hidden={!!order} onAdd={() => setAdding(0)} />}
              <StopRow s={s} i={i} d={d} sel={selected === s.id} dragging={dragId === s.id} onDrag={(e) => drag(s.id, e)} onStep={(by) => step(s.id, by)}
                travel={order ? null : s.eta_min - (i ? shown[i - 1].eta_min + shown[i - 1].dwell_min : start)}
                // the road minutes only hold for the leg the plan made: with the stop before this one just removed (re-planning),
                // the gap spans two legs, so it's all shown as travel rather than a bogus wait
                roadMin={plan.stops[plan.stops.indexOf(s) - 1] === (i ? shown[i - 1] : undefined) ? s.travel_min : undefined}
                onOpen={onOpen} onCheckin={onCheckin} />
              <AddGap hidden={!!order} onAdd={() => setAdding(i + 1)} />
            </Fragment>)}
            {!order && shown.length > 0 && <li className="stop-row dest-row">
              <span className="stop-num dest" aria-hidden><Flag size={12} /></span>
              <span className="stop-text"><b>{d.dest?.name.split(", ")[0]}</b>
                <span className="stop-meta"><b className="num">{hhmm(start + plan.total_min)}</b><span className="fine">Arrive</span></span>
                <span className="fine num stop-leg">{legLine(start + plan.total_min - (shown.at(-1)!.eta_min + shown.at(-1)!.dwell_min), d.prefs.mode)}</span></span>
            </li>}
          </ol>}
      {adding != null && <AddStopSheet places={current?.along ?? []} d={d} full={plan.stops.length >= d.cap} at={adding} onClose={() => setAdding(null)} />}

      <Along places={current?.along ?? []} d={d} full={plan.stops.length >= d.cap} />
      <p className="fine">How stops are picked <Info label="How stops are picked">Stops are picked on quality, opening hours and how little time they
        add. Paid Partner and Giggles Choice places are always labelled; free plans rank them like everyone else, and
        members' plans give them a boost. "Partner picks" is a plan of paid partners only.</Info></p>
    </div>
  );
}
