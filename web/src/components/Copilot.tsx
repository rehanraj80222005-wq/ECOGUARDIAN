"use client";

import { useState } from "react";
import type { FormEvent } from "react";

export default function Copilot() {
  const [question, setQuestion] = useState(
    "What should I check when monthly diesel consumption increases by 36.7%?"
  );
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading || !question.trim()) return;

    setLoading(true);
    setAnswer("");
    setError("");

    try {
      const response = await fetch("/api/copilot", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ question }),
});

const rawBody = await response.text();

if (!rawBody.trim()) {
  throw new Error(
    `The server returned an empty response (HTTP ${response.status}). ` +
    "Check the terminal running npm run dev."
  );
}

let data: { answer?: string; error?: string };

try {
  data = JSON.parse(rawBody);
} catch {
  throw new Error(
    `The server returned invalid JSON (HTTP ${response.status}). ` +
    "Check the Next.js terminal for a compilation or runtime error."
  );
}

if (!response.ok) {
  throw new Error(
    data.error || `The request failed (HTTP ${response.status}).`
  );
}

if (typeof data.answer !== "string" || !data.answer.trim()) {
  throw new Error("The server returned no answer.");
}

      setAnswer(data.answer);
    } catch (error: unknown) {
      setError(
        error instanceof Error ? error.message : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card section-spacing" aria-labelledby="copilot-title">
      <p className="eyebrow">POWERED BY GEMINI</p>
      <h2 id="copilot-title">Your sustainability copilot</h2>

      <p className="muted" style={{ marginTop: 8 }}>
        Ask a general question. The copilot is not connected to your
        dashboard data or documents yet.
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

        {answer && <div className="copilot-answer">{answer}</div>}
      </div>

      {error && (
        <p className="copilot-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}