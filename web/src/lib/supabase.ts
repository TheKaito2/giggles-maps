import { createClient, type Session } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

// Anyone can try the app instantly: sign in anonymously, upgrade to email later.
export async function ensureSession(): Promise<Session> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error || !anon.session) throw new Error("Could not start a session. Check your connection and try again.");
  return anon.session;
}

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
