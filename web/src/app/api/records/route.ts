import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/require-user";
import { extractionSchema } from "@/lib/extraction";

const saveSchema = z.object({
  reviewed: z.literal(true),
  draft: extractionSchema,
  ids: z.array(z.string().uuid()).min(1).max(30),
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
        "id,created_at,supplier,billing_period,quantity,unit,tonnes_co2e,is_demo"
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
      { error: "Review the draft and confirm it before saving." },
      400
    );
  }

  const { draft, ids } = parsed.data;

  if (
    draft.items.length === 0 ||
    draft.items.length !== ids.length ||
    new Set(ids).size !== ids.length
  ) {
    return reply({ error: "The record identifiers are invalid." }, 400);
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
            `Activity ${index + 1}: saving currently requires electricity, ` +
            "a valid quantity, and kWh units.",
        },
        400
      );
    }
  }

  const rows = draft.items.map((item, index) => ({
    id: ids[index],
    user_id: auth.user.id,
    supplier: draft.supplier,
    billing_period: draft.billingPeriod,
    activity: "electricity",
    quantity: item.quantity,
    unit: "kWh",
    factor_id: "demo-electricity-v1",
    factor_kg_co2e: 0.5,
    is_demo: true,
    evidence: item.evidence,
    // PostgreSQL generates tonnes_co2e.
  }));

  try {
    const { data, error } = await auth.supabase
      .from("emission_records")
      .insert(rows)
      .select("id");

    if (error) {
      if (error.code === "23505") {
        return reply(
          {
            error:
              "These record IDs already exist. Refresh Saved records " +
              "to check whether an earlier save succeeded.",
          },
          409
        );
      }

      console.error("Records save failed:", error.code);

      return reply(
        { error: "Could not save records. Check the table and access policies." },
        500
      );
    }

    return reply({ savedCount: data.length }, 201);
  } catch {
    return reply(
      {
        error:
          "The save could not be confirmed. Check Saved records before retrying.",
      },
      503
    );
  }
}