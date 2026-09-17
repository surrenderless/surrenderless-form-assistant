import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { resolveCaseOwnerUserIdForOperatorFulfillment } from "@/lib/justice/operatorFulfillmentQueue";
import { taskNotesMatchOrphanedPaidCaseApprovalMarker } from "@/lib/justice/orphanedPaidCaseApprovalTask";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

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

/**
 * Operator repair of a case's stored intake, scoped strictly to unblocking an
 * orphaned_paid_case_approval review flagged invalid_intake — the one review reason no other
 * code path in this codebase can ever resolve (listOperatorFulfillmentQueue otherwise excludes
 * any case with invalid intake outright, and the finalize endpoint independently refuses to act
 * on one). This does not approve anything or touch client_state; it only replaces intake with a
 * corrected, validated payload so the case can then be resolved normally through the existing
 * finalize endpoint. Requires the same open-task binding as finalize, for the same reason: an
 * operator may only ever act on a case the automated system genuinely flagged.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
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
  if (!caseId || !isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }
  if (!taskId || !isUuid(taskId)) {
    return NextResponse.json({ error: "Invalid task_id" }, { status: 400 });
  }
  if (!isJusticeIntakePayload(b.intake)) {
    return NextResponse.json({ error: "Corrected intake is not valid." }, { status: 400 });
  }
  const intake = b.intake;

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  const owner = await resolveCaseOwnerUserIdForOperatorFulfillment(supabase, caseId);
  if (!owner.ok) {
    return NextResponse.json({ error: owner.error }, { status: owner.status });
  }
  const userId = owner.userId;

  const { data: reviewTaskRow, error: reviewTaskErr } = await supabase
    .from("justice_case_tasks")
    .select("id, case_id, notes, completed_at")
    .eq("id", taskId)
    .eq("case_id", caseId)
    .maybeSingle();
  if (reviewTaskErr) {
    return NextResponse.json({ error: reviewTaskErr.message }, { status: 500 });
  }
  if (
    !reviewTaskRow ||
    reviewTaskRow.completed_at ||
    !taskNotesMatchOrphanedPaidCaseApprovalMarker(reviewTaskRow.notes, caseId)
  ) {
    return NextResponse.json(
      { error: "No open orphaned-paid-case-approval review task bound to this case." },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("justice_cases")
    .update({ intake })
    .eq("id", caseId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `orphaned_paid_case_approval_intake_repaired:${taskId}:${Date.now()}`,
    type: "task_added",
    label: "Operator corrected case intake",
    detail: "Corrected via orphaned paid case approval review",
  });

  return NextResponse.json({ ok: true });
}
