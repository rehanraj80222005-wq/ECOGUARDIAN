"use client";

import { useRef, useState } from "react";

export default function ExportRecords() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef(false);

  async function download() {
    if (pending.current) return;

    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/records/export", {
        cache: "no-store",
      });

      if (!response.ok) {
        const text = await response.text();
        let message = `Export failed (HTTP ${response.status}).`;

        try {
          const data: unknown = JSON.parse(text);

          if (
            typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof data.error === "string"
          ) {
            message = data.error;
          }
        } catch {
          // Keep the fallback message for non-JSON responses.
        }

        throw new Error(message);
      }

      if (!response.headers.get("content-type")?.includes("text/csv")) {
        throw new Error("The server returned an unexpected export format.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);

      link.href = url;
      link.download = `ecoguardian-demo-records-${date}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);

      setMessage("CSV download started. Check your browser downloads.");
    } catch (error: unknown) {
      setError(
        error instanceof Error ? error.message : "Could not export records."
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        type="button"
        className="remove-file"
        disabled={busy}
        onClick={download}
      >
        {busy ? "Preparing CSV…" : "Download CSV"}
      </button>

      <p className="muted" style={{ marginTop: 8 }}>
        Exports all your saved records, including legacy entries, up to
        10,000 rows. Emissions use the fictional demo factor.
      </p>

      <div aria-live="polite">
        {message && <p className="info-note">{message}</p>}
      </div>

      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}