import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateOwnedBbbAutofillExecutionReadiness } from "@/lib/justice/bbbOwnedFilingProduction";
import { getBbbOwnedFilingSubmitContext } from "@/lib/justice/bbbOwnedFilingSubmitContext";
import { completeFtcOperatorFiling } from "@/lib/justice/completeFtcOperatorFiling";
import {
  FTC_FILING_DESTINATION,
  FTC_OWNED_FILING_PROVIDER,
  REAL_FTC_FILING_CONFIRMATION_FALLBACK,
  type AttemptAutomatedFtcFilingResult,
} from "@/lib/justice/ftcOwnedFilingDelivery";
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
import {
  isOwnedFilingSubmitArmed,
  OWNED_FILING_SUBMIT_UNARMED_REASON,
} from "@/lib/justice/ownedFilingSubmitArmed";
import { intakeToRealFtcUserData } from "@/lib/justice/realFtcUserData";
import { runRealFtcBoundedSubmit } from "@/lib/justice/runRealFtcBoundedSubmit";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

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
    console.warn("ftc owned filing execute: patch task notes", error?.message ?? "failed");
    return null;
  }
  return data as JusticeCaseTaskRow;
}

async function markFailed(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  claimedTask: JusticeCaseTaskRow,
  startedAt: string,
  failureDetail: string,
  extra: { confirmation?: string; stopReason?: string } = {}
): Promise<AttemptAutomatedFtcFilingResult> {
  const failedAt = new Date().toISOString();
  const failedRecord: FtcOwnedFilingDeliveryRecord = {
    delivery_state: "failed",
    provider: FTC_OWNED_FILING_PROVIDER,
    started_at: startedAt,
    completed_at: failedAt,
    failure_detail: failureDetail.slice(0, 500),
    ...(extra.confirmation ? { confirmation: extra.confirmation } : {}),
    ...(extra.stopReason ? { stop_reason: extra.stopReason } : {}),
  };
  await patchFtcTaskNotes(
    supabase,
    userId,
    claimedTask.id,
    upsertFtcOwnedFilingDeliveryNotes(claimedTask.notes, failedRecord)
  );
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: ftcOwnedFilingTimelineId(caseId, "failed"),
    type: "filing_recorded",
    label: "FTC filing failed",
    detail: failedRecord.failure_detail,
    ts: failedAt,
  });
  return { status: "failed", error: failureDetail, timeline };
}

/**
 * Executes an already-claimed (delivery_state: "submitting") owned FTC filing task.
 * Runs the real FTC bounded-submit off the request path (worker only) and finalizes:
 * confirmed → filed + task completed; uncertain/config/provider/timeout/portal-change → failed.
 * Never retries a possibly-accepted submission (the claim already moved it out of "queued").
 */
export async function executeClaimedFtcFiling(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  claimedTask: JusticeCaseTaskRow
): Promise<AttemptAutomatedFtcFilingResult> {
  const trimmedCaseId = caseId.trim();
  const priorDelivery = parseFtcOwnedFilingDeliveryRecord(claimedTask.notes);
  const startedAt = priorDelivery?.started_at ?? new Date().toISOString();

  // Defense in depth: live execute refuses when the submit arm is off (fail closed).
  if (!isOwnedFilingSubmitArmed()) {
    return markFailed(supabase, userId, trimmedCaseId, claimedTask, startedAt, OWNED_FILING_SUBMIT_UNARMED_REASON, {
      stopReason: "submit_unarmed",
    });
  }

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("intake")
    .eq("id", trimmedCaseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (caseErr || !caseRow) {
    return markFailed(supabase, userId, trimmedCaseId, claimedTask, startedAt, "case not found for FTC execution");
  }
  const intake = caseRow.intake as JusticeIntake | null;
  if (!intake || typeof intake !== "object") {
    return markFailed(supabase, userId, trimmedCaseId, claimedTask, startedAt, "invalid intake for FTC execution");
  }

  const readiness = evaluateOwnedBbbAutofillExecutionReadiness(userId);
  if (!readiness.ok) {
    return markFailed(supabase, userId, trimmedCaseId, claimedTask, startedAt, readiness.reason);
  }
  const overrideBase = getBbbOwnedFilingSubmitContext()?.base?.trim();
  const base = (overrideBase || readiness.base).replace(/\/$/, "");
  const forwardedHeaders = readiness.forwardedHeaders;

  let bounded;
  try {
    bounded = await runRealFtcBoundedSubmit({
      url: FTC_OFFICIAL_CONSUMER_COMPLAINT_PORTAL_URL,
      userData: intakeToRealFtcUserData(intake),
      base,
      forwardedHeaders,
      mode: "live",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return markFailed(supabase, userId, trimmedCaseId, claimedTask, startedAt, message);
  }

  if (!bounded.ok) {
    return markFailed(supabase, userId, trimmedCaseId, claimedTask, startedAt, bounded.error, {
      stopReason: bounded.stopReason,
    });
  }

  const confirmation =
    bounded.fillResult.confirmationReference?.trim() || REAL_FTC_FILING_CONFIRMATION_FALLBACK;
  const destination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF) ??
    FTC_FILING_DESTINATION;
  const filedAt = new Date().toISOString().slice(0, 10);
  const completeResult = await completeFtcOperatorFiling(supabase, userId, {
    caseId: trimmedCaseId,
    taskId: claimedTask.id,
    destination,
    filedAt,
    confirmationNumber: confirmation,
    notes: [
      `provider: ${FTC_OWNED_FILING_PROVIDER}`,
      `delivery_state: filed`,
      `confirmation: ${confirmation}`,
      `idempotency: ${ftcOwnedFilingIdempotencyKey(trimmedCaseId)}`,
      `steps_executed: ${bounded.fillResult.stepsExecuted}`,
      ...(bounded.fillResult.screenshot ? [`screenshot: ${bounded.fillResult.screenshot}`] : []),
      `completed_at: ${new Date().toISOString()}`,
    ].join("\n"),
  });

  if (!completeResult.ok) {
    return markFailed(
      supabase,
      userId,
      trimmedCaseId,
      claimedTask,
      startedAt,
      `Terminal confirmation returned but completion failed: ${completeResult.error}`,
      { confirmation }
    );
  }

  const filedTs = new Date().toISOString();
  await appendCaseTimelineEntry(supabase, userId, trimmedCaseId, {
    id: ftcOwnedFilingTimelineId(trimmedCaseId, "filed"),
    type: "filing_recorded",
    label: "FTC filing filed",
    detail: [
      `provider: ${FTC_OWNED_FILING_PROVIDER}`,
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
