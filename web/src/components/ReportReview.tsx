"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { reportExtractionSchema } from "@/lib/report-extraction";

const responseSchema = z.object({
  report: reportExtractionSchema,
  originalPages: z.array(z.number().int().positive()).min(1).max(3),
});

type Result = z.infer<typeof responseSchema>;

export default function ReportReview() {
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
      setError("Could not initialize the report-review session.");
      setChecking(false);
    }
  }, []);

  return (
    <section id="report-review" className="card section-spacing">
      <p className="eyebrow">REPORTED EMISSIONS</p>
      <h2>Review a GHG report</h2>

      <p className="muted">
        Extract reported figures from selected PDF pages. Results are
        unverified drafts and stay separate from your bill-based totals.
      </p>

      {error ? (
        <p className="copilot-error" role="alert">{error}</p>
      ) : checking ? (
        <p className="muted">Checking your session…</p>
      ) : userId ? (
        <ReportForm key={userId} />
      ) : (
        <p className="info-note">Sign in to review a report.</p>
      )}
    </section>
  );
}

function ReportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [firstPage, setFirstPage] = useState("1");
  const [lastPage, setLastPage] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const pending = useRef(false);
  const version = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      version.current += 1;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function extract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file || pending.current) return;

    const start = Number(firstPage);
    const end = Number(lastPage);

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end < start ||
      end > 500 ||
      end - start + 1 > 3
    ) {
      setError("Choose one to three consecutive pages, numbered 1–500.");
      return;
    }

    pending.current = true;
    const currentVersion = ++version.current;
    const controller = new AbortController();
    controllerRef.current = controller;

    setBusy(true);
    setError("");
    setResult(null);

    try {
      let source: PDFDocument;

      try {
        source = await PDFDocument.load(await file.arrayBuffer(), {
          updateMetadata: false,
        });
      } catch {
        throw new Error(
          "This PDF cannot be read or is password protected."
        );
      }

      if (source.isEncrypted) {
        throw new Error("Password-protected reports are not supported.");
      }

      const pageCount = source.getPageCount();

      if (pageCount > 500) {
        throw new Error("This prototype supports reports up to 500 pages.");
      }

      if (end > pageCount) {
        throw new Error(`This PDF has only ${pageCount} pages.`);
      }

      const originalPages = Array.from(
        { length: end - start + 1 },
        (_, index) => start + index
      );

      const excerpt = await PDFDocument.create();
      const copiedPages = await excerpt.copyPages(
        source,
        originalPages.map((page) => page - 1)
      );

      copiedPages.forEach((page) => excerpt.addPage(page));

      const savedBytes = await excerpt.save();

      if (savedBytes.byteLength > 3 * 1024 * 1024) {
        throw new Error(
          "The selected pages exceed 3 MB. Select fewer pages."
        );
      }

      if (currentVersion !== version.current) return;

      // Copy to an ArrayBuffer-backed view for browser Blob typing.
      const bytes = new Uint8Array(savedBytes.byteLength);
      bytes.set(savedBytes);

      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes.buffer], { type: "application/pdf" }),
        "selected-report-pages.pdf"
      );
      form.append("originalPages", JSON.stringify(originalPages));

      const response = await fetch("/api/report-extract", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

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
            : "Could not extract report figures.";

        throw new Error(message);
      }

      const parsed = responseSchema.safeParse(body);

      if (
        !parsed.success ||
        JSON.stringify(parsed.data.originalPages) !==
          JSON.stringify(originalPages) ||
        parsed.data.report.figures.some(
          (figure) => figure.excerptPage > originalPages.length
        )
      ) {
        throw new Error("The report response has an unexpected format.");
      }

      if (currentVersion === version.current) {
        setResult(parsed.data);
      }
    } catch (error: unknown) {
      if (currentVersion === version.current) {
        setError(
          error instanceof Error ? error.message : "Extraction failed."
        );
      }
    } finally {
      if (currentVersion === version.current) {
        pending.current = false;
        controllerRef.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <>
      <form onSubmit={extract}>
        <div className="upload-zone">
          <label>
            Select a report PDF · Maximum 20 MB
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                event.target.value = "";

                setFile(null);
                setResult(null);
                setError("");
                setFirstPage("1");
                setLastPage("1");

                if (!selected) return;

                if (
                  !selected.name.toLowerCase().endsWith(".pdf") ||
                  selected.size === 0 ||
                  selected.size > 20 * 1024 * 1024
                ) {
                  setError("Choose a non-empty PDF no larger than 20 MB.");
                  return;
                }

                setFile(selected);
              }}
            />
          </label>
        </div>

        {file && (
          <p className="muted" style={{ overflowWrap: "anywhere" }}>
            {file.name}
          </p>
        )}

        {previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="preview-link"
          >
            Open original report to check pages ↗
          </a>
        )}

        <div className="review-fields" style={{ marginTop: 16 }}>
          <label>
            First PDF page
            <input
              type="number"
              min="1"
              max="500"
              step="1"
              required
              disabled={busy}
              value={firstPage}
              onChange={(event) => {
                setFirstPage(event.target.value);
                setResult(null);
              }}
            />
          </label>

          <label>
            Last PDF page
            <input
              type="number"
              min="1"
              max="500"
              step="1"
              required
              disabled={busy}
              value={lastPage}
              onChange={(event) => {
                setLastPage(event.target.value);
                setResult(null);
              }}
            />
          </label>
        </div>

        <p className="info-note">
          Use PDF page positions, counting the cover as page 1—not printed
          page labels. Select up to three consecutive pages containing
          emissions tables and their headings.
        </p>

        <p className="muted">
          Clicking Extract sends a PDF excerpt of the selected pages to
          Google Gemini and uses API quota. The full report is not uploaded.
        </p>

        <button
          type="submit"
          className="button extract-button"
          disabled={!file || busy}
        >
          {busy ? "Preparing and extracting…" : "Extract report figures"}
        </button>
      </form>

      {error && (
        <p className="copilot-error" role="alert">{error}</p>
      )}

      <div aria-live="polite" aria-busy={busy}>
        {result && (
          <div style={{ marginTop: 24 }}>
            <h3>Unverified report figures</h3>

            <p className="info-note">
              Selected original PDF pages: {result.originalPages.join(", ")}.
              Compare every figure and quotation with the original.
              Results are not saved and will be lost on refresh.
            </p>

            {result.report.warnings.length > 0 && (
              <div className="alert">
                <strong>Review notes</strong>
                <ul>
                  {result.report.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.report.figures.length === 0 && (
              <p className="muted">
                No eligible emissions figures were found on these pages.
                Try the report’s emissions inventory table.
              </p>
            )}

            {result.report.figures.map((figure, index) => (
              <article className="extracted-item" key={index}>
                <h3>{figure.scope}: {figure.label}</h3>

                <p>
                  <strong>
                    {figure.reportedValue ?? "Value not identified"}
                    {" "}
                    {figure.unit ?? "(unit not identified)"}
                  </strong>
                </p>

                <p>Organization: {figure.organization ?? "Not identified"}</p>
                <p>Period: {figure.reportingPeriod ?? "Not identified"}</p>
                <p>Boundary: {figure.boundary ?? "Not identified"}</p>
                <p>Accounting basis: {figure.basis}</p>

                <p className="info-note">
                  Suggested source: original PDF page{" "}
                  {result.originalPages[figure.excerptPage - 1]}.
                  {" "}Check this reference manually.
                </p>

                <blockquote style={{ whiteSpace: "pre-wrap" }}>
                  {figure.evidence}
                </blockquote>
              </article>
            ))}

            <p className="info-note">
              These are reported figures, not EcoGuardian calculations.
              Do not add overlapping periods, subtotals, or alternative
              Scope 2 accounting bases together. No demonstration emission
              factor has been applied.
            </p>
          </div>
        )}
      </div>
    </>
  );
}