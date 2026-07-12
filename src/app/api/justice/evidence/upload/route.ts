import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid, v4 as uuidv4 } from "uuid";
import {
  buildJusticeEvidenceStoragePath,
  inferJusticeEvidenceTypeFromMime,
  validateJusticeEvidenceUploadFile,
} from "@/lib/justice/chatEvidenceUpload";
import {
  isJusticeEvidenceType,
  JUSTICE_EVIDENCE_TYPE_LABELS,
  type JusticeEvidenceType,
} from "@/lib/justice/evidence";
import {
  getRequiredJusticeEvidenceBucket,
  JUSTICE_EVIDENCE_API_SELECT,
  JUSTICE_EVIDENCE_BUCKET_MISSING_ERROR,
  omitEvidenceFilePathFromApiRow,
} from "@/lib/justice/evidenceFileAccess";
import type { TimelineEntry, TimelineEntryType } from "@/lib/justice/types";
import { getUserOr401 } from "@/server/requireUser";
import {
  appendPlaywrightMockJusticeEvidenceUpload,
  isPlaywrightMockJusticeEvidenceCaseId,
  isPlaywrightMockJusticeEvidencePipelineEnabled,
} from "@/lib/testing/playwrightMockJusticeEvidencePipeline";

const EVIDENCE_SELECT = JUSTICE_EVIDENCE_API_SELECT;

const MAX_TITLE = 500;

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

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function normalizeTimeline(v: unknown): TimelineEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (item) => item !== null && typeof item === "object" && !Array.isArray(item)
  ) as TimelineEntry[];
}

function sortByTs(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort((a, b) => a.ts.localeCompare(b.ts));
}

async function userOwnsJusticeCase(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("justice_cases")
    .select("id")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("justice_case ownership check (evidence upload):", error.message);
    return false;
  }
  return !!data;
}

async function appendCaseTimelineEntry(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  entry: {
    id: string;
    type: TimelineEntryType;
    label: string;
    detail?: string;
    ts?: string;
  }
): Promise<TimelineEntry[] | null> {
  const { data: row, error: fetchErr } = await supabase
    .from("justice_cases")
    .select("timeline")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchErr || !row) {
    console.warn("justice timeline append (evidence upload): load case", fetchErr?.message ?? "not found");
    return null;
  }

  let timeline = normalizeTimeline(row.timeline);
  if (timeline.some((e) => e.id === entry.id)) {
    return sortByTs(timeline);
  }

  const newEntry: TimelineEntry = {
    id: entry.id,
    case_id: caseId,
    type: entry.type,
    label: entry.label,
    ts: entry.ts ?? new Date().toISOString(),
    ...(entry.detail !== undefined && entry.detail !== "" ? { detail: entry.detail } : {}),
  };

  timeline = sortByTs([...timeline, newEntry]);

  const { error: upErr } = await supabase
    .from("justice_cases")
    .update({ timeline })
    .eq("id", caseId)
    .eq("user_id", userId);

  if (upErr) {
    console.warn("justice timeline append (evidence upload): update", upErr.message);
    return null;
  }

  return timeline;
}

/** POST multipart: case_id + file (+ optional title, evidence_type). */
export async function POST(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const caseIdRaw = form.get("case_id");
  const caseId = typeof caseIdRaw === "string" ? caseIdRaw.trim() : "";
  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }

  const fileValue = form.get("file");
  if (!(fileValue instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const validated = validateJusticeEvidenceUploadFile({
    mimeType: fileValue.type || "application/octet-stream",
    sizeBytes: fileValue.size,
    fileName: fileValue.name,
  });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const titleRaw = form.get("title");
  const titleFromForm =
    typeof titleRaw === "string" && titleRaw.trim() ? clampLen(titleRaw.trim(), MAX_TITLE) : "";
  const title = titleFromForm || clampLen(validated.fileName, MAX_TITLE);

  const typeRaw = form.get("evidence_type");
  let evidenceType: JusticeEvidenceType = inferJusticeEvidenceTypeFromMime(validated.mimeType);
  if (typeof typeRaw === "string" && isJusticeEvidenceType(typeRaw)) {
    evidenceType = typeRaw;
  }

  const objectId = uuidv4();
  const filePath = buildJusticeEvidenceStoragePath({
    userId,
    caseId,
    objectId,
    fileName: validated.fileName,
  });
  const storageNote = `Uploaded file: ${validated.fileName} (${validated.mimeType}, ${fileValue.size} bytes)`;

  const bucket = getRequiredJusticeEvidenceBucket();
  if (!bucket) return storageUnavailableResponse();

  if (
    isPlaywrightMockJusticeEvidencePipelineEnabled() &&
    isPlaywrightMockJusticeEvidenceCaseId(caseId)
  ) {
    const created = appendPlaywrightMockJusticeEvidenceUpload({
      userId,
      caseId,
      title,
      evidenceType,
      filePath,
      fileName: validated.fileName,
      mimeType: validated.mimeType,
      fileSizeBytes: fileValue.size,
      storageNote,
    });
    return NextResponse.json(omitEvidenceFilePathFromApiRow(created as unknown as Record<string, unknown>));
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  if (!(await userOwnsJusticeCase(supabase, userId, caseId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bytes = Buffer.from(await fileValue.arrayBuffer());
  const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, bytes, {
    contentType: validated.mimeType,
    upsert: false,
  });
  if (uploadError) {
    console.warn("justice evidence upload storage:", uploadError.message);
    return NextResponse.json(
      { error: "Could not store the evidence file. Try again in a moment." },
      { status: 500 }
    );
  }

  // Private attachment only — never write /storage/v1/object/public/ into source_url.
  const insertRow: Record<string, unknown> = {
    user_id: userId,
    case_id: caseId,
    title,
    evidence_type: evidenceType,
    file_path: filePath,
    file_name: validated.fileName,
    mime_type: validated.mimeType,
    file_size_bytes: fileValue.size,
    storage_note: storageNote,
    source_url: null,
  };

  const { data, error } = await supabase
    .from("justice_case_evidence")
    .insert(insertRow)
    .select(EVIDENCE_SELECT)
    .single();

  if (error) {
    console.warn("justice_case_evidence file insert:", error.message);
    try {
      await supabase.storage.from(bucket).remove([filePath]);
    } catch (cleanupErr) {
      console.warn("justice evidence upload cleanup:", cleanupErr);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const typeLabel = JUSTICE_EVIDENCE_TYPE_LABELS[evidenceType];
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `justice_ev:${data.id}`,
    type: "evidence_added",
    label: "Evidence file attached",
    detail: `${data.title} — ${typeLabel} (${validated.fileName})`,
  });

  const publicRow = omitEvidenceFilePathFromApiRow(data as unknown as Record<string, unknown>);
  return NextResponse.json(timeline ? { ...publicRow, timeline } : publicRow);
}
