"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ResendConfirmation() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const pending = useRef(false);
  const mounted = useRef(false);
  const nextAllowedAt = useRef(0);

  useEffect(() => {
    mounted.current = true;

    const timer = window.setInterval(() => {
      setCooldown(
        Math.max(
          0,
          Math.ceil((nextAllowedAt.current - Date.now()) / 1000)
        )
      );
    }, 1000);

    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      pending.current ||
      Date.now() < nextAllowedAt.current
    ) {
      return;
    }

    pending.current = true;
    setBusy(true);
    setMessage("");
    setError("");

    // A UI cooldown discourages repeated clicks.
    // Supabase also enforces its own server-side email limits.
    nextAllowedAt.current = Date.now() + 60_000;
    setCooldown(60);

    try {
      const { error } = await createClient().auth.resend({
        type: "signup",
        email: email.trim(),
      });

      if (error) throw error;

      if (mounted.current) {
        setMessage(
          "If this address has an eligible unconfirmed signup, " +
            "a confirmation email will be sent. Check your inbox " +
            "and spam folder, then follow the newest email's instructions."
        );
      }
    } catch (error: unknown) {
      if (mounted.current) {
        setError(
          error instanceof Error
            ? error.message
            : "Could not resend the confirmation email."
        );
      }
    } finally {
      pending.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  return (
    <details className="section-spacing">
      <summary style={{ cursor: "pointer" }}>
        Need another confirmation email?
      </summary>

      <p className="muted" style={{ marginTop: 12 }}>
        Use the email address you registered with.
        This confirms a new account; it does not reset your password.
      </p>

      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="confirmation-email">
          Account email
          <input
            id="confirmation-email"
            type="email"
            autoComplete="email"
            required
            disabled={busy}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <button
          className="button"
          type="submit"
          disabled={busy || cooldown > 0}
        >
          {busy
            ? "Sending…"
            : cooldown > 0
              ? `Try again in ${cooldown}s`
              : "Resend confirmation email"}
        </button>
      </form>

      {message && (
        <p className="info-note" role="status">
          {message}
        </p>
      )}

      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}