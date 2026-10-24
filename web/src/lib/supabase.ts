import { createClient, type Session } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

// Once per page load: a stored session can belong to a user the server deleted (account deleted elsewhere,
// demo reset). Every call and sign-in would then fail with "User from sub claim in JWT does not exist", so drop it.
const dropDeletedUser = (async () => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const { error } = await supabase.auth.getUser();
  if (error?.code === "user_not_found" || /sub claim/i.test(error?.message ?? "")) await supabase.auth.signOut({ scope: "local" });
})().catch(() => { /* offline: keep the session */ });

// Anyone can try the app instantly: sign in anonymously, upgrade to email later.
export async function ensureSession(): Promise<Session> {
  await dropDeletedUser;
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error || !anon.session) throw new Error("Could not start a session. Check your connection and try again.");
  return anon.session;
}

// Signing out leaves no session, and screens wait for a user: start a fresh guest right away.
// Deferred: calling auth methods inside an auth callback deadlocks supabase-js.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") setTimeout(() => { ensureSession().catch((e) => console.error("guest session", e)); }, 0);
});

// Edge Function call with friendly error codes
export async function callFn<T>(name: string, body: object): Promise<T> {
  await ensureSession();
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let code = "server_error";
    try { code = (await error.context.json()).error ?? code; } catch { /* non-JSON error body */ }
    throw new ApiError(code);
  }
  return data as T;
}

export class ApiError extends Error {
  constructor(public code: string) { super(code); }
}
/** The server's error code, or "" for anything else (offline, a bug): `ERR[errCode(e)] ?? "Couldn't…"`. */
export const errCode = (e: unknown) => e instanceof ApiError ? e.code : "";
