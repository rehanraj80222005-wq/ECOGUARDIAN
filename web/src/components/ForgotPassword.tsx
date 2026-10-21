"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const pending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;

    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();
      const cleanEmail = email.trim();

      if (!sent) {
        const { error } =
          await supabase.auth.resetPasswordForEmail(cleanEmail);

        if (error) throw error;

        if (mounted.current) {
          setEmail(cleanEmail);
          setSent(true);
          setMessage(
            "If this email belongs to an eligible account, " +
              "you will receive a recovery code. Enter the newest code below."
          );
        }
      } else {
        const { data, error } = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: code.trim(),
          type: "recovery",
        });

        if (error) throw error;

        if (!data.session) {
          throw new Error(
            "Recovery could not be confirmed. Request a new code."
          );
        }

        // AuthPanel detects the session and displays SetPassword.
        if (mounted.current) {
          setCode("");
          setMessage("Email verified. Choose your new password.");
        }
      }
    } catch (error: unknown) {
      if (mounted.current) {
        setError(
          error instanceof Error
            ? error.message
            : "Password recovery failed."
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
        Forgot password?
      </summary>

      <p className="muted" style={{ marginTop: 12 }}>
        Verify the recovery code from your email, then set a new password.
      </p>

      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="recovery-email">
          Account email
          <input
            id="recovery-email"
            type="email"
            autoComplete="email"
            required
            disabled={busy || sent}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        {sent && (
          <label htmlFor="recovery-code">
            Recovery code
            <input
              id="recovery-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Enter the code from your email"
              required
              disabled={busy}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
        )}

        <button className="button" type="submit" disabled={busy}>
          {busy
            ? "Please wait…"
            : sent
              ? "Verify recovery code"
              : "Send recovery code"}
        </button>

        {sent && (
          <button
            className="remove-file"
            type="button"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setCode("");
              setMessage("");
              setError("");
            }}
          >
            Change email or request another code
          </button>
        )}
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