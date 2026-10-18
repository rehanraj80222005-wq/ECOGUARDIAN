"use client";

import { useState } from "react";
import Copilot from "@/components/Copilot";
import DocumentUpload from "@/components/DocumentUpload";
import AuthPanel from "@/components/AuthPanel";
import SavedRecords from "@/components/SavedRecords";
import LiveSummary from "@/components/LiveSummary";


const monthlyEmissions = [
  { month: "Apr", scope1: 12, scope2: 24 },
  { month: "May", scope1: 14, scope2: 26 },
  { month: "Jun", scope1: 13, scope2: 25 },
  { month: "Jul", scope1: 18, scope2: 28 },
  { month: "Aug", scope1: 16, scope2: 23 },
  { month: "Sep", scope1: 22, scope2: 27 },
];

const documents = [
  {
    name: "September electricity bill.pdf",
    activity: "Electricity",
    quantity: "38,000 kWh",
    status: "Needs review",
  },
  {
    name: "September fleet fuel.csv",
    activity: "Diesel",
    quantity: "8,200 litres",
    status: "Anomaly flagged",
  },
  {
    name: "August electricity bill.pdf",
    activity: "Electricity",
    quantity: "32,400 kWh",
    status: "Reviewed",
  },
];

export default function Dashboard() {
const [reduction, setReduction] = useState(20);

const latest = monthlyEmissions[monthlyEmissions.length - 1];
const previous = monthlyEmissions[monthlyEmissions.length - 2];

const total = latest.scope1 + latest.scope2;
const previousTotal = previous.scope1 + previous.scope2;
const change = ((total - previousTotal) / previousTotal) * 100;
const estimatedSavings = latest.scope2 * (reduction / 100);
const projectedTotal = total - estimatedSavings;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#" className="brand">
          <span className="brand-icon" aria-hidden="true">E</span>
          EcoGuardian
        </a>

        <p className="sidebar-label">WORKSPACE</p>

        <nav aria-label="Main navigation">
          <a href="#overview">Overview</a>
          <a href="#documents">Document review</a>
          <a href="#insights">Anomaly insights</a>
          <a href="#scenarios">Scenario planner</a>
        </nav>

        <div className="sidebar-note">
          <strong>Evidence before claims.</strong>
          <p>
            Track activity, review calculations, and preserve a traceable
            record.
          </p>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <span>Workspace / Overview</span>
          <span className="badge">Demo prototype</span>
        </header>

        <section id="overview" className="page-heading">
          <div>
            <p className="eyebrow">YOUR ENVIRONMENTAL FOOTPRINT</p>
            <h1>Small actions. Measurable change.</h1>
            <p className="muted">
              Understand your emissions and identify what needs attention.
            </p>
          </div>
          <a href="#documents" className="button">Review documents ↓</a>
        </section>

        <div className="demo-notice">
  Top cards and the scenario planner use all-time totals from your saved
  demo records. The monthly chart, review queue, and document table are
  illustrative examples. All calculated emissions currently use a
  fictional factor.
</div>

        <LiveSummary />

        <div className="content-grid">
          <section className="card">
            <div className="section-heading">
              <div>
                <h2>Emissions over time</h2>
                <p className="muted">Monthly sample totals · tCO₂e</p>
              </div>
              <span className="badge">Demo workspace</span>
            </div>

            <div className="legend">
              <span><i className="scope1-dot" /> Scope 1</span>
              <span><i className="scope2-dot" /> Scope 2</span>
            </div>

            <div className="chart" aria-label="Monthly emissions chart">
              {monthlyEmissions.map((item) => (
                <div
                  className="chart-column"
                  key={item.month}
                  aria-label={`${item.month}: Scope 1 ${item.scope1},
                    Scope 2 ${item.scope2} tonnes CO2 equivalent`}
                >
                  <span className="chart-total">
                    {item.scope1 + item.scope2}
                  </span>
                  <div className="bar-stack">
                    <div
                      className="bar scope2"
                      style={{ height: `${item.scope2 * 3}px` }}
                    />
                    <div
                      className="bar scope1"
                      style={{ height: `${item.scope1 * 3}px` }}
                    />
                  </div>
                  <span className="muted">{item.month}</span>
                </div>
              ))}
            </div>
          </section>

          <section id="insights" className="card">
            <p className="eyebrow">REVIEW QUEUE</p>
            <h2>A closer look at September</h2>

            <div className="alert">
              <strong>Fleet fuel consumption increased</strong>
              <p>
                The example fuel log shows a 36.7% increase:
                8,200 litres versus a 6,000-litre baseline.
              </p>
            </div>

            <p className="muted">
              This exceeds the proposed 30% review threshold. Check billing
              dates, fleet activity, and duplicate entries before drawing
              conclusions.
            </p>

            <div className="info-note">
              Rule-based example. Gemini explanations will be connected
              in a later step.
            </div>
          </section>
        </div>

        <section id="documents" className="card section-spacing">
          <div className="section-heading">
            <div>
              <h2>Document review</h2>
              <p className="muted">
                Example records showing the review workflow.
              </p>
            </div>
            <span className="badge">3 sample documents</span>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Activity</th>
                  <th>Reported quantity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.name}>
                    <td>{document.name}</td>
                    <td>{document.activity}</td>
                    <td>{document.quantity}</td>
                    <td>
                      <span
                        className={`status ${
                          document.status === "Reviewed"
                            ? "status-reviewed"
                            : "status-review"
                        }`}
                      >
                        {document.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="scenarios" className="card section-spacing">
  <div className="section-heading">
    <div>
      <p className="eyebrow">EXPLORE THE POSSIBILITIES</p>
      <h2>What if you used less electricity?</h2>
      <p className="muted">
        Explore a reduction using your saved electricity totals.
      </p>
    </div>
  </div>

  <LiveSummary view="scenario" />
</section>
        <AuthPanel />
        <DocumentUpload />
        <SavedRecords />
        <Copilot />
        <footer>
          EcoGuardian · Pre-audit support, not audit certification.
        </footer>
      </main>
    </div>
  );
}