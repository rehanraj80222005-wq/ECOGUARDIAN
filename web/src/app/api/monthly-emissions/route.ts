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
    const { data, error } = await auth.supabase.rpc(
      "get_monthly_emissions"
    );

    if (error) {
      console.error("Monthly emissions failed:", error.code);

      return reply(
        { error: "Could not load monthly emissions." },
        500
      );
    }

    return reply({ monthly: data });
  } catch {
    return reply(
      { error: "Could not reach the database. Please try again." },
      503
    );
  }
}