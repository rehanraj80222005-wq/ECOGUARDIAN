"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

const responseSchema = z.object({
  review: z.object({
    undatedRecordCount: z.number().int().nonnegative(),
    unlinkedRecordCount: z.number().int().nonnegative(),
    sourcesWithoutRecordsCount: z.number().int().nonnegative(),
  }),
});

type Review = z.infer<typeof responseSchema>["review"];

export default function ReviewQueue() {
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
      setError("Could not initialize the review session.");
      setChecking(false);
    }
  }, []);

  return (
    <section id="insights" className="card">
      <p className="eyebrow">REVIEW QUEUE</p>
      <h2>Records needing attention</h2>

      {error ? (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      ) : checking ? (
        <p className="muted">Checking your session…</p>
      ) : userId ? (
        <ReviewItems key={userId} />
      ) : (
        <p className="muted">
          Sign in to view checks on your saved records.
        </p>
      )}
    </section>
  );
}

function ReviewItems() {
  const [review, setReview] = useState<Review | null>(null);
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
      setReview(null);

      try {
        const response = await fetch("/api/review-summary", {
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
              : "Could not load the review queue.";

          throw new Error(message);
        }

        const parsed = responseSchema.safeParse(body);

        if (!parsed.success) {
          throw new Error("The review response has an unexpected format.");
        }

        if (active) setReview(parsed.data.review);
      } catch (error: unknown) {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not load the review queue."
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

  const hasFindings =
    review !== null &&
    (
      review.undatedRecordCount > 0 ||
      review.unlinkedRecordCount > 0 ||
      review.sourcesWithoutRecordsCount > 0
    );

  return (
    <>
      <button
        type="button"
        className="remove-file"
        style={{ margin: "16px 0" }}
        disabled={loading}
        onClick={() => setRevision((value) => value + 1)}
      >
        {loading ? "Loading…" : "Refresh checks"}
      </button>

      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && review && (
        <>
          {review.undatedRecordCount > 0 && (
            <div className="alert">
              <strong>
                {review.undatedRecordCount} record(s) missing billing dates
              </strong>
              <p>
                These records remain in all-time totals but are excluded
                from the monthly chart. Dates need to be checked against
                their sources before they can be assigned.
              </p>
            </div>
          )}

          {review.unlinkedRecordCount > 0 && (
            <div className="alert">
              <strong>
                {review.unlinkedRecordCount} record(s) without a source link
              </strong>
              <p>
                These legacy records cannot be traced to a registered
                file through the app. They remain included in your saved
                totals.
              </p>
            </div>
          )}

          {review.sourcesWithoutRecordsCount > 0 && (
            <div className="alert">
              <strong>
                {review.sourcesWithoutRecordsCount} source(s) without
                saved activity records
              </strong>
              <p>
                Their fingerprints are registered, but no emissions have
                been saved for them. This may be intentional.
              </p>
              <a href="#documents">View source documents</a>
            </div>
          )}

          {!hasFindings && (
            <p className="info-note">
              No missing dates, missing source links, or sources without
              saved activity records were found.
            </p>
          )}

          <p className="info-note">
            These checks identify missing information, not unusual
            consumption or verified errors. Categories can overlap.
            No records are changed automatically.
          </p>
        </>
      )}
    </>
  );
}