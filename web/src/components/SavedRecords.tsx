"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import SourceDetails from "@/components/SourceDetails";
import ExportRecords from "@/components/ExportRecords";

const recordsSchema = z.object({
  records: z.array(
    z.object({
      id: z.string().uuid(),
      created_at: z.string(),
      supplier: z.string().nullable(),
      billing_period: z.string().nullable(),
      quantity: z.number().finite().nonnegative(),
      unit: z.string(),
      tonnes_co2e: z.number().finite().nonnegative(),
      is_demo: z.boolean(),
      source_document_id: z.string().uuid().nullable(),
    })
  ),
});

type RecordRow = z.infer<typeof recordsSchema>["records"][number];

export default function SavedRecords() {
  const [userId, setUserId] = useState<string | null>(null);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    try {
      const { data } = createClient().auth.onAuthStateChange(
        (_event, session) => {
          setUserId(session?.user.id ?? null);
        }
      );

      return () => data.subscription.unsubscribe();
    } catch {
      setAuthError("Could not initialize the records session.");
    }
  }, []);

  return (
    <section className="card section-spacing">
      <p className="eyebrow">YOUR SAVED DATA</p>
      <h2>Saved records</h2>

      {authError ? (
        <p className="copilot-error" role="alert">
          {authError}
        </p>
      ) : userId ? (
        <RecordList key={userId} />
      ) : (
        <p className="muted">Sign in to view your records.</p>
      )}
    </section>
  );
}

function RecordList() {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    function refresh() {
      setRevision((value) => value + 1);
    }

    window.addEventListener("ecoguardian-records-changed", refresh);

    return () =>
      window.removeEventListener("ecoguardian-records-changed", refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/records", {
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
              : "Could not load records.";

          throw new Error(message);
        }

        const parsed = recordsSchema.safeParse(data);

        if (!parsed.success) {
          throw new Error(
            "The records response has an unexpected format."
          );
        }

        if (active) {
          setRecords(parsed.data.records);
        }
      } catch (error: unknown) {
        if (active) {
          setRecords([]);
          setError(
            error instanceof Error
              ? error.message
              : "Could not load records."
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
      <p className="muted">
        Latest 50 records. All current records use a fictional demo factor.
      </p>

      <button
        className="remove-file"
        type="button"
        disabled={loading}
        style={{ margin: "16px 0" }}
        onClick={() => setRevision((value) => value + 1)}
      >
        {loading ? "Loading…" : "Refresh records"}
      </button>
<ExportRecords />
      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && records.length === 0 && (
        <p className="info-note">You have no saved records yet.</p>
      )}

      {!loading && !error && records.length > 0 && (
        <>
          <div className="table-scroll" style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col">Billing period</th>
                  <th scope="col">Consumption</th>
                  <th scope="col">Demo emissions</th>
                  <th scope="col">Source reference</th>
                </tr>
              </thead>

              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{record.supplier || "Not provided"}</td>

                    <td>{record.billing_period || "Not provided"}</td>

                    <td>
                      {record.quantity.toLocaleString()} {record.unit}
                    </td>

                    <td>
                      {record.tonnes_co2e.toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })}{" "}
                      tCO₂e
                    </td>

                    <td style={{ minWidth: 180 }}>
                      {record.source_document_id ? (
                        <>
                          <strong>Linked source</strong>
                          <code
                            style={{
                              display: "block",
                              marginTop: 6,
                              maxWidth: 260,
                              overflowWrap: "anywhere",
                              whiteSpace: "normal",
                              fontSize: 12,
                            }}
                          >
                            {record.source_document_id}
                          </code>
                          <SourceDetails sourceId={record.source_document_id} />
                        </>
                      ) : (
                        <>
                          <strong>Legacy record</strong>
                          <span
                            className="muted"
                            style={{
                              display: "block",
                              marginTop: 6,
                            }}
                          >
                            No source linked
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="info-note">
            Linked source IDs identify registered file fingerprints.
            They do not verify the accuracy of the bill or its entered
            quantities. Original files are not stored.
          </p>
        </>
      )}
    </>
  );
}