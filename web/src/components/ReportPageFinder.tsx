"use client";

import { useEffect, useRef, useState } from "react";
import type { Worker } from "tesseract.js";

type Candidate = { page: number; score: number; reasons: string[]; snippet: string; source: string };
type Mode = "text" | "sparse" | "range";
type Scan = { mode: Mode; start: number; end: number; run: number };

// Ranking is a heuristic, never a claim that a figure has been verified.
function rankPage(page: number, raw: string, source: string): Candidate | null {
  const text = raw.normalize("NFKC").replace(/[‐‑–—]/g, "-").replace(/\s+/g, " ").trim();
  const scopes = [...text.matchAll(/\bscope\s*[:\-]?\s*[123]\b/gi)];
  const unit = /\b(?:t|mt|kt|kg)\s*co\s*2\s*(?:eq|e)?\b|\b(?:tonnes?|tons?)\s+(?:of\s+)?(?:co\s*2|carbon dioxide)/i;
  const number = /(?:^|\s|[:=(])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?=\s|[;,)\]]|$)/;
  const reasons: string[] = [];
  let score = 0;
  let bestPosition = 0;
  let strong = 0;
  for (const match of scopes) {
    const position = match.index ?? 0;
    const nearby = text.slice(Math.max(0, position - 100), position + 260);
    // Remove labels and explicitly labelled reporting years, not bare numbers:
    // 2000 tCO2e is a valid emissions value, not necessarily a year.
    const values = nearby
      .replace(/\b(?:scope|category)\s*[:/\-]?\s*[\d,]+/gi, " ")
      .replace(/\b(?:FY|(?:reporting|financial|fiscal|calendar)\s+year)\s*[:\-]?\s*(?:19|20)\d{2}(?:\s*[-/]\s*(?:\d{4}|\d{2}))?\b(?![\d.]|\s*(?:t|mt|kt|kg)\s*co)/gi, " ");
    if (unit.test(nearby) && number.test(values)) {
      strong += 1;
      if (strong === 1) bestPosition = position;
    }
  }
  if (!scopes.length || !strong) return null;
  score += Math.min(strong, 4) * 12;
  reasons.push("Scope, emissions unit and number appear nearby");
  if (/\btotal(?:\s+ghg|\s+emissions)?\b|\bemissions\s+(?:inventory|summary)\b/i.test(text)) {
    score += 12; reasons.push("Inventory or totals wording");
  }
  if (/\btable\s*(?:no\.?\s*)?\d|\bscope\s*\/\s*category\b/i.test(text)) {
    score += 5; reasons.push("Possible tabulated results");
  }
  if (/\b(?:location|market)[ -]*based\b/i.test(text)) {
    score += 3; reasons.push("Scope 2 accounting basis");
  }
  const penalties: [RegExp, number, string][] = [
    [/\b(?:table of contents|contents)\b/i, 30, "Contents-page wording"],
    [/\bintroduction\b|\bpurpose of (?:the )?report\b/i, 22, "Introduction wording"],
    [/\bemission(?:s)? factors?\b|\bkg\s*co\s*2.{0,30}\b(?:per|\/)|\bdefra\b/i, 28, "Emission-factor wording"],
    [/\bmethodology\b|\bcalculation method\b/i, 18, "Methodology wording"],
    [/\breduction (?:plan|target|initiative|potential)\b|\bsaving opportunit|\baction plan\b/i, 24, "Reduction-plan wording"],
    [/\bnet[ -]*zero\b|\btargets?\b/i, 8, "Target wording"],
  ];
  for (const [pattern, penalty, label] of penalties) {
    if (pattern.test(text)) { score -= penalty; reasons.push(`${label} lowers ranking`); }
  }
  if (score < 15) return null;
  const start = Math.max(0, bestPosition - 90);
  return { page, score, reasons, source, snippet: (start ? "…" : "") + text.slice(start, start + 420) + (start + 420 < text.length ? "…" : "") };
}

export default function ReportPageFinder({ file, disabled, onBestPage }: {
  file: File; disabled: boolean; onBestPage: (page: number | null) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [first, setFirst] = useState("1");
  const [last, setLast] = useState("10");
  const [scan, setScan] = useState<Scan>({ mode: "text", start: 1, end: 500, run: 0 });
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let stopped = false;
    let destroyPdf: (() => Promise<void>) | null = null;
    let worker: Worker | null = null;
    let cancelRender: (() => void) | null = null;
    const release = () => {
      cancelRender?.(); cancelRender = null;
      const pdf = destroyPdf; destroyPdf = null;
      if (pdf) void pdf().catch(() => {});
      const ocr = worker; worker = null;
      if (ocr) void ocr.terminate().catch(() => {});
    };
    const stop = () => {
      stopped = true; release(); onBestPage(null);
      setBusy(false); setStatus("Scan cancelled. Choose a scan mode to restart.");
    };
    stopRef.current = stop;
    setBusy(true); setError(""); setCandidates([]); onBestPage(null);
    setStatus("Opening PDF…");

    async function run() {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (stopped) return;
        const base = `/pdfjs/${pdfjs.version}/`;
        pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (stopped) return;
        const task = pdfjs.getDocument({ data: bytes, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/` });
        destroyPdf = () => task.destroy();
        const pdf = await task.promise;
        if (stopped) return;
        if (pdf.numPages > 500) throw new Error("Reports over 500 pages are not supported.");
        if (scan.start > pdf.numPages) throw new Error(`This PDF has only ${pdf.numPages} pages.`);
        const end = Math.min(scan.end, pdf.numPages);
        const found: Candidate[] = [];
        let ocrCount = 0, skipped = 0, failures = 0, lowConfidence = 0, lowText = 0;
        let ocrUnavailable = false;
        for (let n = scan.start; n <= end; n++) {
          if (stopped) return;
          setStatus(`Reading PDF page ${n} of ${end}…`);
          const page = await pdf.getPage(n);
          try {
            let text = "";
            try {
              const content = await page.getTextContent();
              text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
            } catch { failures++; }
            if (stopped) return;
            const letters = text.match(/[A-Za-z]/g)?.length ?? 0;
            const broken = (text.match(/\uFFFD/g)?.length ?? 0) > 5;
            const sparse = letters < 100 || broken;
            if (sparse) lowText++;
            let best = rankPage(n, text, "PDF text");
            const needsOcr = scan.mode === "range" || (scan.mode === "sparse" && sparse);
            if (needsOcr && (ocrCount >= 20 || ocrUnavailable)) skipped++;
            if (needsOcr && ocrCount < 20 && !ocrUnavailable) {
              ocrCount++;
              let canvas: HTMLCanvasElement | null = null;
              try {
                if (!worker) {
                  setStatus("Loading English OCR engine and language data…");
                  const { createWorker, PSM } = await import("tesseract.js");
                  if (stopped) return;
                  const created = await createWorker("eng", 1);
                  if (stopped) { await created.terminate(); return; }
                  worker = created;
                  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
                }
                if (stopped) return;
                setStatus(`OCR on PDF page ${n} (${ocrCount}/20 maximum)…`);
                const natural = page.getViewport({ scale: 1 });
                const scale = Math.min(2.5, 2400 / Math.max(natural.width, natural.height), Math.sqrt(4_000_000 / (natural.width * natural.height)));
                const viewport = page.getViewport({ scale });
                canvas = document.createElement("canvas");
                canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Canvas is unavailable.");
                const rendering = page.render({ canvas, canvasContext: context, viewport, background: "white" });
                cancelRender = () => rendering.cancel();
                await rendering.promise; cancelRender = null;
                if (stopped) return;
                const recognized = await worker!.recognize(canvas);
                if (stopped) return;
                if (recognized.data.confidence < 50) lowConfidence++;
                const ocrCandidate = rankPage(n, recognized.data.text, `English OCR; recognition confidence ${Math.round(recognized.data.confidence)}% (not evidence confidence)`);
                if (ocrCandidate && (!best || ocrCandidate.score > best.score)) best = ocrCandidate;
              } catch {
                if (stopped) return;
                failures++;
                if (!worker) ocrUnavailable = true;
              } finally {
                cancelRender = null;
                if (canvas) { canvas.width = 0; canvas.height = 0; }
              }
            }
            if (best) found.push(best);
          } finally { page.cleanup(); }
        }
        if (stopped) return;
        found.sort((a, b) => b.score - a.score || a.page - b.page);
        setCandidates(found.slice(0, 8)); onBestPage(found[0]?.page ?? null);
        setStatus(`Checked PDF pages ${scan.start}–${end}. ${found.length} possible evidence pages; showing up to 8. ${ocrCount} OCR attempts. ${lowText} pages had little or damaged text. ${skipped} OCR pages skipped. ${failures} reading/OCR failures. ${lowConfidence} low-confidence OCR pages. ${found.length ? "Inspect the original before extracting." : "No strong matches: use manual selection or OCR a specific range."}`);
        if (ocrUnavailable) setError("OCR engine could not load. Check your connection or browser restrictions; text scanning still ran.");
      } catch (cause: unknown) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "Could not scan this PDF.");
      } finally {
        release();
        if (!stopped) setBusy(false);
      }
    }
    void run();
    return () => { stopped = true; release(); if (stopRef.current === stop) stopRef.current = null; };
  }, [file, scan, onBestPage]);

  function start(mode: Mode) {
    if (busy || disabled) return;
    const startPage = mode === "range" ? Number(first) : 1;
    const endPage = mode === "range" ? Number(last) : 500;
    if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage || endPage > 500 || (mode === "range" && endPage - startPage + 1 > 20)) {
      setError("Choose 1–20 consecutive OCR pages within pages 1–500."); return;
    }
    onBestPage(null);
    setScan(current => ({ mode, start: startPage, end: endPage, run: current.run + 1 }));
  }
  return <div className="calculation-panel" style={{ marginTop: 20 }}>
    <h3>Find possible evidence pages</h3>
    <p className="muted">Ranks nearby scope labels, values and emissions units. Totals tables receive priority; introductions, methods, factors and reduction plans receive penalties. Matches are not verified figures.</p>
    <p role="status" aria-live="polite">{status}</p>
    {error && <p className="copilot-error" role="alert">{error}</p>}
    {busy && <button type="button" className="button" onClick={() => stopRef.current?.()}>Stop scan</button>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
      <button type="button" className="button" disabled={busy || disabled} onClick={() => start("text")}>Rescan text</button>
      <button type="button" className="button" disabled={busy || disabled} onClick={() => start("sparse")}>Scan + OCR low-text pages</button>
    </div>
    <p className="info-note">OCR runs locally in English. Its engine and language files download from external hosts on first use; PDF contents are not uploaded by this scanner. Up to 20 pages receive OCR per scan. OCR can misread numbers and does not alter or repair the PDF.</p>
    <div className="review-fields">
      <label>First OCR page<input type="number" min="1" max="500" disabled={busy || disabled} value={first} onChange={e => setFirst(e.target.value)} /></label>
      <label>Last OCR page<input type="number" min="1" max="500" disabled={busy || disabled} value={last} onChange={e => setLast(e.target.value)} /></label>
    </div>
    <button type="button" className="button" disabled={busy || disabled} onClick={() => start("range")}>OCR this range, including image tables</button>
    <p className="muted">Use range OCR for pages mixing readable text and image tables. Each scan replaces the suggestions; range scans rank only that range. OCR assists page finding; Gemini still receives the selected original PDF page.</p>
    {candidates.length > 0 && <details style={{ marginTop: 16 }}>
      <summary>Possible evidence pages ({candidates.length})</summary>
      {candidates.map((candidate, index) => <article className="extracted-item" key={candidate.page}>
        <h3>PDF page {candidate.page}{index === 0 ? " · Highest-ranked possible match" : ""}</h3>
        <p className="muted">{candidate.source}</p>
        <p>{candidate.reasons.join(" · ")}</p>
        <blockquote style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{candidate.snippet}</blockquote>
      </article>)}
    </details>}
  </div>;
}
