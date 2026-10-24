"use client";

import { useEffect, useRef, useState } from "react";
import { reportExtractionSchema } from "@/lib/report-extraction";
import type { ReportExtraction } from "@/lib/report-extraction";

type Figure = ReportExtraction["figures"][number];

const textFields = [
  ["organization", "Organization", 300],
  ["reportingPeriod", "Reporting period", 300],
  ["boundary", "Reporting boundary", 600],
  ["label", "Figure label", 300],
  ["reportedValue", "Reported value", 100],
  ["unit", "Unit", 100],
] as const;

export default function SaveReport({
  file,
  report,
  originalPages,
}: {
  file: File;
  report: ReportExtraction;
  originalPages: number[];
}) {
  const [draft, setDraft] = useState<ReportExtraction>(() => ({
    figures: report.figures.map((figure) => ({ ...figure })),
    warnings: [...report.warnings],
  }));
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [savedId, setSavedId] = useState("");
  const [error, setError] = useState("");

  const pending = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const saveId = useRef<string | null>(null);
  const payloadRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  function updateFigure(index: number, patch: Partial<Figure>) {
    setDraft((current) => ({
      ...current,
      figures: current.figures.map((figure, position) =>
        position === index ? { ...figure, ...patch } : figure
      ),
    }));
    setReviewed(false);
    setError("");
  }

  async function save() {
    if (pending.current || savedId || !reviewed) return;

    const parsed = reportExtractionSchema.safeParse(draft);

    if (!parsed.success || draft.figures.length === 0) {
      setError("Provide at least one valid report figure.");
      return;
    }

    const incomplete = draft.figures.findIndex(
      (figure) =>
        !figure.label.trim() ||
        !figure.reportedValue?.trim() ||
        !figure.unit?.trim() ||
        !figure.evidence.trim() ||
        figure.excerptPage > originalPages.length
    );

    if (incomplete !== -1) {
      setError(
        `Figure ${incomplete + 1}: check the label, value, unit, evidence, and page.`
      );
      return;
    }

    pending.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;

    setBusy(true);
    setError("");

    try {
      if (!payloadRef.current) {
        const fileBytes = await file.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", fileBytes);

        if (controller.signal.aborted) return;

        const sha256 = Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");

        saveId.current ??= crypto.randomUUID();

        payloadRef.current = JSON.stringify({
          id: saveId.current,
          reviewed: true,
          originalName: file.name.trim().slice(0, 255) || "Report.pdf",
          originalSizeBytes: file.size,
          originalSha256: sha256,
          originalPages,
          report: parsed.data,
        });
      }

      // Freeze this snapshot once submitted. Retries reuse the same
      // content and ID, including after an uncertain network outcome.
      setAttempted(true);

      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payloadRef.current,
        signal: controller.signal,
      });

      const text = await response.text();
      let body: unknown;

      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(
          "The save could not be confirmed. Check saved reports before retrying."
        );
      }

      if (!response.ok) {
        const message =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "Could not save the report.";

        // These responses confirm that this attempt was rejected without
        // inserting a snapshot. Allow corrections and require review again.
        // Keep the same payload and ID for conflicts or uncertain outcomes.
        if (
          (response.status === 400 || response.status === 413) &&
          typeof body === "object" && body !== null &&
          "error" in body && typeof body.error === "string"
        ) {
          payloadRef.current = null;
          saveId.current = null;
          setAttempted(false);
          setReviewed(false);
        }

        throw new Error(message);
      }

      if (
        typeof body !== "object" ||
        body === null ||
        !("savedReport" in body) ||
        typeof body.savedReport !== "object" ||
        body.savedReport === null ||
        !("id" in body.savedReport) ||
        body.savedReport.id !== saveId.current
      ) {
        throw new Error(
          "The save response could not be validated. Check saved reports."
        );
      }

      if (controller.signal.aborted) return;

      setSavedId(saveId.current!);
      window.dispatchEvent(new Event("ghg-reports-changed"));
    } catch (cause: unknown) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The save could not be confirmed. Check saved reports."
        );
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        pending.current = false;

        if (!controller.signal.aborted) {
          setBusy(false);
        }
      }
    }
  }

  const locked = busy || attempted || Boolean(savedId);

  return (
    <div className="calculation-panel">
      <h3>Review and save reported figures</h3>

      <p className="info-note">
        Compare these fields with the original PDF. Preserve the reported
        units and accounting basis. Saving does not independently verify
        the figures or add them to electricity totals.
      </p>

      {draft.warnings.length > 0 && (
        <div className="alert">
          <strong>Extraction notes</strong>
          <ul>
            {draft.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset
        disabled={locked}
        style={{ border: 0, padding: 0, minWidth: 0 }}
      >
        <legend className="muted">Fields to check against the PDF</legend>

        {draft.figures.map((figure, index) => (
          <article className="extracted-item" key={index}>
            <h3>Figure {index + 1}</h3>

            <div className="review-fields">
              {textFields.map(([field, label, maxLength]) => (
                <label key={field}>
                  {label}
                  <input
                    type="text"
                    maxLength={maxLength}
                    value={figure[field] ?? ""}
                    onChange={(event) =>
                      updateFigure(index, {
                        [field]: event.target.value,
                      })
                    }
                  />
                </label>
              ))}

              <label>
                Scope
                <select
                  value={figure.scope}
                  onChange={(event) =>
                    updateFigure(index, {
                      scope: event.target.value as Figure["scope"],
                    })
                  }
                >
                  <option>Scope 1</option>
                  <option>Scope 2</option>
                  <option>Scope 3</option>
                </select>
              </label>

              <label>
                Accounting basis
                <select
                  value={figure.basis}
                  onChange={(event) =>
                    updateFigure(index, {
                      basis: event.target.value as Figure["basis"],
                    })
                  }
                >
                  <option>location-based</option>
                  <option>market-based</option>
                  <option>not stated</option>
                  <option>not applicable</option>
                </select>
              </label>

              <label>
                Original PDF page
                <select
                  value={figure.excerptPage}
                  onChange={(event) =>
                    updateFigure(index, {
                      excerptPage: Number(event.target.value),
                    })
                  }
                >
                  {originalPages.map((page, position) => (
                    <option key={page} value={position + 1}>
                      Page {page}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Evidence quotation
                <textarea
                  rows={4}
                  maxLength={1000}
                  value={figure.evidence}
                  onChange={(event) =>
                    updateFigure(index, {
                      evidence: event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setDraft((current) => ({
                  ...current,
                  figures: current.figures.filter(
                    (_, position) => position !== index
                  ),
                }));
                setReviewed(false);
                setError("");
              }}
            >
              Remove this figure
            </button>
          </article>
        ))}

        {draft.figures.length === 0 && (
          <p className="muted">
            There are no figures to save. Extract another selection.
          </p>
        )}

        <label style={{ display: "block", margin: "16px 0" }}>
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />{" "}
          I compared every retained figure, unit, accounting basis, and
          evidence quotation with the original PDF.
        </label>
      </fieldset>

      <button
        type="button"
        className="button"
        disabled={
          busy || !reviewed || Boolean(savedId) || draft.figures.length === 0
        }
        onClick={save}
      >
        {busy
          ? "Saving…"
          : savedId
            ? "Report saved"
            : attempted
              ? "Retry the same save"
              : "Save reviewed report"}
      </button>

      {attempted && !savedId && !busy && (
        <p className="info-note">
          This submitted snapshot is locked. Check saved reports before
          retrying; a retry uses the same save ID.
        </p>
      )}

      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}

      {savedId && (
        <p className="info-note" role="status">
          Report saved in your account. Electricity totals are unchanged.
          {" "}Save ID: {savedId}
        </p>
      )}

      <p className="muted">
        Only file identification and reviewed figures are saved. The
        original PDF is not stored. File fingerprints do not prove authenticity.
      </p>
    </div>
  );
}