import { validate as isUuid } from "uuid";
import {
  taskNotesMatchFollowUpResponseReviewMarker,
  taskNotesMatchSupersededLaneReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

export type ReviewTaskDeepLinkParams = { caseId: string; taskId: string };

/**
 * Parses & validates `?case=<uuid>&task=<uuid>` from a consumer-review-notification email link.
 * Returns null for missing or malformed params so normal chat behavior (no deep link at all) is
 * preserved untouched — callers must never fall back to "most recent case" on a null result.
 */
export function parseReviewTaskDeepLinkParams(search: string): ReviewTaskDeepLinkParams | null {
  const params = new URLSearchParams(search);
  const caseId = params.get("case")?.trim() ?? "";
  const taskId = params.get("task")?.trim() ?? "";
  if (!caseId || !isUuid(caseId) || !taskId || !isUuid(taskId)) return null;
  return { caseId, taskId };
}

/**
 * True only for a genuinely open, case-matched consumer review task — never a completed,
 * cross-case, or wrong-type task. Both consumer-review-notification source types are accepted
 * since either can be the subject of a deep link.
 */
export function isOpenConsumerReviewTaskForDeepLink(
  task: Pick<JusticeCaseTaskRow, "case_id" | "completed_at" | "notes"> | null | undefined,
  caseId: string
): boolean {
  if (!task) return false;
  if (task.completed_at?.trim()) return false;
  if (task.case_id !== caseId) return false;
  return (
    taskNotesMatchFollowUpResponseReviewMarker(task.notes, caseId) ||
    taskNotesMatchSupersededLaneReviewMarker(task.notes, caseId)
  );
}

export type ReviewTaskDeepLinkAction =
  | { kind: "none" }
  | { kind: "reject" }
  | { kind: "hydrate"; caseId: string; taskId: string };

/**
 * Pure decision for what a `/justice/chat-ai` visit carrying `?case=&task=` should do, given the
 * already-fetched, ownership-scoped server results. Never substitutes a "most recent" case —
 * `caseLookup`/`tasks` must come from a lookup keyed to the EXACT linked case id.
 *
 * - No params, malformed params (fails to parse as two UUIDs — indistinguishable from "no link"),
 *   or the session already has this exact case active: "none" (no-op, preserves normal chat —
 *   including an already-correct session, which must not be redundantly reloaded).
 * - A validly-parsed link pointing at an unowned or nonexistent case (`caseLookup` null — the
 *   caller's ownership-scoped lookup returns null for both "not found" and "not yours", so this
 *   never distinguishes them and never leaks which case exists), or a completed/cross-case/
 *   wrong-type task: "reject".
 * - Both "none" and "reject" leave active state untouched — the distinction is diagnostic only.
 * - Otherwise: "hydrate" with the exact case + task id from the link.
 */
export function resolveReviewTaskDeepLinkAction(params: {
  search: string;
  sessionCaseId: string;
  caseLookup: { id: string } | null;
  tasks: JusticeCaseTaskRow[] | null;
}): ReviewTaskDeepLinkAction {
  const deepLink = parseReviewTaskDeepLinkParams(params.search);
  if (!deepLink) return { kind: "none" };

  if (params.sessionCaseId.trim() === deepLink.caseId) return { kind: "none" };

  if (!params.caseLookup || params.caseLookup.id !== deepLink.caseId) return { kind: "reject" };

  const task = (params.tasks ?? []).find((t) => t.id === deepLink.taskId);
  if (!isOpenConsumerReviewTaskForDeepLink(task, deepLink.caseId)) return { kind: "reject" };

  return { kind: "hydrate", caseId: deepLink.caseId, taskId: deepLink.taskId };
}
