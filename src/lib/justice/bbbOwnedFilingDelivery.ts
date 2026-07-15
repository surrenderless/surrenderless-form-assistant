import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REAL_BBB_ASSISTED_SUBMISSION_LANE,
  REAL_BBB_COMPLAINT_FILING_DESTINATION,
  REAL_BBB_COMPLAINT_SUBMISSION_URL,
} from "@/lib/justice/assistedSubmissionLane";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import {
  bbbFilingsForManualTracking,
  findOpenBbbFilingTask,
  hasBbbFilingWithConfirmation,
  shouldQueueBbbFilingTask,
  taskNotesMatchBbbFilingMarker,
} from "@/lib/justice/bbbFilingTask";
import {
  getBbbOwnedFilingSubmitContext,
  type BbbOwnedFilingSubmitContext,
} from "@/lib/justice/bbbOwnedFilingSubmitContext";
import { evaluateOwnedBbbAutofillExecutionReadiness } from "@/lib/justice/bbbOwnedFilingProduction";
import {
  bbbOwnedFilingIdempotencyKey,
  bbbOwnedFilingTimelineId,
  parseBbbOwnedFilingDeliveryRecord,
  upsertBbbOwnedFilingDeliveryNotes,
  type BbbOwnedFilingDeliveryRecord,
} from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { completeBbbOperatorFiling } from "@/lib/justice/completeBbbOperatorFiling";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import { isRealBbbComplaintAutofillEnabled } from "@/lib/justice/realBbbAutofillEnabled";
import { intakeToRealBbbUserData } from "@/lib/justice/realBbbUserData";
import { runRealBbbBoundedSubmit } from "@/lib/justice/runRealBbbBoundedSubmit";
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

const FILING_SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

export type AttemptAutomatedBbbFilingResult =
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
 * Runs Surrenderless-owned BBB filing via the existing real BBB bounded-submit path.
 * Completes the operator task only after terminal confirmation is returned.
 * Idempotent on filed confirmations; concurrent submitting skips; failed leaves task open.
 */
export async function attemptAutomatedBbbFiling(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  submitContext?: BbbOwnedFilingSubmitContext | null
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
      reason: "BBB autofill already submitting — operator/manual fallback",
    };
  }

  const readiness = evaluateOwnedBbbAutofillExecutionReadiness(userId);
  if (!readiness.ok) {
    return { status: "skipped", reason: readiness.reason };
  }

  const overrideBase = submitContext?.base?.trim() || getBbbOwnedFilingSubmitContext()?.base?.trim();
  const base = (overrideBase || readiness.base).replace(/\/$/, "");
  const forwardedHeaders = readiness.forwardedHeaders;

  const provider = "real_bbb_bounded_submit";
  const startedAt = new Date().toISOString();
  const submittingRecord: BbbOwnedFilingDeliveryRecord = {
    delivery_state: "submitting",
    provider,
    started_at: startedAt,
  };
  const submittingNotes = upsertBbbOwnedFilingDeliveryNotes(openTask.notes, submittingRecord);
  const submittingTask = await patchBbbTaskNotes(
    supabase,
    userId,
    openTask.id,
    submittingNotes
  );
  await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
    id: bbbOwnedFilingTimelineId(trimmedCaseId, "submitting"),
    type: "filing_recorded",
    label: "BBB filing submitting",
    detail: `provider: ${provider}\nidempotency: ${bbbOwnedFilingIdempotencyKey(trimmedCaseId)}`,
    ts: startedAt,
  });

  let bounded;
  try {
    bounded = await runRealBbbBoundedSubmit({
      url: REAL_BBB_COMPLAINT_SUBMISSION_URL,
      userData: intakeToRealBbbUserData(intake),
      base,
      forwardedHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const failedAt = new Date().toISOString();
    const failedRecord: BbbOwnedFilingDeliveryRecord = {
      delivery_state: "failed",
      provider,
      started_at: startedAt,
      completed_at: failedAt,
      failure_detail: message.slice(0, 500),
    };
    await patchBbbTaskNotes(
      supabase,
      userId,
      openTask.id,
      upsertBbbOwnedFilingDeliveryNotes(submittingTask?.notes ?? submittingNotes, failedRecord)
    );
    const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
      id: bbbOwnedFilingTimelineId(trimmedCaseId, "failed"),
      type: "filing_recorded",
      label: "BBB filing failed",
      detail: failedRecord.failure_detail,
      ts: failedAt,
    });
    return { status: "failed", error: message, timeline };
  }

  if (!bounded.ok) {
    const failedAt = new Date().toISOString();
    const failedRecord: BbbOwnedFilingDeliveryRecord = {
      delivery_state: "failed",
      provider,
      started_at: startedAt,
      completed_at: failedAt,
      failure_detail: bounded.error.slice(0, 500),
      stop_reason: bounded.stopReason,
    };
    await patchBbbTaskNotes(
      supabase,
      userId,
      openTask.id,
      upsertBbbOwnedFilingDeliveryNotes(submittingTask?.notes ?? submittingNotes, failedRecord)
    );
    const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
      id: bbbOwnedFilingTimelineId(trimmedCaseId, "failed"),
      type: "filing_recorded",
      label: "BBB filing failed",
      detail: [
        `error: ${bounded.error.slice(0, 500)}`,
        `stop_reason: ${bounded.stopReason}`,
        `steps_executed: ${bounded.stepsExecuted}`,
      ].join("\n"),
      ts: failedAt,
    });
    return { status: "failed", error: bounded.error, timeline };
  }

  const confirmation = REAL_BBB_ASSISTED_SUBMISSION_LANE.filingConfirmation;
  const destination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF) ??
    REAL_BBB_COMPLAINT_FILING_DESTINATION;
  const filedAt = new Date().toISOString().slice(0, 10);
  const completeResult = await completeBbbOperatorFiling(supabase, userId, {
    caseId: trimmedCaseId,
    taskId: openTask.id,
    destination,
    filedAt,
    confirmationNumber: confirmation,
    notes: [
      `provider: ${provider}`,
      `delivery_state: filed`,
      `confirmation: ${confirmation}`,
      `idempotency: ${bbbOwnedFilingIdempotencyKey(trimmedCaseId)}`,
      `steps_executed: ${bounded.fillResult.stepsExecuted}`,
      `completed_at: ${new Date().toISOString()}`,
    ].join("\n"),
  });

  if (!completeResult.ok) {
    const failedAt = new Date().toISOString();
    const failedRecord: BbbOwnedFilingDeliveryRecord = {
      delivery_state: "failed",
      provider,
      started_at: startedAt,
      completed_at: failedAt,
      confirmation,
      failure_detail: `Terminal confirmation returned but completion failed: ${completeResult.error}`.slice(
        0,
        500
      ),
    };
    await patchBbbTaskNotes(
      supabase,
      userId,
      openTask.id,
      upsertBbbOwnedFilingDeliveryNotes(submittingTask?.notes ?? submittingNotes, failedRecord)
    );
    const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
      id: bbbOwnedFilingTimelineId(trimmedCaseId, "failed"),
      type: "filing_recorded",
      label: "BBB filing failed",
      detail: failedRecord.failure_detail,
      ts: failedAt,
    });
    return { status: "failed", error: completeResult.error, timeline };
  }

  const filedTs = new Date().toISOString();
  await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
    id: bbbOwnedFilingTimelineId(trimmedCaseId, "filed"),
    type: "filing_recorded",
    label: "BBB filing filed",
    detail: [
      `provider: ${provider}`,
      `confirmation: ${confirmation}`,
      `steps_executed: ${bounded.fillResult.stepsExecuted}`,
      `completed_at: ${filedTs}`,
    ].join("\n"),
    ts: filedTs,
  });

  return {
    status: "accepted",
    confirmation,
    idempotent: completeResult.idempotent,
    filing: completeResult.filing,
    task: completeResult.task,
    timeline: completeResult.timeline,
  };
}

/**
 * Call after ensureBbbFilingTask when BBB is approved and owned.
 * Merges timeline from accepted/failed delivery; leaves skipped/unconfirmed open for operators.
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
    (result.status === "accepted" || result.status === "failed") &&
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
