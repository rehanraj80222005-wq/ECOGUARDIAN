import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/require-user";
import { extractionSchema } from "@/lib/extraction";

const saveSchema = z.object({
  reviewed: z.literal(true),
  sourceDocumentId: z.string().uuid(),
  draft: extractionSchema,
});

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
        "id,created_at,supplier,billing_period,quantity,unit,tonnes_co2e,is_demo,source_document_id"
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
          "Register a source file and confirm the reviewed draft before saving.",
      },
      400
    );
  }

  const { draft, sourceDocumentId } = parsed.data;

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
      "save_source_emissions",
      {
        p_source_id: sourceDocumentId,
        p_supplier: draft.supplier,
        p_billing_period: draft.billingPeriod,
        p_items: draft.items,
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
        return reply(
          { error: "The database rejected the activity data. Review the fields." },
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