"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

const answerSchema = z.object({
  answer: z.string().trim().min(1),
  contextLoadedAt: z.string().refine(
    (value) => Number.isFinite(Date.parse(value))
  ),
});

export default function Copilot() {
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
      setError("Could not initialize the copilot session.");
      setChecking(false);
    }
  }, []);

  return (
    <section className="card section-spacing" aria-labelledby="copilot-title">
      <p className="eyebrow">POWERED BY GEMINI</p>
      <h2 id="copilot-title">Your sustainability copilot</h2>

      <p className="muted" style={{ marginTop: 8 }}>
        Ask about your saved electricity totals and review counts.
        Original bills and individual record details are not included.
      </p>

      {error ? (
        <p className="copilot-error" role="alert">{error}</p>
      ) : checking ? (
        <p className="muted">Checking your session…</p>
      ) : userId ? (
        <CopilotForm key={userId} />
      ) : (
        <p className="info-note">Please sign in to use the copilot.</p>
      )}
    </section>
  );
}

function CopilotForm() {
  const [question, setQuestion] = useState(
    "Summarize my saved electricity totals and explain what needs review."
  );
  const [answer, setAnswer] = useState("");
  const [loadedAt, setLoadedAt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    function clearAnswer() {
      requestVersion.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      setAnswer("");
      setLoadedAt("");
      setError("");
      setLoading(false);
    }

    window.addEventListener("ecoguardian-records-changed", clearAnswer);
    window.addEventListener("ecoguardian-sources-changed", clearAnswer);

    return () => {
      requestVersion.current += 1;
      controllerRef.current?.abort();
      window.removeEventListener("ecoguardian-records-changed", clearAnswer);
      window.removeEventListener("ecoguardian-sources-changed", clearAnswer);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (controllerRef.current || !question.trim()) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    const version = ++requestVersion.current;

    setLoading(true);
    setAnswer("");
    setLoadedAt("");
    setError("");

    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
        signal: controller.signal,
      });

      const text = await response.text();
      let body: unknown;

      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(
          `Unexpected server response (HTTP ${response.status}).`
        );
      }

      if (!response.ok) {
        const message =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : `Request failed (HTTP ${response.status}).`;

        throw new Error(message);
      }

      const parsed = answerSchema.safeParse(body);

      if (!parsed.success) {
        throw new Error("The server returned an unexpected answer format.");
      }

      if (version === requestVersion.current) {
        setAnswer(parsed.data.answer);
        setLoadedAt(parsed.data.contextLoadedAt);
      }
    } catch (error: unknown) {
      if (version === requestVersion.current) {
        setError(
          error instanceof Error ? error.message : "Something went wrong."
        );
      }
    } finally {
      if (version === requestVersion.current) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <>
      <p className="info-note">
        Clicking Ask sends your question, saved aggregate electricity totals,
        and review counts to Google Gemini. It uses your Gemini quota.
        No source files are sent by this feature.
      </p>

      <form onSubmit={handleSubmit} className="copilot-form">
        <label htmlFor="copilot-question">Your question</label>

        <textarea
          id="copilot-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={2000}
          rows={3}
          required
          disabled={loading}
        />

        <button
          className="button"
          type="submit"
          disabled={loading || !question.trim()}
        >
          {loading ? "Asking Gemini…" : "Ask EcoGuardian"}
        </button>
      </form>

      <div aria-live="polite" aria-busy={loading}>
        {loading && <p className="muted">Preparing your answer…</p>}

        {answer && (
          <>
            <div
              className="copilot-answer"
              style={{ whiteSpace: "pre-wrap" }}
            >
              {answer}
            </div>

            <p className="muted" style={{ marginTop: 8 }}>
              Saved summaries loaded at{" "}
              {new Date(loadedAt).toLocaleString()}.
              Answers can contain mistakes; check the dashboard figures.
            </p>
          </>
        )}
      </div>

      {error && (
        <p className="copilot-error" role="alert">{error}</p>
      )}
    </>
  );
}