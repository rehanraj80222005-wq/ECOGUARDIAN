import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

function authError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

// Use this helper inside API Route Handlers.
export async function requireUser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return {
      ok: false as const,
      response: authError("Supabase is not configured.", 503),
    };
  }

  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(updatedCookies) {
          for (const { name, value, options } of updatedCookies) {
            cookieStore.set(name, value, options);
          }
        },
      },
    });

    // Verify the user with Supabase, rather than trusting browser state.
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      const unavailable =
        error.status === 0 ||
        (typeof error.status === "number" && error.status >= 500);

      return {
        ok: false as const,
        response: authError(
          unavailable
            ? "Could not verify your session. Please try again."
            : "Please sign in to continue.",
          unavailable ? 503 : 401
        ),
      };
    }

    if (!data.user) {
      return {
        ok: false as const,
        response: authError("Please sign in to continue.", 401),
      };
    }

    return {
      ok: true as const,
      user: data.user,
      supabase,
    };
  } catch {
    return {
      ok: false as const,
      response: authError(
        "Could not verify your session. Please try again.",
        503
      ),
    };
  }
}