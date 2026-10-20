import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/require-user";

const kindSchema = z.enum([
  "utility_bill",
  "ghg_report",
  "unclassified",
]);

const updateSchema = z.object({
  sourceId: z.string().uuid(),
  documentKind: kindSchema,
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

  const parsed = z.string().uuid().safeParse(
    new URL(request.url).searchParams.get("sourceId")
  );

  if (!parsed.success) {
    return reply({ error: "Invalid source ID." }, 400);
  }

  try {
    const { data, error } = await auth.supabase
      .from("source_documents")
      .select("document_kind")
      .eq("id", parsed.data)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (error) {
      return reply({ error: "Could not load the category." }, 500);
    }

    if (!data) {
      return reply({ error: "Source unavailable." }, 404);
    }

    return reply({ documentKind: data.document_kind });
  } catch {
    return reply({ error: "Could not reach the database." }, 503);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return reply({ error: "Invalid JSON request." }, 400);
  }

  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return reply({ error: "Choose a valid source category." }, 400);
  }

  try {
    const { data, error } = await auth.supabase.rpc(
      "classify_source_document",
      {
        p_source_id: parsed.data.sourceId,
        p_document_kind: parsed.data.documentKind,
      }
    );

    if (error) {
      if (error.code === "42501") {
        return reply({ error: "Source unavailable in your account." }, 403);
      }

      if (error.code === "22023") {
        return reply(
          {
            error:
              "A source with saved activity records cannot be classified as a GHG report.",
          },
          400
        );
      }

      console.error("Source classification failed:", error.code);
      return reply({ error: "Could not save the category." }, 500);
    }

    return reply(data);
  } catch {
    return reply(
      { error: "Could not confirm the change. Refresh sources." },
      503
    );
  }
}