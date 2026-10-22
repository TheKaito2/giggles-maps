import { callFn, ensureSession, supabase } from "./supabase";

export interface LatLng { lat: number; lng: number }

export interface RouteStop {
  id: number; name: string; name_th: string | null; category: string; lat: number; lng: number;
  is_partner: boolean; bid_thb: number; is_demo: boolean; rating: number; dwell_min: number; eta_min: number;
}

export interface RoutePlan {
  route_id: string; routing: "valhalla" | "estimate"; mode: string;
  base_min: number; total_min: number; extra_min: number; budget_min: number;
  expected_thb: number; candidates_considered: number;
  stops: RouteStop[]; geometry: [number, number][];
}

export interface CheckinResult {
  checkin_id: string; status: "approved" | "review" | "rejected"; reasons: string[];
  rewarded: boolean; billed_thb: number; distance_m: number;
  new_badges: { slug: string; name: string }[];
}

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
  client: { platform: "web"; demo: boolean };
}) => callFn<CheckinResult>("verify-checkin", p);

export const REASON_TEXT: Record<string, string> = {
  too_far: "You're more than 60 m from this place.",
  no_face: "We couldn't see a face in the selfie.",
  no_selfie: "The selfie didn't upload.",
  mock_location: "Your location looks simulated.",
  speed_jump: "You moved faster than a car since your last check-in.",
  low_accuracy: "GPS was too rough (over 50 m). A person will review it.",
  already_rewarded_today: "Already stamped here today. Come back tomorrow.",
};
