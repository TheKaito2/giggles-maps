import type { AvatarLook } from "../app/avatar/parts";
import { ApiError, callFn, ensureSession, supabase } from "./supabase";

export interface LatLng { lat: number; lng: number }

// "Near this spot" card: the best nearby place by quality, signed up or not (field name kept from v2)
export interface NearbyPartner {
  id: number; name: string; category: string; lat: number; lng: number; distance_m: number;
  is_partner: boolean; is_demo: boolean;
  min_level?: number; exclusive_kind?: ExclusiveKind | null;
}

// v4: members unlock places by level. 0 = open to everyone.
export type ExclusiveKind = "gem" | "perk" | "event";

export interface RouteStop {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  is_partner: boolean; // signed-up shop that pays per verified visit; never affects ranking
  is_demo: boolean; rating: number | null; dwell_min: number; eta_min: number;
  price_level?: number | null; // 0 free, 1-3 = ฿-฿฿฿, null = not listed
  nearby_partner: NearbyPartner | null;
  min_level?: number; exclusive_kind?: ExclusiveKind | null; perk_text?: string | null;
  meal?: Meal | null; // engine v2: this stop covers a meal
  meal_late?: boolean; // the restaurant for that meal, outside the usual meal hours (the route couldn't reach them)
  picked?: boolean;   // the user asked for this place (must_include)
  tier?: 1 | 2 | 3;   // 3 = landmark (must-go), 2 = worth a visit, 1 = everyday
}

export type Meal = "breakfast" | "lunch" | "dinner";

// engine v2: one plan per theme (top_picks | nature | food | culture | shopping); the user picks one
export interface ThemedPlan {
  id: string; name: string; stops: RouteStop[]; geometry: [number, number][];
  extra_min: number; total_min: number; meals: Meal[]; missed_meals: Meal[];
  unfit_required?: number[];   // picked places that didn't fit this plan
  road_extra_min?: number; stop_min?: number; wait_min?: number;   // where extra_min goes
}

export interface RoutePlan {
  route_id: string; routing: "valhalla" | "estimate"; mode: string; plus: boolean; member: boolean; level: number;
  base_min: number; total_min: number; extra_min: number; budget_min: number; max_budget_min: number;
  candidates_considered: number;
  stops: RouteStop[]; geometry: [number, number][];
  base_geometry?: [number, number][];
  warnings?: string[];
  meals?: Meal[]; missed_meals?: Meal[];
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
  must_include?: number[];      // up to 3 places the user picked
  meals?: Meal[];               // meals to stop for; omitted = no food stop forced
}

export type Kind = "food" | "cafes" | "culture" | "nature" | "shopping";

/** A search hit: one of our places (has id) or an address from Photon (OpenStreetMap search). */
export interface FoundPlace extends LatLng {
  id?: number; name: string; name_th?: string | null; category?: string;
  rating?: number | null; price_level?: number | null; distance_m?: number | null; tier?: number; source: "giggles" | "photon";
}

export async function searchPlaces(query: string, near?: LatLng | null, kind?: Kind | null): Promise<FoundPlace[]> {
  await ensureSession();
  const { data, error } = await supabase.rpc("search_places", {
    p_query: query, p_lat: near?.lat ?? null, p_lng: near?.lng ?? null, p_kind: kind ?? null, p_limit: 12,
  });
  if (error) throw error;
  return ((data ?? []) as Omit<FoundPlace, "source">[]).map((p) => ({ ...p, source: "giggles" }));
}

// Photon (photon.komoot.io): free OpenStreetMap search, fair use. Called on Search/Enter only, never per keystroke.
const THAILAND_BBOX = "97.3,5.6,105.7,20.5";
export async function searchAddresses(query: string, near?: LatLng | null): Promise<FoundPlace[]> {
  const params = new URLSearchParams({ q: query, limit: "5", bbox: THAILAND_BBOX });
  if (near) { params.set("lat", String(near.lat)); params.set("lon", String(near.lng)); }
  const res = await fetch(`https://photon.komoot.io/api/?${params}`);
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const json = await res.json() as { features: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] };
  return json.features.map(({ geometry, properties: p }) => ({
    lat: geometry.coordinates[1], lng: geometry.coordinates[0], source: "photon" as const,
    name: [p.name ?? p.street, p.city ?? p.county ?? p.state].filter(Boolean).join(", ") || "Unnamed place",
  }));
}

export const planRoute = (p: PlanRequest) => callFn<RoutePlan>("plan-route", p);

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
export interface PassportPhoto { checkin_id: string; path: string; caption: string | null; place: string; province_id: number | null; at: string }
export interface Challenge { slug: string; kind: "daily" | "weekly" | "province" | "collection" | "friend"; title_en: string; title_th: string;
  have: number; need: number; xp: number; coins: number; claimed: boolean; period?: string }
export interface PassportData {
  profile: { xp: number; level: number; member: boolean; plus: boolean; coins: number } | null;
  stamps: PassportStamp[]; photos: PassportPhoto[]; challenges: Challenge[];
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
export const startCheckout = (p: { kind: "plus" } | { kind: "membership" } | { kind: "credit"; shop_id: string; pack: number }) =>
  callFn<{ url: string }>("stripe-checkout", p);

export type Look = Partial<Record<ShopKind, string>>;
export interface Profile {
  member: boolean; xp: number;
  plusUntil: Date | null; // null unless Plus is active now
  theme: string; flair: string;   // what the passport header wears (from look)
  nickname: string | null; colour: string; friendCode: string; onLeaderboard: boolean;
  look: Look; title: string | null; owned: string[];   // owned = "kind:id" bought with coins
  avatar: AvatarLook; joined: string | null; coins: number; provinces: number;
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
    avatar: data?.avatar ?? {}, joined: data?.joined ?? null, coins: data?.coins ?? 0, provinces: data?.provinces ?? 0,
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
export const getSocial = () => rpc<Social>("social");
export const addFriend = (code: string) => rpc<"friends" | "requested">("add_friend", { p_code: code });
export const answerFriend = (from: string, accept: boolean) => rpc<void>("answer_friend", { p_from: from, p_accept: accept });
export const removeFriend = (id: string) => rpc<void>("remove_friend", { p_id: id });
export interface FriendPassport { card: Card; stamps: PassportStamp[]; photos: PassportPhoto[]; provinces: PassportData["provinces"] }
export const getFriendPassport = (id: string) => rpc<FriendPassport>("friend_passport", { p_id: id });
export const getLeaderboard = () => rpc<{ top: Card[]; me: Card | null; total: number }>("leaderboard");

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
export interface ShopItem { kind: ShopKind; id: string; name_en: string; name_th: string; price: number; plus: boolean; sort: number }
export async function getShop(): Promise<ShopItem[]> {
  const { data, error } = await supabase.from("shop_items").select("*").order("sort");
  if (error) throw error;
  return data as ShopItem[];
}
export const buyItem = (kind: ShopKind, id: string) => rpc<number>("buy_item", { p_kind: kind, p_id: id });
export const equip = (kind: ShopKind, id: string) => rpc<Look>("equip", { p_kind: kind, p_id: id });

export const setAvatar = (look: AvatarLook) => rpc<AvatarLook>("set_avatar", { p: look });

export interface Badge { slug: string; name_en: string; name_th: string; icon: string; value: number; tier: number; goals: number[]; next: number }
export interface ProfilePage extends Omit<Card, "rank"> { friend_code: string | null; photos: number; friends: number; rank: number | null; badges: Badge[] }
export const getProfilePage = (id: string) => rpc<ProfilePage>("profile_of", { p_id: id });

export type Reaction = "heart" | "fire" | "clap" | "wow";
export interface FeedItem {
  id: number; kind: "stamp" | "province" | "level" | "challenge" | "badge" | "nudge"; at: string; mine: boolean;
  data: Record<string, unknown>; who: Who; to: Who | null;
  place: { id: number; name: string; name_th: string | null; category: string; tier: 1 | 2 | 3 } | null;
  province: { id: number; iso: string; name_en: string; name_th: string } | null;
  photo: string | null; caption: string | null; reactions: Partial<Record<Reaction, number>>; my_reaction: Reaction | null;
}
export const getFeed = (scope: "all" | "friends" | "me" = "all") => rpc<FeedItem[]>("feed", { p_scope: scope });
export const react = (id: number, emoji: Reaction | null) => rpc<void>("react", { p_activity: id, p_emoji: emoji });
export const nudge = (friend: string) => rpc<void>("nudge", { p_friend: friend });

export interface FriendQuest { partner: Who; week: string; me: number; them: number }
export const getFriendQuest = () => rpc<FriendQuest | null>("friend_quest");
export const setFriendQuest = (friend: string) => rpc<void>("set_friend_quest", { p_friend: friend });
export const claimQuests = () => rpc<{ slug: string; title: string; xp: number; coins: number }[]>("claim_quests");

export const SITE = "https://giggles-maps.pages.dev";
// "?friend=CODE" (friend QR) and "?trip=CODE" (ride-along QR)
export const readCodeParam = (name: "friend" | "trip") => {
  const m = /^[A-Za-z0-9]{6,10}$/.exec(new URLSearchParams(location.search).get(name) ?? "");
  return m ? m[0].toUpperCase() : null;
};

export interface ExclusivePlace {
  id: number; name: string; category: string; exclusive_kind: ExclusiveKind; min_level: number; unlocked: boolean;
  perk_text: string | null; is_demo: boolean;
}

export async function getExclusives(): Promise<ExclusivePlace[]> {
  await ensureSession();
  const { data, error } = await supabase.rpc("my_exclusives");
  if (error) throw error;
  return data as ExclusivePlace[];
}

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
export const KIND_NAME: Record<ExclusiveKind, string> = { gem: "Hidden gem", perk: "Member perk", event: "Event" };

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
};

// what happened on the shop's side (shown as "Business view" for the demo)
export const BILLING_TEXT: Partial<Record<Billing, string>> = {
  charged: "The shop paid its bid for this verified visit.",
  no_qr: "No counter code, so the shop isn't charged.",
  not_shown_on_route: "This shop wasn't on your route in the last 3 hours, so it isn't charged.",
  repeat_visit_30d: "Already counted for this shop in the last 30 days, so it isn't charged again.",
  wallet_empty: "The shop's credit ran out, so it isn't charged.",
};
