// Demo mode's pretend community, mixed into what the server returns. lib/api.ts loads this module only while demo mode is
// on (dynamic import), so real users never get it. Nothing is written to the database: reactions, comments and nudges on
// pretend people stay on this device.
import { type Board, type BoardMetric, type BoardPeriod, type BoardRow, type BoardScope, type Card, type Champion, type Comment,
  type FeedItem, type FriendPassport, type FriendQuest, mapPlaces, type PartnerTier, type ProfilePage, type Social } from "../lib/api";
import { supabase } from "../lib/supabase";
import { demoAt } from "../lib/demoGps";
import { DEMO_INCOMING, DEMO_PEOPLE, demoChampions } from "./people";
import { demoComments, demoFeed, type DemoPlace } from "./feed";
import { type DemoPerson, who } from "./types";

const byId = new Map(DEMO_PEOPLE.map((p) => [p.id, p]));
const card = (p: DemoPerson): Card => ({ id: p.id, nickname: p.nickname, colour: p.colour, xp: p.xp, level: p.level, stamps: p.stamps,
  provinces: p.provinces, look: p.look, title: p.title, avatar: p.avatar, joined: p.joined });
const count = (p: DemoPerson, metric: Exclude<BoardMetric, "xp">) => metric === "provinces" ? p.provinces : p[metric];
const value = (p: DemoPerson, period: BoardPeriod, metric: BoardMetric) => period === "week"
  ? metric === "xp" ? p.week_xp : Math.round(count(p, metric) * p.week_xp / Math.max(p.xp, 1))
  : metric === "xp" ? p.xp : count(p, metric);

/** The real board plus the pretend players, re-ranked; your own row keeps its value and gets its new rank. */
export function demoBoard(real: Board, scope: BoardScope, period: BoardPeriod, metric: BoardMetric): Board {
  const fake: BoardRow[] = DEMO_PEOPLE.filter((p) => scope === "everyone" || p.friend)
    .map((p) => ({ ...card(p), rank: 0, value: value(p, period, metric) })).filter((r) => r.value > 0);
  const rows = [...real.top.filter((r) => r.value > 0), ...fake, ...(real.me && !real.top.some((r) => r.id === real.me!.id) && real.me.value > 0 ? [real.me] : [])]
    .sort((a, b) => b.value - a.value).map((r, i) => ({ ...r, rank: i + 1 }));
  const me = real.me ? rows.find((r) => r.id === real.me!.id) ?? real.me : null;
  const next = me?.rank && me.rank > 1 ? rows[me.rank - 2] : null;
  return { ...real, top: rows.slice(0, 50), me, next, total: rows.length };
}

export const demoChampionsMerged = (real: Champion[]): Champion[] =>
  [...real, ...demoChampions().filter((c) => !real.some((r) => r.province.id === c.province.id))];

// pretend friend requests you answered this visit (accepted = true): kept in memory only, never sent to the server
const answered = new Map<string, boolean>();
export const answerDemoRequest = (id: string, accept: boolean) => { answered.set(id, accept); };

export const demoSocial = (real: Social): Social => ({
  friends: [...real.friends, ...DEMO_PEOPLE.filter((p) => p.friend || answered.get(p.id)).map(card)],
  incoming: [...real.incoming, ...DEMO_INCOMING.filter((id) => !answered.has(id)).map((id) => card(byId.get(id)!))],
  outgoing: real.outgoing,
});

// real places around the demo location, for the pretend feed (fetched once per position)
let placesFor = "", places: DemoPlace[] = [];
async function nearbyPlaces(): Promise<DemoPlace[]> {
  const at = demoAt(), key = `${at.lat.toFixed(2)},${at.lng.toFixed(2)}`;
  if (key === placesFor) return places;
  const d = 0.12;
  const list = await mapPlaces(at.lng - d, at.lat - d, at.lng + d, at.lat + d, 13, null).catch(() => []);
  places = list.filter((p) => p.tier >= 2 || p.local || p.otop).slice(0, 40)
    .map((p) => ({ id: p.id, name: p.name, name_th: p.name_th, category: p.category, tier: (p.tier >= 1 && p.tier <= 3 ? p.tier : 2) as 1 | 2 | 3, province: null }));
  placesFor = key;
  return places;
}
export async function demoFeedMerged(real: FeedItem[], scope: "all" | "friends" | "me"): Promise<FeedItem[]> {
  const fake = demoFeed(DEMO_PEOPLE, await nearbyPlaces(), scope);
  return [...real, ...fake].sort((a, b) => b.at.localeCompare(a.at));
}
export const demoCommentsFor = (activity: number): Comment[] => demoComments(activity, DEMO_PEOPLE);

// pretend partners: the demo_partners table (readable by anyone, used only here and by plan-route's demo requests)
let demoTiers: Map<number, PartnerTier> | null = null;
export async function demoTiersFor(ids: number[], real: Map<number, PartnerTier>): Promise<Map<number, PartnerTier>> {
  if (!demoTiers) {
    const { data } = await supabase.from("demo_partners").select("place_id, tier");
    demoTiers = new Map(((data ?? []) as { place_id: number; tier: PartnerTier }[]).map((d) => [d.place_id, d.tier]));
  }
  const out = new Map(real);
  for (const id of ids) if (!out.has(id) && demoTiers.has(id)) out.set(id, demoTiers.get(id)!);
  return out;
}

export function demoProfile(id: string): ProfilePage | null {
  const p = byId.get(id);
  if (!p) return null;
  const rank = [...DEMO_PEOPLE].sort((a, b) => b.xp - a.xp).findIndex((x) => x.id === id) + 1;
  return { ...card(p), friend_code: null, photos: Math.round(p.stamps * 0.6), friends: 6 + (p.stamps % 19), rank, badges: [], showcase: [], crowns: [] };
}
export function demoPassport(id: string): FriendPassport | null {
  const p = byId.get(id);
  return p ? { card: card(p), stamps: [], photos: [], provinces: [] } : null;
}

// Friends Quest with a pretend friend: remembered on this device for the week (Monday, Bangkok time)
const FQ = "gm-demo-friend-quest";
const weekOf = (d = new Date()) => {
  const bkk = new Date(d.getTime() + 7 * 3600_000), monday = new Date(bkk);
  monday.setUTCDate(bkk.getUTCDate() - ((bkk.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
};
export function setDemoFriendQuest(id: string) {
  try { localStorage.setItem(FQ, JSON.stringify({ id, week: weekOf() })); } catch { /* this visit only */ }
}
export function demoFriendQuest(): FriendQuest | null {
  let saved: { id: string; week: string } | null = null;
  try { saved = JSON.parse(localStorage.getItem(FQ) ?? "null"); } catch { /* none */ }
  const p = saved && saved.week === weekOf() ? byId.get(saved.id) : undefined;
  if (!p) return null;
  return { partner: who(p), week: saved!.week, me: 0, them: Math.min(6, 1 + (p.week_xp % 5)) };   // the pretend friend has made a start
}
