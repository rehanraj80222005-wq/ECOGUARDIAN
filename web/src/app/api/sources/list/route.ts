import "server-only";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/require-user";

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
    const { data: sources, error } = await auth.supabase
      .from("source_documents")
      .select("id,original_name,size_bytes,mime_type,created_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Source list failed:", error.code);
      return reply({ error: "Could not load registered sources." }, 500);
    }

    const results = await Promise.all(
      (sources ?? []).map(async (source) => {
        const { count, error: countError } = await auth.supabase
          .from("emission_records")
          .select("id", { count: "exact", head: true })
          .eq("user_id", auth.user.id)
          .eq("source_document_id", source.id);

        if (countError || count === null) {
          console.error(
            "Source record count failed:",
            countError?.code ?? "missing count"
          );

          throw new Error("Could not count source records.");
        }

        return {
          ...source,
          saved_record_count: count,
        };
      })
    );

    return reply({ sources: results });
  } catch {
    return reply(
      { error: "Could not load source statuses. Please try again." },
      503
    );
  }
}