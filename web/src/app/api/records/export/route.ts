import "server-only";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/require-user";

const PAGE_SIZE = 500;
const MAX_RECORDS = 10_000;

function failure(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);

  // Prevent text fields from becoming spreadsheet formulas.
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) {
    text = "'" + text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const lines = [
    [
      "Record ID",
      "Saved at (UTC)",
      "Supplier",
      "Billing period (original text)",
"Reviewed billing start date",
"Reviewed billing end date",
"Activity",
      "Consumption",
      "Unit",
      "Factor ID",
      "Factor (kg CO2e per kWh)",
      "Demo emissions (tCO2e)",
      "Demonstration only",
      "Source document ID",
      "Source line index",
      "Source linkage",
      "Evidence",
    ].map(csvCell).join(","),
  ];

  let recordCount = 0;

  try {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await auth.supabase
        .from("emission_records")
        .select("id,created_at,supplier,billing_period,billing_start_date,billing_end_date,activity,quantity,unit,factor_id,factor_kg_co2e,tonnes_co2e,is_demo,source_document_id,source_line_index,evidence")
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error("Records export failed:", error.code);
        return failure("Could not export saved records.", 500);
      }

      if (!data || data.length === 0) break;

      recordCount += data.length;

      if (recordCount > MAX_RECORDS) {
        return failure(
          "This export supports up to 10,000 records. No partial file was downloaded.",
          422
        );
      }

      for (const record of data) {
        lines.push(
  [
    record.id,
    record.created_at,
    record.supplier,
    record.billing_period,
    record.billing_start_date,
    record.billing_end_date,
    record.activity,
    record.quantity,
    record.unit,
    record.factor_id,
    record.factor_kg_co2e,
    record.tonnes_co2e,
    record.is_demo ? "Yes" : "No",
    record.source_document_id,
    record.source_line_index,
    record.source_document_id
      ? "Linked source"
      : "Legacy record — no source linked",
    record.evidence,
  ].map(csvCell).join(",")
);
      }

      if (data.length < PAGE_SIZE) break;
    }

    const date = new Date().toISOString().slice(0, 10);
    const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          `attachment; filename="ecoguardian-demo-records-${date}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return failure("Could not complete the export. Please try again.", 503);
  }
}