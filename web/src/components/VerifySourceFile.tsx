"use client";

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";

const MAX_BYTES = 10 * 1024 * 1024;

type Result = {
  filename: string;
  matches: boolean;
};

export default function VerifySourceFile({
  expectedHash,
}: {
  expectedHash: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function verify(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || pending.current) return;

    setResult(null);
    setError("");

    if (file.size === 0 || file.size > MAX_BYTES) {
      setError("Choose a non-empty file no larger than 10 MB.");
      return;
    }

    if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
      setError("The registered fingerprint is invalid.");
      return;
    }

    if (!window.crypto?.subtle) {
      setError("File verification requires a secure HTTPS connection.");
      return;
    }

    pending.current = true;
    setBusy(true);

    try {
      const bytes = await file.arrayBuffer();
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);

      const actualHash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      setResult({
        filename: file.name,
        matches: actualHash === expectedHash.toLowerCase(),
      });
    } catch {
      setError("Could not read or fingerprint this file. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 16,
        borderTop: "1px solid #dce6dc",
      }}
    >
      <h4>Verify file match</h4>

      <p className="muted" style={{ margin: "8px 0" }}>
        Select a file to compare with this registered fingerprint.
        The file stays in your browser.
      </p>

      <label style={{ display: "block" }}>
        Choose a file · Maximum 10 MB
        <input
          type="file"
          disabled={busy}
          onChange={verify}
          style={{
            display: "block",
            marginTop: 8,
            maxWidth: "100%",
          }}
        />
      </label>

      <div aria-live="polite" aria-busy={busy}>
        {busy && (
          <p className="muted" style={{ marginTop: 12 }}>
            Comparing fingerprints…
          </p>
        )}

        {result && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              background: result.matches ? "#edf6e9" : "#fff3e5",
              overflowWrap: "anywhere",
            }}
          >
            <strong>
              {result.matches ? "Exact file match" : "Different file"}
            </strong>

            <p style={{ marginTop: 6 }}>{result.filename}</p>

            <p style={{ marginTop: 6 }}>
              {result.matches
                ? "This file’s SHA-256 fingerprint matches the registered fingerprint."
                : "This file’s contents do not match the registered fingerprint. Check that you selected the original file."}
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}

      <p className="muted" style={{ marginTop: 12 }}>
        Renaming a file does not change its fingerprint. Editing or
        re-exporting it can. A match does not verify the accuracy of
        the bill or its entered quantities.
      </p>
    </div>
  );
}