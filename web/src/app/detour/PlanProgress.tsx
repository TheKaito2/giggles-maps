import { useEffect, useState } from "react";

// What the planner is doing, more or less in order: the request is one call, so the steps go by time, not by real progress.
// The bar eases towards 92% and the component simply goes away when the plan arrives.
const STEPS: [number, string][] = [
  [0, "Mapping your route"], [800, "Finding places along the way"], [1800, "Checking opening hours"],
  [2900, "Timing each detour on the road"], [4200, "Picking the best stops"], [6500, "Almost there"],
];
const EDIT_STEPS: [number, string][] = [[0, "Updating your plan"], [1200, "Re-timing the road"], [3000, "Almost there"]];

export default function PlanProgress({ editing = false }: { editing?: boolean }) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const t = setInterval(() => setMs(performance.now() - t0), 200);
    return () => clearInterval(t);
  }, []);
  const steps = editing ? EDIT_STEPS : STEPS;
  const step = steps.filter(([at]) => ms >= at).length - 1;
  const pct = 92 * (1 - Math.exp(-ms / (editing ? 1500 : 2600)));
  return (
    <div className={`plan-progress${editing ? " small" : ""}`} role="status" aria-live="polite">
      <span className="plan-step" key={step}><span className="spinner" aria-hidden /> {steps[step][1]}…</span>
      <span className="plan-bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>
    </div>
  );
}
