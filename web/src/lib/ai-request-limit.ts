import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const resultSchema = z.discriminatedUnion("allowed", [
  z.object({
    allowed: z.literal(true),
    reason: z.null(),
    retryAfterSeconds: z.literal(0),
  }),
  z.object({
    allowed: z.literal(false),
    reason: z.enum(["minute_limit", "daily_limit"]),
    retryAfterSeconds: z.number().int().positive().max(86400),
  }),
]);

function unavailable() {
  return NextResponse.json(
    {
      error:
        "Could not check your AI request allowance. Please try again later.",
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function checkAiRequestLimit(
  supabase: SupabaseClient
): Promise<NextResponse | null> {
  try {
    const { data, error } = await supabase.rpc("consume_ai_request");

    if (error) {
      console.error("AI allowance check failed:", {
        code: error.code,
      });

      return unavailable();
    }

    const parsed = resultSchema.safeParse(data);

    if (!parsed.success) {
      console.error("AI allowance returned an unexpected format.");
      return unavailable();
    }

    if (parsed.data.allowed) {
      return null;
    }

    const { reason, retryAfterSeconds } = parsed.data;

    return NextResponse.json(
      {
        error:
          reason === "daily_limit"
            ? "You reached your daily limit of 30 AI requests. It resets at 00:00 UTC (5:30 AM India time)."
            : `You reached the limit of 5 AI requests per minute. Try again in ${retryAfterSeconds} seconds.`,
        retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(retryAfterSeconds),
        },
      }
    );
  } catch {
    return unavailable();
  }
}