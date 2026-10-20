"use client";

import { useEffect, useRef, useState } from "react";
import Copilot from "@/components/Copilot";
import DocumentUpload from "@/components/DocumentUpload";
import AuthPanel from "@/components/AuthPanel";
import SavedRecords from "@/components/SavedRecords";
import LiveSummary from "@/components/LiveSummary";
import RegisteredSources from "@/components/RegisteredSources";
import MonthlyEmissions from "@/components/MonthlyEmissions";
import ReviewQueue from "@/components/ReviewQueue";
import ReportReview from "@/components/ReportReview";

const sections = [
  { id: "overview", label: "Overview", title: "Your electricity workspace", description: "Review saved activity, follow monthly estimates, and identify missing information." },
  { id: "bills", label: "Utility bills", title: "From a bill to a reviewed record", description: "Upload a source, check its consumption, and save a bill-based demo estimate." },
  { id: "reports", label: "GHG reports", title: "Review reported emissions", description: "Read figures from selected report pages and compare each result with its source." },
  { id: "sources", label: "Source documents", title: "Trace your registered sources", description: "Inspect registered file metadata and links to saved activity records." },
  { id: "records", label: "Saved activity", title: "Your saved activity records", description: "Review bill-based records, correct billing dates, and export your data." },
  { id: "scenario", label: "Scenario planner", title: "Explore lower electricity use", description: "Model a reduction against your saved electricity totals using the demo factor." },
  { id: "copilot", label: "Copilot", title: "Ask about your workspace", description: "Explore your saved electricity totals and review checks with Gemini." },
  { id: "account", label: "Account", title: "Manage your account", description: "Sign in, sign out, or set your password." },
] as const;

type SectionId = (typeof sections)[number]["id"];

export default function Dashboard() {
  const [active, setActive] = useState<SectionId>("overview");
  const heading = useRef<HTMLHeadingElement>(null);
  const current = sections.find((section) => section.id === active)!;

  useEffect(() => {
    function followHash() {
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (!id) {
        setActive("overview");
        return;
      }
      // Existing links inside the components still reveal their destination.
      const target = document.getElementById(id);
      const panel = target?.closest<HTMLElement>("[data-workspace-section]");
      const sectionId = panel?.dataset.workspaceSection;
      if (sections.some((section) => section.id === sectionId)) {
        setActive(sectionId as SectionId);
      }
    }
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, []);

  useEffect(() => {
    // Run after the selected panel has become visible.
    const frame = requestAnimationFrame(() => {
      let id = "";
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (id.startsWith("workspace-")) {
        heading.current?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "instant" });
      } else if (id) {
        document.getElementById(id)?.scrollIntoView({ block: "start" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div className="app-shell workspace-shell">
      <a href="#workspace-heading" className="workspace-skip">Skip to content</a>
      <aside className="sidebar">
        <a href="#workspace-overview" className="brand">
          <span className="brand-icon" aria-hidden="true">E</span>
          EcoGuardian
        </a>
        <p className="sidebar-label">WORKSPACE</p>
        <nav aria-label="Main navigation" className="workspace-nav">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#workspace-${section.id}`}
              aria-current={active === section.id ? "page" : undefined}
            >
              {section.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <strong>Evidence before claims.</strong>
          <p>Review the source, check the figures, and preserve a traceable record.</p>
        </div>
      </aside>

      <main className="workspace-main">
        <header className="topbar">
          <span>Workspace / {current.label}</span>
          <div className="workspace-top-actions">
            <span className="badge">Demo prototype</span>
            <a href="#workspace-account">Account</a>
          </div>
        </header>
        <div className="page-heading">
          <div>
            <p className="eyebrow">EVIDENCE-LED EMISSIONS REVIEW</p>
            <h1 id="workspace-heading" tabIndex={-1} ref={heading}>{current.title}</h1>
            <p className="muted">{current.description}</p>
          </div>
        </div>

        {/* Keep components mounted so navigation preserves in-progress drafts. */}
        <section id="workspace-overview" data-workspace-section="overview" hidden={active !== "overview"} aria-label="Overview" className="workspace-panel">
          <div id="overview">
            <div className="demo-notice">
              <strong>Bill-based demo estimates.</strong> Dashboard totals use saved electricity activity and a fictional factor of 0.5 kg CO₂e/kWh. They exclude figures extracted from GHG reports and are not suitable for corporate reporting.
            </div>
            <LiveSummary />
            <div className="workspace-start-grid">
              <a href="#workspace-bills" className="workspace-start-card">
                <span className="eyebrow">ACTIVITY DATA</span>
                <strong>Review a utility bill <span aria-hidden="true">→</span></strong>
                <span>Check consumption, calculate a demo estimate, and save reviewed activity.</span>
              </a>
              <a href="#workspace-reports" className="workspace-start-card">
                <span className="eyebrow">REPORTED FIGURES</span>
                <strong>Review a GHG report <span aria-hidden="true">→</span></strong>
                <span>Extract reported Scope 1, 2, and 3 figures separately from activity totals.</span>
              </a>
            </div>
            <div className="content-grid">
              <MonthlyEmissions />
              <div className="workspace-review">
                <ReviewQueue />
                <p className="workspace-context">A source without saved activity is not necessarily an error. A registered GHG report may have no utility-bill activity. These checks do not yet classify documents by purpose.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="workspace-bills" data-workspace-section="bills" hidden={active !== "bills"} aria-label="Utility bills" className="workspace-panel">
          <div className="workspace-context">Use a utility bill containing consumption such as kWh. Check quantities and units against the source before saving. <a href="#workspace-records">View saved activity →</a></div>
          <DocumentUpload />
        </section>

        <section id="workspace-reports" data-workspace-section="reports" hidden={active !== "reports"} aria-label="GHG reports" className="workspace-panel">
          <div className="workspace-context">These are figures reported by the document, not calculations made by EcoGuardian. Results remain unsaved drafts and are lost on refresh. Switching workspace sections preserves the current draft.</div>
          <ReportReview />
        </section>

        <section id="workspace-sources" data-workspace-section="sources" hidden={active !== "sources"} aria-label="Source documents" className="workspace-panel">
          <div className="workspace-context">Fingerprints identify registered files; they do not verify their contents. Original files are not stored. Activity counts refer to bill-based records, so a GHG report may legitimately have none.</div>
          <RegisteredSources />
        </section>

        <section id="workspace-records" data-workspace-section="records" hidden={active !== "records"} aria-label="Saved bill-based activity" className="workspace-panel">
          <div className="workspace-context">This list contains saved activity and demo calculations. Extracted GHG report figures are separate and are not saved here.</div>
          <SavedRecords />
        </section>

        <section id="workspace-scenario" data-workspace-section="scenario" hidden={active !== "scenario"} aria-label="Scenario planner" className="workspace-panel">
          <section id="scenarios" className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">EXPLORE THE POSSIBILITIES</p>
                <h2>What if you used less electricity?</h2>
                <p className="muted">A hypothetical reduction using saved electricity activity and the fictional demo factor. This does not change saved records.</p>
              </div>
            </div>
            <LiveSummary view="scenario" />
          </section>
        </section>

        <section id="workspace-copilot" data-workspace-section="copilot" hidden={active !== "copilot"} aria-label="Copilot" className="workspace-panel">
          <div className="workspace-context">The copilot uses saved electricity summaries and review checks. It does not receive your original documents or the unsaved figures in GHG report review.</div>
          <Copilot />
        </section>

        <section id="workspace-account" data-workspace-section="account" hidden={active !== "account"} aria-label="Account" className="workspace-panel">
          <AuthPanel />
        </section>
        <footer>EcoGuardian · Pre-audit support, not audit certification.</footer>
      </main>
    </div>
  );
}
