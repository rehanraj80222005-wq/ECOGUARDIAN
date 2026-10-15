"use client";

import { useState } from "react";
import { z } from "zod";
import type { Extraction } from "@/lib/extraction";

const resultSchema = z.object({
  demonstration: z.literal(true),
  factor: z.object({
    id: z.string(),
    label: z.string(),
    kgCO2ePerKwh: z.number().finite().nonnegative(),
    source: z.string(),
    scope: z.literal(2),
  }),
  rows: z.array(
    z.object({
      activity: z.string(),
      quantity: z.number().finite().nonnegative(),
      unit: z.string(),
      kgCO2e: z.number().finite().nonnegative(),
      tonnesCO2e: z.number().finite().nonnegative(),
    })
  ),
  totalKgCO2e: z.number().finite().nonnegative(),
  totalTonnesCO2e: z.number().finite().nonnegative(),
});

type Result = z.infer<typeof resultSchema>;

export default function EmissionCalculation({
  items,
}: {
  items: Extraction["items"];
}) {
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function calculate() {
    if (!reviewed || loading) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewed: true,
          items,
        }),
      });

      const text = await response.text();

      if (!text.trim()) {
        throw new Error(`Empty server response (HTTP ${response.status}).`);
      }

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Invalid server response (HTTP ${response.status}).`
        );
      }

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Calculation failed."
        );
      }

      const parsed = resultSchema.safeParse(data);

      if (!parsed.success) {
        throw new Error("The server returned an unexpected result.");
      }

      setResult(parsed.data);
    } catch (error: unknown) {
      setError(
        error instanceof Error ? error.message : "Calculation failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="calculation-panel">
      <p className="eyebrow">DETERMINISTIC CALCULATION</p>
      <h2>Calculate electricity emissions</h2>

      <div className="demo-notice" style={{ marginTop: 16 }}>
        Demonstration only: uses a fictional factor of 0.5 kg CO₂e/kWh.
        Not suitable for corporate reporting.
      </div>

      <label className="review-confirmation">
        <input
          type="checkbox"
          checked={reviewed}
          disabled={loading}
          onChange={(event) => {
            setReviewed(event.target.checked);
            setResult(null);
            setError("");
          }}
        />
        <span>
          I checked the quantities and units against the source, checked
          for duplicate totals, and confirm these rows represent purchased
          electricity consumed by the organization.
        </span>
      </label>

      <button
        type="button"
        className="button extract-button"
        disabled={!reviewed || loading || items.length === 0}
        onClick={calculate}
      >
        {loading ? "Calculating…" : "Calculate demo emissions"}
      </button>

      {error && (
        <p className="copilot-error" role="alert">{error}</p>
      )}

      <div aria-live="polite" aria-busy={loading}>
        {result && (
          <div className="calculation-result">
            <p>Scope 2 · Demonstration estimate</p>

            <h2>
              {result.totalTonnesCO2e.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{" "}
              <small>tCO₂e</small>
            </h2>

            <p>
              {result.totalKgCO2e.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })}{" "}
              kg CO₂e
            </p>

            {result.rows.map((row, index) => (
              <p key={index} className="calculation-formula">
                {row.quantity.toLocaleString()} kWh ×{" "}
                {result.factor.kgCO2ePerKwh} kg CO₂e/kWh ÷ 1,000
                {" = "}
                {row.tonnesCO2e.toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                })}{" "}
                tCO₂e
              </p>
            ))}

            <p className="info-note">
              Factor: {result.factor.id}
              <br />
              Source: {result.factor.source}
              <br />
              This result has not been saved or added to the dashboard.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}