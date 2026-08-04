import type { SupabaseClient } from "@supabase/supabase-js";
import { followUpTaskOwnerHref, taskNotesMatchFollowUpMarker } from "@/lib/justice/followUpCaseTask";
import {
  appendSupersededLaneReviewDecisionToNotes,
  isSupersededLaneReviewOutcome,
  supersededLaneReviewLinkedFollowUpTaskId,
  supersededLaneReviewOutcomeFromNotes,
  taskNotesMatchSupersededLaneReviewMarker,
  type SupersededLaneReviewOutcome,
} from "@/lib/justice/followUpResponseReviewTask";
import { isOpenFollowUpTaskDue } from "@/lib/justice/processDueFollowUps";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

/**
 * Fetches the EXACT follow-up task this review is durably linked to — by id, scoped to this
 * user/case, never a scan-and-find over every same-lane row. A cross-case id (however it got
 * there) simply matches nothing, since the lookup is scoped by case_id too. Returns null for a
 * missing/deleted row — callers must treat that the same as "linkage invalid," never as "not
 * due yet" vs "due," since no real schedule was ever confirmed.
 */
async function fetchLinkedFollowUpTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  followUpTaskId: string
): Promise<JusticeCaseTaskRow | null> {
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("id", followUpTaskId)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn("justice superseded lane response review: select linked follow-up", error.message);
    }
    return null;
  }
  return data as JusticeCaseTaskRow;
}

export function supersededLaneReviewDecisionTimelineId(caseId: string, taskId: string): string {
  return `superseded_lane_review_decision:${caseId.trim()}:${taskId.trim()}`;
}

export type CompleteSupersededLaneReviewInput = {
  caseId: string;
  taskId: string;
  /** The lane this review belongs to — verified against the task's own owner_href tag, never
   * trusted on its own, so a caller can never record a decision against the wrong lane's row. */
  ownerHref: string;
  outcome: SupersededLaneReviewOutcome;
  notes?: string | null;
};

export type CompleteSupersededLaneReviewResult =
  | {
      ok: true;
      task: JusticeCaseTaskRow;
      timeline: TimelineEntry[] | null;
      outcome: SupersededLaneReviewOutcome;
      idempotent: boolean;
    }
  | { ok: false; error: string; status: number };

/**
 * Records an explicit response/no-response decision for ONE specific superseded escalation
 * lane's own review — scoped by exact task id AND owner_href, so this can never be satisfied by
 * or confused with a different lane's review or with the case's currently-approved lane. Never
 * reads or mutates client_state/approved_next_action: that belongs entirely to whichever lane is
 * CURRENTLY approved, not to a lane the ladder has already moved past.
 *
 * The decision is written into the task's own notes and completed_at in a single atomic update,
 * so it is never possible for the review to be closed without its outcome durably recorded.
 */
export async function completeSupersededLaneReviewTask(
  supabase: SupabaseClient,
  userId: string,
  input: CompleteSupersededLaneReviewInput
): Promise<CompleteSupersededLaneReviewResult> {
  const caseId = input.caseId.trim();
  const taskId = input.taskId.trim();
  const ownerHref = input.ownerHref.trim();
  if (!caseId || !taskId || !ownerHref) {
    return { ok: false, error: "case_id, task_id, and owner_href are required", status: 400 };
  }
  if (!isSupersededLaneReviewOutcome(input.outcome)) {
    return { ok: false, error: "Invalid outcome", status: 400 };
  }

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("id, user_id, archived_at")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (caseErr || !caseRow) {
    return { ok: false, error: "Not found", status: 404 };
  }
  if (caseRow.archived_at) {
    return { ok: false, error: "Case is archived", status: 409 };
  }

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
  if (!taskNotesMatchSupersededLaneReviewMarker(task.notes, caseId)) {
    return { ok: false, error: "Task is not a superseded-lane response review", status: 400 };
  }
  if (followUpTaskOwnerHref(task.notes) !== ownerHref) {
    return { ok: false, error: "Task does not belong to the given owner_href", status: 400 };
  }

  if (task.completed_at?.trim()) {
    const persistedOutcome = supersededLaneReviewOutcomeFromNotes(task.notes) ?? input.outcome;
    return { ok: true, task, timeline: null, outcome: persistedOutcome, idempotent: true };
  }

  // This review must resolve to the EXACT follow-up attempt it was created for — never an
  // arbitrary same-lane row found by scanning. Missing, malformed, mismatched-owner, or
  // cross-case linkage all fail safely here, before anything is written, rather than falling
  // back to a guess about which attempt this decision is actually about.
  const linkedFollowUpTaskId = supersededLaneReviewLinkedFollowUpTaskId(task.notes);
  if (!linkedFollowUpTaskId) {
    return { ok: false, error: "Review is missing its linked follow-up task", status: 400 };
  }
  const linkedFollowUp = await fetchLinkedFollowUpTask(supabase, userId, caseId, linkedFollowUpTaskId);
  if (!linkedFollowUp || !taskNotesMatchFollowUpMarker(linkedFollowUp.notes, caseId)) {
    return { ok: false, error: "Linked follow-up task could not be found", status: 400 };
  }
  if (followUpTaskOwnerHref(linkedFollowUp.notes) !== ownerHref) {
    return { ok: false, error: "Linked follow-up task does not match this review's owner_href", status: 400 };
  }

  // A response can arrive — and be recorded — at any point, including well before this lane's
  // own follow-up becomes due. "No response" is a different claim: it asserts the deadline
  // passed with nothing heard, which is only true once that deadline has actually passed. Gate
  // only that outcome on the linked follow-up's own due_date, exactly the schedule
  // processDueFollowUps itself uses — never the case's current approved_next_action.
  if (input.outcome === "no_response") {
    const due = isOpenFollowUpTaskDue({ task: linkedFollowUp, now: new Date() });
    if (!due) {
      return {
        ok: false,
        error: "This lane's follow-up is not due yet — no_response cannot be recorded before its due date",
        status: 400,
      };
    }
  }

  const updatedNotes = appendSupersededLaneReviewDecisionToNotes(
    task.notes,
    input.outcome,
    input.notes
  );
  const completedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .update({ notes: updatedNotes, completed_at: completedAt })
    .eq("id", task.id)
    .eq("user_id", userId)
    .select(TASK_SELECT)
    .maybeSingle();

  if (error || !data) {
    console.warn(
      "justice superseded lane response review: complete update",
      error?.message ?? "not found"
    );
    return { ok: false, error: "Could not record decision and complete review", status: 500 };
  }

  const updated = data as JusticeCaseTaskRow;
  const label =
    input.outcome === "response_received"
      ? "Superseded-lane response received"
      : "Superseded-lane no response confirmed";
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: supersededLaneReviewDecisionTimelineId(caseId, task.id),
    type: "outcome_recorded",
    label,
    detail: updated.title.trim(),
    ts: completedAt,
  });

  return { ok: true, task: updated, timeline, outcome: input.outcome, idempotent: false };
}
