import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { isJusticeEvidenceType, JUSTICE_EVIDENCE_TYPE_LABELS } from "@/lib/justice/evidence";
import type { TimelineEntry, TimelineEntryType } from "@/lib/justice/types";
import { getUserOr401 } from "@/server/requireUser";

const EVIDENCE_SELECT =
  "id, user_id, case_id, title, evidence_type, evidence_date, description, source_url, storage_note, created_at, updated_at" as const;

const MAX_TITLE = 500;
const MAX_EVIDENCE_DATE = 200;
const MAX_DESCRIPTION = 8000;
const MAX_SOURCE_URL = 2000;
const MAX_STORAGE_NOTE = 8000;

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

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function optionalStringOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function normalizeTimeline(v: unknown): TimelineEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item)) as TimelineEntry[];
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
    console.warn("justice_case ownership check:", error.message);
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
    console.warn("justice timeline append: load case", fetchErr?.message ?? "not found");
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
    console.warn("justice timeline append: update", upErr.message);
    return null;
  }

  return timeline;
}

export async function GET(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const caseId = req.nextUrl.searchParams.get("case_id") ?? "";
  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  if (!(await userOwnsJusticeCase(supabase, userId, caseId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("justice_case_evidence")
    .select(EVIDENCE_SELECT)
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("justice_case_evidence list:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const caseId = typeof b.case_id === "string" ? b.case_id : "";
  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  if (!(await userOwnsJusticeCase(supabase, userId, caseId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!nonEmptyString(b.title)) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const title = clampLen(b.title.trim(), MAX_TITLE);

  if (typeof b.evidence_type !== "string" || !isJusticeEvidenceType(b.evidence_type)) {
    return NextResponse.json({ error: "Invalid evidence_type" }, { status: 400 });
  }

  const evidenceDate = optionalStringOrNull(b.evidence_date);
  if (evidenceDate === undefined && b.evidence_date !== undefined && b.evidence_date !== null) {
    return NextResponse.json({ error: "Invalid evidence_date" }, { status: 400 });
  }
  const evidenceDateVal = evidenceDate == null ? evidenceDate : clampLen(evidenceDate, MAX_EVIDENCE_DATE);

  const description = optionalStringOrNull(b.description);
  if (description === undefined && b.description !== undefined && b.description !== null) {
    return NextResponse.json({ error: "Invalid description" }, { status: 400 });
  }
  const descriptionVal = description == null ? description : clampLen(description, MAX_DESCRIPTION);

  const sourceUrl = optionalStringOrNull(b.source_url);
  if (sourceUrl === undefined && b.source_url !== undefined && b.source_url !== null) {
    return NextResponse.json({ error: "Invalid source_url" }, { status: 400 });
  }
  const sourceUrlVal = sourceUrl == null ? sourceUrl : clampLen(sourceUrl, MAX_SOURCE_URL);

  const storageNote = optionalStringOrNull(b.storage_note);
  if (storageNote === undefined && b.storage_note !== undefined && b.storage_note !== null) {
    return NextResponse.json({ error: "Invalid storage_note" }, { status: 400 });
  }
  const storageNoteVal = storageNote == null ? storageNote : clampLen(storageNote, MAX_STORAGE_NOTE);

  const insertRow: Record<string, unknown> = {
    user_id: userId,
    case_id: caseId,
    title,
    evidence_type: b.evidence_type,
  };
  if (evidenceDateVal !== undefined) insertRow.evidence_date = evidenceDateVal;
  if (descriptionVal !== undefined) insertRow.description = descriptionVal;
  if (sourceUrlVal !== undefined) insertRow.source_url = sourceUrlVal;
  if (storageNoteVal !== undefined) insertRow.storage_note = storageNoteVal;

  const { data, error } = await supabase
    .from("justice_case_evidence")
    .insert(insertRow)
    .select(EVIDENCE_SELECT)
    .single();

  if (error) {
    console.warn("justice_case_evidence insert:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const et = data.evidence_type;
  const typeLabel = isJusticeEvidenceType(et)
    ? JUSTICE_EVIDENCE_TYPE_LABELS[et]
    : et.replace(/_/g, " ");
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `justice_ev:${data.id}`,
    type: "evidence_added",
    label: "Evidence added",
    detail: `${data.title} — ${typeLabel}`,
  });

  return NextResponse.json(timeline ? { ...data, timeline } : data);
}
