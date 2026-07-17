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
import { ensureOwnedFilingTaskAfterClientStateWrite } from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import {
  isDownstreamHumanFulfillmentEscalationAction,
  isEscalationLadderTerminalForResolution,
  stripResolutionTrackingFromApprovedAction,
} from "@/lib/justice/escalationLadderResolution";
import {
  completeFollowUpCaseTaskIfOpen,
  taskNotesMatchFollowUpMarker,
} from "@/lib/justice/followUpCaseTask";
import { ensureFollowUpResponseReviewTask } from "@/lib/justice/followUpResponseReviewTask";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import { getJusticeTaskDueKind, parseDueDateToLocalYmd } from "@/lib/justice/taskDueStatus";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const OUTCOME_NOTE_MAX = 500;

export const NO_RESPONSE_OUTCOME_MARKER = "No response recorded by follow-up date";

export type DueFollowUpSkipReason =
  | "not_due"
  | "already_completed"
  | "archived"
  | "resolved"
  | "invalid"
  | "follow_up_not_needed"
  | "already_processed";

export type DueFollowUpProcessKind = "advanced" | "terminal_response_review" | "skipped";

export type DueFollowUpProcessResult = {
  case_id: string;
  task_id: string;
  kind: DueFollowUpProcessKind;
  reason?: DueFollowUpSkipReason;
  advanced_href?: string;
};

function localTodayYmd(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** True when follow-up task due_date is today or earlier (or follow_up_at fallback is due). */
export function isOpenFollowUpTaskDue(params: {
  task: Pick<JusticeCaseTaskRow, "due_date" | "completed_at">;
  followUpAt?: string | null;
  now?: Date;
}): boolean {
  if (params.task.completed_at?.trim()) return false;
  const now = params.now ?? new Date();
  const kind = getJusticeTaskDueKind(params.task);
  if (kind === "overdue" || kind === "due_today") return true;
  if (kind === "upcoming") return false;

  // No due_date on task — fall back to approved_next_action.follow_up_at.
  const fromAt = parseDueDateToLocalYmd(params.followUpAt);
  if (!fromAt) return false;
  return fromAt <= localTodayYmd(now);
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

async function queueTasksForClientState(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  intake: JusticeIntake,
  clientState: Record<string, unknown>,
  timeline: TimelineEntry[] | null,
  paymentDisputeDraft?: unknown
): Promise<TimelineEntry[] | null> {
  const ownedEnsure = await ensureOwnedFilingTaskAfterClientStateWrite(supabase, {
    userId,
    caseId,
    clientState,
    intake,
    paymentDisputeDraft,
  });
  if (!ownedEnsure.ok) {
    console.warn("process due follow-ups: owned filing task ensure", ownedEnsure.error);
    return timeline;
  }
  if (ownedEnsure.timeline) {
    return ownedEnsure.timeline;
  }
  return timeline;
}

export type ProcessDueFollowUpsSummary = {
  scanned: number;
  processed: number;
  advanced: number;
  terminal_response_review: number;
  skipped: number;
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
      skipped: 0,
      results: [],
    };
  }

  const candidateTasks = ((openTasks ?? []) as JusticeCaseTaskRow[]).filter((task) => {
    const caseId = task.case_id?.trim() ?? "";
    return caseId.length > 0 && taskNotesMatchFollowUpMarker(task.notes, caseId);
  });

  let advancedCount = 0;
  let terminalCount = 0;
  let skippedCount = 0;
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

    if (
      !isOpenFollowUpTaskDue({
        task,
        followUpAt: action?.follow_up_at,
        now,
      })
    ) {
      results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "not_due" });
      skippedCount += 1;
      continue;
    }

    if (caseHasConfirmedResolution(intake, action)) {
      results.push({ case_id: caseId, task_id: task.id, kind: "skipped", reason: "resolved" });
      skippedCount += 1;
      continue;
    }

    // Idempotent: consumer follow-up already cleared and no-response recorded → just ensure task completion.
    if (
      action &&
      action.follow_up_needed !== true &&
      outcomeNoteAlreadyRecordsNoResponse(action.outcome_note)
    ) {
      await completeFollowUpCaseTaskIfOpen(supabase, userId, caseId);
      results.push({
        case_id: caseId,
        task_id: task.id,
        kind: "skipped",
        reason: "already_processed",
      });
      skippedCount += 1;
      continue;
    }

    const plan = planDueFollowUpClientState({
      intake,
      clientState: caseRow.client_state,
      now,
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

    const taskResult = await completeFollowUpCaseTaskIfOpen(supabase, userId, caseId);
    if (taskResult.timeline) timeline = taskResult.timeline;

    if (plan.kind === "advanced") {
      timeline = await queueTasksForClientState(
        supabase,
        userId,
        caseId,
        intake,
        plan.clientState,
        timeline,
        caseRow.payment_dispute_draft
      );
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

    const review = await ensureFollowUpResponseReviewTask(supabase, userId, caseId, intake);
    if (review.timeline) timeline = review.timeline;
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
    skipped: skippedCount,
    results,
  };
}
