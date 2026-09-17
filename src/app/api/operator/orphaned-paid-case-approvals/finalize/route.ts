import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { findDurableIntendedActionForCase } from "@/lib/justice/durablePaymentIntendedAction";
import { finalizePaidPreparedPacketApproval } from "@/lib/justice/finalizePaidPreparedPacketApproval";
import { computeEligibleOrphanedPaidCaseApprovalActions } from "@/lib/justice/orphanedPaidCaseApprovalResolution";
import { taskNotesMatchOrphanedPaidCaseApprovalMarker } from "@/lib/justice/orphanedPaidCaseApprovalTask";
import { resolveCaseOwnerUserIdForOperatorFulfillment } from "@/lib/justice/operatorFulfillmentQueue";
import { justiceEvidenceRowHasUploadedFile } from "@/lib/justice/evidence";
import type { JusticeIntake } from "@/lib/justice/types";
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

const FINALIZE_STATUS_HTTP: Record<string, number> = {
  finalized: 200,
  already_finalized: 200,
  not_paid: 409,
  case_not_found: 404,
  invalid_intake: 409,
  invalid_action: 400,
  conflict_retries_exhausted: 409,
  error: 500,
};

/**
 * Operator manual resolution for an orphaned_paid_case_approval review task — the "genuinely
 * actionable" path automatic recovery (reconcileOrphanedPaidCaseApprovals.ts) deliberately
 * refuses to take on its own once intent is uncertain. The operator picks from a server-computed,
 * bounded set of eligible actions (never an arbitrary string) — the same set (plus, if present,
 * the durably-recorded metadata-bound action from the case's own Stripe payment) shown in the
 * operator fulfillment queue's orphaned_paid_case_approval_workspace. Finalizing here reuses
 * finalizePaidPreparedPacketApproval, so it gets the exact same idempotent CAS write, fulfillment-
 * task-ensure, and review-task auto-close behavior as every other finalization path.
 *
 * Requires task_id: the caller must name an actual open orphaned_paid_case_approval task bound
 * to case_id, verified against justice_case_tasks directly (not merely inferred from case_id
 * alone) — this can only ever act on a case the automated system genuinely flagged, never an
 * arbitrary paid case an operator happens to know the id of.
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
  const href = typeof b.href === "string" ? b.href.trim() : "";
  if (!caseId || !isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }
  if (!taskId || !isUuid(taskId)) {
    return NextResponse.json({ error: "Invalid task_id" }, { status: 400 });
  }
  if (!href) {
    return NextResponse.json({ error: "Invalid href" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return supabaseUnavailableResponse();

  const owner = await resolveCaseOwnerUserIdForOperatorFulfillment(supabase, caseId);
  if (!owner.ok) {
    return NextResponse.json({ error: owner.error }, { status: owner.status });
  }
  const userId = owner.userId;

  // Require proof the automated system actually flagged this exact case for manual review —
  // never let an operator finalize an action against a case that was never actually orphaned,
  // even though the eligibility check below would still refuse an illegitimate href on its own.
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
    .select("intake")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (caseErr) {
    return NextResponse.json({ error: caseErr.message }, { status: 500 });
  }
  if (!caseRow || !isJusticeIntakePayload(caseRow.intake)) {
    return NextResponse.json({ error: "Case intake is not valid" }, { status: 409 });
  }
  const intake = caseRow.intake as JusticeIntake;

  const { data: evidenceRows, error: evidenceErr } = await supabase
    .from("justice_case_evidence")
    .select("file_name, mime_type, file_size_bytes")
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .limit(200);
  if (evidenceErr) {
    return NextResponse.json({ error: evidenceErr.message }, { status: 500 });
  }
  const hasUploadedEvidenceFile = (evidenceRows ?? []).some(justiceEvidenceRowHasUploadedFile);

  const eligible = computeEligibleOrphanedPaidCaseApprovalActions(intake, {
    hasUploadedEvidenceFile,
  });
  const durable = await findDurableIntendedActionForCase(supabase, caseId);

  const matchFromEligible = eligible.find((a) => a.href === href);
  const matchesDurable = durable?.href === href;
  if (!matchFromEligible && !matchesDurable) {
    return NextResponse.json(
      { error: "Selected action is not eligible for this case." },
      { status: 400 }
    );
  }
  const label = matchFromEligible?.label || (matchesDurable ? durable?.label : undefined) || href;

  const result = await finalizePaidPreparedPacketApproval(supabase, {
    caseId,
    userId,
    intendedAction: { href, label },
  });

  const status = FINALIZE_STATUS_HTTP[result.status] ?? 500;
  if (status >= 400) {
    const error = result.status === "error" ? result.error : result.status;
    return NextResponse.json({ error }, { status });
  }

  return NextResponse.json({ ok: true, status: result.status });
}
