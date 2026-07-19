import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { evaluateOwnedBbbAutofillExecutionReadiness } from "@/lib/justice/bbbOwnedFilingProduction";
import {
  findFtcFilingWithConfirmation,
  findOpenFtcFilingTask,
  hasFtcFilingWithConfirmation,
  shouldQueueFtcFilingTask,
  taskNotesMatchFtcFilingMarker,
} from "@/lib/justice/ftcFilingTask";
import {
  ftcOwnedFilingIdempotencyKey,
  ftcOwnedFilingTimelineId,
  parseFtcOwnedFilingDeliveryRecord,
  upsertFtcOwnedFilingDeliveryNotes,
  type FtcOwnedFilingDeliveryRecord,
} from "@/lib/justice/ftcOwnedFilingDeliveryState";
import { MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import { isRealFtcComplaintAutofillEnabled } from "@/lib/justice/realFtcAutofillEnabled";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

export {
  ftcOwnedFilingIdempotencyKey,
  ftcOwnedFilingTimelineId,
  isFtcOwnedFilingFailed,
  isFtcOwnedFilingSubmitting,
  parseFtcOwnedFilingDeliveryRecord,
  upsertFtcOwnedFilingDeliveryNotes,
  type FtcOwnedFilingDeliveryRecord,
  type FtcOwnedFilingDeliveryState,
} from "@/lib/justice/ftcOwnedFilingDeliveryState";

/** Canonical destination label the FTC operator-filing completion path validates against. */
export const FTC_FILING_DESTINATION = "FTC (consumer complaint)";

/** Generic confirmation stored when the portal confirmed submission but exposed no readable reference. */
export const REAL_FTC_FILING_CONFIRMATION_FALLBACK = "FTC report submitted";

/** Provider tag stored on the delivery record. */
export const FTC_OWNED_FILING_PROVIDER = "real_ftc_bounded_submit";

const FILING_SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

export type AttemptAutomatedFtcFilingResult =
  | {
      status: "queued";
      idempotent: boolean;
      task?: JusticeCaseTaskRow;
      timeline?: TimelineEntry[] | null;
    }
  | {
      status: "accepted";
      confirmation: string;
      idempotent: boolean;
      filing?: JusticeCaseFilingRow;
      task?: JusticeCaseTaskRow;
      timeline?: TimelineEntry[] | null;
    }
  | {
      status: "failed";
      error: string;
      timeline?: TimelineEntry[] | null;
    }
  | {
      status: "skipped";
      reason: string;
    };

async function patchFtcTaskNotes(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  notes: string
): Promise<JusticeCaseTaskRow | null> {
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .update({ notes })
    .eq("id", taskId)
    .eq("user_id", userId)
    .select(TASK_SELECT)
    .maybeSingle();
  if (error || !data) {
    console.warn("ftc owned filing delivery: patch task notes", error?.message ?? "failed");
    return null;
  }
  return data as JusticeCaseTaskRow;
}

/**
 * Enqueues Surrenderless-owned FTC filing for the durable background worker.
 * Never runs Playwright/Browserless on the request path — it only persists
 * `delivery_state: "queued"` and lets /api/cron/run-queued-owned-filings execute it.
 *
 * Idempotent: already filed/queued/submitting is not re-enqueued; a reconciled
 * `failed` state short-circuits so operator fallbacks are never auto-resubmitted.
 */
export async function attemptAutomatedFtcFiling(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<AttemptAutomatedFtcFilingResult> {
  const trimmedCaseId = caseId.trim();
  if (!trimmedCaseId) {
    return { status: "skipped", reason: "case_id is required" };
  }

  if (!isRealFtcComplaintAutofillEnabled()) {
    return {
      status: "skipped",
      reason: "real FTC autofill disabled — operator/manual fallback",
    };
  }

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("intake, client_state, timeline")
    .eq("id", trimmedCaseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (caseErr || !caseRow) {
    return { status: "skipped", reason: "case not found" };
  }

  const intake = caseRow.intake as JusticeIntake | null;
  if (!intake || typeof intake !== "object") {
    return { status: "skipped", reason: "invalid intake" };
  }

  const parsed = parseJusticeCaseClientState(caseRow.client_state);
  if (!parsed.prepared_packet_approved) {
    return { status: "skipped", reason: "packet not approved" };
  }
  const approved = parsed.approved_next_action;
  if (!approved || approved.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF) {
    return { status: "skipped", reason: "approved action is not FTC" };
  }
  if (approved.status === "completed") {
    return { status: "skipped", reason: "FTC already completed" };
  }

  const { data: taskRows, error: tasksErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("case_id", trimmedCaseId)
    .eq("user_id", userId);

  if (tasksErr) {
    console.warn("ftc owned filing delivery: list tasks", tasksErr.message);
    return { status: "skipped", reason: "could not list tasks" };
  }

  const { data: filingRows, error: filingsErr } = await supabase
    .from("justice_case_filings")
    .select(FILING_SELECT)
    .eq("case_id", trimmedCaseId)
    .eq("user_id", userId);

  if (filingsErr) {
    console.warn("ftc owned filing delivery: list filings", filingsErr.message);
    return { status: "skipped", reason: "could not list filings" };
  }

  const tasks = (taskRows ?? []) as JusticeCaseTaskRow[];
  const filings = (filingRows ?? []) as JusticeCaseFilingRow[];

  if (
    !shouldSuppressChatManualActionForSurrenderlessOwnedStep({
      approvedAction: approved,
      caseId: trimmedCaseId,
      tasks,
      filings,
    })
  ) {
    return { status: "skipped", reason: "step is not Surrenderless-owned" };
  }

  if (hasFtcFilingWithConfirmation(filings)) {
    const existing = findFtcFilingWithConfirmation(filings);
    return {
      status: "accepted",
      confirmation:
        existing?.confirmation_number?.trim() || REAL_FTC_FILING_CONFIRMATION_FALLBACK,
      idempotent: true,
      filing: existing,
    };
  }

  const openTask = findOpenFtcFilingTask(tasks, trimmedCaseId);
  if (!openTask) {
    return { status: "skipped", reason: "no open FTC task" };
  }
  if (!taskNotesMatchFtcFilingMarker(openTask.notes, trimmedCaseId)) {
    return { status: "skipped", reason: "task marker mismatch" };
  }

  const priorDelivery = parseFtcOwnedFilingDeliveryRecord(openTask.notes);
  if (priorDelivery?.delivery_state === "filed" && priorDelivery.confirmation) {
    return {
      status: "accepted",
      confirmation: priorDelivery.confirmation,
      idempotent: true,
      task: openTask,
    };
  }
  if (priorDelivery?.delivery_state === "submitting") {
    return {
      status: "skipped",
      reason: "FTC autofill already submitting — worker in progress",
    };
  }
  if (priorDelivery?.delivery_state === "queued") {
    return { status: "queued", idempotent: true, task: openTask };
  }
  // Failed/needs-operator short-circuit: never auto-resubmit a reconciled failure.
  if (priorDelivery?.delivery_state === "failed") {
    return {
      status: "skipped",
      reason: "FTC autofill previously failed — operator/manual fallback",
    };
  }

  // Fail closed to operator fallback when production execution config is unavailable.
  const readiness = evaluateOwnedBbbAutofillExecutionReadiness(userId);
  if (!readiness.ok) {
    return { status: "skipped", reason: readiness.reason };
  }

  const queuedAt = new Date().toISOString();
  const queuedRecord: FtcOwnedFilingDeliveryRecord = {
    delivery_state: "queued",
    provider: FTC_OWNED_FILING_PROVIDER,
    started_at: queuedAt,
  };
  const queuedNotes = upsertFtcOwnedFilingDeliveryNotes(openTask.notes, queuedRecord);
  const queuedTask = await patchFtcTaskNotes(supabase, userId, openTask.id, queuedNotes);
  if (!queuedTask) {
    return { status: "skipped", reason: "could not enqueue FTC filing" };
  }
  const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
    id: ftcOwnedFilingTimelineId(trimmedCaseId, "queued"),
    type: "filing_recorded",
    label: "FTC filing queued",
    detail: `provider: ${FTC_OWNED_FILING_PROVIDER}\nidempotency: ${ftcOwnedFilingIdempotencyKey(trimmedCaseId)}`,
    ts: queuedAt,
  });

  return { status: "queued", idempotent: false, task: queuedTask, timeline };
}

/**
 * Call after ensureFtcFilingTask when FTC is approved and owned.
 * Merges timeline from queued/accepted/failed delivery; leaves skipped open for operators.
 */
export async function attemptAutomatedFtcFilingAfterEnsure(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  currentTimeline: TimelineEntry[] | null = null
): Promise<{
  timeline: TimelineEntry[] | null;
  result: AttemptAutomatedFtcFilingResult;
}> {
  const result = await attemptAutomatedFtcFiling(supabase, userId, caseId);
  if (
    (result.status === "queued" || result.status === "accepted" || result.status === "failed") &&
    result.timeline
  ) {
    return { timeline: result.timeline, result };
  }
  return { timeline: currentTimeline, result };
}

/**
 * Safe to call after any ladder completion that may have queued FTC.
 * No-ops unless client_state currently queues the Surrenderless-owned FTC step.
 */
export async function maybeAttemptAutomatedFtcFilingForClientState(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  clientState: unknown,
  currentTimeline: TimelineEntry[] | null = null
): Promise<{
  timeline: TimelineEntry[] | null;
  result: AttemptAutomatedFtcFilingResult | { status: "skipped"; reason: string };
}> {
  if (!shouldQueueFtcFilingTask(clientState)) {
    return {
      timeline: currentTimeline,
      result: { status: "skipped", reason: "FTC not queued for this client_state" },
    };
  }
  return attemptAutomatedFtcFilingAfterEnsure(supabase, userId, caseId, currentTimeline);
}
