import type { SupabaseClient } from "@supabase/supabase-js";
import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import { isEscalationLadderTerminalForResolution } from "@/lib/justice/escalationLadderResolution";
import {
  ensureFollowUpResponseReviewTask,
  followUpResponseReviewTaskNotesMarker,
  taskNotesMatchFollowUpResponseReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import { hasOperatorTerminalResponseReviewOutcome } from "@/lib/justice/operatorOwnedCaseArchive";
import { outcomeNoteAlreadyRecordsNoResponse } from "@/lib/justice/processDueFollowUps";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

const CASE_SELECT = "id, user_id, intake, client_state, archived_at" as const;
const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

export type ReconcileMissingFollowUpResponseReviewResult = {
  case_id: string;
  user_id: string;
  kind: "created" | "already_present" | "failed" | "skipped";
  reason?: "archived" | "not_needed" | "invalid" | "ensure_failed";
};

export type ReconcileMissingFollowUpResponseReviewTasksSummary = {
  scanned: number;
  needing_response_review: number;
  created: number;
  already_present: number;
  failed: number;
  skipped: number;
  results: ReconcileMissingFollowUpResponseReviewResult[];
};

/**
 * True when client_state is in terminal no-response state that should have a
 * follow_up_response_review:<caseId> operator task (orphaned past due processing).
 */
export function caseNeedsFollowUpResponseReviewTask(clientState: unknown): boolean {
  const action = parseApprovedNextActionFromClientState(clientState);
  if (!action) return false;
  if (!outcomeNoteAlreadyRecordsNoResponse(action.outcome_note)) return false;
  if (action.follow_up_needed === true) return false;
  if (!isEscalationLadderTerminalForResolution(action)) return false;
  if (hasOperatorTerminalResponseReviewOutcome(action)) return false;
  return true;
}

async function caseHasResponseReviewTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<boolean | null> {
  const marker = followUpResponseReviewTaskNotesMarker(caseId);
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (error) {
    console.warn("reconcile response-review tasks: select existing", error.message);
    return null;
  }

  const row = (data?.[0] as JusticeCaseTaskRow | undefined) ?? undefined;
  if (!row) return false;
  return taskNotesMatchFollowUpResponseReviewMarker(row.notes, caseId);
}

/**
 * Finds non-archived cases in terminal no-response state that lack a
 * follow_up_response_review:<caseId> task and creates it via idempotent
 * ensureFollowUpResponseReviewTask.
 */
export async function reconcileMissingFollowUpResponseReviewTasks(
  supabase: SupabaseClient,
  options: { limit?: number } = {}
): Promise<ReconcileMissingFollowUpResponseReviewTasksSummary> {
  const limit = options.limit ?? 100;
  const results: ReconcileMissingFollowUpResponseReviewResult[] = [];

  const { data: caseRows, error: casesErr } = await supabase
    .from("justice_cases")
    .select(CASE_SELECT)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (casesErr) {
    console.warn("reconcile response-review tasks: list cases", casesErr.message);
    return {
      scanned: 0,
      needing_response_review: 0,
      created: 0,
      already_present: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };
  }

  const rows = (caseRows ?? []) as Array<{
    id: string;
    user_id: string;
    intake: unknown;
    client_state: unknown;
    archived_at: string | null;
  }>;

  let needingResponseReview = 0;
  let created = 0;
  let alreadyPresent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const caseId = row.id?.trim() ?? "";
    const userId = row.user_id?.trim() ?? "";
    if (!caseId || !userId) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "skipped",
        reason: "invalid",
      });
      skipped += 1;
      continue;
    }

    if (row.archived_at?.trim()) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "skipped",
        reason: "archived",
      });
      skipped += 1;
      continue;
    }

    if (!caseNeedsFollowUpResponseReviewTask(row.client_state)) {
      continue;
    }

    needingResponseReview += 1;

    if (!isJusticeIntakePayload(row.intake)) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "skipped",
        reason: "invalid",
      });
      skipped += 1;
      continue;
    }

    const hasTask = await caseHasResponseReviewTask(supabase, userId, caseId);
    if (hasTask === null) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "failed",
        reason: "ensure_failed",
      });
      failed += 1;
      continue;
    }
    if (hasTask) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "already_present",
      });
      alreadyPresent += 1;
      continue;
    }

    const ensured = await ensureFollowUpResponseReviewTask(
      supabase,
      userId,
      caseId,
      row.intake as JusticeIntake
    );
    if (!ensured.task) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "failed",
        reason: "ensure_failed",
      });
      failed += 1;
      continue;
    }

    if (ensured.created) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "created",
      });
      created += 1;
    } else {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "already_present",
      });
      alreadyPresent += 1;
    }
  }

  return {
    scanned: rows.length,
    needing_response_review: needingResponseReview,
    created,
    already_present: alreadyPresent,
    failed,
    skipped,
    results,
  };
}
