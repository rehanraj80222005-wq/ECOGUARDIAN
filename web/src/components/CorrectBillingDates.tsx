"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";

type Props = {
  recordId: string;
  startDate: string | null;
  endDate: string | null;
};

export default function CorrectBillingDates({
  recordId,
  startDate,
  endDate,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        className="remove-file"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Close date correction" : "Correct billing dates"}
      </button>

      {open && (
        <CorrectionForm
          key={`${recordId}-${startDate}-${endDate}`}
          recordId={recordId}
          startDate={startDate}
          endDate={endDate}
        />
      )}
    </div>
  );
}

function CorrectionForm({
  recordId,
  startDate,
  endDate,
}: Props) {
  const [newStartDate, setNewStartDate] = useState(startDate ?? "");
  const [newEndDate, setNewEndDate] = useState(endDate ?? "");
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  const changed =
    newStartDate !== (startDate ?? "") ||
    newEndDate !== (endDate ?? "");

  const canSave =
    !!newStartDate &&
    !!newEndDate &&
    newEndDate >= newStartDate &&
    reason.trim().length >= 10 &&
    reviewed &&
    changed &&
    !busy &&
    !saved;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSave || pending.current) return;

    pending.current = true;
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/records/dates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId,
          expectedStartDate: startDate,
          expectedEndDate: endDate,
          newStartDate,
          newEndDate,
          reason: reason.trim(),
          reviewed: true,
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
            : "Could not correct billing dates.";

        throw new Error(message);
      }

      if (
        typeof data !== "object" ||
        data === null ||
        !("recordId" in data) ||
        data.recordId !== recordId ||
        !("billingStartDate" in data) ||
        data.billingStartDate !== newStartDate ||
        !("billingEndDate" in data) ||
        data.billingEndDate !== newEndDate
      ) {
        throw new Error(
          "Unexpected correction result. Refresh Saved records."
        );
      }

      setSaved(true);
      window.dispatchEvent(new Event("ecoguardian-records-changed"));
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not confirm the correction."
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        marginTop: 12,
        padding: 14,
        border: "1px solid #dce6dc",
        borderRadius: 8,
        minWidth: 240,
        maxWidth: 360,
        whiteSpace: "normal",
      }}
    >
      <p className="muted" style={{ marginBottom: 12 }}>
        Check the original source. This changes only this record's
        structured billing dates and creates a history entry.
      </p>

      <label style={{ display: "block", marginBottom: 12 }}>
        Billing start date
        <input
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          required
          disabled={busy || saved}
          value={newStartDate}
          onChange={(event) => {
            setNewStartDate(event.target.value);
            setReviewed(false);
          }}
          style={{ display: "block", width: "100%" }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 12 }}>
        Billing end date
        <input
          type="date"
          min={newStartDate || "0001-01-01"}
          max="9999-12-31"
          required
          disabled={busy || saved}
          value={newEndDate}
          onChange={(event) => {
            setNewEndDate(event.target.value);
            setReviewed(false);
          }}
          style={{ display: "block", width: "100%" }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 12 }}>
        Reason for correction
        <textarea
          required
          minLength={10}
          maxLength={1000}
          rows={3}
          disabled={busy || saved}
          value={reason}
          placeholder="Explain what you checked and why the dates need updating."
          onChange={(event) => {
            setReason(event.target.value);
            setReviewed(false);
          }}
          style={{ display: "block", width: "100%" }}
        />
      </label>

      <label className="review-confirmation">
        <input
          type="checkbox"
          checked={reviewed}
          disabled={busy || saved}
          onChange={(event) => setReviewed(event.target.checked)}
        />
        <span>
          I verified these consumption-period dates against the source.
        </span>
      </label>

      <button
        type="submit"
        className="button"
        disabled={!canSave}
        style={{ marginTop: 12 }}
      >
        {saved ? "Saved" : busy ? "Saving…" : "Save date correction"}
      </button>

      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}

      {saved && (
        <p className="info-note" role="status">
          Dates corrected and history recorded.
        </p>
      )}
    </form>
  );
}