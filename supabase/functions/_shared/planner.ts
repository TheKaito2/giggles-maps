// Giggles Maps detour planner.
// Fill the user's extra-time budget with stops, money first:
//   phase 1 = paid partner stops, ranked by expected revenue per added minute
//   phase 2 = free stops fill what's left, ranked by rating per added minute
// Constraints: total extra time <= budget, every stop visited inside its opening hours,
// rating >= floor. Greedy insertion + 2-opt; fine for the <=25 candidates the DB prefilter returns.

export interface Stop {
  idx: number;          // row/column in the travel matrix
  id: number;
  value: number;        // expected THB = effective bid * p(check-in) * quality
  rating: number;
  dwellMin: number;
  openMin?: number | null;   // minutes after midnight
  closeMin?: number | null;
}

export interface PlanInput {
  originIdx: number;
  destIdx: number;
  startMin: number;
  budgetMin: number;
  stops: Stop[];
  travelMin: (from: number, to: number) => number;
  minRating?: number;
}

export interface Plan {
  order: Stop[];        // chosen stops in visiting order
  baseMin: number;      // origin -> destination with no stops
  totalMin: number;
  extraMin: number;
  expectedThb: number;
}

export function expectedValue(bidThb: number, pCheckin: number, rating: number): number {
  return bidThb * pCheckin * (rating / 5);
}

export function planDetour(input: PlanInput): Plan {
  const { originIdx, destIdx, startMin, budgetMin, travelMin, minRating = 4.0 } = input;
  const eligible = input.stops.filter((s) => s.rating >= minRating);

  const duration = (order: Stop[]): number => {
    let t = 0, at = originIdx;
    for (const s of order) { t += travelMin(at, s.idx) + s.dwellMin; at = s.idx; }
    return t + travelMin(at, destIdx);
  };

  const fitsHours = (order: Stop[]): boolean => {
    let t = startMin, at = originIdx;
    for (const s of order) {
      t += travelMin(at, s.idx);
      if (s.openMin != null && s.closeMin != null && (t < s.openMin || t + s.dwellMin > s.closeMin)) return false;
      t += s.dwellMin;
      at = s.idx;
    }
    return true;
  };

  const baseMin = duration([]);
  const feasible = (order: Stop[]) => duration(order) - baseMin <= budgetMin + 1e-9 && fitsHours(order);

  let order: Stop[] = [];
  const insertPhase = (pool: Stop[], score: (s: Stop) => number) => {
    for (;;) {
      let best: { order: Stop[]; ratio: number } | null = null;
      const current = duration(order);
      for (const s of pool) {
        if (order.includes(s)) continue;
        for (let i = 0; i <= order.length; i++) {
          const next = [...order.slice(0, i), s, ...order.slice(i)];
          if (!feasible(next)) continue;
          const ratio = score(s) / Math.max(duration(next) - current, 1);
          if (!best || ratio > best.ratio) best = { order: next, ratio };
        }
      }
      if (!best) return;
      order = twoOpt(best.order);
    }
  };

  // reverse any segment that shortens the trip while staying feasible
  const twoOpt = (o: Stop[]): Stop[] => {
    let bestOrder = o, improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < bestOrder.length - 1; i++) {
        for (let k = i + 1; k < bestOrder.length; k++) {
          const cand = [...bestOrder.slice(0, i), ...bestOrder.slice(i, k + 1).reverse(), ...bestOrder.slice(k + 1)];
          if (duration(cand) < duration(bestOrder) - 1e-9 && feasible(cand)) { bestOrder = cand; improved = true; }
        }
      }
    }
    return bestOrder;
  };

  insertPhase(eligible.filter((s) => s.value > 0), (s) => s.value);
  insertPhase(eligible.filter((s) => s.value <= 0), (s) => s.rating / 100);

  const totalMin = duration(order);
  return {
    order,
    baseMin,
    totalMin,
    extraMin: totalMin - baseMin,
    expectedThb: order.reduce((sum, s) => sum + s.value, 0),
  };
}
