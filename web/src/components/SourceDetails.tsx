"use client";

import { useEffect, useId, useState } from "react";
import { z } from "zod";
import VerifySourceFile from "@/components/VerifySourceFile";

const sourceSchema = z.object({
  source: z.object({
    id: z.string().uuid(),
    original_name: z.string(),
    size_bytes: z.number().int().positive(),
    mime_type: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    created_at: z.string().refine(
      (value) => Number.isFinite(Date.parse(value)),
      "Invalid registration date"
    ),
  }),
});

type Source = z.infer<typeof sourceSchema>["source"];

export default function SourceDetails({
  sourceId,
}: {
  sourceId: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        className="remove-file"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide source details" : "View source details"}
      </button>

      <div id={panelId} hidden={!open}>
        {open && <SourcePanel key={sourceId} sourceId={sourceId} />}
      </div>
    </div>
  );
}

function SourcePanel({ sourceId }: { sourceId: string }) {
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setLoading(true);
      setSource(null);
      setError("");

      try {
        const response = await fetch(
          `/api/sources?id=${encodeURIComponent(sourceId)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const text = await response.text();
        let data: unknown;

        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(
            `Unexpected server response (HTTP ${response.status}).`
          );
        }

        if (!response.ok) {
          const message =
            typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof data.error === "string"
              ? data.error
              : "Could not load source details.";

          throw new Error(message);
        }

        const parsed = sourceSchema.safeParse(data);

        if (!parsed.success) {
          throw new Error("The source response has an unexpected format.");
        }

        if (parsed.data.source.id !== sourceId) {
          throw new Error("The returned source does not match this record.");
        }

        if (active) {
          setSource(parsed.data.source);
        }
      } catch (error: unknown) {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not load source details."
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
  }, [sourceId, revision]);

  return (
    <div
      aria-live="polite"
      aria-busy={loading}
      style={{
        marginTop: 12,
        padding: 14,
        border: "1px solid #dce6dc",
        borderRadius: 8,
        background: "#f8fbf6",
        minWidth: 220,
        maxWidth: 360,
        whiteSpace: "normal",
        overflowWrap: "anywhere",
      }}
    >
      {loading && <p className="muted">Loading source details…</p>}

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

      {!loading && source && (
        <>
          <dl style={{ margin: 0 }}>
            <dt>
              <strong>Registered filename</strong>
            </dt>
            <dd style={{ margin: "4px 0 12px" }}>
              {source.original_name}
            </dd>

            <dt>
              <strong>File size</strong>
            </dt>
            <dd style={{ margin: "4px 0 12px" }}>
              {source.size_bytes.toLocaleString()} bytes (
              {(source.size_bytes / 1024).toFixed(1)} KB)
            </dd>

            <dt>
              <strong>File type</strong>
            </dt>
            <dd style={{ margin: "4px 0 12px" }}>
              {source.mime_type}
            </dd>

            <dt>
              <strong>Registered on</strong>
            </dt>
            <dd style={{ margin: "4px 0 12px" }}>
              <time dateTime={source.created_at}>
                {new Date(source.created_at).toLocaleString()}
              </time>
              <span className="muted"> (your local time)</span>
            </dd>

            <dt>
              <strong>SHA-256 fingerprint</strong>
            </dt>
            <dd style={{ margin: "4px 0 12px" }}>
              <code
                style={{
                  fontSize: 12,
                  whiteSpace: "normal",
                  overflowWrap: "anywhere",
                }}
              >
                {source.sha256}
              </code>
            </dd>
          </dl>
          <VerifySourceFile
  key={source.sha256}
  expectedHash={source.sha256}
/>

          <p className="muted">
            Metadata only. The original file is not stored. A fingerprint
            identifies file contents; it does not prove the bill is accurate.
          </p>
        </>
      )}
    </div>
  );
}