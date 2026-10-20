"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import SourceDetails from "@/components/SourceDetails";
import SourceCategory from "@/components/SourceCategory";



const sourcesSchema = z.object({
  sources: z.array(
    z.object({
      id: z.string().uuid(),
      original_name: z.string(),
      size_bytes: z.number().int().positive(),
      mime_type: z.string(),
      created_at: z.string().refine(
        (value) => Number.isFinite(Date.parse(value))
      ),
      saved_record_count: z.number().int().nonnegative(),
    })
  ),
});

type Source = z.infer<typeof sourcesSchema>["sources"][number];

export default function RegisteredSources() {
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
      setError("Could not initialize the source list session.");
      setChecking(false);
    }
  }, []);

  return (
    <section id="documents" className="card section-spacing">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR REGISTERED FILES</p>
          <h2>Source documents</h2>
          <p className="muted">
            Latest 20 registered sources. Original files are not stored.
          </p>
        </div>

        <a href="#upload" className="button">
          Review a bill
        </a>
      </div>

      {error ? (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      ) : checking ? (
        <p className="muted">Checking your session…</p>
      ) : userId ? (
        <SourceList key={userId} />
      ) : (
        <p className="muted">Sign in to view your source documents.</p>
      )}
    </section>
  );
}

function SourceList() {
  const [sources, setSources] = useState<Source[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    function refresh() {
      setRevision((value) => value + 1);
    }

    window.addEventListener("ecoguardian-records-changed", refresh);
    window.addEventListener("ecoguardian-sources-changed", refresh);

    return () => {
      window.removeEventListener("ecoguardian-records-changed", refresh);
      window.removeEventListener("ecoguardian-sources-changed", refresh);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/sources/list", {
          cache: "no-store",
          signal: controller.signal,
        });

        const text = await response.text();
        let data: unknown;

        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(
            `Unexpected response (HTTP ${response.status}).`
          );
        }

        if (!response.ok) {
          const message =
            typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof data.error === "string"
              ? data.error
              : "Could not load source documents.";

          throw new Error(message);
        }

        const parsed = sourcesSchema.safeParse(data);

        if (!parsed.success) {
          throw new Error("The source list has an unexpected format.");
        }

        if (active) setSources(parsed.data.sources);
      } catch (error: unknown) {
        if (active) {
          setSources([]);
          setError(
            error instanceof Error
              ? error.message
              : "Could not load source documents."
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
  }, [revision]);

  return (
    <>
      <button
        type="button"
        className="remove-file"
        style={{ margin: "16px 0" }}
        disabled={loading}
        onClick={() => setRevision((value) => value + 1)}
      >
        {loading ? "Loading…" : "Refresh sources"}
      </button>

      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && sources.length === 0 && (
        <p className="info-note">
          No sources registered yet. Select a bill below and register
          its fingerprint to get started.
        </p>
      )}

      {!loading && !error && sources.length > 0 && (
        <div className="table-scroll" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th scope="col">Registered file</th>
                <th scope="col">Size</th>
                <th scope="col">Registered on</th>
                <th scope="col">Saved activity records</th>
                <th scope="col">Status and details</th>
              </tr>
            </thead>

            <tbody>
              {sources.map((source) => (
                <tr key={source.id}>
                  <td style={{ overflowWrap: "anywhere" }}>
                    {source.original_name}
                  </td>

                  <td>
                    {(source.size_bytes / 1024).toFixed(1)} KB
                  </td>

                  <td>
                    <time dateTime={source.created_at}>
                      {new Date(source.created_at).toLocaleDateString()}
                    </time>
                  </td>

                  <td>
  <p>{source.saved_record_count.toLocaleString()}</p>

  <SourceCategory
    sourceId={source.id}
    hasRecords={source.saved_record_count > 0}
  />
</td>

                  <td>
                    <span
                      className={`status ${
                        source.saved_record_count > 0
                          ? "status-reviewed"
                          : "status-review"
                      }`}
                    >
                      {source.saved_record_count > 0
  ? "Has saved activity records"
  : "No linked activity records"}
                    </span>

                    <SourceDetails sourceId={source.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="info-note">
        Status indicates whether activity records are linked to a source.
        It does not certify the document or verify its contents.
        Legacy records without a source link are listed in Saved records.
      </p>
    </>
  );
}