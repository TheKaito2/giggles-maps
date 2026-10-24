import { verifyAssertion } from "jsr:@bradford-tech/supabase-integrity-attest@0.9.1/assertion";
import { admin, HttpError, json, num, readJson, requireUser, serve, thaiPoint } from "../_shared/http.ts";
import { APP_ATTEST_APP_ID } from "../_shared/ids.ts";

// iOS App Attest: the app signs "<place_id>|<lat>|<lng>|<selfie_path>" with its registered key.
// Logged as client.attest_ok only (not enforced yet), so dev and Simulator builds keep working.
async function checkAttest(db: ReturnType<typeof admin>, userId: string, raw: string | null, data: string): Promise<boolean | null> {
  if (!raw) return null;
  try {
    const { key_id, assertion } = JSON.parse(raw);
    const { data: key } = await db.from("app_attest_keys").select("public_key_pem, sign_count")
      .eq("key_id", key_id).eq("user_id", userId).maybeSingle();
    if (!key) return false;
    const { signCount } = await verifyAssertion({ appId: APP_ATTEST_APP_ID }, assertion,
      new TextEncoder().encode(data), key.public_key_pem, key.sign_count);
    await db.from("app_attest_keys").update({ sign_count: signCount }).eq("key_id", key_id);
    return true;
  } catch (e) {
    console.error("attest", e);
    return false;
  }
}

serve(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const placeId = num(body.place_id, 1, Number.MAX_SAFE_INTEGER, "bad_place_id");
  const { lat, lng } = thaiPoint(body, "bad_lat", "bad_lng");
  const accuracy = num(body.accuracy_m, 0, 10000, "bad_accuracy");
  const faceCount = body.face_count == null ? 0 : num(body.face_count, 0, 20, "bad_face_count");   // any photo counts, faces not needed
  const selfiePath = typeof body.selfie_path === "string" ? body.selfie_path : null;
  const qr = typeof body.qr_code === "string" ? body.qr_code.trim().slice(0, 16) : null;
  if (selfiePath && !/^[0-9a-f-]{36}\/[\w.-]{1,80}$/.test(selfiePath)) throw new HttpError(400, "bad_selfie_path");

  // client signals: platform, mock-location flag, App Attest assertion (checked below on iOS), demo mode
  const c = body.client ?? {};
  const client = {
    platform: ["web", "ios", "android"].includes(c.platform) ? c.platform : "unknown",
    is_mock: c.is_mock === true,
    attest: typeof c.attest === "string" ? c.attest.slice(0, 4096) : null,
    // Demo mode (anyone can switch it on) fakes the location so the app can be shown anywhere. Its check-ins are real
    // and kept marked client.demo = true; record_checkin skips the speed check for them, the pace limit still applies.
    demo: c.demo === true,
  };

  const db = admin();
  const attestOk = client.platform === "ios"
    ? await checkAttest(db, user.id, client.attest, `${placeId}|${lat}|${lng}|${selfiePath ?? ""}`) : null;
  const clientRecord = { ...client, attest: null, attest_ok: attestOk };   // keep the verdict, not the blob
  // the selfie must really be in this user's folder
  let uploaded: string | null = null;
  if (selfiePath?.startsWith(`${user.id}/`)) {
    const [dir, file] = selfiePath.split("/");
    const { data } = await db.storage.from("selfies").list(dir, { search: file, limit: 1 });
    if (data?.some((o) => o.name === file)) uploaded = selfiePath;
  }

  const { data, error } = await db.rpc("record_checkin_v5", {  // GPS stop zone, any photo, stamps, XP/coins, challenges
    p_user: user.id, p_place: placeId, p_lat: lat, p_lng: lng, p_accuracy: accuracy,
    p_selfie_path: uploaded, p_face_count: faceCount, p_qr: qr, p_client: clientRecord,
  });
  if (error?.code === "P0002") throw new HttpError(404, "place_not_found");
  if (error) throw error;
  return json(data);
});
