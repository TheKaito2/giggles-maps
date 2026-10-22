import { admin, HttpError, json, num, requireUser, serve } from "../_shared/http.ts";

serve(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => { throw new HttpError(400, "bad_json"); });
  const placeId = num(body.place_id, 1, Number.MAX_SAFE_INTEGER, "bad_place_id");
  const lat = num(body.lat, 5, 21, "bad_lat");
  const lng = num(body.lng, 97, 106, "bad_lng");
  const accuracy = num(body.accuracy_m, 0, 10000, "bad_accuracy");
  const faceCount = num(body.face_count, 0, 20, "bad_face_count");
  const selfiePath = typeof body.selfie_path === "string" ? body.selfie_path : null;
  if (selfiePath && !/^[0-9a-f-]{36}\/[\w.-]{1,80}$/.test(selfiePath)) throw new HttpError(400, "bad_selfie_path");

  // client signals: platform, mock-location flag, App Attest / Play Integrity token (verified server-side later)
  const c = body.client ?? {};
  const client = {
    platform: ["web", "ios", "android"].includes(c.platform) ? c.platform : "unknown",
    is_mock: c.is_mock === true,
    attest: typeof c.attest === "string" ? c.attest.slice(0, 4096) : null,
    demo: c.demo === true,
  };

  const db = admin();
  // Demo mode lets people outside Sakon Nakhon try check-in with simulated GPS.
  // Only allowed at example places, so it can never bill a real shop.
  if (client.demo) {
    const { data: place } = await db.from("places").select("is_demo").eq("id", placeId).maybeSingle();
    if (!place?.is_demo) throw new HttpError(403, "demo_only_at_example_places");
  }
  // the selfie must really be in this user's folder
  let uploaded: string | null = null;
  if (selfiePath?.startsWith(`${user.id}/`)) {
    const [dir, file] = selfiePath.split("/");
    const { data } = await db.storage.from("selfies").list(dir, { search: file, limit: 1 });
    if (data?.some((o) => o.name === file)) uploaded = selfiePath;
  }

  const { data, error } = await db.rpc("record_checkin", {
    p_user: user.id, p_place: placeId, p_lat: lat, p_lng: lng, p_accuracy: accuracy,
    p_selfie_path: uploaded, p_face_count: faceCount, p_client: client,
  });
  if (error?.code === "P0002") throw new HttpError(404, "place_not_found");
  if (error) throw error;
  return json(data);
});
