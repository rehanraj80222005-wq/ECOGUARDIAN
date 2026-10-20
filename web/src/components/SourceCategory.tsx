"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";

const kindSchema = z.enum([
  "utility_bill",
  "ghg_report",
  "unclassified",
]);

const responseSchema = z.object({
  documentKind: kindSchema,
});

type Kind = z.infer<typeof kindSchema>;

async function readResponse(response: Response) {
  const body: unknown = await response.json();

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "Could not update the source category.";

    throw new Error(message);
  }

  const parsed = responseSchema.safeParse(body);

  if (!parsed.success) {
    throw new Error("Unexpected category response.");
  }

  return parsed.data.documentKind;
}

export default function SourceCategory({
  sourceId,
  hasRecords,
}: {
  sourceId: string;
  hasRecords: boolean;
}) {
  const [kind, setKind] = useState<Kind>("unclassified");
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;

    setBusy(true);
    setReady(false);
    setError("");
    setMessage("");

    async function load() {
      try {
        const response = await fetch(
          `/api/sources/category?sourceId=${encodeURIComponent(sourceId)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const loadedKind = await readResponse(response);

        if (!controller.signal.aborted) {
          setKind(loadedKind);
          setReady(true);
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not load category."
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

    void load();

    return () => {
      controller.abort();
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [sourceId]);

  async function changeCategory(nextKind: Kind) {
    if (!ready || requestRef.current || nextKind === kind) return;

    const controller = new AbortController();
    requestRef.current = controller;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/sources/category", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId,
          documentKind: nextKind,
        }),
        signal: controller.signal,
      });

      const savedKind = await readResponse(response);

      if (
        controller.signal.aborted ||
        requestRef.current !== controller
      ) {
        return;
      }

      setKind(savedKind);
      setMessage("Category saved.");

      window.dispatchEvent(
        new Event("ecoguardian-sources-changed")
      );
    } catch (error: unknown) {
      if (
        !controller.signal.aborted &&
        requestRef.current === controller
      ) {
        setError(
          error instanceof Error
            ? error.message
            : "Could not save category."
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
    <div>
      <label>
        Source category
        <select
          value={kind}
          disabled={busy || !ready}
          onChange={(event) => {
            const parsed = kindSchema.safeParse(event.target.value);
            if (parsed.success) void changeCategory(parsed.data);
          }}
        >
          <option value="unclassified">Unclassified</option>
          <option value="utility_bill">Utility bill</option>
          <option value="ghg_report" disabled={hasRecords}>
            GHG report
          </option>
        </select>
      </label>

      {busy && <p className="muted">Loading or saving category…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p className="copilot-error" role="alert">{error}</p>}
    </div>
  );
}