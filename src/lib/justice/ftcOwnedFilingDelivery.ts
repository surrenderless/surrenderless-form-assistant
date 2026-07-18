import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { evaluateOwnedBbbAutofillExecutionReadiness } from "@/lib/justice/bbbOwnedFilingProduction";
import { getBbbOwnedFilingSubmitContext } from "@/lib/justice/bbbOwnedFilingSubmitContext";
import { completeFtcOperatorFiling } from "@/lib/justice/completeFtcOperatorFiling";
import {
  findFtcFilingWithConfirmation,
  findOpenFtcFilingTask,
  ftcFilingsForManualTracking,
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
import { FTC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL } from "@/lib/justice/ftcOfficialPortal";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import { isRealFtcComplaintAutofillEnabled } from "@/lib/justice/realFtcAutofillEnabled";
import { intakeToRealFtcUserData } from "@/lib/justice/realFtcUserData";
import { runRealFtcBoundedSubmit } from "@/lib/justice/runRealFtcBoundedSubmit";
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
const FTC_FILING_DESTINATION = "FTC (consumer complaint)";

/** Generic confirmation stored when the portal confirmed submission but exposed no readable reference. */
export const REAL_FTC_FILING_CONFIRMATION_FALLBACK = "FTC report submitted";

const FILING_SELECT =
  "id, user_id, case_id, destination, filed_at, confirmation_number, filing_url, notes, created_at, updated_at" as const;

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

export type AttemptAutomatedFtcFilingResult =
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
 * Runs Surrenderless-owned FTC filing via the real FTC bounded-submit path.
 * Completes the operator task only after terminal confirmation is returned.
 * Idempotent on filed confirmations; concurrent submitting skips; failed leaves task open.
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
      reason: "FTC autofill already submitting — operator/manual fallback",
    };
  }

  const readiness = evaluateOwnedBbbAutofillExecutionReadiness(userId);
  if (!readiness.ok) {
    return { status: "skipped", reason: readiness.reason };
  }

  const overrideBase = getBbbOwnedFilingSubmitContext()?.base?.trim();
  const base = (overrideBase || readiness.base).replace(/\/$/, "");
  const forwardedHeaders = readiness.forwardedHeaders;

  const provider = "real_ftc_bounded_submit";
  const startedAt = new Date().toISOString();
  const submittingRecord: FtcOwnedFilingDeliveryRecord = {
    delivery_state: "submitting",
    provider,
    started_at: startedAt,
  };
  const submittingNotes = upsertFtcOwnedFilingDeliveryNotes(openTask.notes, submittingRecord);
  const submittingTask = await patchFtcTaskNotes(supabase, userId, openTask.id, submittingNotes);
  await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
    id: ftcOwnedFilingTimelineId(trimmedCaseId, "submitting"),
    type: "filing_recorded",
    label: "FTC filing submitting",
    detail: `provider: ${provider}\nidempotency: ${ftcOwnedFilingIdempotencyKey(trimmedCaseId)}`,
    ts: startedAt,
  });

  let bounded;
  try {
    bounded = await runRealFtcBoundedSubmit({
      url: FTC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL,
      userData: intakeToRealFtcUserData(intake),
      base,
      forwardedHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const failedAt = new Date().toISOString();
    const failedRecord: FtcOwnedFilingDeliveryRecord = {
      delivery_state: "failed",
      provider,
      started_at: startedAt,
      completed_at: failedAt,
      failure_detail: message.slice(0, 500),
    };
    await patchFtcTaskNotes(
      supabase,
      userId,
      openTask.id,
      upsertFtcOwnedFilingDeliveryNotes(submittingTask?.notes ?? submittingNotes, failedRecord)
    );
    const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
      id: ftcOwnedFilingTimelineId(trimmedCaseId, "failed"),
      type: "filing_recorded",
      label: "FTC filing failed",
      detail: failedRecord.failure_detail,
      ts: failedAt,
    });
    return { status: "failed", error: message, timeline };
  }

  if (!bounded.ok) {
    const failedAt = new Date().toISOString();
    const failedRecord: FtcOwnedFilingDeliveryRecord = {
      delivery_state: "failed",
      provider,
      started_at: startedAt,
      completed_at: failedAt,
      failure_detail: bounded.error.slice(0, 500),
      stop_reason: bounded.stopReason,
    };
    await patchFtcTaskNotes(
      supabase,
      userId,
      openTask.id,
      upsertFtcOwnedFilingDeliveryNotes(submittingTask?.notes ?? submittingNotes, failedRecord)
    );
    const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
      id: ftcOwnedFilingTimelineId(trimmedCaseId, "failed"),
      type: "filing_recorded",
      label: "FTC filing failed",
      detail: [
        `error: ${bounded.error.slice(0, 500)}`,
        `stop_reason: ${bounded.stopReason}`,
        `steps_executed: ${bounded.stepsExecuted}`,
      ].join("\n"),
      ts: failedAt,
    });
    return { status: "failed", error: bounded.error, timeline };
  }

  const confirmation =
    bounded.fillResult.confirmationReference?.trim() || REAL_FTC_FILING_CONFIRMATION_FALLBACK;
  const destination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF) ??
    FTC_FILING_DESTINATION;
  const filedAt = new Date().toISOString().slice(0, 10);
  const completeResult = await completeFtcOperatorFiling(supabase, userId, {
    caseId: trimmedCaseId,
    taskId: openTask.id,
    destination,
    filedAt,
    confirmationNumber: confirmation,
    notes: [
      `provider: ${provider}`,
      `delivery_state: filed`,
      `confirmation: ${confirmation}`,
      `idempotency: ${ftcOwnedFilingIdempotencyKey(trimmedCaseId)}`,
      `steps_executed: ${bounded.fillResult.stepsExecuted}`,
      ...(bounded.fillResult.screenshot ? [`screenshot: ${bounded.fillResult.screenshot}`] : []),
      `completed_at: ${new Date().toISOString()}`,
    ].join("\n"),
  });

  if (!completeResult.ok) {
    const failedAt = new Date().toISOString();
    const failedRecord: FtcOwnedFilingDeliveryRecord = {
      delivery_state: "failed",
      provider,
      started_at: startedAt,
      completed_at: failedAt,
      confirmation,
      failure_detail:
        `Terminal confirmation returned but completion failed: ${completeResult.error}`.slice(0, 500),
    };
    await patchFtcTaskNotes(
      supabase,
      userId,
      openTask.id,
      upsertFtcOwnedFilingDeliveryNotes(submittingTask?.notes ?? submittingNotes, failedRecord)
    );
    const timeline = await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
      id: ftcOwnedFilingTimelineId(trimmedCaseId, "failed"),
      type: "filing_recorded",
      label: "FTC filing failed",
      detail: failedRecord.failure_detail,
      ts: failedAt,
    });
    return { status: "failed", error: completeResult.error, timeline };
  }

  const filedTs = new Date().toISOString();
  await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
    id: ftcOwnedFilingTimelineId(trimmedCaseId, "filed"),
    type: "filing_recorded",
    label: "FTC filing filed",
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
 * Call after ensureFtcFilingTask when FTC is approved and owned.
 * Merges timeline from accepted/failed delivery; leaves skipped/unconfirmed open for operators.
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
  if ((result.status === "accepted" || result.status === "failed") && result.timeline) {
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
