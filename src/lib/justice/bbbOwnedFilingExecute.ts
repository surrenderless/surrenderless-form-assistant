import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REAL_BBB_ASSISTED_SUBMISSION_LANE,
  REAL_BBB_COMPLAINT_FILING_DESTINATION,
  REAL_BBB_COMPLAINT_SUBMISSION_URL,
} from "@/lib/justice/assistedSubmissionLane";
import { evaluateOwnedBbbAutofillExecutionReadiness } from "@/lib/justice/bbbOwnedFilingProduction";
import { getBbbOwnedFilingSubmitContext } from "@/lib/justice/bbbOwnedFilingSubmitContext";
import { BBB_OWNED_FILING_PROVIDER, type AttemptAutomatedBbbFilingResult } from "@/lib/justice/bbbOwnedFilingDelivery";
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
import { intakeToRealBbbUserData } from "@/lib/justice/realBbbUserData";
import { runRealBbbBoundedSubmit } from "@/lib/justice/runRealBbbBoundedSubmit";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

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
    console.warn("bbb owned filing execute: patch task notes", error?.message ?? "failed");
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
): Promise<AttemptAutomatedBbbFilingResult> {
  const failedAt = new Date().toISOString();
  const failedRecord: BbbOwnedFilingDeliveryRecord = {
    delivery_state: "failed",
    provider: BBB_OWNED_FILING_PROVIDER,
    started_at: startedAt,
    completed_at: failedAt,
    failure_detail: failureDetail.slice(0, 500),
    ...(extra.confirmation ? { confirmation: extra.confirmation } : {}),
    ...(extra.stopReason ? { stop_reason: extra.stopReason } : {}),
  };
  await patchBbbTaskNotes(
    supabase,
    userId,
    claimedTask.id,
    upsertBbbOwnedFilingDeliveryNotes(claimedTask.notes, failedRecord)
  );
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: bbbOwnedFilingTimelineId(caseId, "failed"),
    type: "filing_recorded",
    label: "BBB filing failed",
    detail: failedRecord.failure_detail,
    ts: failedAt,
  });
  return { status: "failed", error: failureDetail, timeline };
}

/**
 * Executes an already-claimed (delivery_state: "submitting") owned BBB filing task.
 * Runs the real BBB bounded-submit off the request path (worker only) and finalizes:
 * confirmed → filed + task completed; uncertain/config/provider/timeout/portal-change → failed.
 * Never retries a possibly-accepted submission (the claim already moved it out of "queued").
 */
export async function executeClaimedBbbFiling(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  claimedTask: JusticeCaseTaskRow
): Promise<AttemptAutomatedBbbFilingResult> {
  const trimmedCaseId = caseId.trim();
  const priorDelivery = parseBbbOwnedFilingDeliveryRecord(claimedTask.notes);
  const startedAt = priorDelivery?.started_at ?? new Date().toISOString();

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("intake")
    .eq("id", trimmedCaseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (caseErr || !caseRow) {
    return markFailed(supabase, userId, trimmedCaseId, claimedTask, startedAt, "case not found for BBB execution");
  }
  const intake = caseRow.intake as JusticeIntake | null;
  if (!intake || typeof intake !== "object") {
    return markFailed(supabase, userId, trimmedCaseId, claimedTask, startedAt, "invalid intake for BBB execution");
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
    bounded = await runRealBbbBoundedSubmit({
      url: REAL_BBB_COMPLAINT_SUBMISSION_URL,
      userData: intakeToRealBbbUserData(intake),
      base,
      forwardedHeaders,
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

  const confirmation = REAL_BBB_ASSISTED_SUBMISSION_LANE.filingConfirmation;
  const destination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF) ??
    REAL_BBB_COMPLAINT_FILING_DESTINATION;
  const filedAt = new Date().toISOString().slice(0, 10);
  const completeResult = await completeBbbOperatorFiling(supabase, userId, {
    caseId: trimmedCaseId,
    taskId: claimedTask.id,
    destination,
    filedAt,
    confirmationNumber: confirmation,
    notes: [
      `provider: ${BBB_OWNED_FILING_PROVIDER}`,
      `delivery_state: filed`,
      `confirmation: ${confirmation}`,
      `idempotency: ${bbbOwnedFilingIdempotencyKey(trimmedCaseId)}`,
      `steps_executed: ${bounded.fillResult.stepsExecuted}`,
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
    id: bbbOwnedFilingTimelineId(trimmedCaseId, "filed"),
    type: "filing_recorded",
    label: "BBB filing filed",
    detail: [
      `provider: ${BBB_OWNED_FILING_PROVIDER}`,
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
