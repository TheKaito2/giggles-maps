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
// One guest sign-up at a time: on a first visit every screen asks for a session at once, and each racing sign-up would make
// its own guest account (and spend the per-IP sign-up limit, which a room on one Wi-Fi shares).
let starting: Promise<Session> | null = null;
export async function ensureSession(): Promise<Session> {
  await dropDeletedUser;
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  starting ??= supabase.auth.signInAnonymously().then(({ data: anon, error }) => {
    if (error || !anon.session) throw new Error("Could not start a session. Check your connection and try again.");
    return anon.session;
  }).finally(() => { starting = null; });
  return starting;
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
