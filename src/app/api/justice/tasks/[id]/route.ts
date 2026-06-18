import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import type { TimelineEntry, TimelineEntryType } from "@/lib/justice/types";
import { getUserOr401 } from "@/server/requireUser";

const SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const MAX_TITLE = 500;
const MAX_DUE = 200;
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

function newTaskCompletedTimelineId(): string {
  return randomUUID();
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

async function getJusticeCaseTimelineForUser(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<TimelineEntry[] | null> {
  const { data: row, error } = await supabase
    .from("justice_cases")
    .select("timeline")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !row) {
    console.warn("justice timeline read:", error?.message ?? "not found");
    return null;
  }
  return sortByTs(normalizeTimeline(row.timeline));
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: RouteCtx) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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
  const patch: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(b, "title")) {
    if (typeof b.title !== "string" || !b.title.trim()) {
      return NextResponse.json({ error: "Invalid title" }, { status: 400 });
    }
    patch.title = clampLen(b.title.trim(), MAX_TITLE);
  }

  if (Object.prototype.hasOwnProperty.call(b, "due_date")) {
    const v = optionalStringOrNull(b.due_date);
    if (v === undefined && b.due_date !== null) {
      return NextResponse.json({ error: "Invalid due_date" }, { status: 400 });
    }
    patch.due_date = v == null ? null : clampLen(v, MAX_DUE);
  }

  if (Object.prototype.hasOwnProperty.call(b, "notes")) {
    const v = optionalStringOrNull(b.notes);
    if (v === undefined && b.notes !== null) {
      return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
    }
    patch.notes = v == null ? null : clampLen(v, MAX_NOTES);
  }

  if (Object.prototype.hasOwnProperty.call(b, "completed_at")) {
    if (b.completed_at === null) {
      patch.completed_at = null;
    } else if (typeof b.completed_at === "string" && b.completed_at.trim()) {
      const t = b.completed_at.trim();
      const d = new Date(t);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid completed_at" }, { status: 400 });
      }
      patch.completed_at = d.toISOString();
    } else {
      return NextResponse.json({ error: "Invalid completed_at" }, { status: 400 });
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  const { data: prev, error: prevErr } = await supabase
    .from("justice_case_tasks")
    .select(SELECT)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (prevErr) {
    console.warn("justice_case_tasks read before update:", prevErr.message);
    return NextResponse.json({ error: prevErr.message }, { status: 500 });
  }
  if (!prev) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    console.warn("justice_case_tasks update:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const completing =
    Object.prototype.hasOwnProperty.call(b, "completed_at") &&
    patch.completed_at != null &&
    prev.completed_at == null;

  if (completing) {
    const titleDetail = data.title.trim();
    let timeline = await appendCaseTimelineEntry(supabase, userId, data.case_id, {
      id: newTaskCompletedTimelineId(),
      type: "task_completed",
      label: "Follow-up task completed",
      detail: titleDetail,
    });
    if (!timeline) {
      timeline = await getJusticeCaseTimelineForUser(supabase, userId, data.case_id);
    }
    return NextResponse.json(timeline != null ? { ...data, timeline } : data);
  }

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, context: RouteCtx) {
  const userId = getUserOr401(req);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    console.warn("justice_case_tasks delete:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data?.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
