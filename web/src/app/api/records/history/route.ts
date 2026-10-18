import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/require-user";

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
    new URL(request.url).searchParams.get("recordId")
  );

  if (!parsed.success) {
    return reply({ error: "Provide a valid record ID." }, 400);
  }

  try {
    const { data: record, error: recordError } = await auth.supabase
      .from("emission_records")
      .select("id")
      .eq("id", parsed.data)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (recordError) {
      return reply({ error: "Could not check this record." }, 500);
    }

    if (!record) {
      return reply({ error: "Record unavailable in your account." }, 404);
    }

    const { data, error } = await auth.supabase
      .from("billing_date_changes")
      .select(
        "id,old_start_date,old_end_date,new_start_date,new_end_date," +
        "reason,changed_at"
      )
      .eq("record_id", parsed.data)
      .eq("user_id", auth.user.id)
      .order("changed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);

    if (error) {
      console.error("Date history failed:", error.code);
      return reply({ error: "Could not load date history." }, 500);
    }

    return reply({
      changes: (data ?? []).slice(0, 50),
      hasMore: (data?.length ?? 0) > 50,
    });
  } catch {
    return reply({ error: "Could not reach the database." }, 503);
  }
}