// Giggles Maps detour planner. The route is never for sale: stops are chosen on quality
// (rating x variety) per added minute. The planner doesn't know which places pay.
// Constraints: total extra time <= budget, every stop open on arrival, rating >= floor.
// Greedy insertion + 2-opt; fine for the <=16 candidates the DB prefilter returns.

export interface Stop {
  idx: number;          // row/column in the travel matrix
  id: number;
  category: string;
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
}

const quality = (s: Stop) => s.rating / 5;

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

  // reverse any segment that shortens the trip while staying feasible
  const twoOpt = (o: Stop[]): Stop[] => {
    let best = o, improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < best.length - 1; i++) {
        for (let k = i + 1; k < best.length; k++) {
          const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
          if (duration(cand) < duration(best) - 1e-9 && feasible(cand)) { best = cand; improved = true; }
        }
      }
    }
    return best;
  };

  // cheapest feasible way to add s to the current order
  const bestInsert = (order: Stop[], s: Stop) => {
    let best: { order: Stop[]; added: number } | null = null;
    const current = duration(order);
    for (let i = 0; i <= order.length; i++) {
      const next = [...order.slice(0, i), s, ...order.slice(i)];
      if (!feasible(next)) continue;
      const added = duration(next) - current;
      if (!best || added < best.added) best = { order: next, added };
    }
    return best;
  };

  // quality route; repeated categories count half (variety)
  let order: Stop[] = [];
  for (;;) {
    let pick: { order: Stop[]; ratio: number } | null = null;
    for (const s of eligible) {
      if (order.includes(s)) continue;
      const ins = bestInsert(order, s);
      if (!ins) continue;
      const variety = order.some((o) => o.category === s.category) ? 0.5 : 1;
      const ratio = (quality(s) * variety) / Math.max(ins.added, 1);
      if (!pick || ratio > pick.ratio) pick = { order: ins.order, ratio };
    }
    if (!pick) break;
    order = twoOpt(pick.order);
  }

  const totalMin = duration(order);
  return { order, baseMin, totalMin, extraMin: totalMin - baseMin };
}
