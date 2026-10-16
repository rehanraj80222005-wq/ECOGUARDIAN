"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

const summarySchema = z.object({
  recordCount: z.number().int().nonnegative(),
  totalKwh: z.number().finite().nonnegative(),
  totalTonnesCO2e: z.number().finite().nonnegative(),
});

type Summary = z.infer<typeof summarySchema>;

export default function LiveSummary() {
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
      setError("Could not initialize the account session.");
      setChecking(false);
    }
  }, []);

  if (error) {
    return <p className="copilot-error" role="alert">{error}</p>;
  }

  if (checking || !userId) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <p className="muted">
          {checking
            ? "Checking your session…"
            : "Sign in below to view totals from your saved records."}
        </p>
      </div>
    );
  }

  // Changing accounts resets the summary and cancels old requests.
  return <SummaryCards key={userId} />;
}

function SummaryCards() {
  const [summary, setSummary] = useState<Summary | null>(null);
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
      setSummary(null);

      try {
        const response = await fetch("/api/summary", {
          cache: "no-store",
          signal: controller.signal,
        });

        const text = await response.text();
        let data;

        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`Unexpected response (HTTP ${response.status}).`);
        }

        if (!response.ok) {
          throw new Error(data?.error || "Could not load summary.");
        }

        const parsed = summarySchema.safeParse(data?.summary);

        if (!parsed.success) {
          throw new Error("The summary response has an unexpected format.");
        }

        if (active) setSummary(parsed.data);
      } catch (error: unknown) {
        if (active) {
          setError(
            error instanceof Error ? error.message : "Could not load summary."
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

  if (loading) {
    return (
      <p className="info-note" role="status" style={{ marginBottom: 24 }}>
        Loading saved totals…
      </p>
    );
  }

  if (error || !summary) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <p className="copilot-error" role="alert">
          {error || "No summary returned."}
        </p>
        <button
          type="button"
          className="remove-file"
          style={{ marginTop: 12 }}
          onClick={() => setRevision((value) => value + 1)}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <section className="stats" aria-label="All-time saved demo totals">
      <article className="card">
        <p className="muted">Saved Scope 2 demo emissions</p>
        <h2>
          {summary.totalTonnesCO2e.toLocaleString(undefined, {
            maximumFractionDigits: 6,
          })}{" "}
          <small>tCO₂e</small>
        </h2>
        <p className="muted">All saved billing periods</p>
      </article>

      <article className="card">
        <p className="muted">Saved electricity consumption</p>
        <h2>
          {summary.totalKwh.toLocaleString(undefined, {
            maximumFractionDigits: 3,
          })}{" "}
          <small>kWh</small>
        </h2>
        <p className="muted">Purchased electricity records</p>
      </article>

      <article className="card">
        <p className="muted">Saved activity records</p>
        <h2>{summary.recordCount.toLocaleString()}</h2>
        <p className="muted">
          {summary.recordCount === 0
            ? "Save your first reviewed draft below"
            : "Record count, not document count"}
        </p>
      </article>

      <article className="card">
        <p className="muted">Demonstration factor</p>
        <h2>0.5 <small>kg CO₂e/kWh</small></h2>
        <p className="warning">Fictional · Not for reporting</p>
      </article>
    </section>
  );
}