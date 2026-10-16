"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import SetPassword from "@/components/SetPassword";

type Mode = "signin" | "signup" | "verify";

export default function AuthPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    try {
      const supabase = createClient();

      // The initial event also restores the existing browser session.
      const { data } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (!active) return;

          setUser(session?.user ?? null);
          setChecking(false);
        }
      );

      unsubscribe = () => data.subscription.unsubscribe();
    } catch (error: unknown) {
      setError(
        error instanceof Error ? error.message : "Could not initialize sign-in."
      );
      setChecking(false);
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  function changeMode(next: Mode) {
    setMode(next);
    setError("");
    setMessage("");
    setPassword("");
    setCode("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();
      const cleanEmail = email.trim();

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });

        if (error) throw error;

        setPassword("");

        if (data.session) {
          setUser(data.session.user);
          setMessage("You are signed in.");
        } else {
          setMode("signin");
setMessage(
  "Check your email and click the confirmation link. " +
  "Then return here and sign in with your email and password."
);
        }
      } else if (mode === "verify") {
        const { data, error } = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: code.trim(),
          type: "email",
        });

        if (error) throw error;

        setCode("");
        setUser(data.user);
        setMode("signin");
        setMessage("Email verified. You are signed in.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error) throw error;

        setPassword("");
        setUser(data.user);
        setMessage("You are signed in.");
      }
    } catch (error: unknown) {
      setError(
        error instanceof Error ? error.message : "Authentication failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const { error } = await createClient().auth.signOut({
        scope: "local",
      });

      if (error) throw error;

      setUser(null);
      setPassword("");
      setCode("");
      setMode("signin");
      setMessage("You are signed out.");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Sign-out failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card section-spacing" aria-labelledby="auth-title">
      <p className="eyebrow">YOUR ECOGUARDIAN ACCOUNT</p>
      <h2 id="auth-title">
        {user ? "Account connected" : "Sign in to your workspace"}
      </h2>

      {checking ? (
        <p className="muted">Checking your session…</p>
      ) : user ? (
        <div className="auth-account">
          <p>
            Signed in as <strong>{user.email}</strong>
          </p>
          <button
            className="remove-file"
            type="button"
            disabled={busy}
            onClick={signOut}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : (
        <>
          <div className="auth-options" aria-label="Account options">
            <button
              type="button"
              aria-pressed={mode === "signin"}
              disabled={busy}
              onClick={() => changeMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === "signup"}
              disabled={busy}
              onClick={() => changeMode("signup")}
            >
              Create account
            </button>
        
          </div>

          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="auth-email">
              Email
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={busy}
              />
            </label>

            {mode === "verify" ? (
              <label htmlFor="auth-code">
                Verification code from your email
                <input
                  id="auth-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
            ) : (
              <label htmlFor="auth-password">
                Password
                {mode === "signup" && " — at least 12 characters"}
                <input
                  id="auth-password"
                  type="password"
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  minLength={mode === "signup" ? 12 : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
            )}

            <button className="button" type="submit" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : mode === "verify"
                    ? "Verify email"
                    : "Sign in"}
            </button>
          </form>
        </>
      )}
      {user && <SetPassword key={user.id} />}
      {message && (
        <p className="info-note" role="status">{message}</p>
      )}

      {error && (
        <p className="copilot-error" role="alert">{error}</p>
      )}
    </section>
  );
}