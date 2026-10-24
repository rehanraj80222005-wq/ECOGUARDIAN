"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { reportExtractionSchema } from "@/lib/report-extraction";
import SaveReport from "@/components/SaveReport";
import SavedReports from "@/components/SavedReports";
import ReportPageFinder from "@/components/ReportPageFinder";

const responseSchema = z.object({
  report: reportExtractionSchema,
  originalPages: z
    .array(z.number().int().min(1).max(500))
    .min(1)
    .max(3),
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
        Find likely emissions pages, then extract and review reported
        figures. These remain separate from electricity totals.
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

      <SavedReports />
    </section>
  );
}

function ReportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [fileVersion, setFileVersion] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [firstPage, setFirstPage] = useState("1");
  const [lastPage, setLastPage] = useState("1");
  const [bestPage, setBestPage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [selectionNote, setSelectionNote] = useState("");

  const pending = useRef(false);
  const version = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  // Stable callback prevents scanning from restarting on ordinary renders.
  const handleBestPage = useCallback((page: number | null) => {
    setBestPage(page);
  }, []);

  useEffect(() => {
    return () => {
      version.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
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
    await extractPages(Number(firstPage), Number(lastPage));
  }

  function extractBestPage() {
    if (bestPage === null || pending.current) return;

    setFirstPage(String(bestPage));
    setLastPage(String(bestPage));
    setSelectionNote(
      `Selected highest-ranked PDF page ${bestPage}.`
    );

    void extractPages(bestPage, bestPage);
  }

  async function extractPages(start: number, end: number) {
    if (!file || pending.current) return;

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

      if (currentVersion !== version.current) return;

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
    } catch (cause: unknown) {
      if (currentVersion === version.current) {
        setError(
          cause instanceof Error ? cause.message : "Extraction failed."
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

                if (pending.current) return;

                version.current += 1;
                setFile(null);
                setFileVersion((value) => value + 1);
                setBestPage(null);
                setPreviewUrl("");
                setResult(null);
                setError("");
                setSelectionNote("");
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

        {file && (
          <ReportPageFinder
            key={fileVersion}
            file={file}
            disabled={busy}
            onBestPage={handleBestPage}
          />
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
                setSelectionNote("");
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
                setSelectionNote("");
              }}
            />
          </label>
        </div>

        <p className="info-note">
          Manual extraction uses the range above: one to three consecutive
          PDF pages, counting the cover as page 1. Automatic extraction
          uses only the highest-ranked suggested page.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginTop: 16,
          }}
        >
          <button
            type="submit"
            className="button"
            disabled={!file || busy}
          >
            {busy ? "Extracting…" : "Extract with Gemini"}
          </button>

          <button
            type="button"
            className="button"
            disabled={!file || busy || bestPage === null}
            onClick={extractBestPage}
          >
            Extract highest-ranked page
            {bestPage !== null ? ` (${bestPage})` : ""}
          </button>
        </div>

        <p className="muted">
          Either extraction button makes one application AI request.
          The full report is not uploaded. Page scanning itself uses
          no AI quota. Review and save each result before starting
          another extraction.
        </p>

        {selectionNote && (
          <p className="info-note" role="status">
            {selectionNote}
          </p>
        )}
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
              {" "}Compare every figure and quotation with the original.
              Unsaved drafts are lost on refresh.
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
                No eligible figures were found. Inspect the suggestions
                and try another page or a manual range.
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

            <p className="info-note">
              These are reported figures, not EcoGuardian calculations.
              Do not add overlapping periods, subtotals, or alternative
              Scope 2 accounting bases together.
            </p>

            {file && result.report.figures.length > 0 && (
              <SaveReport
                file={file}
                report={result.report}
                originalPages={result.originalPages}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}