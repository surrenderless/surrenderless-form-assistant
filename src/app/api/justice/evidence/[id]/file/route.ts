import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import {
  getRequiredJusticeEvidenceBucket,
  isPublicSupabaseStorageObjectUrl,
  JUSTICE_EVIDENCE_BUCKET_MISSING_ERROR,
  JUSTICE_EVIDENCE_SIGNED_URL_TTL_SECONDS,
} from "@/lib/justice/evidenceFileAccess";
import { getUserOr401 } from "@/server/requireUser";
import {
  findPlaywrightMockJusticeEvidenceById,
  isPlaywrightMockJusticeEvidencePipelineEnabled,
} from "@/lib/testing/playwrightMockJusticeEvidencePipeline";

function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

function supabaseUnavailableResponse() {
  return NextResponse.json(
    { error: "Supabase is not configured on this server." },
    { status: 503 }
  );
}

function storageUnavailableResponse() {
  return NextResponse.json(
    { error: JUSTICE_EVIDENCE_BUCKET_MISSING_ERROR },
    { status: 503 }
  );
}

type RouteCtx = { params: Promise<{ id: string }> };

/** Internal only — file_path is never returned to clients from this route. */
const EVIDENCE_FILE_SELECT =
  "id, user_id, case_id, file_path, file_name, mime_type, file_size_bytes, source_url" as const;

/**
 * GET /api/justice/evidence/[id]/file
 * Authenticated, ownership-checked access to a private evidence attachment.
 * Returns a short-lived signed URL (JSON when ?format=json) or redirects to it.
 * Never exposes /storage/v1/object/public/ URLs or file_path.
 */
export async function GET(req: NextRequest, context: RouteCtx) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = rawId?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const bucket = getRequiredJusticeEvidenceBucket();
  if (!bucket) return storageUnavailableResponse();

  const wantJson = req.nextUrl.searchParams.get("format") === "json";

  if (isPlaywrightMockJusticeEvidencePipelineEnabled()) {
    const mockRow = findPlaywrightMockJusticeEvidenceById(id);
    if (!mockRow || mockRow.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!mockRow.file_path?.trim() || !mockRow.file_name?.trim()) {
      return NextResponse.json({ error: "No file attached" }, { status: 404 });
    }
    if (isPublicSupabaseStorageObjectUrl(mockRow.source_url)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const expiresIn = JUSTICE_EVIDENCE_SIGNED_URL_TTL_SECONDS;
    // Deterministic mock signed URL — never a public object path; never includes file_path.
    const signedUrl = `https://example.invalid/mock-signed-evidence/${encodeURIComponent(id)}?expires_in=${expiresIn}`;

    if (wantJson) {
      return NextResponse.json({
        signed_url: signedUrl,
        expires_in: expiresIn,
        file_name: mockRow.file_name,
        mime_type: mockRow.mime_type,
      });
    }

    const body = Buffer.from(`playwright-mock-evidence-file:${mockRow.file_name}`);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": mockRow.mime_type?.trim() || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${mockRow.file_name.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Evidence-Access": "private-mock",
      },
    });
  }

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  const { data: row, error } = await supabase
    .from("justice_case_evidence")
    .select(EVIDENCE_FILE_SELECT)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("justice evidence file access load:", error.message);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = typeof row.file_path === "string" ? row.file_path.trim() : "";
  const fileName = typeof row.file_name === "string" ? row.file_name.trim() : "";
  if (!filePath || !fileName) {
    return NextResponse.json({ error: "No file attached" }, { status: 404 });
  }
  if (isPublicSupabaseStorageObjectUrl(row.source_url as string | null)) {
    console.warn("justice evidence file access refused public source_url row", id);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, JUSTICE_EVIDENCE_SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    console.warn("justice evidence createSignedUrl:", signError?.message ?? "no url");
    return NextResponse.json(
      { error: "Could not create a temporary download link. Try again in a moment." },
      { status: 500 }
    );
  }

  if (isPublicSupabaseStorageObjectUrl(signed.signedUrl)) {
    console.warn("justice evidence signed URL unexpectedly used public object path");
    return NextResponse.json({ error: "Could not create a temporary download link." }, { status: 500 });
  }

  if (wantJson) {
    return NextResponse.json({
      signed_url: signed.signedUrl,
      expires_in: JUSTICE_EVIDENCE_SIGNED_URL_TTL_SECONDS,
      file_name: fileName,
      mime_type: row.mime_type ?? null,
    });
  }

  return NextResponse.redirect(signed.signedUrl, 302);
}
