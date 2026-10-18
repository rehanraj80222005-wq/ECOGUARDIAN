"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

const responseSchema = z.object({
  monthly: z.object({
    allocationMethod: z.literal("inclusive-days"),
    datedRecordCount: z.number().int().nonnegative(),
    undatedRecordCount: z.number().int().nonnegative(),
    undatedTonnesCO2e: z.number().finite().nonnegative(),
    months: z.array(
      z.object({
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        totalKwh: z.number().finite().nonnegative(),
        totalTonnesCO2e: z.number().finite().nonnegative(),
        contributingRecordCount: z.number().int().nonnegative(),
      })
    ).max(12),
  }),
});

type MonthlyData = z.infer<typeof responseSchema>["monthly"];

function format(value: number, decimals = 3) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
  });
}

function monthLabel(value: string) {
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const [year, month] = value.split("-");
  return `${names[Number(month) - 1]} ${year}`;
}

export default function MonthlyEmissions() {
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
      setError("Could not initialize the monthly chart session.");
      setChecking(false);
    }
  }, []);

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <h2>Electricity emissions over time</h2>
          <p className="muted">
            Saved records · Scope 2 demo estimates
          </p>
        </div>
        <span className="badge">Fictional factor</span>
      </div>

      {error ? (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      ) : checking ? (
        <p className="muted">Checking your session…</p>
      ) : userId ? (
        <MonthlyChart key={userId} />
      ) : (
        <p className="muted">
          Sign in to view monthly totals from your saved records.
        </p>
      )}
    </section>
  );
}

function MonthlyChart() {
  const [data, setData] = useState<MonthlyData | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    function refresh() {
      setRevision((value) => value + 1);
    }

    window.addEventListener("ecoguardian-records-changed", refresh);

    return () => {
      window.removeEventListener("ecoguardian-records-changed", refresh);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      setData(null);

      try {
        const response = await fetch("/api/monthly-emissions", {
          cache: "no-store",
          signal: controller.signal,
        });

        const text = await response.text();
        let body: unknown;

        try {
          body = JSON.parse(text);
        } catch {
          throw new Error(
            `Unexpected response (HTTP ${response.status}).`
          );
        }

        if (!response.ok) {
          const message =
            typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
              ? body.error
              : "Could not load monthly emissions.";

          throw new Error(message);
        }

        const parsed = responseSchema.safeParse(body);

        if (!parsed.success) {
          throw new Error("The monthly response has an unexpected format.");
        }

        if (active) setData(parsed.data.monthly);
      } catch (error: unknown) {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not load monthly emissions."
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

  const maximum = data
    ? Math.max(...data.months.map((month) => month.totalTonnesCO2e), 0)
    : 0;

  return (
    <>
      <button
        type="button"
        className="remove-file"
        style={{ margin: "16px 0" }}
        disabled={loading}
        onClick={() => setRevision((value) => value + 1)}
      >
        {loading ? "Loading…" : "Refresh chart"}
      </button>

      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && data && (
        <>
          {data.undatedRecordCount > 0 && (
            <div className="alert">
              <strong>
                {data.undatedRecordCount} undated record(s) excluded
              </strong>
              <p>
                {format(data.undatedTonnesCO2e, 6)} tCO₂e remains included
                in your all-time totals, but cannot be assigned to months.
              </p>
            </div>
          )}

          {data.months.length === 0 ? (
            <p className="info-note">
              Save a record with reviewed billing dates to populate this chart.
            </p>
          ) : (
            <>
              <p className="muted" style={{ margin: "16px 0" }}>
                {monthLabel(data.months[0].month)}–{" "}
                {monthLabel(data.months[data.months.length - 1].month)}.
                The window ends with your latest saved billing end date.
              </p>

              <div style={{ overflowX: "auto" }}>
                <div
                  role="img"
                  aria-label={
                    "Monthly demo electricity emissions. " +
                    "Exact values are available in the table below."
                  }
                  style={{
                    display: "flex",
                    gap: 12,
                    minWidth: 720,
                    padding: "12px 0",
                  }}
                >
                  {data.months.map((month) => {
                    const height =
                      maximum > 0
                        ? (month.totalTonnesCO2e / maximum) * 150
                        : 0;

                    return (
                      <div
                        key={month.month}
                        style={{
                          flex: 1,
                          minWidth: 48,
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            height: 185,
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "flex-end",
                            alignItems: "center",
                            borderBottom: "1px solid #dce6dc",
                          }}
                        >
                          <span style={{ fontSize: 11, marginBottom: 6 }}>
                            {month.contributingRecordCount > 0
                              ? format(month.totalTonnesCO2e, 6)
                              : "—"}
                          </span>

                          <div
                            style={{
                              height,
                              width: 28,
                              background: "#245c46",
                              borderRadius: "4px 4px 0 0",
                            }}
                          />
                        </div>

                        <p style={{ fontSize: 11, marginTop: 8 }}>
                          {monthLabel(month.month)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <p className="muted">
                Bar values are tCO₂e. “—” means no dated records overlap
                that month; it does not mean actual consumption was zero.
              </p>

              <details style={{ marginTop: 16 }}>
                <summary style={{ cursor: "pointer" }}>
                  View monthly figures
                </summary>

                <div className="table-scroll" style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Month</th>
                        <th scope="col">Allocated kWh</th>
                        <th scope="col">Demo tCO₂e</th>
                        <th scope="col">Contributing records</th>
                      </tr>
                    </thead>

                    <tbody>
                      {data.months.map((month) => (
                        <tr key={month.month}>
                          <td>{monthLabel(month.month)}</td>
                          <td>
                            {month.contributingRecordCount > 0
                              ? format(month.totalKwh)
                              : "No records"}
                          </td>
                          <td>
                            {month.contributingRecordCount > 0
                              ? format(month.totalTonnesCO2e, 6)
                              : "—"}
                          </td>
                          <td>{month.contributingRecordCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}

          <p className="info-note">
            Consumption is allocated evenly across billing days, including
            both start and end dates. Cross-month allocations are estimates,
            not measured monthly usage. Emissions use the fictional factor
            of 0.5 kg CO₂e/kWh. Overlapping or duplicate records are not
            automatically corrected.
          </p>
        </>
      )}
    </>
  );
}