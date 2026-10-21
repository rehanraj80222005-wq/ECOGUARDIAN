import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/require-user";
import { extractionSchema } from "@/lib/extraction";

const billingDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value < "0001-01-01" || value > "9999-12-31") return false;

  const date = new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}, "Provide a valid date in YYYY-MM-DD format.");

const saveSchema = z.object({
  reviewed: z.literal(true),
  sourceDocumentId: z.string().uuid(),
  billingStartDate: billingDateSchema,
  billingEndDate: billingDateSchema,
  draft: extractionSchema,
}).refine(
  (value) => value.billingEndDate >= value.billingStartDate,
  {
    message: "Billing end date cannot be before the start date.",
    path: ["billingEndDate"],
  }
);
function reply(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await auth.supabase
      .from("emission_records")
      .select(
  "id,created_at,supplier,billing_period,quantity,unit," +
  "tonnes_co2e,is_demo,source_document_id," +
  "billing_start_date,billing_end_date"
)
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Records read failed:", error.code);
      return reply({ error: "Could not load saved records." }, 500);
    }

    return reply({ records: data });
  } catch {
    return reply({ error: "Could not reach the database." }, 503);
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return reply({ error: "Invalid JSON request." }, 400);
  }

  const parsed = saveSchema.safeParse(body);

  if (!parsed.success) {
    return reply(
      {
        error:
"Register a source file, enter valid billing dates, and confirm the reviewed draft before saving."},
      400
    );
  }

  const {
  draft,
  sourceDocumentId,
  billingStartDate,
  billingEndDate,
} = parsed.data;

  if (draft.items.length === 0) {
    return reply({ error: "Add at least one activity." }, 400);
  }

  for (const [index, item] of draft.items.entries()) {
    if (
      item.activity !== "electricity" ||
      item.unit?.trim().toLowerCase() !== "kwh" ||
      item.quantity === null ||
      item.quantity > 1_000_000_000_000
    ) {
      return reply(
        {
          error:
            `Activity ${index + 1}: provide electricity consumption, ` +
            "a valid quantity, and kWh units.",
        },
        400
      );
    }
  }

  try {
    const { data, error } = await auth.supabase.rpc(
  "save_dated_source_emissions",
  {
    p_source_id: sourceDocumentId,
    p_supplier: draft.supplier,
    p_billing_period: draft.billingPeriod,
    p_items: draft.items,
    p_billing_start_date: billingStartDate,
    p_billing_end_date: billingEndDate,
  }
);

    if (error) {
      console.error("Source-linked save failed:", error.code);

      if (error.code === "23505") {
        return reply(
          {
            error:
              "This source already has saved emissions. " +
              "No additional records were added. Refresh Saved records.",
          },
          409
        );
      }

      if (error.code === "42501") {
        return reply(
          { error: "The source is unavailable in your account." },
          403
        );
      }

      if (error.code === "22023") {
  if (
    error.message ===
    "A GHG report cannot receive saved electricity activity"
  ) {
    return reply(
      {
        error:
          "This source is classified as a GHG report, so electricity " +
          "activity cannot be saved against it. If you selected the " +
          "wrong file, upload the correct utility bill. If the source " +
          "really is a utility bill, change its category in Source " +
          "documents, then retry. No records were added.",
      },
      400
    );
  }

  return reply(
    {
      error:
        "The database rejected the activity data or billing dates. " +
        "Review the fields before retrying.",
    },
    400
  );
}

      return reply(
        { error: "Could not save records. Check the database migration." },
        500
      );
    }

    return reply(data, 201);
  } catch {
    return reply(
      {
        error:
          "The save could not be confirmed. Refresh Saved records before retrying.",
      },
      503
    );
  }
}