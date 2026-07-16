import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearFollowUpFromApprovedNextAction,
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  parseJusticeCaseClientState,
} from "@/lib/justice/approvedNextActionState";
import { ensureBbbFilingTask, shouldQueueBbbFilingTask } from "@/lib/justice/bbbFilingTask";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { ensureCfpbFilingTask, shouldQueueCfpbFilingTask } from "@/lib/justice/cfpbFilingTask";
import {
  ensureDemandLetterFilingTask,
  shouldQueueDemandLetterFilingTask,
} from "@/lib/justice/demandLetterFilingTask";
import { attemptAutomatedDemandLetterEmailDeliveryAfterEnsure } from "@/lib/justice/demandLetterEmailDelivery";
import { ensureDotFilingTask, shouldQueueDotFilingTask } from "@/lib/justice/dotFilingTask";
import {
  isDownstreamHumanFulfillmentEscalationAction,
  stripResolutionTrackingFromApprovedAction,
} from "@/lib/justice/escalationLadderResolution";
import { ensureFccFilingTask, shouldQueueFccFilingTask } from "@/lib/justice/fccFilingTask";
import {
  completeFollowUpResponseReviewTaskIfOpen,
  taskNotesMatchFollowUpResponseReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import { ensureFtcFilingTask, shouldQueueFtcFilingTask } from "@/lib/justice/ftcFilingTask";
import {
  ensureMerchantContactFilingTask,
  shouldQueueMerchantContactFilingTask,
} from "@/lib/justice/merchantContactFilingTask";
import {
  ensurePaymentDisputeFilingTask,
  shouldQueuePaymentDisputeFilingTask,
} from "@/lib/justice/paymentDisputeFilingTask";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import {
  ensureStateAgFilingTask,
  shouldQueueStateAgFilingTask,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const OUTCOME_NOTE_MAX = 500;
const MAX_NOTES = 8000;

export const FOLLOW_UP_RESPONSE_REVIEW_OUTCOMES = [
  "resolved",
  "no_resolution",
  "further_escalation",
] as const;

export type FollowUpResponseReviewOutcome = (typeof FOLLOW_UP_RESPONSE_REVIEW_OUTCOMES)[number];

export const OPERATOR_RESOLVED_OUTCOME_MARKER =
  "Operator confirmed resolution after follow-up response review";
export const OPERATOR_NO_RESOLUTION_OUTCOME_MARKER =
  "Operator confirmed no resolution after follow-up response review";
export const OPERATOR_FURTHER_ESCALATION_OUTCOME_MARKER =
  "Operator queued further escalation after follow-up response review";

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

export function isFollowUpResponseReviewOutcome(v: unknown): v is FollowUpResponseReviewOutcome {
  return (
    typeof v === "string" &&
    (FOLLOW_UP_RESPONSE_REVIEW_OUTCOMES as readonly string[]).includes(v)
  );
}

function appendOperatorNote(
  base: string,
  operatorNotes: string | null | undefined
): string {
  const note = operatorNotes?.trim();
  if (!note) return clampLen(base, OUTCOME_NOTE_MAX);
  return clampLen(`${base} Operator note: ${note}`, OUTCOME_NOTE_MAX);
}

function withClearedFollowUp(action: JusticeApprovedNextAction): JusticeApprovedNextAction {
  return clearFollowUpFromApprovedNextAction(action);
}

function withAcknowledgedHandling(action: JusticeApprovedNextAction): JusticeApprovedNextAction {
  if (!action.handling_requested_at?.trim()) return action;
  if (action.handling_acknowledged_at?.trim()) return action;
  return { ...action, handling_acknowledged_at: new Date().toISOString() };
}

async function queueFilingTasksForClientState(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  intake: JusticeIntake,
  clientState: Record<string, unknown>,
  timeline: TimelineEntry[] | null
): Promise<TimelineEntry[] | null> {
  let nextTimeline = timeline;

  if (shouldQueueMerchantContactFilingTask(clientState)) {
    const r = await ensureMerchantContactFilingTask(supabase, userId, caseId, intake);
    if (r.timeline) nextTimeline = r.timeline;
  }
  if (shouldQueueCfpbFilingTask(clientState)) {
    const r = await ensureCfpbFilingTask(supabase, userId, caseId, intake);
    if (r.timeline) nextTimeline = r.timeline;
  }
  if (shouldQueueFccFilingTask(clientState)) {
    const r = await ensureFccFilingTask(supabase, userId, caseId, intake);
    if (r.timeline) nextTimeline = r.timeline;
  }
  if (shouldQueueDotFilingTask(clientState)) {
    const r = await ensureDotFilingTask(supabase, userId, caseId, intake);
    if (r.timeline) nextTimeline = r.timeline;
  }
  if (shouldQueueFtcFilingTask(clientState)) {
    const r = await ensureFtcFilingTask(supabase, userId, caseId, intake);
    if (r.timeline) nextTimeline = r.timeline;
  }
  if (shouldQueueBbbFilingTask(clientState)) {
    const r = await ensureBbbFilingTask(supabase, userId, caseId, intake);
    if (r.timeline) nextTimeline = r.timeline;
  }
  if (shouldQueueStateAgFilingTask(clientState)) {
    const r = await ensureStateAgFilingTask(supabase, userId, caseId, intake);
    if (r.timeline) nextTimeline = r.timeline;
  }
  if (shouldQueuePaymentDisputeFilingTask(clientState)) {
    const r = await ensurePaymentDisputeFilingTask(supabase, userId, caseId, intake);
    if (r.timeline) nextTimeline = r.timeline;
  }
  if (shouldQueueDemandLetterFilingTask(clientState)) {
    const r = await ensureDemandLetterFilingTask(supabase, userId, caseId, intake);
    if (r.timeline) nextTimeline = r.timeline;
    const emailAttempt = await attemptAutomatedDemandLetterEmailDeliveryAfterEnsure(
      supabase,
      userId,
      caseId,
      nextTimeline
    );
    nextTimeline = emailAttempt.timeline;
  }

  return nextTimeline;
}

export function planFollowUpResponseReviewClientState(params: {
  intake: JusticeIntake;
  clientState: unknown;
  outcome: FollowUpResponseReviewOutcome;
  operatorNotes?: string | null;
}):
  | { kind: "error"; error: string; status: number }
  | {
      kind: "ok";
      nextAction: JusticeApprovedNextAction;
      clientState: Record<string, unknown>;
      intake: JusticeIntake;
      advanced: boolean;
    } {
  const parsed = parseJusticeCaseClientState(params.clientState);
  const action = parsed.approved_next_action;
  if (!action) {
    return { kind: "error", error: "Case has no approved next action", status: 400 };
  }

  const operatorNotes = params.operatorNotes?.trim()
    ? clampLen(params.operatorNotes.trim(), MAX_NOTES)
    : null;

  if (params.outcome === "resolved") {
    const nextAction = withAcknowledgedHandling(
      withClearedFollowUp({
        ...action,
        status: "completed",
        completed_at: action.completed_at?.trim() || new Date().toISOString(),
        outcome_note: appendOperatorNote(OPERATOR_RESOLVED_OUTCOME_MARKER, operatorNotes),
      })
    );
    const clientState = mergeClientStateWithApprovedNextAction(
      params.clientState,
      omitClearedHandlingRequestNoteFromApprovedNextAction(nextAction)
    ) as Record<string, unknown>;
    const intake: JusticeIntake = {
      ...params.intake,
      merchant_response_type: "resolved",
    };
    return { kind: "ok", nextAction, clientState, intake, advanced: false };
  }

  if (params.outcome === "no_resolution") {
    const nextAction = withAcknowledgedHandling(
      withClearedFollowUp({
        ...action,
        status: "completed",
        completed_at: action.completed_at?.trim() || new Date().toISOString(),
        outcome_note: appendOperatorNote(OPERATOR_NO_RESOLUTION_OUTCOME_MARKER, operatorNotes),
      })
    );
    const clientState = mergeClientStateWithApprovedNextAction(
      params.clientState,
      omitClearedHandlingRequestNoteFromApprovedNextAction(nextAction)
    ) as Record<string, unknown>;
    return { kind: "ok", nextAction, clientState, intake: params.intake, advanced: false };
  }

  // further_escalation
  const completedHref = action.href?.trim() ?? "";
  if (!completedHref) {
    return { kind: "error", error: "Cannot escalate without a completed action href", status: 400 };
  }

  const localCompleted = omitClearedHandlingRequestNoteFromApprovedNextAction(
    withClearedFollowUp({
      ...action,
      status: "completed",
      completed_at: action.completed_at?.trim() || new Date().toISOString(),
      outcome_note: appendOperatorNote(OPERATOR_FURTHER_ESCALATION_OUTCOME_MARKER, operatorNotes),
    })
  );

  const advanced = advanceApprovedNextActionAfterCompleted(params.intake, completedHref, {
    existing: localCompleted,
  });

  if (
    !advanced?.href?.trim() ||
    advanced.href.trim() === completedHref ||
    advanced.status !== "approved"
  ) {
    return {
      kind: "error",
      error: "No further escalation step is available for this case",
      status: 400,
    };
  }

  const cleaned = isDownstreamHumanFulfillmentEscalationAction(advanced)
    ? stripResolutionTrackingFromApprovedAction(advanced)
    : advanced;
  const clearedFollowUp: JusticeApprovedNextAction = {
    ...cleaned,
    follow_up_needed: false,
  };
  delete clearedFollowUp.follow_up_at;
  // Do not carry the prior wait-step outcome onto the newly approved escalation.
  if (!isDownstreamHumanFulfillmentEscalationAction(cleaned)) {
    delete clearedFollowUp.outcome_note;
  }
  const nextAction = omitClearedHandlingRequestNoteFromApprovedNextAction(
    mergeApprovedNextActionTrackingFields(undefined, clearedFollowUp)
  );
  // Ensure follow-up stays cleared after merge helpers.
  nextAction.follow_up_needed = false;
  delete nextAction.follow_up_at;

  const clientState = mergeClientStateWithApprovedNextAction(
    params.clientState,
    nextAction
  ) as Record<string, unknown>;
  return { kind: "ok", nextAction, clientState, intake: params.intake, advanced: true };
}

export type CompleteFollowUpResponseReviewInput = {
  caseId: string;
  taskId: string;
  outcome: FollowUpResponseReviewOutcome;
  notes?: string | null;
};

export type CompleteFollowUpResponseReviewResult =
  | {
      ok: true;
      task: JusticeCaseTaskRow;
      clientState: Record<string, unknown>;
      intake: JusticeIntake;
      timeline: TimelineEntry[] | null;
      outcome: FollowUpResponseReviewOutcome;
      advanced: boolean;
      advanced_href?: string;
      idempotent: boolean;
      archived: false;
    }
  | { ok: false; error: string; status: number };

/**
 * Operator completes follow-up response review: record outcome, complete task,
 * optionally advance escalation. Never sets archived_at.
 */
export async function completeFollowUpResponseReview(
  supabase: SupabaseClient,
  userId: string,
  input: CompleteFollowUpResponseReviewInput
): Promise<CompleteFollowUpResponseReviewResult> {
  const caseId = input.caseId.trim();
  const taskId = input.taskId.trim();
  if (!caseId || !taskId) {
    return { ok: false, error: "case_id and task_id are required", status: 400 };
  }
  if (!isFollowUpResponseReviewOutcome(input.outcome)) {
    return { ok: false, error: "Invalid outcome", status: 400 };
  }

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("id, user_id, intake, client_state, archived_at")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (caseErr || !caseRow) {
    return { ok: false, error: "Not found", status: 404 };
  }
  if (caseRow.archived_at) {
    return { ok: false, error: "Case is archived", status: 409 };
  }
  if (!isJusticeIntakePayload(caseRow.intake)) {
    return { ok: false, error: "Invalid case intake", status: 400 };
  }
  const intake = caseRow.intake as JusticeIntake;

  const { data: taskRow, error: taskErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("id", taskId)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (taskErr || !taskRow) {
    return { ok: false, error: "Task not found", status: 404 };
  }
  const task = taskRow as JusticeCaseTaskRow;
  if (!taskNotesMatchFollowUpResponseReviewMarker(task.notes, caseId)) {
    return { ok: false, error: "Task is not a follow-up response review", status: 400 };
  }

  if (task.completed_at?.trim()) {
    const parsed = parseJusticeCaseClientState(caseRow.client_state);
    return {
      ok: true,
      task,
      clientState: (parsed as Record<string, unknown>) ?? {},
      intake,
      timeline: null,
      outcome: input.outcome,
      advanced: false,
      idempotent: true,
      archived: false,
    };
  }

  const plan = planFollowUpResponseReviewClientState({
    intake,
    clientState: caseRow.client_state,
    outcome: input.outcome,
    operatorNotes: input.notes,
  });
  if (plan.kind === "error") {
    return { ok: false, error: plan.error, status: plan.status };
  }

  const patch: Record<string, unknown> = { client_state: plan.clientState };
  if (input.outcome === "resolved") {
    patch.intake = plan.intake;
  }

  const { error: patchErr } = await supabase
    .from("justice_cases")
    .update(patch)
    .eq("id", caseId)
    .eq("user_id", userId);

  if (patchErr) {
    console.warn("follow-up response review complete: patch case", patchErr.message);
    return { ok: false, error: "Could not update case", status: 500 };
  }

  let timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `follow_up_response_review_outcome:${caseId}:${taskId}:${input.outcome}`,
    type: "outcome_recorded",
    label:
      input.outcome === "resolved"
        ? "Operator confirmed resolution"
        : input.outcome === "no_resolution"
          ? "Operator confirmed no resolution"
          : "Operator queued further escalation",
    detail: plan.nextAction.outcome_note ?? input.outcome,
  });

  const taskResult = await completeFollowUpResponseReviewTaskIfOpen(
    supabase,
    userId,
    caseId,
    taskId
  );
  if (!taskResult.task) {
    return { ok: false, error: "Could not complete response-review task", status: 500 };
  }
  if (taskResult.timeline) timeline = taskResult.timeline;

  if (plan.advanced) {
    timeline = await queueFilingTasksForClientState(
      supabase,
      userId,
      caseId,
      plan.intake,
      plan.clientState,
      timeline
    );
  }

  return {
    ok: true,
    task: taskResult.task,
    clientState: plan.clientState,
    intake: plan.intake,
    timeline,
    outcome: input.outcome,
    advanced: plan.advanced,
    ...(plan.advanced && plan.nextAction.href
      ? { advanced_href: plan.nextAction.href }
      : {}),
    idempotent: false,
    archived: false,
  };
}
