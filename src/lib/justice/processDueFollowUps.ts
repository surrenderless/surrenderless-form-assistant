import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearFollowUpFromApprovedNextAction,
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  parseApprovedNextActionFromClientState,
  parseJusticeCaseClientState,
} from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  ensureOwnedFilingTaskAfterClientStateWrite,
  OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR,
  resolveRequiredOwnedFilingTaskKind,
} from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import {
  isDownstreamHumanFulfillmentEscalationAction,
  isEscalationLadderTerminalForResolution,
  stripResolutionTrackingFromApprovedAction,
} from "@/lib/justice/escalationLadderResolution";
import {
  completeFollowUpCaseTaskById,
  followUpTaskOwnerHref,
  taskNotesMatchFollowUpMarker,
} from "@/lib/justice/followUpCaseTask";
import {
  ensureFollowUpResponseReviewTask,
  ensureSupersededLaneResponseReviewTask,
  supersededLaneReviewOutcomeFromNotes,
  supersededLaneReviewOutcomeTimelineId,
} from "@/lib/justice/followUpResponseReviewTask";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import { resolveHasUploadedEvidenceFile } from "@/lib/justice/resolveHasUploadedEvidenceFile";
import { getJusticeTaskDueKind } from "@/lib/justice/taskDueStatus";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const OUTCOME_NOTE_MAX = 500;

export const NO_RESPONSE_OUTCOME_MARKER = "No response recorded by follow-up date";

/** Retriable when a superseded lane's own owned response review task can't be ensured. */
export const SUPERSEDED_LANE_REVIEW_ENSURE_RETRYABLE_ERROR =
  "The superseded lane's own response review task could not be created. Retry to finish handoff.";

/** Retriable when a superseded lane's reviewed outcome can't be recorded on the case timeline —
 * the task must stay open so a retry can persist the outcome before it's ever closed. */
export const SUPERSEDED_LANE_OUTCOME_APPEND_RETRYABLE_ERROR =
  "The superseded lane's reviewed outcome could not be recorded. Retry to finish handoff.";

/** Retriable when a superseded lane's own due follow-up can't be closed after its reviewed
 * outcome was durably recorded. */
export const SUPERSEDED_LANE_FOLLOW_UP_CLOSE_RETRYABLE_ERROR =
  "Case updated but the superseded lane's follow-up task could not be closed. Retry to finish handoff.";

/**
 * Owner hrefs this cron can independently process when they no longer match the case's current
 * approved action — i.e. lanes whose bounce-remediation flow can leave a fresh, correctly-owned
 * follow-up open on a case whose ladder has already advanced past them (see
 * completeDemandLetterOperatorFiling.ts and its payment-dispute/merchant-contact mirrors). Any
 * other owner_href (a lane without this remediation-follow-up model, or one this cron doesn't
 * recognize) is left alone — "unsupported" is a safe skip, not a guess.
 */
export const SUPPORTED_SUPERSEDED_LANE_HREFS: ReadonlySet<string> = new Set([
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
]);

export type DueFollowUpSkipReason =
  | "not_due"
  | "already_completed"
  | "archived"
  | "resolved"
  | "invalid"
  | "follow_up_not_needed"
  | "already_processed"
  | "not_current_lane"
  | "missing_owner";

export type DueFollowUpProcessKind =
  | "advanced"
  | "terminal_response_review"
  | "superseded_lane_closed"
  | "superseded_lane_review_pending"
  | "skipped"
  | "failed_retryable";

export type DueFollowUpProcessResult = {
  case_id: string;
  task_id: string;
  kind: DueFollowUpProcessKind;
  reason?: DueFollowUpSkipReason;
  advanced_href?: string;
  /** Present when kind is failed_retryable — cron/operator may retry the open follow-up task. */
  error?: string;
};

/**
 * True when this SPECIFIC follow-up task's own due_date is today or earlier. Deliberately never
 * falls back to the case-level approved_next_action.follow_up_at: with more than one lane's
 * follow-up able to be open on the same case at once, that fallback would let a task fire off a
 * different lane's schedule. A task with no due_date of its own is simply not due — it must not
 * fire until it has its own valid schedule.
 */
export function isOpenFollowUpTaskDue(params: {
  task: Pick<JusticeCaseTaskRow, "due_date" | "completed_at">;
  now?: Date;
}): boolean {
  if (params.task.completed_at?.trim()) return false;
  const now = params.now ?? new Date();
  const kind = getJusticeTaskDueKind(params.task, now);
  return kind === "overdue" || kind === "due_today";
}

export function caseHasConfirmedResolution(
  intake: JusticeIntake,
  action: JusticeApprovedNextAction | null | undefined
): boolean {
  if (intake.merchant_response_type === "resolved") return true;
  const note = action?.outcome_note?.trim().toLowerCase() ?? "";
  if (!note) return false;
  if (note.includes(NO_RESPONSE_OUTCOME_MARKER.toLowerCase())) return false;
  return (
    /\b(resolved|refund received|full refund|matter settled|issue (?:is|was) closed)\b/.test(note) &&
    !/\bno response\b/.test(note)
  );
}

export function outcomeNoteAlreadyRecordsNoResponse(note: string | null | undefined): boolean {
  return (note ?? "").includes(NO_RESPONSE_OUTCOME_MARKER);
}

export function buildNoResponseOutcomeNote(
  existingNote: string | null | undefined,
  followUpAt: string | null | undefined
): string {
  const due = followUpAt?.trim() ? ` (due ${followUpAt.trim().slice(0, 10)})` : "";
  const line = `${NO_RESPONSE_OUTCOME_MARKER}${due}. Follow-up check completed by Surrenderless — case remains open; no automatic resolution applied.`;
  const prior = existingNote?.trim() ?? "";
  if (!prior) return line.slice(0, OUTCOME_NOTE_MAX);
  if (prior.includes(NO_RESPONSE_OUTCOME_MARKER)) return prior.slice(0, OUTCOME_NOTE_MAX);
  return `${prior} ${line}`.trim().slice(0, OUTCOME_NOTE_MAX);
}

export function dueFollowUpNoResponseTimelineId(caseId: string, taskId: string): string {
  return `follow_up_no_response:${caseId.trim()}:${taskId.trim()}`;
}

function markActionCompleted(action: JusticeApprovedNextAction): JusticeApprovedNextAction {
  if (action.status === "completed" && action.completed_at?.trim()) return action;
  return {
    ...action,
    status: "completed",
    completed_at: action.completed_at?.trim() || new Date().toISOString(),
  };
}

export function planDueFollowUpClientState(params: {
  intake: JusticeIntake;
  clientState: unknown;
  now?: Date;
  /** Whether the case has a real uploaded evidence record — see justiceEvidenceRowHasUploadedFile. */
  hasUploadedEvidenceFile?: boolean;
}):
  | { kind: "skip"; reason: DueFollowUpSkipReason }
  | {
      kind: "advanced";
      nextAction: JusticeApprovedNextAction;
      clientState: Record<string, unknown>;
    }
  | {
      kind: "terminal_response_review";
      nextAction: JusticeApprovedNextAction;
      clientState: Record<string, unknown>;
    } {
  const parsed = parseJusticeCaseClientState(params.clientState);
  const action = parsed.approved_next_action;
  if (!action) return { kind: "skip", reason: "invalid" };
  if (action.follow_up_needed !== true) return { kind: "skip", reason: "follow_up_not_needed" };
  if (caseHasConfirmedResolution(params.intake, action)) {
    return { kind: "skip", reason: "resolved" };
  }

  const withNoResponse: JusticeApprovedNextAction = {
    ...action,
    outcome_note: buildNoResponseOutcomeNote(action.outcome_note, action.follow_up_at),
  };
  const cleared = clearFollowUpFromApprovedNextAction(withNoResponse);
  const completed = markActionCompleted(cleared);
  const withTracking = mergeApprovedNextActionTrackingFields(action, completed);
  const localCompleted = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);

  const advanced = advanceApprovedNextActionAfterCompleted(params.intake, localCompleted.href?.trim() ?? "", {
    existing: localCompleted,
    hasUploadedEvidenceFile: params.hasUploadedEvidenceFile,
  });

  if (
    advanced?.href?.trim() &&
    advanced.href.trim() !== (localCompleted.href?.trim() ?? "") &&
    advanced.status === "approved"
  ) {
    const cleaned = isDownstreamHumanFulfillmentEscalationAction(advanced)
      ? stripResolutionTrackingFromApprovedAction(advanced)
      : advanced;
    // Explicit false so mergeClientState does not restore prior follow_up_needed from the wait step.
    const clearedFollowUp: JusticeApprovedNextAction = {
      ...cleaned,
      follow_up_needed: false,
    };
    delete clearedFollowUp.follow_up_at;
    const nextAction = omitClearedHandlingRequestNoteFromApprovedNextAction(clearedFollowUp);
    const clientState = mergeClientStateWithApprovedNextAction(
      params.clientState,
      nextAction
    ) as Record<string, unknown>;
    return { kind: "advanced", nextAction, clientState };
  }

  // Terminal (or nowhere to advance): keep completed action with cleared follow-up + no-response note.
  if (
    isEscalationLadderTerminalForResolution(localCompleted) ||
    !advanced?.href?.trim() ||
    advanced.href.trim() === (localCompleted.href?.trim() ?? "")
  ) {
    const clientState = mergeClientStateWithApprovedNextAction(
      params.clientState,
      localCompleted
    ) as Record<string, unknown>;
    return { kind: "terminal_response_review", nextAction: localCompleted, clientState };
  }

  const clientState = mergeClientStateWithApprovedNextAction(
    params.clientState,
    localCompleted
  ) as Record<string, unknown>;
  return { kind: "terminal_response_review", nextAction: localCompleted, clientState };
}

async function ensureOwnedFilingTasksForClientState(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  intake: JusticeIntake,
  clientState: unknown,
  timeline: TimelineEntry[] | null,
  paymentDisputeDraft?: unknown
): Promise<
  | { ok: true; timeline: TimelineEntry[] | null }
  | { ok: false; error: string; timeline: TimelineEntry[] | null }
> {
  const ownedEnsure = await ensureOwnedFilingTaskAfterClientStateWrite(supabase, {
    userId,
    caseId,
    clientState,
    intake,
    paymentDisputeDraft,
  });
  if (!ownedEnsure.ok) {
    console.warn("process due follow-ups: owned filing task ensure", ownedEnsure.error);
    return {
      ok: false,
      error: ownedEnsure.error || OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR,
      timeline: ownedEnsure.timeline ?? timeline,
    };
  }
  return { ok: true, timeline: ownedEnsure.timeline ?? timeline };
}

/** Retriable when terminal due processing cannot queue operator response review. */
export const FOLLOW_UP_RESPONSE_REVIEW_ENSURE_RETRYABLE_ERROR =
  "Case updated but the follow-up response review task could not be created. Retry to finish handoff.";

async function ensureResponseReviewTaskForDueFollowUp(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  intake: JusticeIntake,
  timeline: TimelineEntry[] | null
): Promise<
  | { ok: true; timeline: TimelineEntry[] | null }
  | { ok: false; error: string; timeline: TimelineEntry[] | null }
> {
  const review = await ensureFollowUpResponseReviewTask(supabase, userId, caseId, intake);
  if (!review.task) {
    console.warn(
      "process due follow-ups: response review task ensure",
      FOLLOW_UP_RESPONSE_REVIEW_ENSURE_RETRYABLE_ERROR
    );
    return {
      ok: false,
      error: FOLLOW_UP_RESPONSE_REVIEW_ENSURE_RETRYABLE_ERROR,
      timeline: review.timeline ?? timeline,
    };
  }
  return { ok: true, timeline: review.timeline ?? timeline };
}

export type ProcessDueFollowUpsSummary = {
  scanned: number;
  processed: number;
  advanced: number;
  terminal_response_review: number;
  superseded_lane_closed: number;
  superseded_lane_review_pending: number;
  skipped: number;
  failed_retryable: number;
  results: DueFollowUpProcessResult[];
};

/**
 * Processes open due follow-up tasks: record no response, clear consumer follow-up,
 * advance escalation when possible, otherwise queue operator response review.
 * Never archives or marks the case resolved.
 */
export async function processDueFollowUps(
  supabase: SupabaseClient,
  options: { now?: Date; limit?: number } = {}
): Promise<ProcessDueFollowUpsSummary> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 100;
  const results: DueFollowUpProcessResult[] = [];

  const { data: openTasks, error: tasksErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .is("completed_at", null)
    .like("notes", "follow_up:%")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (tasksErr) {
    console.warn("process due follow-ups: list tasks", tasksErr.message);
    return {
      scanned: 0,
      processed: 0,
      advanced: 0,
      terminal_response_review: 0,
      superseded_lane_closed: 0,
      superseded_lane_review_pending: 0,
      skipped: 0,
      failed_retryable: 0,
      results: [],
    };
  }

  const candidateTasks = ((openTasks ?? []) as JusticeCaseTaskRow[]).filter((task) => {
    const caseId = task.case_id?.trim() ?? "";
    return caseId.length > 0 && taskNotesMatchFollowUpMarker(task.notes, caseId);
  });

  let advancedCount = 0;
  let terminalCount = 0;
  let supersededLaneClosedCount = 0;
  let supersededLaneReviewPendingCount = 0;
  let skippedCount = 0;
  let failedRetryableCount = 0;
  let processedCount = 0;

  for (const task of candidateTasks) {
    const caseId = task.case_id.trim();
    const userId = task.user_id.trim();
    if (!caseId || !userId) {
      results.push({
        case_id: caseId,
        task_id: task.id,
        kind: "skipped",
        reason: "invalid",
      });
      skippedCount += 1;
      continue;
    }

    const { data: caseRow, error: caseErr } = await supabase
      .from("justice_cases")
      .select("id, user_id, intake, client_state, archived_at, payment_dispute_draft")
      .eq("id", caseId)
      .eq("user_id", userId)
      .maybeSingle();

    if (caseErr || !caseRow) {
      results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "invalid" });
      skippedCount += 1;
      continue;
    }

    if (caseRow.archived_at) {
      results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "archived" });
      skippedCount += 1;
      continue;
    }

    if (!isJusticeIntakePayload(caseRow.intake)) {
      results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "invalid" });
      skippedCount += 1;
      continue;
    }
    const intake = caseRow.intake as JusticeIntake;
    const action = parseApprovedNextActionFromClientState(caseRow.client_state);

    // The ladder-advance / response-review logic below reasons entirely from the case's
    // CURRENTLY approved action — it is never correct to apply it to a follow-up that isn't
    // confirmed to belong to that same lane. A row with no owner_href tag predates
    // lane-ownership tracking; its true owner is unknown, so it must be skipped rather than
    // assumed compatible — ensureFollowUpCaseTask can duplicate an untagged row into a second,
    // correctly-owned one for the current lane (see followUpCaseTask.ts), so an untagged row
    // firing here could advance/record-outcome-for the current lane using a stale schedule while
    // the current lane's real follow-up stays untouched.
    const taskOwnerHref = followUpTaskOwnerHref(task.notes);
    if (!taskOwnerHref) {
      results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "missing_owner" });
      skippedCount += 1;
      continue;
    }
    const currentActionHref = action?.href?.trim() || null;
    if (taskOwnerHref !== currentActionHref) {
      // A follow-up owned by a lane the ladder has already advanced past. It still deserves its
      // own due-date processing — closing this task specifically once it goes unanswered — but
      // must NEVER touch client_state (no rewinding/advancing the ladder, no mutating the
      // current lane's approved_next_action, follow-up, or outcome) since that belongs entirely
      // to whichever lane is current. Only lanes with a known remediation-follow-up model are
      // handled this way; anything else is left alone.
      if (!SUPPORTED_SUPERSEDED_LANE_HREFS.has(taskOwnerHref)) {
        results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "not_current_lane" });
        skippedCount += 1;
        continue;
      }
      if (!isOpenFollowUpTaskDue({ task, now })) {
        results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "not_due" });
        skippedCount += 1;
        continue;
      }
      if (caseHasConfirmedResolution(intake, action)) {
        results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "resolved" });
        skippedCount += 1;
        continue;
      }

      const supersededLabel =
        canonicalFilingDestinationForApprovedActionHref(taskOwnerHref) ?? "This attempt";

      // The deadline passing is never itself evidence of "no response" — lane A's own reply
      // status lives nowhere in client_state (that belongs to whichever lane is current), so an
      // owner_href-scoped review task is the durable place a real decision gets recorded. Ensure
      // it (idempotent by case + owner_href + this EXACT follow-up task id — see
      // ensureSupersededLaneResponseReviewTask) and only ever act on ITS completion state. Passing
      // task.id (not just taskOwnerHref) means an older, already-decided review from a prior
      // attempt on this same lane is never reused for this specific follow-up.
      const reviewEnsure = await ensureSupersededLaneResponseReviewTask(
        supabase,
        userId,
        caseId,
        taskOwnerHref,
        task.id,
        supersededLabel
      );
      if (!reviewEnsure.task) {
        results.push({
          case_id: caseId,
          task_id: task.id,
          kind: "failed_retryable",
          error: SUPERSEDED_LANE_REVIEW_ENSURE_RETRYABLE_ERROR,
        });
        failedRetryableCount += 1;
        continue;
      }

      if (!reviewEnsure.task.completed_at?.trim()) {
        // No explicit lane-A decision yet. Keep lane A's follow-up open — closing it here would
        // permanently lose the chance to record what actually happened on this attempt.
        results.push({
          case_id: caseId,
          task_id: task.id,
          kind: "superseded_lane_review_pending",
        });
        supersededLaneReviewPendingCount += 1;
        continue;
      }

      // Reviewed outcome must be durably persisted BEFORE the follow-up task is ever closed —
      // appendCaseTimelineEntry returns null (never throws) on failure, so its result must be
      // checked explicitly rather than assumed. The stable per-task id keeps a retry from ever
      // duplicating this entry once it does succeed. The decision itself was already durably
      // recorded on the review task's own notes by completeSupersededLaneReviewTask — this entry
      // just reflects that recorded decision, never infers one.
      const decision = supersededLaneReviewOutcomeFromNotes(reviewEnsure.task.notes);
      const outcomeTimeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
        id: supersededLaneReviewOutcomeTimelineId(caseId, task.id),
        type: "outcome_recorded",
        label:
          decision === "response_received"
            ? `${supersededLabel}: response received (follow-up closed)`
            : decision === "no_response"
              ? `${supersededLabel}: no response confirmed (follow-up closed)`
              : `${supersededLabel}: response review completed`,
        detail:
          `${supersededLabel}'s own response review was completed. This attempt was already ` +
          `superseded by later escalation — no change to the case's current step.`,
      });
      if (!outcomeTimeline) {
        results.push({
          case_id: caseId,
          task_id: task.id,
          kind: "failed_retryable",
          error: SUPERSEDED_LANE_OUTCOME_APPEND_RETRYABLE_ERROR,
        });
        failedRetryableCount += 1;
        continue;
      }

      const supersededTaskResult = await completeFollowUpCaseTaskById(
        supabase,
        userId,
        caseId,
        task.id
      );
      if (!supersededTaskResult.completed) {
        results.push({
          case_id: caseId,
          task_id: task.id,
          kind: "failed_retryable",
          error: SUPERSEDED_LANE_FOLLOW_UP_CLOSE_RETRYABLE_ERROR,
        });
        failedRetryableCount += 1;
        continue;
      }
      results.push({ case_id: caseId, task_id: task.id, kind: "superseded_lane_closed" });
      supersededLaneClosedCount += 1;
      processedCount += 1;
      continue;
    }

    if (!isOpenFollowUpTaskDue({ task, now })) {
      results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "not_due" });
      skippedCount += 1;
      continue;
    }

    if (caseHasConfirmedResolution(intake, action)) {
      results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "resolved" });
      skippedCount += 1;
      continue;
    }

    // Idempotent recovery: follow-up already cleared (no-response recorded and/or
    // client_state already advanced to a required owned filing step) while the
    // follow-up task is still open. Re-ensure owned filing and/or response review
    // before closing the task.
    if (action && action.follow_up_needed !== true) {
      const alreadyNoResponse = outcomeNoteAlreadyRecordsNoResponse(action.outcome_note);
      const requiresOwnedFiling =
        resolveRequiredOwnedFilingTaskKind(caseRow.client_state) !== null;
      if (alreadyNoResponse || requiresOwnedFiling) {
        if (requiresOwnedFiling) {
          const ownedEnsure = await ensureOwnedFilingTasksForClientState(
            supabase,
            userId,
            caseId,
            intake,
            caseRow.client_state,
            null,
            caseRow.payment_dispute_draft
          );
          if (!ownedEnsure.ok) {
            results.push({
              case_id: caseId,
              task_id: task.id,
              kind: "failed_retryable",
              error: ownedEnsure.error,
            });
            failedRetryableCount += 1;
            continue;
          }
        } else if (alreadyNoResponse) {
          // Terminal recovery: queue response review before closing follow-up.
          const reviewEnsure = await ensureResponseReviewTaskForDueFollowUp(
            supabase,
            userId,
            caseId,
            intake,
            null
          );
          if (!reviewEnsure.ok) {
            results.push({
              case_id: caseId,
              task_id: task.id,
              kind: "failed_retryable",
              error: reviewEnsure.error,
            });
            failedRetryableCount += 1;
            continue;
          }
        }
        await completeFollowUpCaseTaskById(supabase, userId, caseId, task.id);
        results.push({
          case_id: caseId,
          task_id: task.id,
          kind: "skipped",
          reason: "already_processed",
        });
        skippedCount += 1;
        continue;
      }
    }

    const hasUploadedEvidenceFile = await resolveHasUploadedEvidenceFile(supabase, caseId, userId);
    const plan = planDueFollowUpClientState({
      intake,
      clientState: caseRow.client_state,
      now,
      hasUploadedEvidenceFile,
    });

    if (plan.kind === "skip") {
      results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: plan.reason });
      skippedCount += 1;
      continue;
    }

    const { error: patchErr } = await supabase
      .from("justice_cases")
      .update({ client_state: plan.clientState })
      .eq("id", caseId)
      .eq("user_id", userId);

    if (patchErr) {
      console.warn("process due follow-ups: patch client_state", patchErr.message);
      results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "invalid" });
      skippedCount += 1;
      continue;
    }

    let timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
      id: dueFollowUpNoResponseTimelineId(caseId, task.id),
      type: "outcome_recorded",
      label: "Follow-up: no response recorded",
      detail: NO_RESPONSE_OUTCOME_MARKER,
    });

    if (plan.kind === "advanced") {
      const ownedEnsure = await ensureOwnedFilingTasksForClientState(
        supabase,
        userId,
        caseId,
        intake,
        plan.clientState,
        timeline,
        caseRow.payment_dispute_draft
      );
      if (!ownedEnsure.ok) {
        // Leave follow-up open so cron can retry; client_state already advanced.
        results.push({
          case_id: caseId,
          task_id: task.id,
          kind: "failed_retryable",
          error: ownedEnsure.error,
        });
        failedRetryableCount += 1;
        continue;
      }
      timeline = ownedEnsure.timeline;
      const taskResult = await completeFollowUpCaseTaskById(supabase, userId, caseId, task.id);
      if (taskResult.timeline) timeline = taskResult.timeline;
      results.push({
        case_id: caseId,
        task_id: task.id,
        kind: "advanced",
        advanced_href: plan.nextAction.href,
      });
      advancedCount += 1;
      processedCount += 1;
      continue;
    }

    const reviewEnsure = await ensureResponseReviewTaskForDueFollowUp(
      supabase,
      userId,
      caseId,
      intake,
      timeline
    );
    if (!reviewEnsure.ok) {
      // Leave follow-up open so cron can retry; client_state already cleared.
      results.push({
        case_id: caseId,
        task_id: task.id,
        kind: "failed_retryable",
        error: reviewEnsure.error,
      });
      failedRetryableCount += 1;
      continue;
    }
    timeline = reviewEnsure.timeline;
    const taskResult = await completeFollowUpCaseTaskById(supabase, userId, caseId, task.id);
    if (taskResult.timeline) timeline = taskResult.timeline;
    results.push({
      case_id: caseId,
      task_id: task.id,
      kind: "terminal_response_review",
    });
    terminalCount += 1;
    processedCount += 1;
  }

  return {
    scanned: candidateTasks.length,
    processed: processedCount,
    advanced: advancedCount,
    terminal_response_review: terminalCount,
    superseded_lane_review_pending: supersededLaneReviewPendingCount,
    superseded_lane_closed: supersededLaneClosedCount,
    skipped: skippedCount,
    failed_retryable: failedRetryableCount,
    results,
  };
}
