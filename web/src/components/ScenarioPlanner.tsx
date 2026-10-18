"use client";

import { useState } from "react";

type Props = {
  recordCount: number;
  totalKwh: number;
  totalTonnesCO2e: number;
};

function format(value: number, decimals = 3) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
  });
}

export default function ScenarioPlanner({
  recordCount,
  totalKwh,
  totalTonnesCO2e,
}: Props) {
  const [reduction, setReduction] = useState(20);

  const fraction = reduction / 100;
  const savedKwh = totalKwh * fraction;
  const projectedKwh = totalKwh * (1 - fraction);
  const avoidedEmissions = totalTonnesCO2e * fraction;
  const projectedEmissions = totalTonnesCO2e * (1 - fraction);

  if (recordCount === 0) {
    return (
      <p className="info-note">
        Save a reviewed electricity record to try the scenario planner.
      </p>
    );
  }

  return (
    <>
      <p className="muted" style={{ marginBottom: 16 }}>
        Based on {recordCount.toLocaleString()} saved activity records
        across all saved billing periods. This includes legacy records.
      </p>

      <div className="demo-notice">
        Demonstration only: uses the fictional factor of 0.5 kg CO₂e/kWh.
        This is a what-if estimate, not a forecast or a reporting result.
      </div>

      <div className="scenario-grid">
        <div>
          <p style={{ marginBottom: 12 }}>
            Saved baseline: <strong>{format(totalKwh)} kWh</strong>
            {" · "}
            <strong>{format(totalTonnesCO2e, 6)} tCO₂e</strong>
          </p>

          <label htmlFor="saved-electricity-reduction">
            Electricity consumption reduction:{" "}
            <strong>{reduction}%</strong>
          </label>

          <input
            id="saved-electricity-reduction"
            type="range"
            min="0"
            max="100"
            step="5"
            value={reduction}
            onChange={(event) =>
              setReduction(Number(event.target.value))
            }
          />

          <p className="muted">
            Applies the same reduction to all saved electricity consumption,
            with the emission factor held constant. Other emissions are
            outside this calculation.
          </p>
        </div>

        <div className="scenario-result" aria-live="polite">
          <p>Projected electricity emissions · all saved periods</p>

          <strong>
            {format(projectedEmissions, 6)} <small>tCO₂e</small>
          </strong>

          <p>
            {format(avoidedEmissions, 6)} tCO₂e estimated reduction
          </p>

          <p style={{ marginTop: 12 }}>
            Projected consumption: {format(projectedKwh)} kWh
          </p>

          <p>Consumption reduction: {format(savedKwh)} kWh</p>
        </div>
      </div>

      <p className="info-note">
        Moving this slider does not change saved records or dashboard totals.
        Any duplicate legacy entries in your saved totals also affect this
        estimate.
      </p>
    </>
  );
}