import { callFn, ensureSession, supabase } from "./supabase";

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
  is_demo: boolean; rating: number; dwell_min: number; eta_min: number;
  nearby_partner: NearbyPartner | null;
  min_level?: number; exclusive_kind?: ExclusiveKind | null; perk_text?: string | null;
}

export interface RoutePlan {
  route_id: string; routing: "valhalla" | "estimate"; mode: string; plus: boolean; member: boolean; level: number;
  base_min: number; total_min: number; extra_min: number; budget_min: number; max_budget_min: number;
  candidates_considered: number;
  stops: RouteStop[]; geometry: [number, number][];
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
}

// A place the user can check in at: a route stop, a "Near this spot" card, or a scanned sticker
export interface CheckinTarget { id: number; name: string; lat: number; lng: number; is_partner: boolean; is_demo: boolean }

export const planRoute = (p: { origin: LatLng; dest: LatLng; start_min: number; budget_min: number; mode: "pedestrian" | "auto" }) =>
  callFn<RoutePlan>("plan-route", p);

export async function uploadSelfie(blob: Blob): Promise<string> {
  const session = await ensureSession();
  const path = `${session.user.id}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("selfies").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error("Selfie upload failed. Try again.");
  return path;
}

export const verifyCheckin = (p: {
  place_id: number; lat: number; lng: number; accuracy_m: number; selfie_path: string; face_count: number;
  qr_code: string | null; client: { platform: "web"; demo: boolean };
}) => callFn<CheckinResult>("verify-checkin", p);

// Stripe Checkout (web only). Returns the hosted payment page URL.
export const startCheckout = (p: { kind: "plus" } | { kind: "membership" } | { kind: "credit"; shop_id: string; pack: number }) =>
  callFn<{ url: string }>("stripe-checkout", p);

export interface Profile {
  member: boolean; xp: number;
  plusUntil: Date | null; // null unless Plus is active now
  theme: string; flair: string;
}

export async function getProfile(): Promise<Profile> {
  const s = await ensureSession();
  const { data } = await supabase.from("profiles").select("member_since, xp, plus_until, cosmetics").eq("id", s.user.id).maybeSingle();
  const until = data?.plus_until ? new Date(data.plus_until) : null;
  const plusUntil = until && until > new Date() ? until : null;
  return {
    member: !!data?.member_since, xp: data?.xp ?? 0, plusUntil,
    theme: plusUntil ? data?.cosmetics?.theme ?? "classic" : "classic",
    flair: plusUntil ? data?.cosmetics?.flair ?? "none" : "none",
  };
}

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

// Plus only; the server checks and whitelists the values
export async function setCosmetics(p: { p_theme?: string; p_flair?: string }) {
  const { error } = await supabase.rpc("set_cosmetics", p);
  if (error) throw error;
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
  too_far: "You're more than 60 m from this place.",
  no_face: "We couldn't see a face in the selfie.",
  no_selfie: "The selfie didn't upload.",
  mock_location: "Your location looks simulated.",
  speed_jump: "You moved faster than a car since your last check-in.",
  low_accuracy: "GPS was too rough (over 50 m). A person will review it.",
  already_rewarded_today: "Already stamped here today. Come back tomorrow.",
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
