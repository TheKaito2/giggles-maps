import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const LINKING_KEY = "giggles.linkingProvider";
type Provider = "google" | "apple";
const redirectTo = () => location.origin + location.pathname;

// Guests start anonymous. Signing in with Google/Apple first tries to link the provider to the
// guest account (stamps and coupons stay). If that Google/Apple account already belongs to a
// user, the provider sends us back with error_code=identity_already_exists and
// resumeSignIn() signs into that existing account instead.
export async function signInWith(provider: Provider) {
  const { data } = await supabase.auth.getUser();
  if (data.user?.is_anonymous && await hasProgress(data.user.id)) {
    try { sessionStorage.setItem(LINKING_KEY, provider); } catch { /* storage blocked: no fallback, plain sign-in below */ }
    const { error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo: redirectTo() } });
    if (!error) return;
  }
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
  if (error) throw new Error("Couldn't open the sign-in page. Try again.");
}

// Linking a Google/Apple account that already has a Giggles account fails and costs a second sign-in, so only try
// when the guest has check-ins worth keeping (a fresh guest, e.g. right after signing out, signs in directly).
async function hasProgress(id: string) {
  const { count, error } = await supabase.from("checkins").select("id", { count: "exact", head: true }).eq("user_id", id);
  return !!error || (count ?? 0) > 0;   // can't tell: link, so nothing is lost
}

// Run once on page load: finish the fallback after a failed link, and clean the error off the URL.
export async function resumeSignIn(): Promise<string | null> {
  const params = new URLSearchParams(location.hash.slice(1) + "&" + location.search.slice(1));
  const code = params.get("error_code");
  if (!code) return null;
  history.replaceState(null, "", location.pathname);
  let provider: string | null = null;
  try { provider = sessionStorage.getItem(LINKING_KEY); sessionStorage.removeItem(LINKING_KEY); } catch { /* ignore */ }
  if (code === "identity_already_exists" && (provider === "google" || provider === "apple")) {
    await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
    return null;
  }
  return params.get("error_description")?.replace(/\+/g, " ") ?? "Sign-in didn't finish. Try again.";
}

// Email: a guest adds an email to the same account (confirm link). If that email already has an
// account, send a normal sign-in link instead.
export async function signInWithEmail(email: string): Promise<void> {
  const emailRedirectTo = redirectTo();
  const { data } = await supabase.auth.getUser();
  if (data.user?.is_anonymous) {
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo });
    if (!error) return;
    if (error.code !== "email_exists" && !/already/i.test(error.message)) throw friendly(error.status);
  }
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });
  if (error) throw friendly(error.status);
}

const friendly = (status?: number) =>
  new Error(status === 429 ? "Too many emails. Wait a minute and try again." : "Couldn't send the email. Check the address.");

export function useUser(): User | null {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return user;
}

export const isGuest = (u: User | null) => !u || !!u.is_anonymous;
