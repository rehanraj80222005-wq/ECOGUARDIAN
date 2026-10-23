import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/require-user";
import { reportExtractionSchema } from "@/lib/report-extraction";

const MAX_REQUEST_BYTES = 300 * 1024;

const originalPagesSchema = z
  .array(z.number().int().min(1).max(500))
  .min(1)
  .max(3)
  .refine(
    (pages) =>
      pages.every(
        (page, index) => index === 0 || page === pages[index - 1] + 1
      ),
    "Choose consecutive original PDF pages."
  );

const saveSchema = z
  .object({
    // Reused by the interface when retrying the same save.
    id: z.string().uuid(),
    reviewed: z.literal(true),

    originalName: z.string().trim().min(1).max(255),
    originalSizeBytes: z.number().int().min(1).max(20 * 1024 * 1024),
    originalSha256: z.string().regex(/^[a-f0-9]{64}$/),

    originalPages: originalPagesSchema,
    report: reportExtractionSchema,
  })
  .superRefine((value, context) => {
    if (value.report.figures.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["report", "figures"],
        message: "Add at least one reported figure.",
      });
    }

    value.report.figures.forEach((figure, index) => {
      const requiredFields = [
        ["label", figure.label],
        ["reportedValue", figure.reportedValue],
        ["unit", figure.unit],
        ["evidence", figure.evidence],
      ] as const;

      for (const [field, text] of requiredFields) {
        if (!text?.trim()) {
          context.addIssue({
            code: "custom",
            path: ["report", "figures", index, field],
            message: `Figure ${index + 1}: provide ${field}.`,
          });
        }
      }

      if (figure.excerptPage > value.originalPages.length) {
        context.addIssue({
          code: "custom",
          path: ["report", "figures", index, "excerptPage"],
          message: `Figure ${index + 1}: choose a page within the selected excerpt.`,
        });
      }
    });

    if (
      Buffer.byteLength(JSON.stringify(value.report), "utf8") >
      240 * 1024
    ) {
      context.addIssue({
        code: "custom",
        path: ["report"],
        message: "The reviewed report is too large to save.",
      });
    }
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
      .from("saved_ghg_reports")
      .select(
        "id,created_at,original_name,original_size_bytes," +
          "original_sha256,original_pages,reviewed,report"
      )
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10);

    if (error) {
      console.error("Saved reports read failed:", error.code);

      return reply(
        { error: "Could not load saved GHG reports." },
        500
      );
    }

    return reply({ reports: data ?? [] });
  } catch {
    return reply(
      { error: "Could not reach the database. Please retry." },
      503
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const contentLength = Number(
    request.headers.get("content-length")
  );

  if (contentLength > MAX_REQUEST_BYTES) {
    return reply({ error: "The report request is too large." }, 413);
  }

  let body: unknown;

  try {
    const text = await request.text();

    if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) {
      return reply(
        { error: "The report request is too large." },
        413
      );
    }

    body = JSON.parse(text);
  } catch {
    return reply(
      { error: "The request must contain valid JSON." },
      400
    );
  }

  const parsed = saveSchema.safeParse(body);

  if (!parsed.success) {
    return reply(
      {
        error:
          parsed.error.issues[0]?.message ??
          "Review the report fields before saving.",
      },
      400
    );
  }

  const input = parsed.data;

  try {
    const { data, error } = await auth.supabase
      .from("saved_ghg_reports")
      .insert({
        id: input.id,
        original_name: input.originalName,
        original_size_bytes: input.originalSizeBytes,
        original_sha256: input.originalSha256,
        original_pages: input.originalPages,
        reviewed: input.reviewed,
        report: input.report,
      })
      .select("id,created_at")
      .single();

    if (error) {
      console.error("Report save failed:", error.code);

      if (error.code === "23505") {
        return reply(
          {
            error:
              "This save ID already exists. Refresh saved reports " +
              "and check the existing entry before trying another save.",
          },
          409
        );
      }

      if (error.code === "42501") {
        return reply(
          {
            error:
              "Saving this report is not permitted. " +
              "Check your sign-in session.",
          },
          403
        );
      }

      if (error.code === "23514") {
        return reply(
          {
            error:
              "The database rejected the report fields. " +
              "Review the figures and selected pages.",
          },
          400
        );
      }

      return reply(
        { error: "Could not save the GHG report." },
        500
      );
    }

    if (!data) {
      return reply(
        {
          error:
              "The save could not be confirmed. " +
              "Refresh saved reports before retrying.",
        },
        503
      );
    }

    return reply({ savedReport: data }, 201);
  } catch {
    return reply(
      {
        error:
          "The save could not be confirmed. " +
          "Refresh saved reports before retrying.",
      },
      503
    );
  }
}