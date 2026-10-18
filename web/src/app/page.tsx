"use client";

import Copilot from "@/components/Copilot";
import DocumentUpload from "@/components/DocumentUpload";
import AuthPanel from "@/components/AuthPanel";
import SavedRecords from "@/components/SavedRecords";
import LiveSummary from "@/components/LiveSummary";
import RegisteredSources from "@/components/RegisteredSources";
import MonthlyEmissions from "@/components/MonthlyEmissions";
import ReviewQueue from "@/components/ReviewQueue";
import ReportReview from "@/components/ReportReview";

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
          <a href="#insights">Review queue</a>
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
          This dashboard uses your saved records and registered sources.
          Monthly figures exclude undated records and allocate consumption
          evenly across billing days. The review queue checks for missing
          information. All calculated emissions use a fictional factor.
        </div>

        <LiveSummary />

        <div className="content-grid">
          <MonthlyEmissions />
          <ReviewQueue />
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
        <ReportReview />
        <a href="#report-review">GHG report review</a>
        <SavedRecords />
        <Copilot />

        <footer>
          EcoGuardian · Pre-audit support, not audit certification.
        </footer>
      </main>
    </div>
  );
}