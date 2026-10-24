import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { AUTH_CALLBACK, isNative, onAuthCallback, openAuth } from "./native";

const LINKING_KEY = "giggles.linkingProvider";
type Provider = "google" | "apple";
// the iOS app comes back through its own URL scheme (allow-listed in Supabase Auth); the web comes back to this page
const redirectTo = () => isNative ? AUTH_CALLBACK : location.origin + location.pathname;
// the iOS app can't sign in inside its web view (Google refuses embedded views): get the URL and open the system browser
const viaBrowser = { skipBrowserRedirect: isNative };
async function go(url: string | null | undefined) { if (isNative && url) await openAuth(url); }

// Guests start anonymous. Signing in with Google/Apple first tries to link the provider to the
// guest account (stamps and coupons stay). If that Google/Apple account already belongs to a
// user, the provider sends us back with error_code=identity_already_exists and
// resumeSignIn() signs into that existing account instead.
export async function signInWith(provider: Provider) {
  const { data } = await supabase.auth.getUser();
  if (data.user?.is_anonymous && await hasProgress(data.user.id)) {
    try { sessionStorage.setItem(LINKING_KEY, provider); } catch { /* storage blocked: no fallback, plain sign-in below */ }
    const { data: link, error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo: redirectTo(), ...viaBrowser } });
    if (!error) return go(link.url);
  }
  const { data: res, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo(), ...viaBrowser } });
  if (error) throw new Error("Couldn't open the sign-in page. Try again.");
  await go(res.url);
}

// Linking a Google/Apple account that already has a Giggles account fails and costs a second sign-in, so only try
// when the guest has check-ins worth keeping (a fresh guest, e.g. right after signing out, signs in directly).
async function hasProgress(id: string) {
  const { count, error } = await supabase.from("checkins").select("id", { count: "exact", head: true }).eq("user_id", id);
  return !!error || (count ?? 0) > 0;   // can't tell: link, so nothing is lost
}

// Run once on page load: finish the fallback after a failed link, and clean the error off the URL.
// In the iOS app the same parameters arrive through giggles://auth-callback instead of the page URL.
export async function resumeSignIn(fromApp?: URLSearchParams): Promise<string | null> {
  const params = fromApp ?? new URLSearchParams(location.hash.slice(1) + "&" + location.search.slice(1));
  if (fromApp && !params.get("error_code")) {   // the app's callback carries the session itself
    const at = params.get("access_token"), rt = params.get("refresh_token"), code = params.get("code");
    const { error } = at && rt ? await supabase.auth.setSession({ access_token: at, refresh_token: rt })
      : code ? await supabase.auth.exchangeCodeForSession(code) : { error: null };
    return error ? "Sign-in didn't finish. Try again." : null;
  }
  const code = params.get("error_code");
  if (!code) return null;
  if (!fromApp) history.replaceState(null, "", location.pathname);
  let provider: string | null = null;
  try { provider = sessionStorage.getItem(LINKING_KEY); sessionStorage.removeItem(LINKING_KEY); } catch { /* ignore */ }
  if (code === "identity_already_exists" && (provider === "google" || provider === "apple")) {
    const { data } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo(), ...viaBrowser } });
    await go(data.url);
    return null;
  }
  // our own words for the codes we know; never echo error_description, which anyone can put in a link to this domain
  return AUTH_ERRORS[code] ?? "Sign-in didn't finish. Try again.";
}

const AUTH_ERRORS: Record<string, string> = {
  otp_expired: "That sign-in link has expired. Ask for a new one.",
  access_denied: "Sign-in was cancelled.",
  identity_already_exists: "That account is already linked to another Giggles Maps account.",
  email_exists: "That email already has an account. Sign in with it instead.",
};

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

/** The iOS app: finish sign-ins that come back through giggles://auth-callback. */
export const listenForAuthCallback = (done: (message: string | null) => void) => onAuthCallback((p) => { resumeSignIn(p).then(done); });

export const isGuest = (u: User | null) => !u || !!u.is_anonymous;
