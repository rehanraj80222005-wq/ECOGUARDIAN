"use client";

import { useEffect, useId, useState } from "react";
import { z } from "zod";

const historySchema = z.object({
  changes: z.array(
    z.object({
      id: z.string().uuid(),
      old_start_date: z.string().nullable(),
      old_end_date: z.string().nullable(),
      new_start_date: z.string(),
      new_end_date: z.string(),
      reason: z.string(),
      changed_at: z.string(),
    })
  ),
  hasMore: z.boolean(),
});

type History = z.infer<typeof historySchema>;

export default function BillingDateHistory({
  recordId,
}: {
  recordId: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        className="remove-file"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide date history" : "View date history"}
      </button>

      <div id={panelId} hidden={!open}>
        {open && <HistoryPanel key={recordId} recordId={recordId} />}
      </div>
    </div>
  );
}

function HistoryPanel({ recordId }: { recordId: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    function refresh() {
      setRevision((value) => value + 1);
    }

    window.addEventListener("ecoguardian-records-changed", refresh);

    return () =>
      window.removeEventListener("ecoguardian-records-changed", refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      setHistory(null);

      try {
        const response = await fetch(
          `/api/records/history?recordId=${encodeURIComponent(recordId)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const text = await response.text();
        let body: unknown;

        try {
          body = JSON.parse(text);
        } catch {
          throw new Error(
            `Unexpected response (HTTP ${response.status}).`
          );
        }

        if (!response.ok) {
          const message =
            typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
              ? body.error
              : "Could not load date history.";

          throw new Error(message);
        }

        const parsed = historySchema.safeParse(body);

        if (!parsed.success) {
          throw new Error("The history response has an unexpected format.");
        }

        if (active) setHistory(parsed.data);
      } catch (error: unknown) {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not load date history."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [recordId, revision]);

  return (
    <div
      aria-live="polite"
      aria-busy={loading}
      style={{
        marginTop: 12,
        padding: 14,
        border: "1px solid #dce6dc",
        borderRadius: 8,
        minWidth: 240,
        maxWidth: 420,
        whiteSpace: "normal",
        overflowWrap: "anywhere",
      }}
    >
      {loading && <p className="muted">Loading date history…</p>}

      {error && (
        <>
          <p className="copilot-error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="remove-file"
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </button>
        </>
      )}

      {!loading && history && (
        <>
          {history.changes.length === 0 ? (
            <p className="muted">
              No billing-date corrections have been recorded.
            </p>
          ) : (
            <ol style={{ paddingLeft: 20 }}>
              {history.changes.map((change) => (
                <li
                  key={change.id}
                  style={{
                    marginBottom: 16,
                    paddingBottom: 12,
                    borderBottom: "1px solid #dce6dc",
                  }}
                >
                  <strong>
                    {new Date(change.changed_at).toLocaleString()}
                  </strong>

                  <p style={{ marginTop: 6 }}>
                    Previous: {change.old_start_date ?? "Not set"}
                    {" → "}
                    {change.old_end_date ?? "Not set"}
                  </p>

                  <p>
                    Updated: {change.new_start_date}
                    {" → "}
                    {change.new_end_date}
                  </p>

                  <p style={{ marginTop: 6 }}>
                    Reason: {change.reason}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {history.hasMore && (
            <p className="info-note">
              Showing the latest 50 corrections. Older entries remain
              stored in the database.
            </p>
          )}

          <p className="muted">
            Times are shown in your local timezone. This history records
            date corrections, not independent verification of the source.
          </p>
        </>
      )}
    </div>
  );
}