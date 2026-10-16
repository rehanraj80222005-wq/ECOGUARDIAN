import "server-only";

import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/require-user";
function jsonResponse(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function redactSecrets(message: string, apiKey: string) {
  return message
    .split(apiKey)
    .join("[REDACTED]")
    .replace(/AIza[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(
      /([?&](?:key|api_key)=)[^&\s"']+/gi,
      "$1[REDACTED]"
    );
}

export async function POST(request: Request) {
  const auth = await requireUser();

if (!auth.ok) {
  return auth.response;
}
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  // Read the model from .env.local. Use the original model only as fallback.
  const model =
    process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";

  if (!apiKey) {
    return jsonResponse(
      {
        error:
          "Add GEMINI_API_KEY to web/.env.local and restart the server.",
      },
      503
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "The request must contain valid JSON." },
      400
    );
  }

  const question =
    typeof body === "object" &&
    body !== null &&
    "question" in body &&
    typeof body.question === "string"
      ? body.question.trim()
      : "";

  if (!question || question.length > 2000) {
    return jsonResponse(
      { error: "Enter a question between 1 and 2,000 characters." },
      400
    );
  }

  const startedAt = Date.now();

  console.log("Gemini requested model:", JSON.stringify(model));

  try {
    const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    timeout: 45_000,
    retryOptions: {
      attempts: 1,
    },
  },
});
    const response = await ai.models.generateContent({
      model,
      contents: question,
      config: {
        systemInstruction: `
You are EcoGuardian's sustainability assistant.

Explain energy consumption, emissions accounting, and document review
in clear, practical language.

This is an early prototype. You have NO access to the dashboard,
uploaded documents, database, or actual company records.
Never imply that you have reviewed them.

Treat figures supplied by the user as unverified.
Distinguish possible explanations from established causes.
Do not invent emission factors, citations, or legal compliance claims.
Do not claim to provide audit certification.

Keep answers concise. Use plain text with short paragraphs.
        `.trim(),
        maxOutputTokens: 2048,
      },
    });

    const answer = response.text?.trim();

    if (!answer) {
      return jsonResponse(
        {
          error:
            "Gemini returned no text. Try rephrasing your question.",
        },
        502
      );
    }

    console.log("Gemini request succeeded:", {
      model,
      elapsedMs: Date.now() - startedAt,
    });

    return jsonResponse({ answer });
  } catch (error: unknown) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : undefined;

    const errorName =
      error instanceof Error ? error.name : "UnknownError";

    const rawMessage =
      error instanceof Error
        ? error.message
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
          ? error.message
          : "No provider message available.";

    // Diagnostic details stay in the server terminal.
    // Never log the client instance, API key, or entire error object.
    console.error("Gemini provider message:", 
      redactSecrets(rawMessage, apiKey)
    );

    console.error("Gemini diagnostic:", {
      model,
      status: status ?? "not provided",
      errorName,
      elapsedMs: Date.now() - startedAt,
    });

    let message = "The Gemini request failed. Please try again.";
    let responseStatus = 502;

    if (
      errorName === "AbortError" ||
      errorName === "TimeoutError" ||
      status === 408 ||
      status === 504
    ) {
      message =
        "Gemini took too long to respond. Please try again later.";
      responseStatus = 504;
    } else if (status === 503) {
      message =
        "Gemini is temporarily unavailable. Please try again later.";
      responseStatus = 503;
    } else if (status === 429) {
      message =
        "Gemini quota or rate limit reached. Check your AI Studio usage and billing.";
      responseStatus = 429;
    } else if (status === 401 || status === 403) {
      message =
        "Gemini access was denied. Check your API key and project permissions.";
    } else if (status === 404) {
      message =
        "The configured Gemini model was not found. Check the server terminal for details.";
    } else if (status === 400) {
      message =
        "Gemini rejected the request. Check the server terminal for details.";
    }

    return jsonResponse({ error: message }, responseStatus);
  }
}