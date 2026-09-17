import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { jsonDeepEqual } from "@/lib/jsonDeepEqual";
import { resolveCaseOwnerUserIdForOperatorFulfillment } from "@/lib/justice/operatorFulfillmentQueue";
import { taskNotesMatchOrphanedPaidCaseApprovalMarker } from "@/lib/justice/orphanedPaidCaseApprovalTask";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

export const REPAIR_INTAKE_CONFLICT_ERROR =
  "Case intake was updated concurrently. Reload and retry.";
export const REPAIR_INTAKE_AUDIT_FAILED_ERROR =
  "Intake was saved but the audit trail entry could not be recorded. Retry — the intake write is idempotent and will not be repeated.";

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

function repairIntakeAuditTimelineId(taskId: string): string {
  // Deterministic and keyed only by task_id (never a timestamp) — a review task can only ever be
  // repaired once in the sense that matters here, so this both dedupes appendCaseTimelineEntry's
  // own idempotent-by-id write AND makes a retry after a partial failure land on the exact same
  // entry instead of accumulating a new one per attempt.
  return `orphaned_paid_case_approval_intake_repaired:${taskId}`;
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
 *
 * Concurrency: requires expected_updated_at (the case row's updated_at at the moment the
 * operator loaded the raw intake for editing) and applies it as a compare-and-swap, exactly like
 * updateClientStateIfUnchanged does for client_state elsewhere in this codebase. A genuine
 * conflicting concurrent write (a different operator, or any other writer) fails the CAS and
 * returns 409. An identical retry of the SAME already-applied intake — including one that races
 * against, or follows, its own earlier successful write and so no longer matches the stale
 * expected_updated_at it was sent with — is detected by comparing the currently-stored intake to
 * the one being submitted and treated as a no-op success rather than a spurious conflict.
 *
 * Durable audit trail: the response never reports success until the deterministic timeline entry
 * (repairIntakeAuditTimelineId, keyed only by task_id) is confirmed written. If the intake write
 * succeeds but the timeline write fails, the endpoint returns an error rather than {ok:true}; a
 * retry with the same body finds the intake already matches (idempotent no-op on the write) and
 * proceeds straight to re-attempting only the missing timeline entry — never re-applying the
 * intake, so it can never clobber a newer, different write made in between.
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
  const expectedUpdatedAt =
    typeof b.expected_updated_at === "string" ? b.expected_updated_at.trim() : "";
  if (!caseId || !isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }
  if (!taskId || !isUuid(taskId)) {
    return NextResponse.json({ error: "Invalid task_id" }, { status: 400 });
  }
  if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
    return NextResponse.json({ error: "Invalid expected_updated_at" }, { status: 400 });
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

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("intake, updated_at")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (caseErr) {
    return NextResponse.json({ error: caseErr.message }, { status: 500 });
  }
  if (!caseRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const alreadyApplied = jsonDeepEqual(caseRow.intake, intake);

  if (!alreadyApplied) {
    const { data: updated, error: updateErr } = await supabase
      .from("justice_cases")
      .update({ intake })
      .eq("id", caseId)
      .eq("user_id", userId)
      .eq("updated_at", expectedUpdatedAt)
      .select("id")
      .maybeSingle();
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
    if (!updated) {
      // CAS miss: something changed the row since the operator loaded it. Re-read fresh and tell
      // a genuine conflict (a different intake now stored) apart from our own retry racing itself
      // (the currently-stored intake already exactly matches what we're trying to write) —
      // the latter is not an error, it just means the write already happened.
      const { data: freshRow, error: freshErr } = await supabase
        .from("justice_cases")
        .select("intake")
        .eq("id", caseId)
        .eq("user_id", userId)
        .maybeSingle();
      if (freshErr) {
        return NextResponse.json({ error: freshErr.message }, { status: 500 });
      }
      if (!freshRow) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (!jsonDeepEqual(freshRow.intake, intake)) {
        return NextResponse.json({ error: REPAIR_INTAKE_CONFLICT_ERROR }, { status: 409 });
      }
      // Else: the exact intake we wanted is already there (our own prior attempt, or a
      // concurrent identical repair) — fall through to the durable audit-trail step as a no-op.
    }
  }

  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: repairIntakeAuditTimelineId(taskId),
    type: "task_added",
    label: "Operator corrected case intake",
    detail: "Corrected via orphaned paid case approval review",
  });

  if (!timeline) {
    return NextResponse.json({ error: REPAIR_INTAKE_AUDIT_FAILED_ERROR }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
