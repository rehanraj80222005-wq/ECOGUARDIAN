import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/require-user";

const dateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value < "0001-01-01" || value > "9999-12-31") return false;

  const date = new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
});

const correctionSchema = z.object({
  recordId: z.string().uuid(),
  expectedStartDate: dateSchema.nullable(),
  expectedEndDate: dateSchema.nullable(),
  newStartDate: dateSchema,
  newEndDate: dateSchema,
  reason: z.string().trim().min(10).max(1000),
  reviewed: z.literal(true),
}).refine(
  (value) => value.newEndDate >= value.newStartDate
);

function reply(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return reply({ error: "The request must contain valid JSON." }, 400);
  }

  const parsed = correctionSchema.safeParse(body);

  if (!parsed.success) {
    return reply(
      {
        error:
          "Provide valid billing dates, a reason of 10–1,000 characters, " +
          "and confirm that you checked the source.",
      },
      400
    );
  }

  const input = parsed.data;

  try {
    const { data, error } = await auth.supabase.rpc(
      "correct_billing_dates",
      {
        p_record_id: input.recordId,
        p_expected_start_date: input.expectedStartDate,
        p_expected_end_date: input.expectedEndDate,
        p_new_start_date: input.newStartDate,
        p_new_end_date: input.newEndDate,
        p_reason: input.reason,
      }
    );

    if (error) {
      console.error("Billing date correction failed:", error.code);

      if (error.code === "40001") {
        return reply(
          {
            error:
              "This record's dates changed while you were editing. " +
              "Refresh Saved records and review the current dates.",
          },
          409
        );
      }

      if (error.code === "42501") {
        return reply(
          { error: "This record is unavailable in your account." },
          403
        );
      }

      if (error.code === "22023") {
        return reply(
          {
            error:
              "Check the date range and correction reason. " +
              "The new dates must differ from the saved dates.",
          },
          400
        );
      }

      return reply({ error: "Could not correct the billing dates." }, 500);
    }

    return reply(data);
  } catch {
    return reply(
      {
        error:
          "The correction could not be confirmed. " +
          "Refresh Saved records before retrying.",
      },
      503
    );
  }
}