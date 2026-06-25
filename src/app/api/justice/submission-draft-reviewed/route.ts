import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import {
  buildSubmissionDraftReviewedDetail,
  SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID,
} from "@/lib/justice/timeline";
import type { TimelineEntry, TimelineEntryType } from "@/lib/justice/types";
import { getUserOr401 } from "@/server/requireUser";
import {
  buildPlaywrightMockSubmissionDraftReviewedResponse,
  isPlaywrightMockSubmissionDraftReviewedPipelineEnabled,
} from "@/lib/testing/playwrightMockSubmissionDraftReviewedPipeline";

const MAX_DEST_LABEL = 300;

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

function clampStr(s: string, max: number): string {
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
  const caseId = typeof b.case_id === "string" ? b.case_id.trim() : "";
  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }

  const destinationLabel =
    typeof b.destination_label === "string" && b.destination_label.trim()
      ? clampStr(b.destination_label.trim(), MAX_DEST_LABEL)
      : undefined;
  const usedAi = b.used_ai === true;

  if (isPlaywrightMockSubmissionDraftReviewedPipelineEnabled()) {
    return NextResponse.json(
      buildPlaywrightMockSubmissionDraftReviewedResponse(caseId, {
        destinationLabel,
        usedAi,
      })
    );
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  if (!(await userOwnsJusticeCase(supabase, userId, caseId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const detail = buildSubmissionDraftReviewedDetail({
    destinationLabel,
    usedAi,
  });

  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID,
    type: "submission_draft_reviewed",
    label: "Submission draft reviewed",
    detail,
  });

  if (!timeline) {
    return NextResponse.json({ error: "Could not update timeline" }, { status: 500 });
  }

  return NextResponse.json({ timeline });
}
