"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { reportExtractionSchema } from "@/lib/report-extraction";

const savedReportSchema = z
  .object({
    id: z.string().uuid(),
    created_at: z.iso.datetime({ offset: true }),
    original_name: z.string(),
    original_size_bytes: z.number().int().positive(),
    original_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    original_pages: z
      .array(z.number().int().min(1).max(500))
      .min(1)
      .max(3),
    reviewed: z.literal(true),
    report: reportExtractionSchema,
  })
  .refine(
    (saved) =>
      saved.report.figures.every(
        (figure) =>
          figure.excerptPage <= saved.original_pages.length
      ),
    "Invalid source page reference."
  );

const cursorSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.string().uuid(),
});

const responseSchema = z.object({
  reports: z.array(savedReportSchema).max(10),
  nextCursor: cursorSchema.nullable(),
});

type SavedReport = z.infer<typeof savedReportSchema>;
type ReportCursor = z.infer<typeof cursorSchema>;

function csvCell(
  value: string | number | null | undefined
): string {
  let text =
    value === null || value === undefined ? "" : String(value);

  if (/^\s*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) {
    text = "'" + text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function downloadReportCsv(saved: SavedReport) {
  const headers = [
    "Save ID",
    "Saved at (UTC)",
    "Original filename",
    "Original file SHA-256",
    "Selected original PDF pages",
    "Organization",
    "Reporting period",
    "Boundary",
    "Scope",
    "Accounting basis",
    "Figure label",
    "Reported value",
    "Unit",
    "Original PDF page",
    "Evidence quotation",
    "Extraction warnings",
    "Review status",
    "Usage note",
  ];

  const rows = saved.report.figures.map((figure) => [
    saved.id,
    saved.created_at,
    saved.original_name,
    saved.original_sha256,
    saved.original_pages.join(", "),
    figure.organization,
    figure.reportingPeriod,
    figure.boundary,
    figure.scope,
    figure.basis,
    figure.label,
    figure.reportedValue,
    figure.unit,
    saved.original_pages[figure.excerptPage - 1],
    figure.evidence,
    saved.report.warnings.join("\n"),
    "User-reviewed; not independently verified",
    "Reported figures, not calculated electricity totals. " +
      "Do not sum overlapping figures or alternative Scope 2 bases.",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

  const blob = new Blob(["\uFEFF", csv, "\r\n"], {
    type: "text/csv;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `ecoguardian-ghg-report-${saved.id}.csv`;
  document.body.appendChild(link);

  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export default function SavedReports() {
  const [userId, setUserId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const { data } = createClient().auth.onAuthStateChange(
        (_event, session) => {
          setUserId(session?.user.id ?? null);
          setChecking(false);
        }
      );

      return () => data.subscription.unsubscribe();
    } catch {
      setError("Could not initialize the saved-reports session.");
      setChecking(false);
    }
  }, []);

  return (
    <section className="card section-spacing">
      <p className="eyebrow">REPORTED EMISSIONS</p>
      <h2>Saved GHG reports</h2>

      <p className="muted">
        Reviewed snapshots, newest first. Load older reports below.
        These figures remain separate from your calculated electricity
        totals.
      </p>

      {error ? (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      ) : checking ? (
        <p className="muted">Checking your session…</p>
      ) : userId ? (
        <ReportsList key={userId} />
      ) : (
        <p className="info-note">
          Sign in to view your saved reports.
        </p>
      )}
    </section>
  );
}

function ReportsList() {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] =
    useState<ReportCursor | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (cursor: ReportCursor | null) => {
      if (cursor && controllerRef.current) return;

      controllerRef.current?.abort();

      const controller = new AbortController();
      controllerRef.current = controller;

      setBusy(true);
      setError("");

      if (!cursor) {
        setReports([]);
        setNextCursor(null);
        setLoaded(false);
      }

      try {
        const params = new URLSearchParams();

        if (cursor) {
          params.set("before", cursor.createdAt);
          params.set("beforeId", cursor.id);
        }

        const query = params.toString();

        const response = await fetch(
          query ? `/api/reports?${query}` : "/api/reports",
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
            `Unexpected server response (HTTP ${response.status}).`
          );
        }

        if (!response.ok) {
          const message =
            typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
              ? body.error
              : "Could not load saved reports.";

          throw new Error(message);
        }

        const parsed = responseSchema.safeParse(body);

        if (!parsed.success) {
          throw new Error(
            "The saved report response could not be validated."
          );
        }

        if (
          controller.signal.aborted ||
          controllerRef.current !== controller
        ) {
          return;
        }

        const page = parsed.data;

        setReports((current) => {
          if (!cursor) return page.reports;

          const existingIds = new Set(
            current.map((report) => report.id)
          );

          return [
            ...current,
            ...page.reports.filter(
              (report) => !existingIds.has(report.id)
            ),
          ];
        });

        setNextCursor(page.nextCursor);
        setLoaded(true);
      } catch (cause: unknown) {
        if (
          !controller.signal.aborted &&
          controllerRef.current === controller
        ) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load saved reports."
          );
        }
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;

          if (!controller.signal.aborted) {
            setBusy(false);
          }
        }
      }
    },
    []
  );

  useEffect(() => {
    function refreshReports() {
      void load(null);
    }

    window.addEventListener(
      "ghg-reports-changed",
      refreshReports
    );

    void load(null);

    return () => {
      window.removeEventListener(
        "ghg-reports-changed",
        refreshReports
      );

      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [load]);

  return (
    <div>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void load(null)}
        style={{ margin: "16px 0" }}
      >
        {busy ? "Loading…" : "Refresh saved reports"}
      </button>

      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}

      <div aria-live="polite" aria-busy={busy}>
        {loaded && !busy && reports.length === 0 && (
          <p className="muted">
            No saved GHG reports yet. Extract a report, review its
            figures, and save the reviewed snapshot.
          </p>
        )}
      </div>

      {reports.map((saved) => (
        <details className="extracted-item" key={saved.id}>
          <summary
            style={{
              cursor: "pointer",
              overflowWrap: "anywhere",
            }}
          >
            <strong>{saved.original_name}</strong>
            {" · "}
            {saved.report.figures.length} figures
          </summary>

          <p className="muted">
            Saved: {new Date(saved.created_at).toLocaleString()}
          </p>

          <button
            type="button"
            className="secondary-button"
            onClick={() => downloadReportCsv(saved)}
            style={{ marginBottom: 12 }}
          >
            Download CSV
          </button>

          <p className="muted">
            Exports one row per figure, including evidence and page
            references. Spreadsheet-sensitive text is prefixed with
            an apostrophe for safety.
          </p>

          <p>
            Original PDF pages: {saved.original_pages.join(", ")}
          </p>

          <p className="info-note">
            User-reviewed snapshot, not independent verification.
            The original PDF is not stored.
          </p>

          {saved.report.warnings.length > 0 && (
            <div className="alert">
              <strong>
                Extraction notes retained with this snapshot
              </strong>

              <ul>
                {saved.report.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {saved.report.figures.map((figure, index) => (
            <article className="extracted-item" key={index}>
              <h3>
                {figure.scope}: {figure.label}
              </h3>

              <p>
                <strong>
                  {figure.reportedValue ?? "Not identified"}
                  {" "}
                  {figure.unit ?? "(unit not identified)"}
                </strong>
              </p>

              <p>
                Organization: {figure.organization || "Not stated"}
              </p>

              <p>
                Reporting period:{" "}
                {figure.reportingPeriod || "Not stated"}
              </p>

              <p>
                Boundary: {figure.boundary || "Not stated"}
              </p>

              <p>Accounting basis: {figure.basis}</p>

              <p>
                Original PDF page:{" "}
                {saved.original_pages[figure.excerptPage - 1]}
              </p>

              <blockquote
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {figure.evidence}
              </blockquote>
            </article>
          ))}

          <details>
            <summary>File identification</summary>

            <p>
              {saved.original_size_bytes.toLocaleString()} bytes
            </p>

            <p style={{ overflowWrap: "anywhere" }}>
              Save ID: {saved.id}
            </p>

            <p>Original file SHA-256:</p>

            <code
              style={{
                display: "block",
                overflowWrap: "anywhere",
              }}
            >
              {saved.original_sha256}
            </code>

            <p className="muted">
              This fingerprint identifies file contents; it does
              not prove authenticity.
            </p>
          </details>

          <p className="info-note">
            Do not add overlapping figures or alternative Scope 2
            accounting bases together. No demo emission factor is
            applied.
          </p>
        </details>
      ))}

      {loaded && (
        <p className="muted" role="status">
          {reports.length} saved report
          {reports.length === 1 ? "" : "s"} loaded.
        </p>
      )}

      {nextCursor && (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void load(nextCursor)}
          style={{ marginTop: 12 }}
        >
          {busy ? "Loading…" : "Load more reports"}
        </button>
      )}

      {loaded &&
        reports.length > 0 &&
        !nextCursor &&
        !busy && (
          <p className="muted">All saved reports loaded.</p>
        )}
    </div>
  );
}