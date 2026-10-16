import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { extractionSchema } from "@/lib/extraction";
import { requireUser } from "@/lib/supabase/require-user";
const requestSchema = z.object({
  reviewed: z.literal(true),
  items: extractionSchema.shape.items.min(1),
});

// Fictional test value. Not an official reporting factor.
const DEMO_FACTOR = {
  id: "demo-electricity-v1",
  label: "Fictional electricity factor",
  kgCO2ePerKwh: 0.5,
  source: "EcoGuardian tutorial — demonstration only",
  scope: 2,
};

function reply(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const auth = await requireUser();

if (!auth.ok) {
  return auth.response;
}
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return reply({ error: "The request must contain valid JSON." }, 400);
  }

  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return reply(
      { error: "Review the activity data and confirm it before calculating." },
      400
    );
  }

  const rows: {
    activity: string;
    quantity: number;
    unit: string;
    kgCO2e: number;
    tonnesCO2e: number;
  }[] = [];

  for (const [index, item] of parsed.data.items.entries()) {
    const label = `Activity ${index + 1}`;

    if (item.activity !== "electricity") {
      return reply(
        {
          error:
            `${label}: this first calculator supports electricity only. ` +
            "Fuel calculations will be added separately.",
        },
        400
      );
    }

    if (item.quantity === null) {
      return reply(
        { error: `${label}: enter the electricity consumption quantity.` },
        400
      );
    }

    const unit = item.unit?.trim().toLowerCase();

    if (unit !== "kwh") {
      return reply(
        {
          error:
            `${label}: the demo factor requires kWh. ` +
            "Other units need a conversion; do not simply relabel the value.",
        },
        400
      );
    }

    const kgCO2e = item.quantity * DEMO_FACTOR.kgCO2ePerKwh;
    const tonnesCO2e = kgCO2e / 1000;

    if (!Number.isFinite(kgCO2e) || !Number.isFinite(tonnesCO2e)) {
      return reply({ error: `${label}: the quantity is too large.` }, 400);
    }

    rows.push({
      activity: item.activity,
      quantity: item.quantity,
      unit: "kWh",
      kgCO2e,
      tonnesCO2e,
    });
  }

  const totalKgCO2e = rows.reduce((total, row) => total + row.kgCO2e, 0);

  if (!Number.isFinite(totalKgCO2e)) {
    return reply({ error: "The combined quantity is too large." }, 400);
  }

  return reply({
    demonstration: true,
    factor: DEMO_FACTOR,
    rows,
    totalKgCO2e,
    totalTonnesCO2e: totalKgCO2e / 1000,
  });
}