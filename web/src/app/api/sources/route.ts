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

  const id = new URL(request.url).searchParams.get("id");
  const parsed = z.string().uuid().safeParse(id);

  if (!parsed.success) {
    return reply({ error: "Provide a valid source document ID." }, 400);
  }

  try {
    const { data, error } = await auth.supabase
      .from("source_documents")
      .select("id,original_name,size_bytes,mime_type,sha256,created_at")
      .eq("id", parsed.data)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (error) {
      console.error("Source details read failed:", error.code);
      return reply({ error: "Could not load source details." }, 500);
    }

    if (!data) {
      return reply(
        { error: "This source is unavailable in your account." },
        404
      );
    }

    return reply({ source: data });
  } catch {
    return reply({ error: "Could not reach the database." }, 503);
  }
}