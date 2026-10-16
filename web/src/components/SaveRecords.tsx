"use client";

import { useRef, useState } from "react";
import type { Extraction } from "@/lib/extraction";

export default function SaveRecords({
  draft,
}: {
  draft: Extraction;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Reuse IDs when retrying this same draft.
  const ids = useRef<string[] | null>(null);
  const pending = useRef(false);

  async function save() {
    if (!reviewed || pending.current || saved) return;

    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (!ids.current) {
        ids.current = draft.items.map(() => crypto.randomUUID());
      }

      const response = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewed: true,
          draft,
          ids: ids.current,
        }),
      });

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Unexpected response (HTTP ${response.status}). ` +
          "Check Saved records before retrying."
        );
      }

      if (!response.ok) {
        throw new Error(data?.error || "Could not save records.");
      }

      if (data?.savedCount !== draft.items.length) {
        throw new Error("Save result was unexpected. Check Saved records.");
      }

      setSaved(true);
      setMessage(`Saved ${data.savedCount} demo record(s) to your account.`);
      window.dispatchEvent(new Event("ecoguardian-records-changed"));
    } catch (error: unknown) {
      setError(
        error instanceof Error ? error.message : "Could not confirm the save."
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="calculation-panel">
      <h2>Save reviewed records</h2>
      <p className="muted">
        Saves one demo record per activity using the fictional electricity
        factor. The original PDF or image is not stored yet.
      </p>

      <label
        className="review-confirmation"
        style={{ marginTop: 16 }}
      >
        <input
          type="checkbox"
          checked={reviewed}
          disabled={busy || saved}
          onChange={(event) => setReviewed(event.target.checked)}
        />
        <span>
          I reviewed these rows, checked for duplicate totals, and confirm
          they represent purchased electricity consumed by the organization.
          I understand the saved emissions use a fictional demo factor.
        </span>
      </label>

      <button
        type="button"
        className="button extract-button"
        disabled={!reviewed || busy || saved || draft.items.length === 0}
        onClick={save}
      >
        {saved ? "Saved" : busy ? "Saving…" : "Save demo records"}
      </button>

      {message && <p className="info-note" role="status">{message}</p>}
      {error && <p className="copilot-error" role="alert">{error}</p>}
    </section>
  );
}