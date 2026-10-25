import { myLocation } from "../../lib/demoGps";
import { useEffect, useRef, useState } from "react";
import { ApiError, errCode } from "../../lib/supabase";
import { isGuest, useUser } from "../../lib/auth";
import { choosePlan, planRoute, type RoutePlan } from "../../lib/api";
import { DEFAULT_PREFS, MAX_BUDGET, type Place, type Prefs, toRequest } from "../prefs";

// Detour flow, Google-Maps style: browse the map -> pick where to -> pick how much time (Quick, Relaxed, Day out and Half day
// are planned in parallel; none is picked until you tap one) -> results you can edit (remove or add stops).
type Stage = "browse" | "choose" | "results";
export const PRESETS = [
  { id: "quick", label: "Quick", min: 20, blurb: "One or two quick stops" },
  { id: "relaxed", label: "Relaxed", min: 45, blurb: "The best along the way" },
  { id: "day", label: "Day out", min: 120, blurb: "Make a trip of it" },
  { id: "half", label: "Half day", min: 240, blurb: "Room for a long wander" },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"] | "custom";
type Result = RoutePlan | "loading" | { error: string; gate?: Gate };   // gate: sign in or upgrade, not worth a retry
// v5: why a plan was refused, for the sign-in / membership sheet
export type Gate = "sign_in_required" | "sign_in_edits" | "detour_limit" | "edit_limit";
const GATES = new Set<string>(["sign_in_required", "sign_in_edits", "detour_limit", "edit_limit"]);

const errorText = (e: unknown) => {
  const code = errCode(e);
  return code === "routing_unavailable" ? "Couldn't find a road route. Try another way to travel, or retry in a moment."
    : code === "sign_in_required" ? "Guests try one detour a day. Sign in free for 3."
    : code === "sign_in_edits" ? "Guests get 3 changes a day. Sign in free for 10."
    : code === "detour_limit" ? "That's today's 3 free detours."
    : code === "edit_limit" ? "That's today's 10 free changes."
    : code === "slow_down" ? "Lots of plans at once. Wait a moment, then try again."
    : code === "day_cap" ? "That's all the plans for today. Sign in free for more, or come back tomorrow."
    : code === "stop_limit" ? "That's the most stops a plan holds. Remove one to add another."
    : code === "too_far_for_mode" ? "That's too far to walk or cycle in one go. Try Driving."
    : code === "bad_origin" || code === "bad_dest" ? "Pick a start and destination inside Thailand." : "Couldn't plan this one. Try again in a moment.";
};

// The trip you're planning, kept on this device for 12 hours: closing the app (a phone does that to apps in the
// background on a road trip), a reload or iOS dropping the web view doesn't lose it. The destination, start, time option
// and filters come back and the options are planned again; edits to stops aren't kept.
// Its plans come back too when they're under 30 minutes old, instead of planning all four options again on every reopen
// (that used up a guest's 20 plans a day).
const SAVED = "gm-trip", KEEP_MS = 12 * 3600_000, PLANS_MS = 30 * 60_000;
type Saved = { stage: Stage; origin: Place | null; dest: Place; prefs: Prefs; preset: PresetId | null; at?: number;
  results?: Partial<Record<PresetId, Result>>; resultsAt?: number };
/** Signing out or deleting the account: the trip and directions kept on this device go too (a shared phone's next user
 *  saw the previous route, planned on their account). Open screens hear it and close. */
export function forgetTrip() {
  try { localStorage.removeItem(SAVED); localStorage.removeItem("gm-nav"); } catch { /* nothing kept */ }
  dispatchEvent(new Event("gm-forget-trip"));
}
const isPlace = (p: unknown): p is Place => {
  const v = p as Place | null;
  return !!v && typeof v.name === "string" && Number.isFinite(v.point?.lat) && Number.isFinite(v.point?.lng);
};
function savedTrip(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED) ?? "null") as Saved | null;
    // anything that doesn't look like a trip we saved (edited, from an older version) is dropped, not half-restored
    if (!v || v.at == null || Date.now() - v.at >= KEEP_MS || !(v.stage === "choose" || v.stage === "results")) return null;
    if (!isPlace(v.dest) || (v.origin != null && !isPlace(v.origin))) return null;
    if (v.preset != null && !PRESETS.some((x) => x.id === v.preset) && v.preset !== "custom") return null;
    const plans = v.results && v.resultsAt != null && Date.now() - v.resultsAt < PLANS_MS ? v.results : undefined;
    return { ...v, prefs: { ...DEFAULT_PREFS, ...v.prefs }, results: plans };
  } catch { return null; }
}

export function useDetour(onError: (m: string) => void) {
  const restored = useRef(savedTrip()).current;
  const guest = isGuest(useUser());
  const [gate, setGate] = useState<Gate | null>(null);
  const gated = (e: unknown) => { if (e instanceof ApiError && GATES.has(e.code)) setGate(e.code as Gate); };
  const [stage, setStage] = useState<Stage>(restored?.stage ?? "browse");
  const [origin, setOrigin] = useState<Place | null>(restored?.origin ?? null);   // null = your location, found when needed
  const [dest, setDest] = useState<Place | null>(restored?.dest ?? null);
  const [prefs, setPrefs] = useState<Prefs>(restored?.prefs ?? DEFAULT_PREFS);
  const [results, setResults] = useState<Partial<Record<PresetId, Result>>>(() =>
    Object.fromEntries(Object.entries(restored?.results ?? {}).filter(([, r]) => r !== "loading")));
  // the restored plans stand while the trip is unchanged (reopening doesn't plan again); any change plans afresh
  const reuseKey = useRef<string | null>(restored?.results ? JSON.stringify([restored.origin, restored.dest, restored.prefs]) : null);
  const [preset, setPreset] = useState<PresetId | null>(restored?.preset ?? null);   // nothing picked until you tap one
  const [choice, setChoice] = useState<string | null>(null);   // theme of the plan card you picked
  const [exclude, setExclude] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const [hidden, setHidden] = useState<number[]>([]);   // removed stops, hidden at once while the route recalculates
  // you put the stops in your own order (a drag, a + between two): edits keep it. A new plan (another time option, plan
  // card or destination) starts from the planner's order again: reset where those happen, not by watching `choice`,
  // which an edit's own result sets too (that reset it after the first edit).
  const [manual, setManual] = useState(false);
  useEffect(() => {
    try {
      if (stage === "browse" || !dest) localStorage.removeItem(SAVED);
      else {
        const settled = !Object.values(results).some((r) => r === "loading");
        localStorage.setItem(SAVED, JSON.stringify({ stage, origin, dest, prefs, preset, at: Date.now(),
          ...(settled && { results, resultsAt: Date.now() }) } satisfies Saved));
      }
    } catch { /* not kept: private mode, or full */ }
  }, [stage, origin, dest, prefs, preset, results]);
  const [locating, setLocating] = useState(false);
  const request = useRef(0);   // preset plans in flight
  const [again, setAgain] = useState(0);   // bumped to plan the presets again (a rewarded ad lifted today's limit)
  const edit = useRef(0);      // remove/add re-plan in flight

  // same values = same object, so re-tapping a choice doesn't re-plan every preset
  const set = (patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) => setPrefs((p) => {
    const next = { ...p, ...(typeof patch === "function" ? patch(p) : patch) };
    return JSON.stringify(next) === JSON.stringify(p) ? p : next;
  });

  // start defaults to your location, the first time it's needed
  const locate = () => new Promise<Place>((ok, fail) => {
    setLocating(true);
    myLocation(
      (pos) => { setLocating(false); ok({ point: { lat: pos.coords.latitude, lng: pos.coords.longitude }, name: "Your location" }); },
      () => { setLocating(false); fail(new Error("Location is blocked. Type where you're starting from instead.")); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });

  useEffect(() => {
    const forget = () => closeRef.current();
    addEventListener("gm-forget-trip", forget);
    return () => removeEventListener("gm-forget-trip", forget);
  }, []);
  // a trip saved before your location was found: find it now, as picking the destination would have
  useEffect(() => {
    if (restored && !restored.origin) locate().then((here) => setOrigin((o) => o ?? here)).catch((e) => onError((e as Error).message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const budgetOf = (id: PresetId) => id === "custom" ? prefs.budget : PRESETS.find((p) => p.id === id)!.min;

  const planPreset = (k: PresetId, id: number) => {
    if (!origin || !dest) return;
    setResults((all) => ({ ...all, [k]: "loading" }));
    planRoute(toRequest({ ...prefs, budget: budgetOf(k) }, origin.point, dest.point))
      .then((r) => { if (id === request.current) setResults((all) => ({ ...all, [k]: r })); })
      .catch((e) => { if (id === request.current) { gated(e); setResults((all) => ({ ...all, [k]: { error: errorText(e), gate: GATES.has(errCode(e)) ? errCode(e) as Gate : undefined } })); } });
  };
  // a new trip plans all four options at once (Relaxed first), plus a custom time if that's the one picked;
  // the cards fill in as each returns
  useEffect(() => {
    const signInGate = Object.values(results).some((r) => typeof r === "object" && "gate" in r && r.gate?.startsWith("sign_in"));
    if (reuseKey.current === JSON.stringify([origin, dest, prefs]) && !(signInGate && !guest)) return;   // the saved plans still fit
    reuseKey.current = null;
    const id = ++request.current;
    edit.current++; setEditing(false);   // an edit in flight belongs to the old trip
    setExclude([]); setChoice(null); setManual(false); setHidden([]); setResults({});
    if (stage === "browse" || !origin || !dest) return;
    const ids: PresetId[] = ["relaxed", "quick", "day", "half", ...(preset === "custom" ? ["custom" as const] : [])];
    // guests plan too (one destination a day, server-side): the server answers sign_in_required after that
    setResults(Object.fromEntries(ids.map((k) => [k, "loading"])));
    // a short pause first: tapping several filter chips in a row sends one round of plans, not one per tap
    const t = setTimeout(() => { for (const k of ids) planPreset(k, id); }, 400);
    return () => clearTimeout(t);
  }, [origin, dest, prefs, stage === "browse", guest, again]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = (k: PresetId) => planPreset(k, request.current);

  const goTo = async (place: Place) => {
    setDest(place); setStage("choose"); setPreset(null);
    if (!origin) {
      try { const here = await locate(); setOrigin((o) => o ?? here); } catch (e) { onError((e as Error).message); }   // a From typed meanwhile wins
    }
  };
  // tapping an option shows its plans (planning it again only if it failed); edits don't carry across options
  const choosePreset = (id: PresetId) => {
    edit.current++; setPreset(id); setChoice(null); setManual(false); setExclude([]); setEditing(false); setHidden([]);
    const r = results[id];
    // a guest's refused plan would be refused again until they sign in: show the sign-in sheet instead of asking the
    // server. Any other failure (a daily limit too: they may have just bought membership) is asked again.
    if (guest && r && typeof r === "object" && "gate" in r && r.gate?.startsWith("sign_in")) setGate(r.gate);
    else if (!r || (typeof r === "object" && "error" in r)) planPreset(id, request.current);
  };
  // a new custom time changes the trip, and the effect above plans it; the same time again just picks it
  const pickCustom = (min: number | "auto") => {
    if (min === prefs.budget) choosePreset("custom"); else { set({ budget: min }); setPreset("custom"); }
  };
  const closeRef = useRef(() => {});
  const close = () => {
    request.current++; edit.current++;
    setStage("browse"); setDest(null); setResults({}); setExclude([]); setChoice(null); setManual(false); setEditing(false); setHidden([]);
    setOrigin((o) => o?.name === "Your location" ? null : o);   // you'll have moved: locate again next time
  };

  closeRef.current = close;
  const current = preset ? results[preset] : undefined;
  const response = current && typeof current === "object" && "route_id" in current ? current : null;
  const plan = response && choosePlan(response, choice);
  const cap = response?.max_stops ?? 10;   // stops a plan holds: 10, members 15 (= STOP_CAP in plan-route)

  // edits re-plan the shown preset: kept stops stay in (must_include), removed ones stay out (exclude), and the planner works
  // out the best order again. Kept stops always stay, past the preset's time if need be: the time only shapes the generated
  // plans, it never refuses a stop you chose. `fixed`: keep exactly this order (a place added in a gap goes right there).
  const replan = async (keep: number[], out: number[], fixed: boolean | number[] = false): Promise<void> => {
    if (!origin || !dest || !response || !preset) return;
    const id = ++edit.current;
    setEditing(true);
    try {
      const theme = choice ?? response.plans?.[0]?.id;
      const base = budgetOf(preset);
      const budget = base === "auto" ? "auto" : Math.min(MAX_BUDGET, base);
      const r = await planRoute({ ...toRequest({ ...prefs, budget }, origin.point, dest.point),
        must_include: [...new Set([...keep, ...prefs.picks.map((p) => p.id)])].slice(0, cap), keep_order: fixed || undefined,
        exclude: out.slice(-30), theme });
      if (id !== edit.current) return;
      setExclude(out); setResults((all) => ({ ...all, [preset!]: r })); setChoice(theme ?? null);
    } catch (e) { if (id === edit.current) { gated(e); onError(errorText(e)); } }
    finally { if (id === edit.current) { setEditing(false); setHidden([]); } }
  };
  const ids = () => plan?.stops.map((s) => s.id) ?? [];
  // one edit at a time: the next one builds on its result. Removing keeps the others, rules this one out,
  // and lets the planner fill the gap with its best replacement.
  // Once you've set the order yourself (a drag or a + between stops), later edits keep it.
  const removeStop = (stop: number) => { if (editing) return; setHidden((h) => [...h, stop]); return replan(ids().filter((x) => x !== stop), [...exclude, stop], manual); };
  // a stop dragged to a new place: the route goes in exactly this order
  const reorder = (order: number[]) => { if (editing) return; setManual(true); return replan(order, exclude, true); };
  // adding means adding: the place goes in even when the trip runs past the preset's time. `at`: the gap it goes in
  // (the + between two stops, 0 = before the first): the route goes through it right there; none = "add along your
  // route", and the planner fits it in the best order
  const addStop = (place: number, at?: number) => {
    if (editing) return;
    const keep = ids(), out = exclude.filter((x) => x !== place);
    if (at == null) return replan([...keep, place], out, manual ? keep : false);
    setManual(true);
    return replan([...keep.slice(0, at), place, ...keep.slice(at)], out, true);
  };

  return {
    stage, setStage, origin, setOrigin, dest, setDest, prefs, set, results, preset, setPreset: choosePreset, choice,
    setChoice: (c: string | null) => { setManual(false); setChoice(c); }, plan, response,
    cap, editing, locating, hidden, retry, notify: onError, gate, setGate, replanAll: () => { reuseKey.current = null; setAgain((n) => n + 1); }, goTo, close, pickCustom, budgetOf, removeStop, addStop, reorder,
    swap: () => { if (origin && dest) { setOrigin(dest); setDest(origin); } },
  };
}
export type Detour = ReturnType<typeof useDetour>;
