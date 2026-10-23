import { useState } from "react";
import { signInWith, signInWithEmail } from "../lib/auth";

// Google, Apple and email sign-in. Used in Passport and wherever an account is needed.
export default function SignIn({ why }: { why?: string }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, ok = "") => {
    setBusy(true); setMsg("");
    try { await fn(); if (ok) setMsg(ok); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="stack signin">
      {why && <p className="fine">{why}</p>}
      <div className="row">
        <button className="btn provider" disabled={busy} onClick={() => run(() => signInWith("google"))}>
          <span aria-hidden="true" className="g-mark">G</span> Continue with Google
        </button>
        <button className="btn provider apple" disabled={busy} onClick={() => run(() => signInWith("apple"))}>
          <span aria-hidden="true"></span> Continue with Apple
        </button>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => signInWithEmail(email), "Check your email for a sign-in link."); }}>
        <label className="sr-only" htmlFor="signin-email">Email</label>
        <input id="signin-email" className="text-in" type="email" required placeholder="you@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn ghost" disabled={busy}>Email me a link</button>
      </form>
      {msg && <p className="fine" role="status">{msg}</p>}
      <p className="fine">Your stamps and coupons move to your account.</p>
    </div>
  );
}
