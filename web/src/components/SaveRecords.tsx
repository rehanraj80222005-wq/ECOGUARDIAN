"use client";

import { useRef, useState } from "react";
import type { Extraction } from "@/lib/extraction";

export default function SaveRecords({
  draft,
  sourceDocumentId,
}: {
  draft: Extraction;
  sourceDocumentId: string | null;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const pending = useRef(false);

  async function save() {
    if (
      !sourceDocumentId ||
      !reviewed ||
      pending.current ||
      saved
    ) {
      return;
    }

    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewed: true,
          sourceDocumentId,
          draft,
        }),
      });

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Unexpected response (HTTP ${response.status}). ` +
          "Refresh Saved records before retrying."
        );
      }

      if (!response.ok) {
        throw new Error(data?.error || "Could not save records.");
      }

      if (
        data?.savedCount !== draft.items.length ||
        data?.sourceDocumentId !== sourceDocumentId
      ) {
        throw new Error("Unexpected save result. Refresh Saved records.");
      }

      setSaved(true);
      setMessage(
        `Saved ${data.savedCount} source-linked demo record(s).`
      );

      window.dispatchEvent(
        new Event("ecoguardian-records-changed")
      );
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not confirm the save."
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="calculation-panel">
      <h2>Save reviewed records</h2>

      {!sourceDocumentId ? (
        <p className="info-note">
          Select an actual source file and register its fingerprint before
          saving. Built-in sample data can still be calculated, but cannot
          be saved without a source.
        </p>
      ) : (
        <>
          <p className="muted" style={{ overflowWrap: "anywhere" }}>
            Linked source: {sourceDocumentId}
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
              I checked these rows against the selected source, removed
              duplicate totals, and confirm they represent purchased
              electricity consumption. Emissions use the fictional demo
              factor.
            </span>
          </label>

          <button
            type="button"
            className="button extract-button"
            disabled={
              !reviewed || busy || saved || draft.items.length === 0
            }
            onClick={save}
          >
            {saved ? "Saved" : busy ? "Saving…" : "Save source-linked records"}
          </button>
        </>
      )}

      {message && (
        <p className="info-note" role="status">{message}</p>
      )}

      {error && (
        <p className="copilot-error" role="alert">{error}</p>
      )}
    </section>
  );
}