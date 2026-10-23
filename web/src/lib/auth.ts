import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Guests start anonymous. Signing in with Google/Apple links the provider to the same
// account (stamps and coupons stay); if that identity already belongs to another account,
// we sign into that account instead.
export async function signInWith(provider: "google" | "apple") {
  const redirectTo = location.origin + location.pathname;
  const { data } = await supabase.auth.getUser();
  if (data.user?.is_anonymous) {
    const { error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo } });
    if (!error) return;
  }
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
  if (error) throw new Error("Couldn't open the sign-in page. Try again.");
}

// Email: a guest adds an email to the same account (confirm link); others get a magic link.
export async function signInWithEmail(email: string): Promise<void> {
  const emailRedirectTo = location.origin + location.pathname;
  const { data } = await supabase.auth.getUser();
  const { error } = data.user?.is_anonymous
    ? await supabase.auth.updateUser({ email }, { emailRedirectTo })
    : await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });
  if (error) throw new Error(error.status === 429 ? "Too many emails. Wait a minute and try again." : "Couldn't send the email. Check the address.");
}

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
