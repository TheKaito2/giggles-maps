import { type CheckinTarget, KIND_NAME, type Meal, type RoutePlan } from "../lib/api";
import { hhmm, MEALS } from "./prefs";

const MEAL_NAME: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
export const CATEGORY: Record<string, string> = { cafe: "Café", food: "Food", craft: "Craft shop", temple: "Temple", park: "Park", museum: "Museum", market: "Market", viewpoint: "Viewpoint", art: "Art" };
const PRICE = ["Free", "฿", "฿฿", "฿฿฿"];
const PARTNER_TIP = "This shop pays Giggles Maps when you visit. It's ranked like every other place; paying never moves it up.";

interface Props {
  response: RoutePlan;
  plan: RoutePlan;           // response with the picked plan swapped in
  choice: string | null;
  setChoice: (id: string) => void;
  selected: number | null;
  onCheckin: (target: CheckinTarget) => void;
  picks: { id: number; name: string }[];
}

export default function Results({ response, plan, choice, setChoice, selected, onCheckin, picks }: Props) {
  const plans = response.plans ?? [];
  const current = plans.find((p) => p.id === choice) ?? plans[0];
  return (
    <div className="stack">
      {plans.length > 1 && (
        <div>
          <div className="eyebrow" id="plan-label">Pick a plan</div>
          <div className="plan-picker" role="radiogroup" aria-labelledby="plan-label">
            {plans.map((p) => {
              const on = p.id === current.id;
              return (
                <button key={p.id} type="button" role="radio" aria-checked={on} className={on ? "on" : ""} onClick={() => setChoice(p.id)}>
                  <span className="plan-name">{p.name}</span>
                  <span className="num fine">{p.stops.length} stop{p.stops.length === 1 ? "" : "s"} · +{p.extra_min} min</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {current && !!current.unfit_required?.length && (
        <p className="fine" role="status">
          Couldn't fit {current.unfit_required.map((id) => picks.find((p) => p.id === id)?.name ?? "a place you picked").join(", ")} in +{plan.budget_min} min
          (too far, closed then, or over your stop limit). Try more time.
        </p>
      )}
      {current && current.missed_meals.length > 0 && (
        <p className="fine" role="status">
          No food stop fits {current.missed_meals.map((m) => `${MEAL_NAME[m].toLowerCase()} (${MEALS.find((x) => x.id === m)!.window})`).join(", ")} in
          this plan. Try leaving closer to that time or allowing more extra time.
        </p>
      )}

      <div className="summary">
        <div><span className="num big-num">+{plan.extra_min}</span><span className="fine"> of +{plan.budget_min} min used</span></div>
        {plan.road_extra_min != null && plan.stops.length > 0 && (
          <dl className="time-split">
            <div><dt>More on the road</dt><dd className="num">+{plan.road_extra_min} min</dd></div>
            <div><dt>At {plan.stops.length} stop{plan.stops.length === 1 ? "" : "s"}</dt>
              <dd className="num">{plan.stop_min} min <span className="fine">(avg {Math.round(plan.stop_min! / plan.stops.length)})</span></dd></div>
            {!!plan.wait_min && <div><dt>Waiting for a meal time</dt><dd className="num">{plan.wait_min} min</dd></div>}
          </dl>
        )}
        <div className="fine">{plan.stops.length} stop{plan.stops.length === 1 ? "" : "s"} · trip {plan.total_min} min instead of {plan.base_min}</div>
        {plan.routing === "estimate" && <div className="fine" role="status">Routing is unavailable. The dashed line is an approximate walking connection, not road directions. Times and your allowance are checked using estimates.</div>}
        {plan.stops.length > 0 && !!plan.base_geometry?.length && <div className="fine">Dashed grey: direct road route · Indigo: your detour. Both end at your destination.</div>}
        {plan.warnings?.some((w) => w !== "estimated_local_walk") && <div className="fine" role="status">Some stops were adjusted or couldn't be checked. Retry to explore more detours.</div>}
      </div>
      {plan.stops.length === 0 && (plan.warnings?.some((w) => w === "places_unavailable" || w === "some_detours_unavailable")
        ? <p className="error" role="status">Couldn't load places or check road times right now. Tap Edit trip and Find again in a moment.</p>
        : <p className="fine">No stops fit +{plan.budget_min} min with these preferences. Try more time, a lower rating, or fewer filters.</p>)}

      <ol className="stops">
        {plan.stops.map((s, i) => (
          <li key={s.id} id={`stop-${s.id}`} className="stop-item">
            <div className={`stop-card ${selected === s.id ? "sel" : ""} ${s.is_partner ? "is-partner" : ""}`}>
              <span className={`pin static ${s.is_partner ? "stop partner" : "stop"}`}>{i + 1}</span>
              <div className="stop-body">
                <div className="stop-name">{s.name}</div>
                {s.name_th && s.name_th !== s.name && <div className="fine">{s.name_th}</div>}
                <div className="stop-meta">
                  <span className="num">{hhmm(s.eta_min)}</span>
                  <span>{CATEGORY[s.category] ?? s.category}</span>
                  <span>{s.dwell_min} min</span>
                  <span>{s.rating == null ? "Unrated" : `★ ${s.rating.toFixed(1)}`}</span>
                  <span className="chip price">{s.price_level == null ? "Price not listed" : PRICE[s.price_level]}</span>
                  {s.picked && <span className="chip picked">You picked this</span>}
                  {s.meal && <span className="chip meal">{MEAL_NAME[s.meal]}</span>}
                  {s.is_partner && <span className="chip partner" title={PARTNER_TIP}>{s.is_demo ? "Example partner" : "Partner"}</span>}
                  {!!s.min_level && s.exclusive_kind && <span className="chip exclusive">{KIND_NAME[s.exclusive_kind]} · Level {s.min_level}</span>}
                </div>
                {!!s.min_level && s.perk_text && <div className="fine">{s.perk_text}</div>}
              </div>
              <button type="button" className="btn small" onClick={() => onCheckin(s)}>Check in</button>
            </div>
            {s.nearby_partner && (
              <div className="near-card">
                <span className="near-label">Near this spot</span>
                <span className="near-name">{s.nearby_partner.name}</span>
                <span className="fine num">{s.nearby_partner.distance_m} m</span>
                {!!s.nearby_partner.min_level && s.nearby_partner.exclusive_kind && <span className="chip exclusive">{KIND_NAME[s.nearby_partner.exclusive_kind]} · Level {s.nearby_partner.min_level}</span>}
                {s.nearby_partner.is_partner && <span className="chip partner" title={PARTNER_TIP}>{s.nearby_partner.is_demo ? "Example partner" : "Partner"}</span>}
                <button type="button" className="link" onClick={() => onCheckin(s.nearby_partner!)}>Check in</button>
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className="fine">Stops are picked on quality only. Partner shops rank like everyone else.</p>
    </div>
  );
}
