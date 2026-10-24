import type { AvatarLook } from "../app/avatar/parts";
import { ApiError, callFn, ensureSession, supabase } from "./supabase";
import { demoOn } from "./demoGps";

// Demo mode mixes a pretend community (src/demo) into what the server returns. Loaded only while demo mode is on, so real
// users never download it or see it.
const demo = () => demoOn() ? import("../demo") : null;

export interface LatLng { lat: number; lng: number }

// "Near this spot" card: the best nearby place by quality, signed up or not (field name kept from v2)
export interface NearbyPartner {
  id: number; name: string; category: string; lat: number; lng: number; distance_m: number;
  is_partner: boolean; is_demo: boolean;
}

// v5: a verified shop paying monthly. Members' plans put these first; "choice" ones also make the Giggle's plan.
export type PartnerTier = "partner" | "choice";
export const TIER_NAME: Record<PartnerTier, string> = { partner: "Partner", choice: "Giggles Choice" };

export interface RouteStop {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  is_partner: boolean; // signed-up shop that pays per verified visit; never affects ranking
  is_demo: boolean; rating: number | null; dwell_min: number; eta_min: number;
  pit_stop?: boolean;   // Quick plans: a convenience store after the sight (snacks, toilet)
  price_level?: number | null; // 0 free, 1-3 = ฿-฿฿฿, null = not listed
  nearby_partner: NearbyPartner | null;
  partner_tier?: PartnerTier | null;
  meal?: Meal | null; // engine v2: this stop covers a meal
  meal_late?: boolean; // the restaurant for that meal, outside the usual meal hours (the route couldn't reach them)
  picked?: boolean;   // the user asked for this place (must_include)
  local?: boolean; otop?: boolean; community?: boolean;   // local first: independent / OTOP / community enterprise
  tier?: 1 | 2 | 3;   // 3 = landmark (must-go), 2 = worth a visit, 1 = everyday
  extra_min?: number | null;   // about how many minutes this stop adds (road detour + time there); null if unknown
  photo?: string | null;  // a photo of the place, when we have one
}

// a place the plan left out that you can add ("along your route"); extra_min is an estimate
export interface AlongPlace {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number; tier: 1 | 2 | 3;
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
  along?: AlongPlace[];
}

export interface RoutePlan {
  route_id: string; routing: "valhalla" | "estimate"; mode: string; plus: boolean; member: boolean; level: number;
  base_min: number; total_min: number; extra_min: number; budget_min: number; max_budget_min: number;
  candidates_considered: number;
  stops: RouteStop[]; geometry: [number, number][];
  base_geometry?: [number, number][];
  warnings?: string[];
  meals?: Meal[]; missed_meals?: Meal[];
  unfit_required?: number[];   // picked places that didn't fit (Top picks)
  plans?: ThemedPlan[]; // top-level fields = Top picks
  road_extra_min?: number; stop_min?: number; wait_min?: number;
  budget_auto?: boolean;   // budget_min was picked by the server ("auto")
}

/** The trip with the picked themed plan swapped in (first plan when none is picked). */
export function choosePlan(plan: RoutePlan, id: string | null): RoutePlan {
  const p = plan.plans?.find((x) => x.id === id) ?? plan.plans?.[0];
  return p ? { ...plan, stops: p.stops, geometry: p.geometry, extra_min: p.extra_min, total_min: p.total_min,
               road_extra_min: p.road_extra_min, stop_min: p.stop_min, wait_min: p.wait_min } : plan;
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
  stamp?: { tier: 1 | 2 | 3; new_province: boolean; province: string | null; event: string | null } | null;   // first visit
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
  boost_hours: number; item_kind: string | null; item_id: string | null; source: "checkin" | "bonus"; created_at: string }
export async function shakeHistory(): Promise<PastShake[]> {
  await ensureSession();
  const { data, error } = await supabase.from("fortune_pulls").select("id, stick, rarity, prize_kind, coins, xp, boost_hours, item_kind, item_id, source, created_at")
    .order("id", { ascending: false }).limit(20);
  if (error) throw error;
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
  must_include?: number[];      // up to 6 places the user picked or added
  exclude?: number[];           // stops the user removed or swapped out
  theme?: string;               // this plan comes first
  meals?: Meal[];               // meals to stop for; omitted = no food stop forced
  open_only?: boolean;          // only places whose opening hours are known
  no_chains?: boolean;          // independent shops, cafés and restaurants only
}

export type Kind = "food" | "cafes" | "culture" | "nature" | "shopping";

/** A search hit: one of our places (has id) or an address from Photon (OpenStreetMap search). */
export interface FoundPlace extends LatLng {
  id?: number; name: string; name_th?: string | null; category?: string;
  rating?: number | null; price_level?: number | null; distance_m?: number | null; tier?: number; kind?: string | null; source: "giggles" | "photon";
}

export async function searchPlaces(query: string, near?: LatLng | null, kind?: Kind | null): Promise<FoundPlace[]> {
  await ensureSession();
  const { data, error } = await supabase.rpc("search_places", {
    p_query: query, p_lat: near?.lat ?? null, p_lng: near?.lng ?? null, p_kind: kind ?? null, p_limit: 12,
  });
  if (error) throw error;
  return ((data ?? []) as Omit<FoundPlace, "source">[]).map((p) => ({ ...p, source: "giggles" }));
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
export const setPhoto = async (checkinId: string, hidden: boolean, caption?: string) => {
  const { error } = await supabase.rpc("set_photo", { p_checkin: checkinId, p_hidden: hidden, p_caption: caption ?? null });
  if (error) throw error;
};

export interface PassportStamp { place_id: number; name: string; name_th: string | null; category: string; tier: 1 | 2 | 3;
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
export async function getPassport(): Promise<PassportData> {
  await ensureSession();
  const { data, error } = await supabase.rpc("passport_v2");
  if (error) throw error;
  return data as PassportData;
}
/** Short-lived links to your own check-in photos (private bucket). */
export async function photoUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from("selfies").createSignedUrls(paths, 3600);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path!, d.signedUrl]));
}

export interface Stop { id: number; name: string; name_th: string | null; category: string; tier: 1 | 2 | 3;
  lat: number; lng: number; zone_m: number; distance_m: number; stamped: boolean }
/** Places around you, landmarks first, with their check-in zone and whether you have the stamp. */
export async function stopsNear(p: LatLng, radiusM = 1500): Promise<Stop[]> {
  await ensureSession();
  const { data, error } = await supabase.rpc("stops_near", { p_lat: p.lat, p_lng: p.lng, p_radius_m: radiusM });
  if (error) throw error;
  return (data ?? []) as Stop[];
}

export const verifyCheckin = (p: {
  place_id: number; lat: number; lng: number; accuracy_m: number; selfie_path: string;
  qr_code: string | null; client: { platform: "web"; demo: boolean };
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
  const { data, error } = await supabase.rpc("places_tiers", { p_ids: ids.slice(0, 300) });
  if (error) throw error;
  const real = new Map((data as { id: number; tier: PartnerTier }[]).map((t) => [t.id, t.tier])), d = demo();
  return d ? (await d).demoTiersFor(ids, real) : real;
}

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
}

export async function getProfile(): Promise<Profile> {
  await ensureSession();
  const { data, error } = await supabase.rpc("me");
  if (error) throw error;
  const until = data?.plus_until ? new Date(data.plus_until) : null;
  const look: Look = data?.look ?? {};
  return {
    member: !!data?.member, xp: data?.xp ?? 0, plusUntil: until && until > new Date() ? until : null,
    theme: look.theme ?? "classic", flair: look.flair ?? "none",
    nickname: data?.nickname ?? null, colour: data?.colour ?? "marigold", friendCode: data?.friend_code ?? "",
    onLeaderboard: data?.on_leaderboard ?? true, look, title: data?.title ?? null, owned: data?.owned ?? [],
    avatar: data?.avatar ?? {}, joined: data?.joined ?? null, coins: data?.coins ?? 0, provinces: data?.provinces ?? 0, isAdmin: !!data?.is_admin,
    fortuneTickets: data?.fortune_tickets ?? 0, xpBoostUntil: data?.xp_boost_until ? new Date(data.xp_boost_until) : null,
  };
}

// ---------- phase 2: friends, leaderboard, ride along, coin shop ----------
// every RPC raises a short code ("code_not_found", "not_enough_coins", ...) as its message
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  await ensureSession();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ApiError(error.message);
  return data as T;
}

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
export const answerFriend = (from: string, accept: boolean) => rpc<void>("answer_friend", { p_from: from, p_accept: accept });
export const removeFriend = async (id: string) => { if (!id.startsWith("demo-")) await rpc<void>("remove_friend", { p_id: id }); };
export interface FriendPassport { card: Card; stamps: PassportStamp[]; photos: PassportPhoto[]; provinces: PassportData["provinces"] }
export async function getFriendPassport(id: string): Promise<FriendPassport> {
  const d = demo();
  if (d && id.startsWith("demo-")) { const p = (await d).demoPassport(id); if (p) return p; }
  return rpc<FriendPassport>("friend_passport", { p_id: id });
}
export const getLeaderboard = () => rpc<{ top: Card[]; me: Card | null; total: number }>("leaderboard");
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
export interface ShopItem { kind: ShopKind; id: string; name_en: string; name_th: string; price: number; plus: boolean; sort: number;
  gacha_only: boolean;   // Siam Si prizes: never sold
  plus_only: boolean }   // the Plus shelf: worn with Plus, never sold
export async function getShop(): Promise<ShopItem[]> {
  const { data, error } = await supabase.from("shop_items").select("*").order("sort");
  if (error) throw error;
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
export type Pin = ({ type: "badge" } & Badge) | { type: "stamp"; id: number; name: string; name_th: string | null; tier: 1 | 2 | 3;
  earned_at: string; province: string | null };
export interface ProfilePage extends Omit<Card, "rank"> { friend_code: string | null; photos: number; friends: number; rank: number | null; badges: Badge[];
  showcase: Pin[]; crowns: { id: number; name_en: string; name_th: string; visits: number }[] }
export const setShowcase = (pins: { type: "badge" | "stamp"; id: string }[]) => rpc<unknown>("set_showcase", { p: pins });
export async function getProfilePage(id: string): Promise<ProfilePage> {
  const d = demo();
  if (d && id.startsWith("demo-")) { const p = (await d).demoProfile(id); if (p) return p; }
  return rpc<ProfilePage>("profile_of", { p_id: id });
}

export type Reaction = "heart" | "fire" | "clap" | "wow";
export interface FeedItem {
  id: number; kind: "stamp" | "province" | "level" | "challenge" | "badge" | "nudge" | "fortune" | "comment" | "award"; at: string; mine: boolean;
  data: Record<string, unknown>; who: Who; to: Who | null;
  place: { id: number; name: string; name_th: string | null; category: string; tier: 1 | 2 | 3 } | null;
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
export const nudge = async (friend: string) => { if (!friend.startsWith("demo-")) await rpc<void>("nudge", { p_friend: friend }); };

export interface FriendQuest { partner: Who; week: string; me: number; them: number }
export async function getFriendQuest(): Promise<FriendQuest | null> {
  const real = await rpc<FriendQuest | null>("friend_quest"), d = demo();
  return real ?? (d ? (await d).demoFriendQuest() : null);
}
// a quest with a pretend friend (demo mode) stays on this device
export const setFriendQuest = async (friend: string) => {
  if (friend.startsWith("demo-")) { const d = demo(); if (d) (await d).setDemoFriendQuest(friend); return; }
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
  if (error) throw error;
  return (data ?? []) as MapPlace[];
}

// ---------- place page: reviews, photos, lists, edits ----------
export interface PlaceReview { who: Who; rating: number; body: string | null; at: string; mine: boolean }
export interface PlacePhoto { url?: string; path?: string; credit: string | null; licence?: string | null; source: "wikimedia" | "owner" | "checkin" }
export interface PlacePage {
  id: number; name: string; name_th: string | null; kind: string | null; category: string; tier: number; lat: number; lng: number;
  opening_hours: string | null; phone: string | null; website: string | null; address: string | null;
  local: boolean; otop: boolean; community: boolean; detour: boolean;
  rating: number | null; review_count: number; reviews: PlaceReview[]; checked_in: boolean; stamped: boolean;
  photos: PlacePhoto[]; busy: number[] | null; saved_in: string[];
  regular: { who: Who; visits: number; friend: boolean; mine: boolean } | null;   // most visit-days here in 60 days (2+)
}
export async function getPlacePage(id: number): Promise<PlacePage | null> {
  const real = await rpc<PlacePage | null>("place_page", { p_id: id }), d = demo();
  return d && real ? (await d).demoPlacePage(real) : real;
}
export const writeReview = (place: number, rating: number, body: string) => rpc<void>("write_review", { p_place: place, p_rating: rating, p_body: body });
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
  return m ? m[0].toUpperCase() : null;
};

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

export const REASON_TEXT: Record<string, string> = {
  too_far: "You're outside this place's check-in zone (150 m for landmarks and parks, 50 m elsewhere).",
  no_face: "We couldn't see a face in the selfie.",
  no_selfie: "The photo didn't upload.",
  mock_location: "Your location looks simulated.",
  speed_jump: "You moved faster than a car since your last check-in.",
  low_accuracy: "GPS was too rough (over 75 m). A person will review it.",
  already_rewarded_today: "Already stamped here today. Come back tomorrow.",
  already_stamped: "You already have this stamp. The photo is added to your passport.",
  level_locked: "This place is for members at a higher level.",
  slow_down: "You're stamping fast! Stamps here are paused for a bit; your photo is saved. Check in again later for the stamp.",
};

// what happened on the shop's side (shown as "Business view" for the demo)
export const BILLING_TEXT: Partial<Record<Billing, string>> = {
  charged: "The shop paid its bid for this verified visit.",
  no_qr: "No counter code, so the shop isn't charged.",
  not_shown_on_route: "This shop wasn't on your route in the last 3 hours, so it isn't charged.",
  repeat_visit_30d: "Already counted for this shop in the last 30 days, so it isn't charged again.",
  wallet_empty: "The shop's credit ran out, so it isn't charged.",
};
