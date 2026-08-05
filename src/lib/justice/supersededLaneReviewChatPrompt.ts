import { validate as isUuid } from "uuid";
import { followUpTaskOwnerHref } from "@/lib/justice/followUpCaseTask";
import {
  taskNotesMatchSupersededLaneReviewMarker,
  type SupersededLaneReviewOutcome,
} from "@/lib/justice/followUpResponseReviewTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

/**
 * Every OPEN superseded_lane_review task for this case, never just one — more than one prior
 * lane can have its own open review simultaneously. When deepLinkTaskId identifies one of them
 * (from a notification email's `?case=&task=` link), that task is sorted first so it stays
 * visible even with several open reviews, rather than being buried or silently dropped.
 */
export function selectOpenSupersededLaneReviewTasks(
  tasks: JusticeCaseTaskRow[],
  caseId: string,
  deepLinkTaskId?: string | null
): JusticeCaseTaskRow[] {
  const open = tasks.filter(
    (t) => !t.completed_at?.trim() && taskNotesMatchSupersededLaneReviewMarker(t.notes, caseId)
  );
  if (!deepLinkTaskId) return open;
  return [...open].sort((a, b) => {
    const aFirst = a.id === deepLinkTaskId ? 0 : 1;
    const bFirst = b.id === deepLinkTaskId ? 0 : 1;
    return aFirst - bFirst;
  });
}

export type SupersededLaneReviewCompletionRequest = {
  case_id: string;
  task_id: string;
  owner_href: string;
  outcome: SupersededLaneReviewOutcome;
};

/**
 * Builds the exact body for POST /api/justice/follow-up-response-review/consumer-complete-
 * superseded, or null when the case id, task id, or the task's own owner_href can't be resolved
 * — malformed or foreign task notes must never produce a request rather than send a broken one.
 */
export function buildSupersededLaneReviewCompletionRequest(
  caseId: string,
  task: Pick<JusticeCaseTaskRow, "id" | "notes">,
  outcome: SupersededLaneReviewOutcome
): SupersededLaneReviewCompletionRequest | null {
  const trimmedCaseId = caseId.trim();
  const ownerHref = followUpTaskOwnerHref(task.notes);
  if (!trimmedCaseId || !isUuid(trimmedCaseId) || !task.id?.trim() || !ownerHref) return null;
  return { case_id: trimmedCaseId, task_id: task.id, owner_href: ownerHref, outcome };
}
