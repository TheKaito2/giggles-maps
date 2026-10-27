import type { AvatarLook } from "../app/avatar/parts";
import { ApiError, callFn, ensureSession, supabase } from "./supabase";
import { demoOn, isDemoId } from "./demoGps";

// Demo mode mixes a pretend community (src/demo) into what the server returns. Loaded only while demo mode is on, so real
// users never download it or see it.
const demo = () => demoOn() ? import("../demo") : null;

/** A database function, after making sure there's a (guest) session; errors become ApiError(code). */
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  await ensureSession();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ApiError(error.message);
  return data as T;
}

export interface LatLng { lat: number; lng: number }

// "Near this spot" card: the best nearby place by quality, signed up or not (field name kept from v2)
export interface NearbyPartner {
  id: number; name: string; category: string; lat: number; lng: number; distance_m: number;
  is_partner: boolean; is_demo: boolean;
}

// v5: a verified shop paying monthly. Members' plans put these first; "choice" ones also make the Partner picks plan.
export type PartnerTier = "partner" | "choice";
export const TIER_NAME: Record<PartnerTier, string> = { partner: "Partner", choice: "Giggles Choice" };

export interface RouteStop {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  is_partner: boolean; // signed-up shop that pays per verified visit; never affects ranking
  is_demo: boolean; rating: number | null; dwell_min: number; eta_min: number;
  travel_min?: number;   // road minutes from the previous stop; eta_min - previous leave - travel_min = waiting for a meal time
  pit_stop?: boolean;   // Quick plans: a convenience store after the sight (snacks, toilet)
  price_level?: number | null; // 0 free, 1-3 = ฿-฿฿฿, null = not listed
  nearby_partner: NearbyPartner | null;
  partner_tier?: PartnerTier | null;
  meal?: Meal | null; // engine v2: this stop covers a meal
  meal_late?: boolean; // the restaurant for that meal, outside the usual meal hours (the route couldn't reach them)
  picked?: boolean;   // the user asked for this place (must_include)
  local?: boolean; otop?: boolean; community?: boolean;   // local first: independent / OTOP / community enterprise
  tier?: 1 | 2 | 3 | 4;   // 4 = icon (major landmark), 3 = landmark (must-go), 2 = worth a visit, 1 = everyday
  extra_min?: number | null;   // about how many minutes this stop adds (road detour + time there); null if unknown
  photo?: string | null;  // a photo of the place, when we have one
}

// a place the plan left out that you can add ("along your route"); extra_min is an estimate
export interface AlongPlace {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number; tier: 1 | 2 | 3 | 4;
  rating: number | null; local: boolean; otop: boolean; community: boolean; photo: string | null; extra_min: number;
  partner_tier?: PartnerTier | null;
}

export type Meal = "breakfast" | "lunch" | "dinner";

// engine v2: one plan per theme (top_picks | nature | food | culture | shopping); the user picks one
export interface ThemedPlan {
  id: string; name: string; stops: RouteStop[]; geometry: [number, number][];
  extra_min: number; total_min: number; meals: Meal[]; missed_meals: Meal[];
  unfit_required?: number[];   // picked places that didn't fit this plan
  road_extra_min?: number; stop_min?: number; wait_min?: number;   // where extra_min goes
  extra_km?: number;   // how much further than the direct road the plan drives (older servers: absent)
  along?: AlongPlace[];
}

export interface RoutePlan {
  route_id: string; routing: "valhalla" | "estimate"; mode: string; plus: boolean; member: boolean; level: number;
  base_min: number; total_min: number; extra_min: number; budget_min: number; max_budget_min: number;
  max_stops?: number;   // the most stops this account's plans hold (10, members 15)
  start_min?: number;   // when this plan leaves (minutes after midnight): the stops' times count from it
  candidates_considered: number;
  stops: RouteStop[]; geometry: [number, number][];
  base_geometry?: [number, number][];
  warnings?: string[];
  meals?: Meal[]; missed_meals?: Meal[];
  unfit_required?: number[];   // picked places that didn't fit (Top picks)
  plans?: ThemedPlan[]; // top-level fields = Top picks
  road_extra_min?: number; stop_min?: number; wait_min?: number; extra_km?: number;
  budget_auto?: boolean;   // budget_min was picked by the server ("auto")
}

/** The trip with the picked themed plan swapped in (first plan when none is picked). */
export function choosePlan(plan: RoutePlan, id: string | null): RoutePlan {
  const p = plan.plans?.find((x) => x.id === id) ?? plan.plans?.[0];
  return p ? { ...plan, stops: p.stops, geometry: p.geometry, extra_min: p.extra_min, total_min: p.total_min,
               road_extra_min: p.road_extra_min, stop_min: p.stop_min, wait_min: p.wait_min, extra_km: p.extra_km } : plan;
}

export type Billing = "charged" | "no_qr" | "not_shown_on_route" | "repeat_visit_30d"
  | "wallet_empty" | "not_rewarded" | "not_partner";

export interface Spin { won: boolean; odds: number; title?: string; place?: string; code?: string }

export interface CheckinResult {
  checkin_id: string; status: "approved" | "review" | "rejected"; reasons: string[];
  rewarded: boolean; billed_thb: number; billing: Billing; qr_ok: boolean; distance_m: number;
  new_badges: { slug: string; name: string }[];
  spin: Spin | null;
  xp_gained?: number; xp?: number; level?: number; level_up?: boolean; member?: boolean;
  required_level?: number; // with reason "level_locked"
  stamp?: { tier: 1 | 2 | 3 | 4; new_province: boolean; province: string | null; event: string | null } | null;   // first visit
  challenges?: { slug: string; title: string; title_th: string; xp: number; coins: number }[];                 // completed now
  coins?: number;   // members' coin balance
  group_bonus?: boolean;   // ride along: a trip-mate checked in here within the hour, +50%
  badges?: Badge[];        // badge tiers reached by this check-in
  shake?: boolean;         // a first visit: this check-in earns a Siam Si shake
  fortune_tickets?: number;   // bonus shakes waiting
}

// ---------- Siam Si (เซียมซี) fortune sticks ----------
export type Rarity = "common" | "rare" | "epic" | "legendary";
export interface Shake {
  stick: number; rarity: Rarity; prize: "coins" | "xp" | "boost" | "item";
  coins: number; xp: number; boost_hours: number;
  item_kind: ShopKind | null; item_id: string | null; item_en: string | null; item_th: string | null;
  xp_boost_until: string | null; member: boolean; tickets: number;
}
/** Shake for a first-visit check-in (its id), or spend a bonus shake (no id). Error "nothing_to_shake" otherwise. */
export const shakeFortune = (checkin?: string) => rpc<Shake>("shake_fortune", { p_checkin: checkin ?? null });
export interface PastShake { id: number; stick: number; rarity: Rarity; prize_kind: Shake["prize"]; coins: number; xp: number;
  boost_hours: number; item_kind: ShopKind | null; item_id: string | null; source: "checkin" | "bonus"; created_at: string }
export async function shakeHistory(): Promise<PastShake[]> {
  await ensureSession();
  const { data, error } = await supabase.from("fortune_pulls").select("id, stick, rarity, prize_kind, coins, xp, boost_hours, item_kind, item_id, source, created_at")
    .order("id", { ascending: false }).limit(20);
  if (error) throw new ApiError(error.message);
  return data as PastShake[];
}

// A place the user can check in at: a route stop, a "Near this spot" card, or a scanned sticker
export interface CheckinTarget { id: number; name: string; lat: number; lng: number; is_partner: boolean; is_demo: boolean }

export type TravelMode = "pedestrian" | "bicycle" | "auto";
export type Interest = "food" | "cafes" | "culture" | "nature" | "shopping" | "landmarks";

export interface PlanRequest {
  origin: LatLng; dest: LatLng; start_min: number; budget_min: number | "auto"; mode: TravelMode;   // auto = half the direct trip, 45 min-3 h
  interests?: Interest[];       // builds the "Your mix" plan, shown first
  min_rating?: 0 | 3.5 | 4 | 4.5;
  include_unrated?: boolean;
  max_stops?: number;           // 1-6; omitted = Auto
  max_price?: 0 | 1 | 2 | 3;    // omitted = Any
  must_include?: number[];      // places the user picked or kept (10, members 15)
  keep_order?: boolean | number[];   // true: must_include is the order, exactly; a list: those keep their order, the rest fit in
  exclude?: number[];           // stops the user removed or swapped out
  theme?: string;               // this plan comes first
  meals?: Meal[];               // meals to stop for; omitted = no food stop forced
  no_chains?: boolean;          // independent shops, cafés and restaurants only
}

export type Kind = "food" | "cafes" | "culture" | "nature" | "shopping";

/** A search hit: one of our places (has id) or an address from Photon (OpenStreetMap search). */
export interface FoundPlace extends LatLng {
  id?: number; name: string; name_th?: string | null; category?: string;
  rating?: number | null; price_level?: number | null; distance_m?: number | null; tier?: number; kind?: string | null; source: "giggles" | "photon";
}

export async function searchPlaces(query: string, near?: LatLng | null, kind?: Kind | null): Promise<FoundPlace[]> {
  const data = await rpc<Omit<FoundPlace, "source">[] | null>("search_places", {
    p_query: query, p_lat: near?.lat ?? null, p_lng: near?.lng ?? null, p_kind: kind ?? null, p_limit: 12,
  });
  return (data ?? []).map((p) => ({ ...p, source: "giggles" }));
}

// Photon (photon.komoot.io): free OpenStreetMap search, fair use: 3+ letters, after a 300 ms pause, the previous request cancelled.
const THAILAND_BBOX = "97.3,5.6,105.7,20.5";
export async function searchAddresses(query: string, near?: LatLng | null, signal?: AbortSignal): Promise<FoundPlace[]> {
  const params = new URLSearchParams({ q: query, limit: "5", bbox: THAILAND_BBOX });
  if (near) { params.set("lat", String(near.lat)); params.set("lon", String(near.lng)); }
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const json = await res.json() as { features: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] };
  return json.features.map(({ geometry, properties: p }) => ({
    lat: geometry.coordinates[1], lng: geometry.coordinates[0], source: "photon" as const,
    name: [p.name ?? p.street, p.city ?? p.county ?? p.state].filter(Boolean).join(", ") || "Unnamed place",
  }));
}

export const planRoute = (p: PlanRequest) => callFn<RoutePlan>("plan-route", demoOn() ? { ...p, demo: true } : p);   // demo: pretend partners too

export async function uploadSelfie(blob: Blob): Promise<string> {
  const session = await ensureSession();
  const path = `${session.user.id}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("selfies").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error("Selfie upload failed. Try again.");
  return path;
}

/** Hide or caption one of your check-in photos (passport album). */
export const setPhoto = (checkinId: string, hidden: boolean, caption?: string) =>
  rpc<void>("set_photo", { p_checkin: checkinId, p_hidden: hidden, p_caption: caption ?? null });

export interface PassportStamp { place_id: number; name: string; name_th: string | null; category: string; tier: 1 | 2 | 3 | 4;
  province_id: number | null; event: string | null; earned_at: string; photo: string | null }
export interface PassportPhoto { checkin_id: string; path: string; caption: string | null; place: string; province_id: number | null; place_id?: number; at: string }
export interface Challenge { slug: string; kind: "daily" | "weekly" | "province" | "collection" | "friend"; title_en: string; title_th: string;
  have: number; need: number; xp: number; coins: number; claimed: boolean; period?: string }
/** A ride-along you shared: its 3 memory photos (first, middle and last of the album). */
export interface TripMemory { id: string; name: string | null; started_at: string;
  photos: { checkin_id: string; path: string; caption: string | null; place: string; at: string; nickname: string }[] }
export interface PassportData {
  profile: { xp: number; level: number; member: boolean; plus: boolean; coins: number } | null;
  stamps: PassportStamp[]; photos: PassportPhoto[]; challenges: Challenge[]; trips?: TripMemory[];
  provinces: { id: number; iso: string; name_en: string; name_th: string; stamps: number }[];
}
export const getPassport = () => rpc<PassportData>("passport_v2");
/** Short-lived links to your own check-in photos (private bucket). */
export async function photoUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from("selfies").createSignedUrls(paths, 3600);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path!, d.signedUrl]));
}

export interface Stop { id: number; name: string; name_th: string | null; category: string; tier: 1 | 2 | 3 | 4;
  lat: number; lng: number; zone_m: number; distance_m: number; stamped: boolean }
/** Places around you, landmarks first, with their check-in zone and whether you have the stamp. */
export const stopsNear = async (p: LatLng, radiusM = 1500) =>
  (await rpc<Stop[] | null>("stops_near", { p_lat: p.lat, p_lng: p.lng, p_radius_m: radiusM })) ?? [];

export const verifyCheckin = (p: {
  place_id: number; lat: number; lng: number; accuracy_m: number; selfie_path: string;
  qr_code: string | null; client: { platform: "web" | "ios"; demo: boolean; attest?: string; is_mock?: boolean };
}) => callFn<CheckinResult>("verify-checkin", p);

// Stripe Checkout (web only). Returns the hosted payment page URL.
export const startCheckout = (p: { kind: "plus" } | { kind: "membership" } | { kind: "credit"; shop_id: string; pack: number }
  | { kind: "partner" | "choice"; shop_id: string }) =>
  callFn<{ url: string }>("stripe-checkout", p);

// v5 prices (THB); the server has the same numbers
export const PRICES = { membership: 349, plus: 59, partner: 299, choice: 799, booking: 20 } as const;
// v5: who sees ads (everyone but members and Plus)
export const adFree = (p: Profile | null) => !!p && (p.member || !!p.plusUntil);

// detours planned / edits made today (free accounts: 3 and 10 a day)
export interface PlanUsage { member: boolean; detours: number; edits: number; max_detours: number; max_edits: number;
  ads_left: number }   // rewarded ads still available today (each: +1 detour or +5 changes)
export const getPlanUsage = () => rpc<PlanUsage>("my_plan_usage");
// watch an ad at the limit: start, then claim at least 15 s later (the server checks the time)
export type AdReward = "detour" | "edit";
export const startAdReward = (kind: AdReward) => rpc<number>("start_ad_reward", { p_kind: kind });
export const claimAdReward = (id: number) => rpc<void>("claim_ad_reward", { p_id: id });
// Plus: +20 coins the first time you open the app each day (0 when already collected or no Plus)
export const plusDaily = () => rpc<number>("plus_daily");

// paid tier of these places, when they have one (Partner / Giggles Choice)
export async function placesTiers(ids: number[]): Promise<Map<number, PartnerTier>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.rpc("places_tiers", { p_ids: ids.slice(0, 300) });   // no session needed: public
  if (error) throw new ApiError(error.message);
  const real = new Map((data as { id: number; tier: PartnerTier }[]).map((t) => [t.id, t.tier])), d = demo();
  return d ? (await d).demoTiersFor(ids, real) : real;
}

// a paying partner's member perk ("10% off for members"), for those of these places that have one; demo partners have none
export async function placesPerks(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.rpc("places_perks", { p_ids: ids.slice(0, 300) });   // no session needed: public
  if (error) throw new ApiError(error.message);
  return new Map((data as { id: number; perk_text: string }[]).map((p) => [p.id, p.perk_text]));
}
export const PERK_MAX = 80;
export const setMyPerk = (place: number, text: string) => rpc<void>("set_my_perk", { p_place: place, p_text: text });

// bookings through Giggles Maps (partner places only); the shop pays a flat fee once you check in
export type BookingStatus = "requested" | "accepted" | "declined" | "completed" | "cancelled";
export interface Booking { id: number; place_id: number; place: string; day: string; party: number; note: string | null; status: BookingStatus }
export interface ShopBooking { id: number; place: string; guest: string; day: string; party: number; note: string | null; status: BookingStatus;
  fee: number; charged: number | null }
export const requestBooking = (place: number, day: string, party: number, note: string) =>
  rpc<number>("request_booking", { p_place: place, p_day: day, p_party: party, p_note: note || null });
export const myBookings = () => rpc<Booking[]>("my_bookings");
export const cancelBooking = (id: number) => rpc<void>("cancel_booking", { p_id: id });
export const shopBookings = (shop: string) => rpc<ShopBooking[]>("shop_bookings", { p_shop: shop });
export const answerBooking = (id: number, accept: boolean) => rpc<void>("answer_booking", { p_id: id, p_accept: accept });
export const requestChoice = (shop: string) => rpc<void>("request_choice", { p_shop: shop });
// the shop pitch's real number: trips planned near a place and times it was on a route (30 days)
export interface ShopReach { name: string; shown_30d: number; trips_near_30d: number }
export const shopReach = (place: number) => rpc<ShopReach>("shop_reach", { p_place: place });
export const approveChoice = (shop: string, ok: boolean) => rpc<void>("approve_choice", { p_shop: shop, p_ok: ok });
export const choiceRequests = () => rpc<{ shop: string; name: string; tier: PartnerTier | null; at: string }[]>("choice_requests");

export type Look = Partial<Record<ShopKind, string>>;
export interface Profile {
  member: boolean; xp: number;
  plusUntil: Date | null; // null unless Plus is active now
  theme: string; flair: string;   // what the passport header wears (from look)
  nickname: string | null; colour: string; friendCode: string; onLeaderboard: boolean;
  look: Look; title: string | null; owned: string[];   // owned = "kind:id" bought with coins
  avatar: AvatarLook; joined: string | null; coins: number; provinces: number; isAdmin: boolean;
  fortuneTickets: number; xpBoostUntil: Date | null;   // Siam Si: bonus shakes waiting, x1.5 stamp XP until
  perks: Perks;   // level rewards picked so far
  pendingShakes: { checkin: string; place: string }[];   // check-ins from the last day whose Siam Si shake hasn't been taken
}
/** Level rewards: one permanent +10% pick per level from 2 up (choose_level_perk). */
export type Perk = "luck" | "coins";
export interface Perks { luck: number; coins: number; chosen: { level: number; perk: Perk }[] }
/** Levels reached whose reward hasn't been picked yet, lowest first. */
export const pendingLevels = (p: Pick<Profile, "xp" | "perks">) => {
  const done = new Set(p.perks.chosen.map((c) => c.level));
  return Array.from({ length: Math.max(0, levelFor(p.xp) - 1) }, (_, i) => i + 2).filter((l) => !done.has(l));
};
export const chooseLevelPerk = (level: number, perk: Perk) => rpc<Perks>("choose_level_perk", { p_level: level, p_perk: perk });

/** The row the `me` database function returns. */
interface MeRow {
  member: boolean; xp: number; plus_until: string | null; look: Look | null; nickname: string | null; colour: string | null;
  friend_code: string | null; on_leaderboard: boolean | null; title: string | null; owned: string[] | null; avatar: AvatarLook | null;
  joined: string | null; coins: number | null; provinces: number | null; is_admin: boolean; fortune_tickets: number | null; xp_boost_until: string | null;
  perks: Perks | null; pending_shakes: { checkin: string; place: string }[] | null;
}
export async function getProfile(): Promise<Profile> {
  const data = await rpc<MeRow | null>("me");
  const until = data?.plus_until ? new Date(data.plus_until) : null;
  const look: Look = data?.look ?? {};
  return {
    member: !!data?.member, xp: data?.xp ?? 0, plusUntil: until && until > new Date() ? until : null,
    theme: look.theme ?? "classic", flair: look.flair ?? "none",
    nickname: data?.nickname ?? null, colour: data?.colour ?? "marigold", friendCode: data?.friend_code ?? "",
    onLeaderboard: data?.on_leaderboard ?? true, look, title: data?.title ?? null, owned: data?.owned ?? [],
    avatar: data?.avatar ?? {}, joined: data?.joined ?? null, coins: data?.coins ?? 0, provinces: data?.provinces ?? 0, isAdmin: !!data?.is_admin,
    fortuneTickets: data?.fortune_tickets ?? 0, xpBoostUntil: data?.xp_boost_until ? new Date(data.xp_boost_until) : null,
    perks: data?.perks ?? { luck: 0, coins: 0, chosen: [] }, pendingShakes: data?.pending_shakes ?? [],
  };
}

// ---------- phase 2: friends, leaderboard, ride along, coin shop ----------
// every RPC raises a short code ("code_not_found", "not_enough_coins", ...) as its message

export const COLOURS = ["marigold", "indigo", "lotus", "jade", "sky", "coral", "plum", "slate"] as const;
export const setMe = (p: { nickname?: string; colour?: string; onLeaderboard?: boolean }) =>
  rpc<void>("set_me", { p_nickname: p.nickname ?? null, p_colour: p.colour ?? null, p_on_leaderboard: p.onLeaderboard ?? null });

export interface Card { id: string; nickname: string; colour: string; xp: number; level: number; stamps: number; provinces: number;
  look: Look; title: string | null; rank?: number; avatar?: AvatarLook; joined?: string }
export interface Who { id: string; nickname: string; colour: string; avatar: AvatarLook; level: number }
export interface Social { friends: Card[]; incoming: Card[]; outgoing: Card[] }
export async function getSocial(): Promise<Social> {
  const real = await rpc<Social>("social"), d = demo();
  return d ? (await d).demoSocial(real) : real;
}
export const addFriend = (code: string) => rpc<"friends" | "requested">("add_friend", { p_code: code });
export async function answerFriend(from: string, accept: boolean) {
  const d = demo();
  if (isDemoId(from)) { if (d) (await d).answerDemoRequest(from, accept); return; }   // a pretend request: answered on this device
  await rpc<void>("answer_friend", { p_from: from, p_accept: accept });
}
export const removeFriend = async (id: string) => { if (!isDemoId(id)) await rpc<void>("remove_friend", { p_id: id }); };
export interface FriendPassport { card: Card; stamps: PassportStamp[]; photos: PassportPhoto[]; provinces: PassportData["provinces"] }
export async function getFriendPassport(id: string): Promise<FriendPassport> {
  const d = demo();
  if (d && isDemoId(id)) { const p = (await d).demoPassport(id); if (p) return p; }
  return rpc<FriendPassport>("friend_passport", { p_id: id });
}
export type BoardScope = "everyone" | "friends";
export type BoardPeriod = "week" | "all";
export type BoardMetric = "xp" | "provinces" | "landmarks" | "temples" | "food";
export type BoardRow = Card & { rank: number | null; value: number };
/** One board: top 50, your row (rank null when you've scored nothing yet), and the player just above you (the chase). */
export interface Board { scope: BoardScope; period: BoardPeriod; metric: BoardMetric; ends: string | null;
  top: BoardRow[]; me: BoardRow | null; next: BoardRow | null; total: number }
export async function getBoard(scope: BoardScope, period: BoardPeriod, metric: BoardMetric): Promise<Board> {
  const real = await rpc<Board>("board", { p_scope: scope, p_period: period, p_metric: metric }), d = demo();
  return d ? (await d).demoBoard(real, scope, period, metric) : real;
}
/** Per province, who visited on the most different days in 90 days; `need` = visit-days for you to take it. */
export interface Champion { province: { id: number; iso: string; name_en: string; name_th: string }; champion: Who; visits: number;
  mine: boolean; my_visits: number; need: number }
export async function getChampions(): Promise<Champion[]> {
  const real = await rpc<Champion[]>("province_champions"), d = demo();
  return d ? (await d).demoChampionsMerged(real) : real;
}
/** Places of some map kinds (convenience, fuel, atm...) nearest a route line, with how far off it they are. */
export interface RoutePlace { id: number; name: string; name_th: string | null; category: string; kind: string | null; lat: number; lng: number;
  tier: number; rating: number | null; distance_m: number }
export const routePlaces = (geometry: [number, number][], kinds: string[]) =>
  rpc<RoutePlace[]>("route_places", { p_geometry: geometry, p_kinds: kinds, p_max_n: 20 });

export interface TripMember { id: string; me: boolean; owner: boolean; nickname: string; colour: string; lat: number | null; lng: number | null }
export interface TripPhoto { checkin_id: string; path: string; caption: string | null; place: string; at: string; nickname: string; colour: string }
export interface Trip { id: string; code: string; name: string | null; owner: boolean; started_at: string; ends_at: string;
  members: TripMember[]; album: TripPhoto[] }
export const getTrip = () => rpc<Trip | null>("my_trip");
export const startTrip = (name?: string) => rpc<Trip>("start_trip", { p_name: name ?? null });
export const joinTrip = (code: string) => rpc<Trip>("join_trip", { p_code: code });
export const leaveTrip = () => rpc<void>("leave_trip");
export const tripPing = (p: LatLng) => rpc<void>("trip_ping", { p_lat: p.lat, p_lng: p.lng });

export type ShopKind = "theme" | "flair" | "map" | "frame" | "title" | "avatar";
export const KIND_NAME: Record<ShopKind, string> = { theme: "Passport cover", frame: "Photo frame", avatar: "Avatar item", flair: "Name flair", title: "Title", map: "Map skin" };
export interface ShopItem { kind: ShopKind; id: string; name_en: string; name_th: string; price: number; plus: boolean; sort: number;
  gacha_only: boolean;   // Siam Si prizes: never sold
  plus_only: boolean;    // the Plus shelf: worn with Plus, never sold
  level_req: number | null }   // a level reward: yours (free) from that level on, never sold
export async function getShop(): Promise<ShopItem[]> {
  const { data, error } = await supabase.from("shop_items").select("*").order("sort");
  if (error) throw new ApiError(error.message);
  return data as ShopItem[];
}
export const buyItem = (kind: ShopKind, id: string) => rpc<number>("buy_item", { p_kind: kind, p_id: id });
export const equip = (kind: ShopKind, id: string) => rpc<Look>("equip", { p_kind: kind, p_id: id });
/** A themed set: items are "kind:id"; price = what the items you don't own cost you now (25% off), full = all of them at list price. */
export interface ShopSet { id: string; name_en: string; name_th: string; blurb_en: string; items: string[]; full: number; price: number }
export interface ShopToday { ends: string; picks: { kind: ShopKind; id: string }[]; sets: ShopSet[] }
export const getShopToday = () => rpc<ShopToday>("shop_today");
export const buySet = (id: string) => rpc<number>("buy_set", { p_id: id });

export const setAvatar = (look: AvatarLook) => rpc<AvatarLook>("set_avatar", { p: look });

export interface Badge { slug: string; name_en: string; name_th: string; icon: string; value: number; tier: number; goals: number[]; next: number }
export type Pin = ({ type: "badge" } & Badge) | { type: "stamp"; id: number; name: string; name_th: string | null; tier: 1 | 2 | 3 | 4;
  earned_at: string; province: string | null };
export interface ProfilePage extends Omit<Card, "rank"> { friend_code: string | null; photos: number; friends: number; rank: number | null; badges: Badge[];
  showcase: Pin[]; crowns: { id: number; name_en: string; name_th: string; visits: number }[] }
export const setShowcase = (pins: { type: "badge" | "stamp"; id: string }[]) => rpc<unknown>("set_showcase", { p: pins });
export async function getProfilePage(id: string): Promise<ProfilePage> {
  const d = demo();
  if (d && isDemoId(id)) { const p = (await d).demoProfile(id); if (p) return p; }
  return rpc<ProfilePage>("profile_of", { p_id: id });
}

export type Reaction = "heart" | "fire" | "clap" | "wow";
export interface FeedItem {
  id: number; kind: "stamp" | "province" | "level" | "challenge" | "badge" | "nudge" | "fortune" | "comment" | "award"; at: string; mine: boolean;
  data: Record<string, unknown>; who: Who; to: Who | null;
  place: { id: number; name: string; name_th: string | null; category: string; tier: 1 | 2 | 3 | 4 } | null;
  province: { id: number; iso: string; name_en: string; name_th: string } | null;
  photo: string | null; caption: string | null; reactions: Partial<Record<Reaction, number>>; my_reaction: Reaction | null; comments: number;
}
export interface Comment { id: number; body: string; at: string; mine: boolean; who: Who }
// pretend posts (negative ids) keep their comments and reactions on this device
const demoAdded = new Map<number, Comment[]>();
export async function getComments(activity: number): Promise<Comment[]> {
  const d = demo();
  if (d && activity < 0) return [...(await d).demoCommentsFor(activity), ...(demoAdded.get(activity) ?? [])];
  return rpc<Comment[]>("comments_of", { p_activity: activity });
}
export async function addComment(activity: number, body: string): Promise<Comment> {
  if (activity < 0) {
    const p = await getProfile();
    const c: Comment = { id: -Date.now(), body, at: new Date().toISOString(), mine: true,
      who: { id: "me", nickname: p.nickname ?? "You", colour: p.colour, avatar: p.avatar, level: levelFor(p.xp) } };
    demoAdded.set(activity, [...(demoAdded.get(activity) ?? []), c]);
    return c;
  }
  return rpc<Comment>("comment", { p_activity: activity, p_body: body });
}
export const deleteComment = (id: number) => rpc<void>("delete_comment", { p_id: id });
export async function getFeed(scope: "all" | "friends" | "me" = "all"): Promise<FeedItem[]> {
  const real = await rpc<FeedItem[]>("feed", { p_scope: scope }), d = demo();
  return d ? (await d).demoFeedMerged(real, scope) : real;
}
export const react = async (id: number, emoji: Reaction | null) => { if (id > 0) await rpc<void>("react", { p_activity: id, p_emoji: emoji }); };
export const nudge = async (friend: string) => { if (!isDemoId(friend)) await rpc<void>("nudge", { p_friend: friend }); };

export interface FriendQuest { partner: Who; week: string; me: number; them: number }
export async function getFriendQuest(): Promise<FriendQuest | null> {
  const real = await rpc<FriendQuest | null>("friend_quest"), d = demo();
  return real ?? (d ? (await d).demoFriendQuest() : null);
}
// a quest with a pretend friend (demo mode) stays on this device
export const setFriendQuest = async (friend: string) => {
  if (isDemoId(friend)) { const d = demo(); if (d) (await d).setDemoFriendQuest(friend); return; }
  await rpc<void>("set_friend_quest", { p_friend: friend });
};
export interface QuestReward { slug: string; title: string; title_th: string; xp: number; coins: number; member: boolean; level: number;
  level_up: boolean; fortune_tickets: number }
/** Claim one finished quest (its chest opens): errors with `not_ready` if it isn't finished or was claimed already. */
export const claimQuest = (slug: string) => rpc<QuestReward>("claim_quest", { p_slug: slug });

export interface MapPlace { id: number; name: string; name_th: string | null; kind: string | null; category: string; tier: number;
  lat: number; lng: number; local: boolean; otop: boolean; community: boolean }
/** Place pins for the visible map box: fewer when zoomed out, landmarks and OTOP first. */
export async function mapPlaces(w: number, s: number, e: number, n: number, zoom: number, kinds: string[] | null): Promise<MapPlace[]> {
  const { data, error } = await supabase.rpc("map_places", { p_min_lng: w, p_min_lat: s, p_max_lng: e, p_max_lat: n, p_zoom: zoom, p_kinds: kinds });
  if (error) throw new ApiError(error.message);
  return (data ?? []) as MapPlace[];
}

// ---------- place page: reviews, photos, lists, edits ----------
export interface PlaceReview { who: Who; rating: number; body: string | null; at: string; mine: boolean }
export interface PlacePhoto { id?: number; url?: string; path?: string; credit: string | null; licence?: string | null;
  source: "wikimedia" | "owner" | "checkin" | "traveller"; mine?: boolean }
export interface PlacePage {
  id: number; name: string; name_th: string | null; kind: string | null; category: string; tier: number; lat: number; lng: number;
  opening_hours: string | null; phone: string | null; website: string | null; address: string | null;
  local: boolean; otop: boolean; community: boolean; detour: boolean;
  rating: number | null; review_count: number; reviews: PlaceReview[]; checked_in: boolean; stamped: boolean;
  photo_reward: boolean; review_shake: boolean;   // your first photo here still pays coins; a written review still earns a shake
  photos: PlacePhoto[]; busy: number[] | null; saved_in: string[];
  regular: { who: Who; visits: number; friend: boolean; mine: boolean } | null;   // most visit-days here in 60 days (2+)
}
export const getPlacePage = (id: number) => rpc<PlacePage | null>("place_page", { p_id: id });
/** A freely licensed Wikimedia Commons photo of a landmark; author, licence and page_url must be shown with it (CC BY / BY-SA). */
export interface CommonsPhoto { url: string; small_url: string; author: string; licence: string; licence_url: string | null;
  page_url: string; width: number; height: number }
export const getCommonsPhotos = (id: number) => rpc<CommonsPhoto[]>("place_commons_photos", { p_place: id });
/** A written review (60+ characters) of a place earns one bonus Siam Si shake there, once. */
export const REVIEW_SHAKE_CHARS = 60;
export const writeReview = (place: number, rating: number, body: string) =>
  rpc<{ xp: number; shake: boolean; tickets: number }>("write_review", { p_place: place, p_rating: rating, p_body: body });
/** Add a photo of a place you have a stamp at to its page; your first one there pays coins. Removes the upload if the add fails. */
export async function addPlacePhoto(place: number, photo: Blob): Promise<{ coins_earned: number; coins: number }> {
  const s = await ensureSession();
  const path = `${s.user.id}/${place}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("place-photos").upload(path, photo, { contentType: "image/jpeg" });
  if (error) throw new Error("Photo upload failed. Try again.");
  try { return await rpc<{ coins_earned: number; coins: number }>("add_place_photo", { p_place: place, p_path: path }); }
  catch (e) { await supabase.storage.from("place-photos").remove([path]); throw e; }
}
export async function deletePlacePhoto(photo: PlacePhoto) {
  await rpc<void>("delete_place_photo", { p_id: photo.id });
  if (photo.url) await supabase.storage.from("place-photos").remove([photo.url.replace(/^place-photos\//, "")]);
}
export const reportPlacePhoto = (id: number) => rpc<void>("report_place_photo", { p_id: id });
/** Public URL of a traveller's place photo ("place-photos/<uid>/<file>"). */
export const placePhotoUrl = (url: string) => supabase.storage.from("place-photos").getPublicUrl(url.replace(/^place-photos\//, "")).data.publicUrl;
export const deleteReview = (place: number) => rpc<void>("delete_review", { p_place: place });
export const reportReview = (user: string, place: number) => rpc<void>("report_review", { p_user: user, p_place: place });
export const setPublicPhoto = (checkin: string, isPublic: boolean) => rpc<void>("set_public_photo", { p_checkin: checkin, p_public: isPublic });

export interface SavedList { id: string; name: string; shared: boolean; places: { id: number; name: string; kind: string | null; category: string; lat: number; lng: number }[] }
export const getMyLists = () => rpc<SavedList[]>("my_lists");
export const savePlace = (list: string, place: number, saved: boolean) => rpc<void>("save_place", { p_list: list, p_place: place, p_saved: saved });
export const createList = (name: string) => rpc<string>("create_list", { p_name: name });
export const updateList = (list: string, p: { name?: string; shared?: boolean; remove?: boolean }) =>
  rpc<void>("update_list", { p_list: list, p_name: p.name ?? null, p_shared: p.shared ?? null, p_delete: p.remove ?? false });

export type EditPayload = Partial<{ name: string; name_th: string; kind: string; opening_hours: string; phone: string; website: string;
  closed: boolean; lat: number; lng: number; otop: boolean; community: boolean; otop_stars: number }>;
export const suggestEdit = (place: number | null, payload: EditPayload, here?: LatLng) =>
  rpc<void>("suggest_edit", { p_place: place, p_payload: payload, p_here_lat: here?.lat ?? null, p_here_lng: here?.lng ?? null });
export interface PendingEdit { id: number; place_id: number | null; payload: EditPayload; at: string; who: Who;
  place: { name: string; kind: string | null; opening_hours: string | null; phone: string | null; website: string | null } | null }
export const getAdminEdits = () => rpc<PendingEdit[]>("admin_edits");
export const reviewEdit = (id: number, approve: boolean) => rpc<void>("review_edit", { p_edit: id, p_approve: approve });

// ---------- local first: owners, products, nominations ----------
export interface OwnedPlace {
  id: number; name: string; kind: string | null; shop_id: string; opening_hours: string | null; phone: string | null;
  website: string | null; description: string | null; otop: boolean; otop_stars: number | null; community: boolean;
  verified: boolean; qr_code: string | null;
  perk_text?: string | null; paid?: boolean;   // the member perk; paid = the shop has a live Partner / Choice tier (can set one)
  products: { id: number; name: string; price: number | null; photo: string | null }[]; photos: { id: number; url: string }[];
}
export const getMyPlaces = () => rpc<OwnedPlace[]>("my_places");
export const claimShop = (place: number) => rpc<string>("claim_shop", { p_place: place });
export const addShop = (name: string, kind: string, at: LatLng, here: LatLng) =>
  rpc<number>("add_shop", { p_name: name, p_kind: kind, p_lat: at.lat, p_lng: at.lng, p_here_lat: here.lat, p_here_lng: here.lng });
export const updateMyPlace = (place: number, payload: Record<string, string | number | boolean | null>) =>
  rpc<void>("update_my_place", { p_place: place, p_payload: payload });
export const saveProduct = (place: number, id: number | null, name: string, price: number | null, photo: string | null) =>
  rpc<void>("save_product", { p_place: place, p_id: id, p_name: name, p_price: price, p_photo: photo });
export const deleteProduct = (place: number, id: number) => rpc<void>("delete_product", { p_place: place, p_id: id });
export const addOwnerPhoto = (place: number, path: string) => rpc<void>("add_owner_photo", { p_place: place, p_path: path });
export const deleteOwnerPhoto = (place: number, id: number) => rpc<void>("delete_owner_photo", { p_place: place, p_photo: id });
/** Upload to the public shop-photos bucket under your own folder; returns the storage path. */
export async function uploadShopPhoto(file: Blob): Promise<string> {
  const s = await ensureSession();
  const path = `${s.user.id}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("shop-photos").upload(path, file, { contentType: file.type || "image/jpeg" });
  if (error) throw new Error("Photo upload failed. Try again.");
  return path;
}
/** Public URL for a shop photo path ("<uid>/..." or "shop-photos/<uid>/..."). */
export const shopPhotoUrl = (path: string) => supabase.storage.from("shop-photos").getPublicUrl(path.replace(/^shop-photos\//, "")).data.publicUrl;
/** Any place_photos url as an image src: Wikimedia ones are full URLs, owner and traveller photos "<bucket>/<path>". */
export const photoSrc = (url: string) => /^https?:\/\//.test(url) ? url : url.startsWith("place-photos/") ? placePhotoUrl(url) : shopPhotoUrl(url);

export interface PlaceExtras { description: string | null; otop_stars: number | null; verified: boolean; claimed: boolean;
  products: { id: number; name: string; price: number | null; photo: string | null }[] }
export const getPlaceExtras = (id: number) => rpc<PlaceExtras | null>("place_extras", { p_id: id });

export interface Nomination { id: number; name: string; kind: string; otop: boolean; community: boolean; lat: number; lng: number;
  distance_m: number; confirms: number; mine: boolean; confirmed: boolean }
export const nominate = (p: { name: string; kind: string; otop: boolean; community: boolean; photo: string; at: LatLng }) =>
  rpc<number>("nominate", { p_name: p.name, p_kind: p.kind, p_otop: p.otop, p_community: p.community, p_photo: p.photo, p_lat: p.at.lat, p_lng: p.at.lng });
export const nominationsNear = (at: LatLng) => rpc<Nomination[]>("nominations_near", { p_lat: at.lat, p_lng: at.lng });
export const confirmNomination = (id: number, at: LatLng) => rpc<"confirmed" | "live">("confirm_nomination", { p_id: id, p_lat: at.lat, p_lng: at.lng });
export interface Spotlight { id: number; name: string; name_th: string | null; kind: string | null; otop: boolean; community: boolean;
  province: string | null; photo: string | null; visits: number }
export const getSpotlight = (at: LatLng) => rpc<Spotlight | null>("local_spotlight", { p_lat: at.lat, p_lng: at.lng });
export interface LocalStat { province: string; local_visits_30d: number; new_shops_30d: number; nominations_30d: number; local_stop_share_pct: number | null }
export const getLocalStats = () => rpc<LocalStat[]>("local_stats");

// ---------- turn-by-turn navigation and live ETA ----------
export interface Maneuver { type: number; instruction: string; verbal: string | null; street: string | null; lengthM: number; timeS: number; begin: number; leg: number }
export interface NavRoute { shape: [number, number][]; maneuvers: Maneuver[]; distanceM: number; timeS: number; legEnds: number[] }
export interface Avoid { tolls?: boolean; highways?: boolean; ferries?: boolean }
export const getNavRoute = (points: LatLng[], mode: TravelMode, avoid: Avoid) => callFn<NavRoute>("navigate", { points, mode, avoid });
// refresh = keep an open share's ETA fresh (never reopens a stopped share)
export const shareEta = (dest: LatLng & { name: string }, etaMin: number, refresh = false) =>
  rpc<string | null>("share_eta", { p_dest_lat: dest.lat, p_dest_lng: dest.lng, p_dest_name: dest.name, p_eta_min: Math.max(0, Math.min(1440, etaMin)), p_refresh: refresh });
export const stopEta = () => rpc<void>("stop_eta");
export interface EtaView { who: Who; dest: { lat: number; lng: number; name: string | null }; eta_at: string | null; at: { lat: number; lng: number; seen_at: string } | null }
export const viewEta = (token: string) => rpc<EtaView | null>("view_eta", { p_token: token });

export const SITE = "https://giggles-maps.pages.dev";
// "?friend=CODE" (friend QR) and "?trip=CODE" (ride-along QR)
export const readCodeParam = (name: "friend" | "trip") => {
  const m = /^[A-Za-z0-9]{6,10}$/.exec(new URLSearchParams(location.search).get(name) ?? "");
  if (name === "trip" && m?.[0].length === 8) return null;   // 8 characters: a shared trip page (readSharedTripParam); ride codes are 10
  return m ? m[0].toUpperCase() : null;
};

// ---------- shared trip pages: /app/?trip=<8 base62 characters> ----------
/** A stop on a shared trip; minutes count from when the trip leaves. */
export interface SharedStop { id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  arrive_min: number; leave_min: number; dwell_min: number }
export interface SharedTrip {
  id: string; created_at: string; title: string; mode: TravelMode;
  origin: { name: string; lat: number | null; lng: number | null };   // no point when it started at the sharer's location
  dest: { name: string; lat: number; lng: number };
  stops: SharedStop[]; extra_min: number; total_min: number; geometry: [number, number][]; note: string | null; demo: boolean;
  who: Omit<Who, "id"> | null;
}
/** What the app sends: the server looks up each stop's name, kind and position itself and builds the title. */
export interface TripSnapshot {
  mode: TravelMode; origin_name: string; origin_lat: number | null; origin_lng: number | null;
  dest_name: string; dest_lat: number; dest_lng: number; stops: { id: number; arrive_min: number; dwell_min: number }[];
  extra_min: number; total_min: number; geometry: [number, number][]; note: string | null; demo: boolean;
}
/** Saves the trip as a public page and returns its id. Errors: share_limit (30 a day), bad_trip. */
export const shareTrip = (t: TripSnapshot) => rpc<string>("share_trip", { p_trip: t });
export const viewSharedTrip = (id: string) => rpc<SharedTrip | null>("view_shared_trip", { p_id: id });
export const readSharedTripParam = () => /^[A-Za-z0-9]{8}$/.exec(new URLSearchParams(location.search).get("trip") ?? "")?.[0] ?? null;

// Collects this month's Plus stamp (no-op without Plus), then lists them: "2026-10-01", newest first
export async function getMonthlyStamps(): Promise<string[]> {
  await ensureSession();
  await supabase.rpc("claim_monthly_stamp");
  const { data } = await supabase.from("plus_stamps").select("month").order("month", { ascending: false });
  return (data ?? []).map((r) => r.month as string);
}

// same curve as public.level_for in the database
const LEVEL_XP = [0, 300, 800, 1500, 2500, 4000, 6000, 8500, 11500, 15000];
export const levelFor = (xp: number) => LEVEL_XP.filter((t) => xp >= t).length;
export function levelProgress(xp: number): { into: number; span: number | null } {
  const l = levelFor(xp);
  return l >= LEVEL_XP.length ? { into: 0, span: null } : { into: xp - LEVEL_XP[l - 1], span: LEVEL_XP[l] - LEVEL_XP[l - 1] };
}

// "?scan=<place_id>-<code>" from the QR sticker at a shop counter
export function readScanParam(): { placeId: number; code: string } | null {
  const m = /^(\d+)-([A-Za-z0-9]{2,16})$/.exec(new URLSearchParams(location.search).get("scan") ?? "");
  return m ? { placeId: Number(m[1]), code: m[2].toUpperCase() } : null;
}
