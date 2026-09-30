import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { resolveCaseOwnerUserIdForOperatorFulfillment } from "@/lib/justice/operatorFulfillmentQueue";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";

const RPC_NAME = "repair_orphaned_paid_case_approval_intake";

export const REPAIR_INTAKE_CONFLICT_ERROR =
  "Case intake was updated concurrently. Reload and retry.";
export const REPAIR_INTAKE_TASK_CONFLICT_ERROR =
  "No open orphaned-paid-case-approval review task bound to this case.";

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

type RepairRpcResult = {
  status: "applied" | "already_applied" | "conflict" | "task_conflict" | "not_found" | "invalid_input";
  case_version?: number;
  case_intake?: unknown;
  audit_event_id?: string;
};

function isRepairRpcResult(value: unknown): value is RepairRpcResult {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

/**
 * Operator repair of a case's stored intake, scoped strictly to unblocking an
 * orphaned_paid_case_approval review flagged invalid_intake — the one review reason no other
 * code path in this codebase can ever resolve (listOperatorFulfillmentQueue otherwise excludes
 * any case with invalid intake outright, and the finalize endpoint independently refuses to act
 * on one). This does not approve anything or touch client_state; it only replaces intake with a
 * corrected, validated payload so the case can then be resolved normally through the existing
 * finalize endpoint.
 *
 * Everything that matters — the task-binding check, the compare-and-swap on case_version, the
 * intake write, and the immutable audit event — happens inside one Postgres transaction via the
 * repair_orphaned_paid_case_approval_intake RPC (see
 * supabase/migrations/20260917120000_justice_case_audit_events.sql): either all of it commits or
 * none of it does, so a failure between "intake saved" and "audit recorded" is structurally
 * impossible, not merely retried. The audit event lives in justice_case_audit_events, a table no
 * role (including service_role) is ever granted UPDATE or DELETE on — no consumer write to
 * justice_cases.intake or .timeline can ever erase it. The concurrency token is case_version — a
 * monotonic integer bumped by exactly 1 on every UPDATE, never updated_at (a wall-clock timestamp
 * proven able to repeat across genuinely sequential writes, which let racing operator requests
 * both "win" in a third to half of trials against real Postgres with no sleep involved). The RPC's
 * idempotency key is derived from the task, the expected prior case_version, and the exact
 * corrected content: an identical retry reuses the same key (a genuine no-op), while a second,
 * distinct correction for the same still-open task — even one that reverts to earlier content —
 * gets its own key and its own audit event.
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
  const expectedCaseVersion = b.expected_case_version;
  if (!caseId || !isUuid(caseId)) {
    return NextResponse.json({ error: "Invalid case_id" }, { status: 400 });
  }
  if (!taskId || !isUuid(taskId)) {
    return NextResponse.json({ error: "Invalid task_id" }, { status: 400 });
  }
  if (typeof expectedCaseVersion !== "number" || !Number.isInteger(expectedCaseVersion) || expectedCaseVersion < 0) {
    return NextResponse.json(
      { error: "Invalid expected_case_version: must be a non-negative integer" },
      { status: 400 }
    );
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

  const { data, error } = await supabase.rpc(RPC_NAME, {
    p_case_id: caseId,
    p_task_id: taskId,
    p_user_id: userId,
    p_expected_case_version: expectedCaseVersion,
    p_new_intake: intake,
    p_actor: auth.operatorUserId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!isRepairRpcResult(data)) {
    return NextResponse.json({ error: "Unexpected response from intake repair" }, { status: 500 });
  }

  switch (data.status) {
    case "applied":
    case "already_applied":
      return NextResponse.json({ ok: true });
    case "conflict":
      return NextResponse.json({ error: REPAIR_INTAKE_CONFLICT_ERROR }, { status: 409 });
    case "task_conflict":
      return NextResponse.json({ error: REPAIR_INTAKE_TASK_CONFLICT_ERROR }, { status: 409 });
    case "not_found":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "invalid_input":
    default:
      return NextResponse.json({ error: "Could not repair intake" }, { status: 400 });
  }
}
