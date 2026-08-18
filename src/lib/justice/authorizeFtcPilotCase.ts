import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import {
  findOpenFtcFilingTask,
  hasFtcFilingWithConfirmation,
  taskNotesMatchFtcFilingMarker,
} from "@/lib/justice/ftcFilingTask";
import { parseFtcOwnedFilingDeliveryRecord } from "@/lib/justice/ftcOwnedFilingDeliveryState";
import {
  parseFtcPilotAuthorizationRecord,
  upsertFtcPilotAuthorizationNotes,
  type FtcPilotAuthorizationRecord,
} from "@/lib/justice/ftcPilotAuthorizationState";
import { MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;
const FILING_SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

export function ftcPilotAuthorizedTimelineId(caseId: string): string {
  return `ftc_pilot_authorized:${caseId.trim()}`;
}

export type AuthorizeFtcPilotCaseResult =
  | { ok: true; task: JusticeCaseTaskRow; authorizedAt: string; idempotent: boolean }
  | { ok: false; error: string; status: number };

/**
 * Operator-authenticated verification + authorization of a single case for the FTC live pilot.
 * Never trusts the caller's own judgment: independently re-verifies the SAME consumer-approval
 * and no-conflicting-state conditions attemptAutomatedFtcFiling checks, so an operator cannot
 * authorize a case that isn't genuinely eligible. Writes only a task-notes marker (who/when) — it
 * does not touch OWNED_FILING_SUBMIT_ARMED or OWNED_FILING_LIVE_CASE_ALLOWLIST, both of which
 * remain independently required at claim and execute time.
 */
export async function authorizeFtcPilotCase(
  supabase: SupabaseClient,
  operatorUserId: string,
  caseId: string
): Promise<AuthorizeFtcPilotCaseResult> {
  const trimmedCaseId = caseId.trim();
  if (!trimmedCaseId) {
    return { ok: false, error: "case_id is required", status: 400 };
  }

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("user_id, client_state")
    .eq("id", trimmedCaseId)
    .maybeSingle();
  if (caseErr || !caseRow) {
    return { ok: false, error: "case not found", status: 404 };
  }

  const ownerUserId = String((caseRow as { user_id?: unknown }).user_id ?? "").trim();
  if (!ownerUserId) {
    return { ok: false, error: "case owner not found", status: 404 };
  }

  const parsed = parseJusticeCaseClientState((caseRow as { client_state?: unknown }).client_state);
  if (!parsed.prepared_packet_approved) {
    return { ok: false, error: "consumer has not approved the prepared packet", status: 409 };
  }
  const approved = parsed.approved_next_action;
  if (!approved || approved.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF) {
    return { ok: false, error: "consumer's approved next action is not FTC", status: 409 };
  }
  if (approved.status === "completed") {
    return { ok: false, error: "FTC filing is already completed for this case", status: 409 };
  }

  const { data: taskRows, error: tasksErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("case_id", trimmedCaseId)
    .eq("user_id", ownerUserId);
  if (tasksErr) {
    return { ok: false, error: "could not list tasks", status: 500 };
  }

  const { data: filingRows, error: filingsErr } = await supabase
    .from("justice_case_filings")
    .select(FILING_SELECT)
    .eq("case_id", trimmedCaseId)
    .eq("user_id", ownerUserId);
  if (filingsErr) {
    return { ok: false, error: "could not list filings", status: 500 };
  }

  const tasks = (taskRows ?? []) as JusticeCaseTaskRow[];
  const filings = (filingRows ?? []) as JusticeCaseFilingRow[];

  if (hasFtcFilingWithConfirmation(filings)) {
    return { ok: false, error: "FTC is already filed with a recorded confirmation", status: 409 };
  }

  const openTask = findOpenFtcFilingTask(tasks, trimmedCaseId);
  if (!openTask) {
    return { ok: false, error: "no open FTC filing task for this case", status: 404 };
  }
  if (!taskNotesMatchFtcFilingMarker(openTask.notes, trimmedCaseId)) {
    return { ok: false, error: "task marker mismatch", status: 409 };
  }

  const priorDelivery = parseFtcOwnedFilingDeliveryRecord(openTask.notes);
  if (priorDelivery?.delivery_state === "filed" || priorDelivery?.delivery_state === "submitting") {
    return {
      ok: false,
      error: `FTC autofill is already ${priorDelivery.delivery_state} — cannot authorize`,
      status: 409,
    };
  }

  // Idempotent: an existing authorization is preserved, not silently overwritten by a second
  // call — who/when authorized a live pilot is an audit fact, not something to quietly replace.
  const existing = parseFtcPilotAuthorizationRecord(openTask.notes);
  if (existing) {
    return { ok: true, task: openTask, authorizedAt: existing.authorized_at, idempotent: true };
  }

  const authorizedAt = new Date().toISOString();
  const record: FtcPilotAuthorizationRecord = {
    authorized_by: operatorUserId,
    authorized_at: authorizedAt,
  };
  const nextNotes = upsertFtcPilotAuthorizationNotes(openTask.notes, record);

  const { data: patched, error: patchErr } = await supabase
    .from("justice_case_tasks")
    .update({ notes: nextNotes })
    .eq("id", openTask.id)
    .eq("notes", openTask.notes ?? "")
    .is("completed_at", null)
    .select(TASK_SELECT)
    .maybeSingle();
  if (patchErr || !patched) {
    return {
      ok: false,
      error: "could not record pilot authorization — task changed concurrently",
      status: 409,
    };
  }

  await appendCaseTimelineEntry(supabase, ownerUserId, trimmedCaseId, {
    id: ftcPilotAuthorizedTimelineId(trimmedCaseId),
    type: "filing_recorded",
    label: "FTC live pilot authorized",
    detail: `authorized_by: ${operatorUserId}\nauthorized_at: ${authorizedAt}`,
    ts: authorizedAt,
  });

  return { ok: true, task: patched as JusticeCaseTaskRow, authorizedAt, idempotent: false };
}
