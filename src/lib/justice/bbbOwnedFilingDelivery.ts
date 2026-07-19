import type { SupabaseClient } from "@supabase/supabase-js";
import { REAL_BBB_ASSISTED_SUBMISSION_LANE } from "@/lib/justice/assistedSubmissionLane";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import {
  bbbFilingsForManualTracking,
  findOpenBbbFilingTask,
  hasBbbFilingWithConfirmation,
  shouldQueueBbbFilingTask,
  taskNotesMatchBbbFilingMarker,
} from "@/lib/justice/bbbFilingTask";
import { getBbbOwnedFilingSubmitContext } from "@/lib/justice/bbbOwnedFilingSubmitContext";
import { evaluateOwnedBbbAutofillExecutionReadiness } from "@/lib/justice/bbbOwnedFilingProduction";
import {
  bbbOwnedFilingIdempotencyKey,
  bbbOwnedFilingTimelineId,
  parseBbbOwnedFilingDeliveryRecord,
  upsertBbbOwnedFilingDeliveryNotes,
  type BbbOwnedFilingDeliveryRecord,
} from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import { isRealBbbComplaintAutofillEnabled } from "@/lib/justice/realBbbAutofillEnabled";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

export {
  bbbOwnedFilingIdempotencyKey,
  bbbOwnedFilingTimelineId,
  isBbbOwnedFilingFailed,
  isBbbOwnedFilingSubmitting,
  parseBbbOwnedFilingDeliveryRecord,
  upsertBbbOwnedFilingDeliveryNotes,
  type BbbOwnedFilingDeliveryRecord,
  type BbbOwnedFilingDeliveryState,
} from "@/lib/justice/bbbOwnedFilingDeliveryState";

/** Provider tag stored on the delivery record. */
export const BBB_OWNED_FILING_PROVIDER = "real_bbb_bounded_submit";

const FILING_SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

export type AttemptAutomatedBbbFilingResult =
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

async function patchBbbTaskNotes(
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
    console.warn("bbb owned filing delivery: patch task notes", error?.message ?? "failed");
    return null;
  }
  return data as JusticeCaseTaskRow;
}

/**
 * Enqueues Surrenderless-owned BBB filing for the durable background worker.
 * Never runs Playwright/Browserless on the request path — it only persists
 * `delivery_state: "queued"` and lets /api/cron/run-queued-owned-filings execute it.
 *
 * Idempotent: already filed/queued/submitting is not re-enqueued; a reconciled
 * `failed` state short-circuits so operator fallbacks are never auto-resubmitted.
 */
export async function attemptAutomatedBbbFiling(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<AttemptAutomatedBbbFilingResult> {
  const trimmedCaseId = caseId.trim();
  if (!trimmedCaseId) {
    return { status: "skipped", reason: "case_id is required" };
  }

  if (!isRealBbbComplaintAutofillEnabled()) {
    return {
      status: "skipped",
      reason: "real BBB autofill disabled — operator/manual fallback",
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
  if (!approved || approved.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF) {
    return { status: "skipped", reason: "approved action is not BBB" };
  }
  if (approved.status === "completed") {
    return { status: "skipped", reason: "BBB already completed" };
  }

  const { data: taskRows, error: tasksErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("case_id", trimmedCaseId)
    .eq("user_id", userId);

  if (tasksErr) {
    console.warn("bbb owned filing delivery: list tasks", tasksErr.message);
    return { status: "skipped", reason: "could not list tasks" };
  }

  const { data: filingRows, error: filingsErr } = await supabase
    .from("justice_case_filings")
    .select(FILING_SELECT)
    .eq("case_id", trimmedCaseId)
    .eq("user_id", userId);

  if (filingsErr) {
    console.warn("bbb owned filing delivery: list filings", filingsErr.message);
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

  if (hasBbbFilingWithConfirmation(filings)) {
    const existing = bbbFilingsForManualTracking(filings).find((f) =>
      Boolean(f.confirmation_number?.trim())
    );
    return {
      status: "accepted",
      confirmation:
        existing?.confirmation_number?.trim() ||
        REAL_BBB_ASSISTED_SUBMISSION_LANE.filingConfirmation,
      idempotent: true,
      filing: existing,
    };
  }

  const openTask = findOpenBbbFilingTask(tasks, trimmedCaseId);
  if (!openTask) {
    return { status: "skipped", reason: "no open BBB task" };
  }
  if (!taskNotesMatchBbbFilingMarker(openTask.notes, trimmedCaseId)) {
    return { status: "skipped", reason: "task marker mismatch" };
  }

  const priorDelivery = parseBbbOwnedFilingDeliveryRecord(openTask.notes);
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
      reason: "BBB autofill already submitting — worker in progress",
    };
  }
  if (priorDelivery?.delivery_state === "queued") {
    return { status: "queued", idempotent: true, task: openTask };
  }
  // Failed/needs-operator short-circuit: never auto-resubmit a reconciled failure.
  if (priorDelivery?.delivery_state === "failed") {
    return {
      status: "skipped",
      reason: "BBB autofill previously failed — operator/manual fallback",
    };
  }

  // Fail closed to operator fallback when production execution config is unavailable.
  const overrideBase = getBbbOwnedFilingSubmitContext()?.base?.trim();
  const readiness = evaluateOwnedBbbAutofillExecutionReadiness(userId);
  if (!readiness.ok && !overrideBase) {
    return { status: "skipped", reason: readiness.reason };
  }

  const queuedAt = new Date().toISOString();
  const queuedRecord: BbbOwnedFilingDeliveryRecord = {
    delivery_state: "queued",
    provider: BBB_OWNED_FILING_PROVIDER,
    started_at: queuedAt,
  };
  const queuedNotes = upsertBbbOwnedFilingDeliveryNotes(openTask.notes, queuedRecord);
  const queuedTask = await patchBbbTaskNotes(supabase, userId, openTask.id, queuedNotes);
  if (!queuedTask) {
    return { status: "skipped", reason: "could not enqueue BBB filing" };
  }
  const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
    id: bbbOwnedFilingTimelineId(trimmedCaseId, "queued"),
    type: "filing_recorded",
    label: "BBB filing queued",
    detail: `provider: ${BBB_OWNED_FILING_PROVIDER}\nidempotency: ${bbbOwnedFilingIdempotencyKey(trimmedCaseId)}`,
    ts: queuedAt,
  });

  return { status: "queued", idempotent: false, task: queuedTask, timeline };
}

/**
 * Call after ensureBbbFilingTask when BBB is approved and owned.
 * Merges timeline from queued/accepted/failed delivery; leaves skipped open for operators.
 */
export async function attemptAutomatedBbbFilingAfterEnsure(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  currentTimeline: TimelineEntry[] | null = null
): Promise<{
  timeline: TimelineEntry[] | null;
  result: AttemptAutomatedBbbFilingResult;
}> {
  const result = await attemptAutomatedBbbFiling(supabase, userId, caseId);
  if (
    (result.status === "queued" || result.status === "accepted" || result.status === "failed") &&
    result.timeline
  ) {
    return { timeline: result.timeline, result };
  }
  return { timeline: currentTimeline, result };
}

/**
 * Safe to call after any ladder completion that may have queued BBB.
 * No-ops unless client_state currently queues the Surrenderless-owned BBB step.
 */
export async function maybeAttemptAutomatedBbbFilingForClientState(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  clientState: unknown,
  currentTimeline: TimelineEntry[] | null = null
): Promise<{
  timeline: TimelineEntry[] | null;
  result: AttemptAutomatedBbbFilingResult | { status: "skipped"; reason: string };
}> {
  if (!shouldQueueBbbFilingTask(clientState)) {
    return {
      timeline: currentTimeline,
      result: { status: "skipped", reason: "BBB not queued for this client_state" },
    };
  }
  return attemptAutomatedBbbFilingAfterEnsure(supabase, userId, caseId, currentTimeline);
}
