import "server-only";

import { isDeepStrictEqual } from "node:util";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/require-user";
import { reportExtractionSchema } from "@/lib/report-extraction";

const MAX_REQUEST_BYTES = 300 * 1024;

const reportCursorSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.string().uuid(),
});

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
          message:
            `Figure ${index + 1}: choose a page within the selected excerpt.`,
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

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const before = params.get("before");
  const beforeId = params.get("beforeId");

  let cursor: z.infer<typeof reportCursorSchema> | null = null;

  if (before !== null || beforeId !== null) {
    const parsed = reportCursorSchema.safeParse({
      createdAt: before,
      id: beforeId,
    });

    if (!parsed.success) {
      return reply(
        { error: "Invalid report pagination cursor." },
        400
      );
    }

    cursor = parsed.data;
  }

  try {
    let query = auth.supabase
      .from("saved_ghg_reports")
      .select(
        "id,created_at,original_name,original_size_bytes,original_sha256,original_pages,reviewed,report"
      )
      .eq("user_id", auth.user.id);

    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},` +
          `and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      );
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(11);

    if (error) {
      console.error("Saved reports read failed:", error.code);

      return reply(
        { error: "Could not load saved GHG reports." },
        500
      );
    }

    const rows = data ?? [];
    const reports = rows.slice(0, 10);
    const last = reports[reports.length - 1];

    return reply({
      reports,
      nextCursor:
        rows.length > 10 && last
          ? {
              createdAt: last.created_at,
              id: last.id,
            }
          : null,
    });
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
    return reply(
      { error: "The report request is too large." },
      413
    );
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
      if (error.code === "23505") {
        const { data: existing, error: lookupError } =
          await auth.supabase
            .from("saved_ghg_reports")
            .select(
              "id,created_at,original_name,original_size_bytes,original_sha256,original_pages,reviewed,report"
            )
            .eq("id", input.id)
            .eq("user_id", auth.user.id)
            .maybeSingle();

        if (lookupError) {
          console.error(
            "Report retry lookup failed:",
            lookupError.code
          );

          return reply(
            {
              error:
                "The previous save could not be checked. " +
                "Retry the same save or refresh saved reports.",
            },
            503
          );
        }

        if (!existing) {
          return reply(
            {
              error:
                "This save ID cannot be reused for this report. " +
                "Refresh saved reports before continuing.",
            },
            409
          );
        }

        const identical =
          existing.id === input.id &&
          existing.original_name === input.originalName &&
          existing.original_size_bytes === input.originalSizeBytes &&
          existing.original_sha256 === input.originalSha256 &&
          existing.reviewed === input.reviewed &&
          isDeepStrictEqual(
            existing.original_pages,
            input.originalPages
          ) &&
          isDeepStrictEqual(existing.report, input.report);

        if (!identical) {
          return reply(
            {
              error:
                "This save ID already contains different report content. " +
                "The existing snapshot was not changed.",
            },
            409
          );
        }

        return reply({
          savedReport: {
            id: existing.id,
            created_at: existing.created_at,
          },
          alreadySaved: true,
        });
      }

      console.error("Report save failed:", error.code);

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