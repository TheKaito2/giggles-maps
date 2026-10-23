import { callFn, ensureSession, supabase } from "./supabase";

export interface LatLng { lat: number; lng: number }

export interface NearbyPartner {
  id: number; name: string; category: string; lat: number; lng: number; distance_m: number; is_demo: boolean;
}

export interface RouteStop {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  is_partner: boolean; is_demo: boolean; rating: number; dwell_min: number; eta_min: number;
  nearby_partner: NearbyPartner | null;
}

export interface RoutePlan {
  route_id: string; routing: "valhalla" | "estimate"; mode: string; plus: boolean;
  base_min: number; total_min: number; extra_min: number; budget_min: number; max_budget_min: number;
  candidates_considered: number;
  stops: RouteStop[]; geometry: [number, number][];
}

export type Billing = "charged" | "starter_plan" | "no_qr" | "not_shown_on_route" | "repeat_visit_30d"
  | "wallet_empty" | "not_rewarded" | "not_partner";

export interface Spin { won: boolean; odds: number; title?: string; place?: string; code?: string }

export interface CheckinResult {
  checkin_id: string; status: "approved" | "review" | "rejected"; reasons: string[];
  rewarded: boolean; billed_thb: number; billing: Billing; qr_ok: boolean; distance_m: number;
  new_badges: { slug: string; name: string }[];
  spin: Spin | null;
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
export const startCheckout = (p: { kind: "plus" } | { kind: "starter"; shop_id: string } | { kind: "credit"; shop_id: string; pack: number }) =>
  callFn<{ url: string }>("stripe-checkout", p);

export async function getPlusUntil(): Promise<Date | null> {
  const s = await ensureSession();
  const { data } = await supabase.from("profiles").select("plus_until").eq("id", s.user.id).maybeSingle();
  const until = data?.plus_until ? new Date(data.plus_until) : null;
  return until && until > new Date() ? until : null;
}

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
};

// what happened on the shop's side (shown as "Business view" for the demo)
export const BILLING_TEXT: Partial<Record<Billing, string>> = {
  charged: "The shop paid its bid for this verified visit.",
  starter_plan: "The shop is on the Starter plan, so this visit costs it nothing extra.",
  no_qr: "No counter code, so the shop isn't charged.",
  not_shown_on_route: "This shop wasn't on your route in the last 3 hours, so it isn't charged.",
  repeat_visit_30d: "Already counted for this shop in the last 30 days, so it isn't charged again.",
  wallet_empty: "The shop's credit ran out, so it isn't charged.",
};
