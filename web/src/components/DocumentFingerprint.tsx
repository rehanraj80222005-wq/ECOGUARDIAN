"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";

const fingerprintSchema = z.object({
  algorithm: z.literal("SHA-256"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive(),
  documentId: z.string().uuid(),
  alreadyRegistered: z.boolean(),
});

type Fingerprint = z.infer<typeof fingerprintSchema>;

export default function DocumentFingerprint({
  file,
  onRegistered,
}: {
  file: File;
  onRegistered: (documentId: string) => void;
}) {
  const [result, setResult] = useState<Fingerprint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  async function fingerprint() {
    if (requestRef.current) return;

    const controller = new AbortController();
    requestRef.current = controller;

    setBusy(true);
    setError("");
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const response = await fetch("/api/fingerprint", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

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
            : "Fingerprinting failed.";

        throw new Error(message);
      }

      const parsed = fingerprintSchema.safeParse(data);

      if (!parsed.success || parsed.data.sizeBytes !== file.size) {
        throw new Error("The fingerprint response could not be validated.");
      }

      if (
        controller.signal.aborted ||
        requestRef.current !== controller
      ) {
        return;
      }

      setResult(parsed.data);
      onRegistered(parsed.data.documentId);
    } catch (error: unknown) {
      if (
        !controller.signal.aborted &&
        requestRef.current === controller
      ) {
        setError(
          error instanceof Error ? error.message : "Fingerprinting failed."
        );
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;

        if (!controller.signal.aborted) {
          setBusy(false);
        }
      }
    }
  }

  return (
    <div className="calculation-panel">
      <h3>Source-file fingerprint</h3>

      <p className="muted">
        Registers this file’s name, size, type, and fingerprint in your
        account. The original file is not stored, and Gemini is not called.
      </p>

      <button
        type="button"
        className="button extract-button"
        disabled={busy}
        onClick={fingerprint}
      >
        {busy ? "Registering…" : "Register source fingerprint"}
      </button>

      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}

      <div aria-live="polite" aria-busy={busy}>
        {result && (
          <div className="calculation-result">
            <p role="status">
              <strong>
                {result.alreadyRegistered
                  ? "This file is already registered in your account."
                  : "Source fingerprint registered successfully."}
              </strong>
            </p>

            <p style={{ overflowWrap: "anywhere", marginTop: 8 }}>
              Source document ID: {result.documentId}
            </p>

            <p>
              <strong>{result.algorithm}</strong>
            </p>

            <code
              style={{
                display: "block",
                overflowWrap: "anywhere",
                margin: "12px 0",
              }}
            >
              {result.sha256}
            </code>

            <p>{result.sizeBytes.toLocaleString()} bytes</p>

            <p className="info-note">
              This identifies the file’s contents. It does not prove the
              bill is authentic or its claims are true.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}