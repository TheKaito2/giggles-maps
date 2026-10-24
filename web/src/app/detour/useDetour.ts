import { myLocation } from "../../lib/demoGps";
import { useEffect, useRef, useState } from "react";
import { ApiError, errCode } from "../../lib/supabase";
import { isGuest, useUser } from "../../lib/auth";
import { choosePlan, planRoute, type RoutePlan } from "../../lib/api";
import { DEFAULT_PREFS, MAX_BUDGET, MAX_STOPS, type Place, type Prefs, toRequest } from "../prefs";

// Detour flow, Google-Maps style: browse the map -> pick where to -> pick how much time (Quick, Relaxed and Day out
// are planned in parallel; none is picked until you tap one) -> results you can edit (remove or add stops).
type Stage = "browse" | "choose" | "results";
export const PRESETS = [
  { id: "quick", label: "Quick", min: 20, blurb: "A quick sight and a 7-Eleven stop" },
  { id: "relaxed", label: "Relaxed", min: 45, blurb: "The best along the way" },
  { id: "day", label: "Day out", min: 120, blurb: "Make a trip of it" },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"] | "custom";
type Result = RoutePlan | "loading" | { error: string };
// v5: why a plan was refused, for the sign-in / membership sheet
export type Gate = "sign_in_required" | "detour_limit" | "edit_limit";
const GATES = new Set<string>(["sign_in_required", "detour_limit", "edit_limit"]);

const errorText = (e: unknown) => {
  const code = errCode(e);
  return code === "routing_unavailable" ? "Couldn't find a road route. Try another way to travel, or retry in a moment."
    : code === "sign_in_required" ? "Sign in to plan detours."
    : code === "detour_limit" ? "That's today's 3 free detours."
    : code === "edit_limit" ? "That's today's 10 free changes."
    : code === "slow_down" ? "Lots of plans at once. Wait a moment, then try again."
    : code.startsWith("bad_") ? "Pick a start and destination inside Thailand." : "Couldn't plan this one. Try again in a moment.";
};

export function useDetour(onError: (m: string) => void) {
  const guest = isGuest(useUser());
  const [gate, setGate] = useState<Gate | null>(null);
  const gated = (e: unknown) => { if (e instanceof ApiError && GATES.has(e.code)) setGate(e.code as Gate); };
  const [stage, setStage] = useState<Stage>("browse");
  const [origin, setOrigin] = useState<Place | null>(null);   // null = your location, found when needed
  const [dest, setDest] = useState<Place | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [results, setResults] = useState<Partial<Record<PresetId, Result>>>({});
  const [preset, setPreset] = useState<PresetId | null>(null);   // nothing picked until you tap one
  const [choice, setChoice] = useState<string | null>(null);   // theme of the plan card you picked
  const [exclude, setExclude] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const [bump, setBump] = useState(0);              // extra minutes added so the stops you added fit
  const [hidden, setHidden] = useState<number[]>([]);   // removed stops, hidden at once while the route recalculates
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

  const budgetOf = (id: PresetId) => id === "custom" ? prefs.budget : PRESETS.find((p) => p.id === id)!.min;

  const planPreset = (k: PresetId, id: number) => {
    if (!origin || !dest) return;
    setResults((all) => ({ ...all, [k]: "loading" }));
    planRoute(toRequest({ ...prefs, budget: budgetOf(k) }, origin.point, dest.point))
      .then((r) => { if (id === request.current) setResults((all) => ({ ...all, [k]: r })); })
      .catch((e) => { if (id === request.current) { gated(e); setResults((all) => ({ ...all, [k]: { error: errorText(e) } })); } });
  };
  // a new trip plans all three options at once (Relaxed first), plus a custom time if that's the one picked;
  // the cards fill in as each returns
  useEffect(() => {
    const id = ++request.current;
    edit.current++; setEditing(false);   // an edit in flight belongs to the old trip
    setExclude([]); setChoice(null); setBump(0); setHidden([]); setResults({});
    if (stage === "browse" || !origin || !dest) return;
    const ids: PresetId[] = ["relaxed", "quick", "day", ...(preset === "custom" ? ["custom" as const] : [])];
    // detours need an account (v5): ask a guest to sign in instead of sending plans the server refuses
    if (guest) { setGate("sign_in_required"); setResults(Object.fromEntries(ids.map((k) => [k, { error: "Sign in to plan detours." }]))); return; }
    setResults(Object.fromEntries(ids.map((k) => [k, "loading"])));
    // a short pause first: tapping several filter chips in a row sends one round of plans, not one per tap
    const t = setTimeout(() => { for (const k of ids) planPreset(k, id); }, 400);
    return () => clearTimeout(t);
  }, [origin, dest, prefs, stage === "browse", guest, again]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = (k: PresetId) => guest ? setGate("sign_in_required") : planPreset(k, request.current);

  const goTo = async (place: Place) => {
    setDest(place); setStage("choose"); setPreset(null);
    if (!origin) {
      try { const here = await locate(); setOrigin((o) => o ?? here); } catch (e) { onError((e as Error).message); }   // a From typed meanwhile wins
    }
  };
  // tapping an option shows its plans (planning it again only if it failed); edits don't carry across options
  const choosePreset = (id: PresetId) => {
    edit.current++; setPreset(id); setChoice(null); setExclude([]); setEditing(false); setBump(0); setHidden([]);
    const r = results[id];
    if (guest) { setGate("sign_in_required"); return; }
    if (!r || (typeof r === "object" && "error" in r)) planPreset(id, request.current);
  };
  // a new custom time changes the trip, and the effect above plans it; the same time again just picks it
  const pickCustom = (min: number | "auto") => {
    if (min === prefs.budget) choosePreset("custom"); else { set({ budget: min }); setPreset("custom"); }
  };
  const close = () => {
    request.current++; edit.current++;
    setStage("browse"); setDest(null); setResults({}); setExclude([]); setChoice(null); setEditing(false); setHidden([]); setBump(0);
    setOrigin((o) => o?.name === "Your location" ? null : o);   // you'll have moved: locate again next time
  };

  const current = preset ? results[preset] : undefined;
  const response = current && typeof current === "object" && "route_id" in current ? current : null;
  const plan = response && choosePlan(response, choice);

  // edits re-plan the shown preset: kept stops stay in (must_include), removed ones stay out (exclude)
  const replan = async (keep: number[], out: number[], extra = bump, mustFit?: number, tries = 2): Promise<void> => {
    if (!origin || !dest || !response || !preset) return;
    const id = ++edit.current;
    setEditing(true);
    try {
      const theme = choice ?? response.plans?.[0]?.id;
      const base = budgetOf(preset);
      // auto: the server's own pick is the base (response.budget_min already includes the current bump)
      const budget = base === "auto" ? (extra ? Math.min(MAX_BUDGET, response.budget_min - bump + extra) : "auto") : Math.min(MAX_BUDGET, base + extra);
      const r = await planRoute({ ...toRequest({ ...prefs, budget }, origin.point, dest.point),
        must_include: [...new Set([...prefs.picks.map((p) => p.id), ...keep])].slice(0, MAX_STOPS), exclude: out.slice(-30), theme });
      if (id !== edit.current) return;
      // the estimate said it fits but the real road time didn't: give it 15 more minutes (twice at most)
      const unfit = r.plans?.find((p) => p.id === theme)?.unfit_required ?? r.unfit_required ?? [];
      if (mustFit != null && unfit.includes(mustFit) && tries > 0 && budget !== "auto" && budget < MAX_BUDGET) {
        return replan(keep, out, extra + 15, mustFit, tries - 1);
      }
      setExclude(out); setBump(extra); setResults((all) => ({ ...all, [preset!]: r })); setChoice(theme ?? null);
    } catch (e) { if (id === edit.current) { gated(e); onError(errorText(e)); } }
    finally { if (id === edit.current) { setEditing(false); setHidden([]); } }
  };
  const ids = () => plan?.stops.map((s) => s.id) ?? [];
  // one edit at a time: the next one builds on its result. Removing keeps the others, rules this one out,
  // and lets the planner fill the gap with its best replacement.
  const removeStop = (stop: number) => { if (editing) return; setHidden((h) => [...h, stop]); return replan(ids().filter((x) => x !== stop), [...exclude, stop]); };
  // adding means adding: stretch the time (to the next 15 min) when the place wouldn't fit what's left
  const addStop = (place: number, extraMin: number) => {
    if (editing) return;
    const left = (response?.budget_min ?? 0) - (plan?.extra_min ?? 0);
    const more = extraMin > left ? Math.ceil((extraMin - left) / 15) * 15 : 0;
    return replan([...ids(), place], exclude.filter((x) => x !== place), bump + more, place);
  };

  return {
    stage, setStage, origin, setOrigin, dest, setDest, prefs, set, results, preset, setPreset: choosePreset, choice, setChoice, plan, response,
    editing, locating, bump, hidden, retry, notify: onError, gate, setGate, replanAll: () => setAgain((n) => n + 1), goTo, close, pickCustom, budgetOf, removeStop, addStop,
    swap: () => { if (origin && dest) { setOrigin(dest); setDest(origin); } },
  };
}
export type Detour = ReturnType<typeof useDetour>;
