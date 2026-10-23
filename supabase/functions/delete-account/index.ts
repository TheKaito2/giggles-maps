import { importPKCS8, SignJWT } from "npm:jose@5.9.6";
import { admin, json, requireUser, serve } from "../_shared/http.ts";

// App Store 5.1.1(v): users must be able to delete their account in-app.
// Apple also requires revoking the Sign in with Apple token: the iOS app sends a fresh authorization code,
// we swap it for a refresh token and revoke that. Web (Services ID) sign-ins don't send a code.
const APPLE_BUNDLE_ID = "com.kristpaul.gigglesmaps";

async function revokeApple(code: string) {
  const p8 = Deno.env.get("APPLE_SIGNIN_P8"), keyId = Deno.env.get("APPLE_SIGNIN_KEY_ID"), team = Deno.env.get("APPLE_TEAM_ID");
  if (!p8 || !keyId || !team) { console.error("apple revoke: secrets missing"); return; }
  const secret = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(team).setSubject(APPLE_BUNDLE_ID).setAudience("https://appleid.apple.com")
    .setIssuedAt().setExpirationTime("5m")
    .sign(await importPKCS8(p8, "ES256"));
  const form = (o: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o) });
  const tokenRes = await fetch("https://appleid.apple.com/auth/token",
    form({ client_id: APPLE_BUNDLE_ID, client_secret: secret, code, grant_type: "authorization_code" }));
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.refresh_token) { console.error("apple token exchange failed", tokenRes.status, tokens.error); return; }
  const revoke = await fetch("https://appleid.apple.com/auth/revoke",
    form({ client_id: APPLE_BUNDLE_ID, client_secret: secret, token: tokens.refresh_token, token_type_hint: "refresh_token" }));
  if (!revoke.ok) console.error("apple revoke failed", revoke.status);
}

serve(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  if (typeof body.apple_authorization_code === "string" && body.apple_authorization_code) {
    await revokeApple(body.apple_authorization_code).catch((e) => console.error("apple revoke", e)); // never blocks deletion
  }
  const db = admin();
  const { data: files } = await db.storage.from("selfies").list(user.id, { limit: 1000 });
  if (files?.length) await db.storage.from("selfies").remove(files.map((f) => `${user.id}/${f.name}`));
  const { error } = await db.auth.admin.deleteUser(user.id); // cascades profile, check-ins, badges
  if (error) throw error;
  return json({ deleted: true });
});
