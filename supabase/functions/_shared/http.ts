import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.49.4";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

let adminClient: SupabaseClient | undefined;
export const admin = (): SupabaseClient =>
  adminClient ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

export async function requireUser(req: Request): Promise<User> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!token) throw new HttpError(401, "not_signed_in");
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "not_signed_in");
  return data.user;
}

// wraps a handler with CORS preflight, POST-only and error mapping (no internals leak to clients)
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code }, e.status);
      console.error(e);
      return json({ error: "server_error" }, 500);
    }
  });
}

export const num = (v: unknown, min: number, max: number, code: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, code);
  return v;
};

// Thailand bounding box: reject coordinates we can't route anyway
export const thaiPoint = (v: unknown, latCode: string, lngCode = latCode) => {
  const p = v as { lat?: unknown; lng?: unknown } | null;
  return { lat: num(p?.lat, 5, 21, latCode), lng: num(p?.lng, 97, 106, lngCode) };
};

/** The request body as a JSON object; anything else is a 400. `allowEmpty` treats a missing body as {}. */
export async function readJson(req: Request, allowEmpty = false): Promise<Record<string, any>> {
  const text = await req.text().catch(() => { throw new HttpError(400, "bad_json"); });
  if (allowEmpty && !text.trim()) return {};
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, "bad_json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "bad_json");
  return body as Record<string, any>;
}
