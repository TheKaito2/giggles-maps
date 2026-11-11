// Made-up demo-mode content: fake community posts and comments that exist only while demo mode is on.
// Nothing here is saved, sent to the server, or shown to real users. Same people + places + now give the same feed.
import type { Comment, FeedItem, Reaction } from "../lib/api";
import { type DemoPerson, seeded, who } from "./types";

export interface DemoPlace {
  id: number;
  name: string;
  name_th: string | null;
  category: string;
  tier: 1 | 2 | 3 | 4;
  province: { id: number; iso: string; name_en: string; name_th: string } | null;
}

type Rand = () => number;
type Draft = Omit<FeedItem, "id">;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const FEED_SEED = 4242;   // fixed, so the random picks never change; only the timestamps follow `now`

const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
/** Whole number from lo to hi, both included. */
const int = (r: Rand, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

const placeOf = (pl: DemoPlace) => ({ id: pl.id, name: pl.name, name_th: pl.name_th, category: pl.category, tier: pl.tier });

const CAPTIONS = ["ร้านนี้อร่อยมาก!", "Best view all week", "มาครั้งแรก ประทับใจ", "Worth the detour", "Golden hour here", "ไม่ผิดหวังเลย"];
const PRIZES = ["a free iced coffee on your next stop", "a mango sticky rice voucher", "one bonus week of XP"];
const CHALLENGES = [
  { title: "Visit 3 temples this week", title_th: "ไปวัด 3 แห่งในสัปดาห์นี้", xp: 150, coins: 40 },
  { title: "Try 2 local cafés", title_th: "ลองคาเฟ่ท้องถิ่น 2 แห่ง", xp: 100, coins: 25 },
  { title: "Eat at 3 street food stalls", title_th: "กินอาหารริมทาง 3 ร้าน", xp: 120, coins: 30 },
];
// Real badge slugs, names and icons (icon names as in Badges.tsx ICON map), from the server's badge definitions.
const BADGES = [
  { slug: "province-hopper", name_en: "Province Hopper", icon: "map" },
  { slug: "landmark-hunter", name_en: "Landmark Hunter", icon: "landmark" },
  { slug: "collector", name_en: "Collector", icon: "stamp" },
  { slug: "foodie", name_en: "Foodie", icon: "utensils" },
  { slug: "temple-runner", name_en: "Temple Runner", icon: "temple" },
  { slug: "road-crew", name_en: "Road Crew", icon: "car" },
];
const COMMENT_LINES = [
  "สวยมาก!", "Adding this to my list", "Was it crowded?", "ไปมาแล้ว อร่อยจริง", "Next time I'm in town!",
  "ขอบคุณที่แชร์นะ", "Looks amazing", "Which day did you go?", "อยากไปบ้างเลย", "Save me a seat next time",
];

/** Reactions skew low; heart can reach 12, the rest less. */
function reactionsFor(r: Rand): Partial<Record<Reaction, number>> {
  const out: Partial<Record<Reaction, number>> = {};
  const keys: Reaction[] = ["heart", "fire", "clap", "wow"];
  const caps = [12, 6, 4, 3];
  keys.forEach((k, i) => {
    const n = Math.floor(r() * r() * (caps[i] + 1));
    if (n > 0) out[k] = n;
  });
  return out;
}

export function demoFeed(people: DemoPerson[], places: DemoPlace[], scope: "all" | "friends" | "me", now = new Date()): FeedItem[] {
  const pool = scope === "all" ? people : scope === "friends" ? people.filter((p) => p.friend) : [];
  if (!pool.length) return [];
  const r = seeded(FEED_SEED);
  const withProv = places.filter((p) => p.province);
  const bkk = new Date(now.getTime() + 7 * HOUR);
  const dayStart = (back: number) => Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate() - back, 1); // 08:00 Bangkok
  const within6 = () => now.getTime() - Math.floor(r() * 6 * DAY / MIN) * MIN;

  const draft = (p: DemoPerson, kind: FeedItem["kind"], t: number,
    o: { place?: FeedItem["place"]; province?: FeedItem["province"]; data?: Record<string, unknown>; caption?: string | null } = {}): Draft => ({
    kind, at: new Date(t).toISOString(), mine: false, data: o.data ?? {}, who: who(p), to: null,
    place: o.place ?? null, province: o.province ?? null, photo: null, caption: o.caption ?? null,
    reactions: reactionsFor(r), my_reaction: null, comments: int(r, 0, 4),
  });
  const stamp = (p: DemoPerson, pl: DemoPlace, t: number, rideAlong = false): Draft =>
    draft(p, "stamp", t, {
      place: placeOf(pl), province: pl.province, data: rideAlong ? { group_bonus: 1 } : {},
      caption: r() < 0.3 ? pick(r, CAPTIONS) : null,
    });

  const out: Draft[] = [];
  if (places.length) {
    // Five day clusters: one person stamping 2 to 3 places on the same Bangkok day (the app folds these into one card).
    for (let back = 1; back <= 5; back++) {
      const p = pick(r, pool);
      const n = int(r, 2, 3);
      for (let k = 0; k < n; k++) {
        const t = dayStart(back) + int(r, 0, 9) * HOUR + int(r, 0, 59) * MIN;
        out.push(stamp(p, pick(r, places), t, k === 0 && r() < 0.3));
      }
    }
    // Five single stamps spread over the week.
    for (let k = 0; k < 5; k++) out.push(stamp(pick(r, pool), pick(r, places), within6()));
  }
  if (withProv.length) {
    out.push(draft(pick(r, pool), "province", within6(), { province: pick(r, withProv).province }));
  }
  for (let k = 0; k < 3; k++) {
    const p = pick(r, pool);
    out.push(draft(p, "level", within6(), { data: { level: Math.max(2, p.level) } }));
  }
  for (let k = 0; k < 3; k++) {
    const c = CHALLENGES[k];
    out.push(draft(pick(r, pool), "challenge", within6(), { data: { ...c } }));
  }
  for (let k = 0; k < 2; k++) {
    const b = BADGES[int(r, 0, BADGES.length - 1)];
    out.push(draft(pick(r, pool), "badge", within6(), { data: { slug: b.slug, name_en: b.name_en, icon: b.icon, tier: int(r, 1, 4) } }));
  }
  out.push(draft(pick(r, pool), "fortune", within6(), {
    data: { rarity: "legendary", item: pick(r, PRIZES), stick: int(r, 1, 30) },
  }));
  out.push(draft(pick(r, pool), "award", now.getTime() - int(r, 4, 5) * DAY, {
    data: { scope: scope === "friends" ? "friends" : "all", rank: 1, coins: 200 },
  }));

  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out.map((d, i) => ({ ...d, id: -(i + 1) }));
}

export function demoComments(activityId: number, people: DemoPerson[], now = new Date()): Comment[] {
  if (!people.length) return [];
  const r = seeded(Math.abs(activityId) * 97 + 13);
  const n = int(r, 1, 4);
  const minsAgo = Array.from({ length: n }, () => int(r, 2, 4000)).sort((a, b) => b - a); // oldest first
  return minsAgo.map((m, k) => ({
    id: -(Math.abs(activityId) * 10 + k + 1),
    body: pick(r, COMMENT_LINES),
    at: new Date(now.getTime() - m * MIN).toISOString(),
    mine: false,
    who: who(pick(r, people)),
  }));
}
