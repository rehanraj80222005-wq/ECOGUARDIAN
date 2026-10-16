"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SetPassword() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setError("");
    setSuccess(false);

    if (password.length < 12) {
      setError("Use at least 12 characters.");
      return;
    }

    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);

    try {
      const supabase = createClient();

      const { data, error: sessionError } =
        await supabase.auth.getUser();

      if (sessionError || !data.user) {
        throw new Error(
          "Your session has expired. Password recovery is required."
        );
      }

      const { error: updateError } =
        await supabase.auth.updateUser({ password });

      if (updateError) throw updateError;

      setPassword("");
      setConfirmation("");
      setSuccess(true);
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save your password."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section-spacing">
      <h2>Set your EcoGuardian password</h2>
      <p className="muted">
        Use this password for future email-and-password sign-ins.
      </p>

      <form
        className="auth-form"
        onSubmit={submit}
        style={{ marginTop: 18 }}
      >
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <label>
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            disabled={busy}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>

        <button className="button" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>

      {success && (
        <p className="info-note" role="status">
          Password saved. You can now sign out and sign back in.
        </p>
      )}

      {error && (
        <p className="copilot-error" role="alert">{error}</p>
      )}
    </div>
  );
}