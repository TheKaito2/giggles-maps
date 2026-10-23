import type { LatLng, Mode, RoadRoute } from "./valhalla.ts";

export interface RoadStop extends LatLng {
  id: number; rating: number; category: string; dwell_min: number;
  paid: boolean; bid_thb: number; progress: number;
  open_min: number | null; close_min: number | null;
}
type Router = (points: LatLng[], mode: Mode) => Promise<RoadRoute>;

// Validate complete visits, including overnight hours and travel across midnight.
export function visitIsOpen(arrival: number, dwell: number, open: number | null, close: number | null) {
  if (open == null || close == null || open === close) return true;
  const day = Math.floor(arrival / 1440);
  return [day - 1, day].some((d) => {
    const from = d * 1440 + open;
    const to = d * 1440 + close + (close < open ? 1440 : 0);
    return arrival >= from && arrival + dwell <= to;
  });
}

export async function planRoadDetour<T extends RoadStop>(input: {
  origin: LatLng; dest: LatLng; mode: Mode; startMin: number; budgetMin: number;
  baseline: RoadRoute; candidates: T[]; allowPaid: boolean; route: Router;
}) {
  const { origin, dest, mode, startMin, budgetMin, baseline, route } = input;
  let order: T[] = [], road = baseline;
  let totalMin = baseline.travelMin, failures = 0, calls = 0;
  const deadline = Date.now() + 22000;
  const eligible = input.candidates.filter((s) => s.rating >= 4 && s.dwell_min <= budgetMin);
  // At most 6 + 5 free attempts and 2 paid attempts, two at a time.
  const free = eligible.filter((s) => !s.paid).slice(0, 6);
  const paid = input.allowPaid ? eligible.filter((s) => s.paid && s.bid_thb > 0).slice(0, 2) : [];
  const evaluate = async (s: T) => {
    if (Date.now() >= deadline || calls >= 13) return null;
    calls++;
    const next = [...order, s].sort((a, b) => a.progress - b.progress || a.id - b.id);
    try {
      const result = await route([origin, ...next, dest], mode);
      const duration = result.travelMin + next.reduce((sum, p) => sum + p.dwell_min, 0);
      if (!Number.isFinite(duration) || duration - baseline.travelMin > budgetMin + 1e-7) return null;
      let arrival = startMin;
      for (let i = 0; i < next.length; i++) {
        arrival += result.legMin[i];
        if (!visitIsOpen(arrival, next[i].dwell_min, next[i].open_min, next[i].close_min)) return null;
        arrival += next[i].dwell_min;
      }
      const added = Math.max(duration - totalMin, 1);
      const variety = order.some((p) => p.category === s.category) ? 0.5 : 1;
      const score = s.paid
        ? s.rating / 5 * s.bid_thb / (1 + Math.max(added - s.dwell_min, 0) / 10)
        : s.rating / 5 * variety / added;
      return { order: next, road: result, totalMin: duration, score };
    } catch { failures++; return null; }
  };
  const choose = async (pool: T[]) => {
    let best: Awaited<ReturnType<typeof evaluate>> = null;
    for (let i = 0; i < pool.length; i += 2) {
      const results = await Promise.all(pool.slice(i, i + 2).map(evaluate));
      for (const result of results) if (result && (!best || result.score > best.score)) best = result;
    }
    if (!best) return false;
    order = best.order; road = best.road; totalMin = best.totalMin;
    return true;
  };
  if (budgetMin > 0) {
    for (let i = 0; i < 2; i++) {
      if (!await choose(free.filter((s) => !order.includes(s)))) break;
    }
    // Paid stops cannot displace selected free stops or exceed the remaining budget.
    await choose(paid);
  }
  let arrival = startMin;
  const etaMin = order.map((s, i) => {
    arrival += road.legMin[i];
    const eta = Math.round(arrival); arrival += s.dwell_min; return eta;
  });
  return { order, road, etaMin, baseMin: baseline.travelMin, totalMin,
    extraMin: Math.max(0, totalMin - baseline.travelMin), failures, calls };
}
