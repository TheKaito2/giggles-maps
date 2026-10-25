// Opening hours for a place OpenStreetMap gives none for (most temples, parks and markets here): the usual hours for its
// kind, so a plan made at night doesn't send people to a temple at 04:00 or a weekend-night walking street at dawn.
// Known hours always win. Minutes after midnight; close < open means it closes after midnight.
// ponytail: one window per kind, no weekdays; a walking street open only at weekends still shows on a Tuesday evening.
// for markets, shops, food, art and crafts ("Artwork Zone Night Bazaar"): a park called "Night Safari" or a
// "Midnight Café" is not a night market
const NIGHT_MARKET = /\bnight\b|walking street|ถนนคนเดิน|ตลาดโต้รุ่ง|ตลาดกลางคืน|ไนท์/i;
const NIGHT_KINDS = new Set(["market", "shop", "food", "art", "craft"]);
const USUAL: Record<string, [number, number]> = {
  temple: [6 * 60, 18 * 60], museum: [9 * 60, 16 * 60 + 30], art: [10 * 60, 18 * 60], park: [5 * 60, 20 * 60],
  viewpoint: [5 * 60, 20 * 60], craft: [9 * 60, 18 * 60], shop: [9 * 60, 20 * 60], market: [6 * 60, 18 * 60],
  food: [7 * 60, 21 * 60], cafe: [8 * 60, 18 * 60],
};

export function usualHours(category: string, name: string, open: number | null, close: number | null): [number | null, number | null] {
  if (open != null && close != null) return [open, close];
  if (NIGHT_KINDS.has(category) && NIGHT_MARKET.test(name)) return [17 * 60, 23 * 60];
  return USUAL[category] ?? [null, null];   // stays, fuel, convenience stores...: treated as always open
}
