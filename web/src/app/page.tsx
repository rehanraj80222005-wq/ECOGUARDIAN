"use client";

import Copilot from "@/components/Copilot";
import DocumentUpload from "@/components/DocumentUpload";
import AuthPanel from "@/components/AuthPanel";
import SavedRecords from "@/components/SavedRecords";
import LiveSummary from "@/components/LiveSummary";
import RegisteredSources from "@/components/RegisteredSources";
import MonthlyEmissions from "@/components/MonthlyEmissions";

export default function Dashboard() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#overview" className="brand">
          <span className="brand-icon" aria-hidden="true">
            E
          </span>
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

          <a href="#documents" className="button">
            Review documents ↓
          </a>
        </section>

        <div className="demo-notice">
          Summary cards, the monthly chart, source documents, saved records,
          and the scenario planner use your saved data. The review queue
          remains an illustrative example. Monthly figures exclude undated
          records and allocate consumption evenly across billing days.
          All calculated emissions use a fictional factor.
        </div>

        <LiveSummary />

        <div className="content-grid">
          <MonthlyEmissions />

          <section id="insights" className="card">
            <p className="eyebrow">SAMPLE REVIEW QUEUE</p>
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
              Illustrative example, not calculated from your saved records.
              Gemini explanations will be connected in a later step.
            </div>
          </section>
        </div>

        <RegisteredSources />

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