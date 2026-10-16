import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/require-user";

const MAX_BYTES = 10 * 1024 * 1024;

function reply(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function detectMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  const pngSignature = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);

  if (bytes.subarray(0, 8).equals(pngSignature)) {
    return "image/png";
  }

  return null;
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const contentLength = Number(request.headers.get("content-length"));

  if (contentLength > MAX_BYTES + 1024 * 1024) {
    return reply({ error: "The upload exceeds the file-size limit." }, 413);
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return reply({ error: "Could not read the upload." }, 400);
  }

  const file = form.get("file");

  if (!(file instanceof File)) {
    return reply({ error: "Choose a file first." }, 400);
  }

  if (file.size === 0 || file.size > MAX_BYTES) {
    return reply(
      { error: "Choose a non-empty file no larger than 10 MB." },
      400
    );
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = detectMime(bytes);

    if (!mimeType) {
      return reply(
        { error: "The file must be a PDF, JPEG, or PNG." },
        415
      );
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const { data, error } = await auth.supabase
      .from("source_documents")
      .insert({
        user_id: auth.user.id,
        original_name: file.name.trim().slice(0, 255) || "Unnamed document",
        sha256,
        size_bytes: bytes.length,
        mime_type: mimeType,
      })
      .select("id")
      .single();

    if (!error && data) {
      return reply(
        {
          algorithm: "SHA-256",
          sha256,
          sizeBytes: bytes.length,
          documentId: data.id,
          alreadyRegistered: false,
        },
        201
      );
    }

    if (error?.code === "23505") {
      // A unique-key conflict can mean this user registered the file before.
      const { data: existing, error: lookupError } = await auth.supabase
        .from("source_documents")
        .select("id")
        .eq("user_id", auth.user.id)
        .eq("sha256", sha256)
        .single();

      if (lookupError || !existing) {
        return reply(
          { error: "Could not retrieve the existing source registration." },
          500
        );
      }

      return reply({
        algorithm: "SHA-256",
        sha256,
        sizeBytes: bytes.length,
        documentId: existing.id,
        alreadyRegistered: true,
      });
    }

    console.error("Source registration failed:", error?.code);

    return reply(
      { error: "Could not register the source. Check its table and policies." },
      500
    );
  } catch {
    return reply(
      { error: "Source registration could not be confirmed. Please retry." },
      503
    );
  }
}