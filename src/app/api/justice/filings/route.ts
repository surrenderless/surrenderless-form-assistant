import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import type { TimelineEntry, TimelineEntryType } from "@/lib/justice/types";
import { getUserOr401 } from "@/server/requireUser";

const FILING_SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

const MAX_DEST = 500;
const MAX_FILED_AT = 200;
const MAX_CONFIRM = 200;
const MAX_URL = 2000;
const MAX_NOTES = 8000;

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

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
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
    .from("justice_case_filings")
    .select(FILING_SELECT)
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("justice_case_filings list:", error.message);
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

  if (!nonEmptyString(b.destination)) {
    return NextResponse.json({ error: "destination is required" }, { status: 400 });
  }
  const destination = clampLen(b.destination.trim(), MAX_DEST);

  const filedAt = optionalStringOrNull(b.filed_at);
  if (filedAt === undefined && b.filed_at !== undefined && b.filed_at !== null) {
    return NextResponse.json({ error: "Invalid filed_at" }, { status: 400 });
  }
  const filedAtVal = filedAt != null ? clampLen(filedAt, MAX_FILED_AT) : filedAt;

  const confirmation = optionalStringOrNull(b.confirmation_number);
  if (confirmation === undefined && b.confirmation_number !== undefined && b.confirmation_number !== null) {
    return NextResponse.json({ error: "Invalid confirmation_number" }, { status: 400 });
  }
  const confirmationVal = confirmation != null ? clampLen(confirmation, MAX_CONFIRM) : confirmation;

  const filingUrl = optionalStringOrNull(b.filing_url);
  if (filingUrl === undefined && b.filing_url !== undefined && b.filing_url !== null) {
    return NextResponse.json({ error: "Invalid filing_url" }, { status: 400 });
  }
  const filingUrlVal = filingUrl != null ? clampLen(filingUrl, MAX_URL) : filingUrl;

  const notes = optionalStringOrNull(b.notes);
  if (notes === undefined && b.notes !== undefined && b.notes !== null) {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
  }
  const notesVal = notes != null ? clampLen(notes, MAX_NOTES) : notes;

  const insertRow: Record<string, unknown> = {
    user_id: userId,
    case_id: caseId,
    destination,
  };
  if (filedAtVal !== undefined) insertRow.filed_at = filedAtVal;
  if (confirmationVal !== undefined) insertRow.confirmation_number = confirmationVal;
  if (filingUrlVal !== undefined) insertRow.filing_url = filingUrlVal;
  if (notesVal !== undefined) insertRow.notes = notesVal;

  const { data, error } = await supabase
    .from("justice_case_filings")
    .insert(insertRow)
    .select(FILING_SELECT)
    .single();

  if (error) {
    console.warn("justice_case_filings insert:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const conf = data.confirmation_number?.trim();
  const detail = conf ? `${data.destination} filed — ${conf}` : `${data.destination} filed`;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `justice_fil:${data.id}`,
    type: "filing_recorded",
    label: "Filing recorded",
    detail,
  });

  return NextResponse.json(timeline ? { ...data, timeline } : data);
}
