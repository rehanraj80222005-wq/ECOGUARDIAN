"use client";

import { useRef, useState } from "react";
import type { Extraction } from "@/lib/extraction";

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value < "0001-01-01" || value > "9999-12-31") return false;

  const date = new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export default function SaveRecords({
  draft,
  sourceDocumentId,
}: {
  draft: Extraction;
  sourceDocumentId: string | null;
}) {
  const [billingStartDate, setBillingStartDate] = useState("");
  const [billingEndDate, setBillingEndDate] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const pending = useRef(false);

  const datesValid =
    validDate(billingStartDate) &&
    validDate(billingEndDate) &&
    billingEndDate >= billingStartDate;

  async function save() {
    if (
      !sourceDocumentId ||
      !reviewed ||
      !datesValid ||
      pending.current ||
      saved ||
      draft.items.length === 0
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
          billingStartDate,
          billingEndDate,
          draft,
        }),
      });

      const text = await response.text();
      let data: unknown;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Unexpected response (HTTP ${response.status}). ` +
            "Refresh Saved records before retrying."
        );
      }

      if (!response.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Could not save records.";

        throw new Error(message);
      }

      if (
        typeof data !== "object" ||
        data === null ||
        !("savedCount" in data) ||
        data.savedCount !== draft.items.length ||
        !("sourceDocumentId" in data) ||
        data.sourceDocumentId !== sourceDocumentId ||
        !("billingStartDate" in data) ||
        data.billingStartDate !== billingStartDate ||
        !("billingEndDate" in data) ||
        data.billingEndDate !== billingEndDate
      ) {
        throw new Error(
          "Unexpected save result. Refresh Saved records before retrying."
        );
      }

      setSaved(true);
      setMessage(
        `Saved ${data.savedCount} source-linked demo record(s) with billing dates.`
      );

      window.dispatchEvent(new Event("ecoguardian-records-changed"));
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

          <p className="info-note">
            Enter the consumption period shown on the bill, not its payment
            due date. These dates apply to every activity in this save.
            If activities cover different periods, do not save them together.
          </p>

          <div className="review-fields" style={{ marginTop: 16 }}>
            <label>
              Billing start date
              <input
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={billingStartDate}
                disabled={busy || saved}
                required
                onChange={(event) => {
                  setBillingStartDate(event.target.value);
                  setReviewed(false);
                  setError("");
                }}
              />
            </label>

            <label>
              Billing end date
              <input
                type="date"
                min={billingStartDate || "0001-01-01"}
                max="9999-12-31"
                value={billingEndDate}
                disabled={busy || saved}
                required
                onChange={(event) => {
                  setBillingEndDate(event.target.value);
                  setReviewed(false);
                  setError("");
                }}
              />
            </label>
          </div>

          {billingStartDate && billingEndDate && !datesValid && (
            <p className="copilot-error" role="alert">
              Enter valid dates. The end date cannot be before the start date.
            </p>
          )}

          <label
            className="review-confirmation"
            style={{ marginTop: 16 }}
          >
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy || saved || !datesValid}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            <span>
              I checked the quantities, units, and billing dates against
              the selected source, removed duplicate totals, and confirm
              these rows represent purchased electricity consumption.
              Emissions use the fictional demo factor.
            </span>
          </label>

          <button
            type="button"
            className="button extract-button"
            disabled={
              !reviewed ||
              !datesValid ||
              busy ||
              saved ||
              draft.items.length === 0
            }
            onClick={save}
          >
            {saved ? "Saved" : busy ? "Saving…" : "Save source-linked records"}
          </button>

          <p className="muted" style={{ marginTop: 8 }}>
            Complete the activity edits above before entering these dates.
            Changing the draft resets this save form.
          </p>
        </>
      )}

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
    </section>
  );
}