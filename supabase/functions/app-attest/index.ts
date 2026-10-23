import { verifyAttestation } from "jsr:@bradford-tech/supabase-integrity-attest@0.9.1";
import { admin, HttpError, json, requireUser, serve } from "../_shared/http.ts";

// One-time App Attest registration for an iPhone install.
//   {action:"challenge"}                              -> {challenge}
//   {action:"register", key_id, challenge, attestation} -> {registered:true}
// The app uses the production App Attest environment (entitlement), so we verify against production.
export const APP_ID = "97BS2K8UQ2.com.kristpaul.gigglesmaps";

serve(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => { throw new HttpError(400, "bad_json"); });
  const db = admin();

  if (body.action === "challenge") {
    const { data, error } = await db.from("attest_challenges").insert({ user_id: user.id }).select("id").single();
    if (error) throw error;
    return json({ challenge: data.id });
  }

  if (body.action !== "register") throw new HttpError(400, "bad_action");
  const { key_id, challenge, attestation } = body;
  if (typeof key_id !== "string" || typeof challenge !== "string" || typeof attestation !== "string") throw new HttpError(400, "bad_fields");

  // single use, this user only, 5 minutes
  const { data: used } = await db.from("attest_challenges").delete()
    .eq("id", challenge).eq("user_id", user.id).gt("created_at", new Date(Date.now() - 5 * 60_000).toISOString()).select("id");
  if (!used?.length) throw new HttpError(400, "challenge_expired");

  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(challenge)));
  let result;
  try {
    result = await verifyAttestation({ appId: APP_ID }, key_id, hash, attestation);
  } catch (e) {
    console.error("attestation", e);
    throw new HttpError(400, "attestation_invalid");
  }
  const { error } = await db.from("app_attest_keys").upsert({
    key_id, user_id: user.id, public_key_pem: result.publicKeyPem, sign_count: result.signCount,
  });
  if (error) throw error;
  return json({ registered: true });
});
