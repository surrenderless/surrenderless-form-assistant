import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { completeSupersededLaneReviewTask } from "@/lib/justice/completeSupersededLaneReviewTask";
import { isSupersededLaneReviewOutcome } from "@/lib/justice/followUpResponseReviewTask";
import { SUPPORTED_SUPERSEDED_LANE_HREFS } from "@/lib/justice/processDueFollowUps";
import { getUserOr401 } from "@/server/requireUser";

/**
 * Consumer-facing counterpart to /api/justice/follow-up-response-review/complete-superseded
 * (operator-only). Lets the signed-in case owner report whether a SUPERSEDED escalation lane
 * (one the ladder has already moved past) ever got a response — never touches the case's
 * current approved_next_action, which belongs entirely to whichever lane is now current.
 */

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
  const taskId = typeof b.task_id === "string" ? b.task_id.trim() : "";
  const ownerHref = typeof b.owner_href === "string" ? b.owner_href.trim() : "";

  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }
  if (!isUuid(taskId)) {
    return NextResponse.json({ error: "Invalid task_id" }, { status: 400 });
  }
  if (!SUPPORTED_SUPERSEDED_LANE_HREFS.has(ownerHref)) {
    return NextResponse.json({ error: "Invalid or unsupported owner_href" }, { status: 400 });
  }
  if (!isSupersededLaneReviewOutcome(b.outcome)) {
    return NextResponse.json(
      { error: "outcome must be response_received or no_response" },
      { status: 400 }
    );
  }

  const notes =
    b.notes === undefined || b.notes === null
      ? null
      : typeof b.notes === "string"
        ? b.notes
        : undefined;
  if (notes === undefined) {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  // completeSupersededLaneReviewTask scopes every query by user_id, so passing the
  // authenticated consumer's own userId (not an operator-resolved case-owner lookup) is both
  // correct and the whole of the authorization check here.
  const result = await completeSupersededLaneReviewTask(supabase, userId, {
    caseId,
    taskId,
    ownerHref,
    outcome: b.outcome,
    notes,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    task: result.task,
    timeline: result.timeline,
    outcome: result.outcome,
    idempotent: result.idempotent,
  });
}
