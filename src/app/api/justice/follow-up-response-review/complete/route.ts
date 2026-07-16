import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import {
  completeFollowUpResponseReview,
  isFollowUpResponseReviewOutcome,
} from "@/lib/justice/completeFollowUpResponseReview";
import { resolveCaseOwnerUserIdForOperatorFulfillment } from "@/lib/justice/operatorFulfillmentQueue";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";

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
  const auth = await requireOperatorApiAccess(req);
  if (!auth.ok) return auth.response;

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

  if (!isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }
  if (!isUuid(taskId)) {
    return NextResponse.json({ error: "Invalid task_id" }, { status: 400 });
  }
  if (!isFollowUpResponseReviewOutcome(b.outcome)) {
    return NextResponse.json(
      { error: "outcome must be resolved, no_resolution, or further_escalation" },
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

  const ownerResult = await resolveCaseOwnerUserIdForOperatorFulfillment(supabase, caseId);
  if (!ownerResult.ok) {
    return NextResponse.json({ error: ownerResult.error }, { status: ownerResult.status });
  }

  const result = await completeFollowUpResponseReview(supabase, ownerResult.userId, {
    caseId,
    taskId,
    outcome: b.outcome,
    notes,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    task: result.task,
    client_state: result.clientState,
    intake: result.intake,
    timeline: result.timeline,
    outcome: result.outcome,
    advanced: result.advanced,
    ...(result.advanced_href ? { advanced_href: result.advanced_href } : {}),
    idempotent: result.idempotent,
    archived: false,
  });
}
