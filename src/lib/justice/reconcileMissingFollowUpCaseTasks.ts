import type { SupabaseClient } from "@supabase/supabase-js";
import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import {
  ensureFollowUpCaseTask,
  followUpTaskNotesMarker,
  taskNotesMatchFollowUpMarker,
} from "@/lib/justice/followUpCaseTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_SELECT = "id, user_id, client_state, archived_at" as const;
const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

export type ReconcileMissingFollowUpCaseResult = {
  case_id: string;
  user_id: string;
  kind: "created" | "already_present" | "failed" | "skipped";
  reason?: "archived" | "follow_up_not_needed" | "invalid" | "ensure_failed";
};

export type ReconcileMissingFollowUpCaseTasksSummary = {
  scanned: number;
  needing_follow_up: number;
  created: number;
  already_present: number;
  failed: number;
  skipped: number;
  results: ReconcileMissingFollowUpCaseResult[];
};

function caseNeedsFollowUpTask(clientState: unknown): boolean {
  return parseApprovedNextActionFromClientState(clientState)?.follow_up_needed === true;
}

async function caseHasFollowUpTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<boolean | null> {
  const marker = followUpTaskNotesMarker(caseId);
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (error) {
    console.warn("reconcile follow-up tasks: select existing", error.message);
    return null;
  }

  const row = (data?.[0] as JusticeCaseTaskRow | undefined) ?? undefined;
  if (!row) return false;
  return taskNotesMatchFollowUpMarker(row.notes, caseId);
}

/**
 * Finds non-archived cases with follow_up_needed === true that lack a follow_up:<caseId>
 * task (open or completed) and creates the missing task via idempotent ensureFollowUpCaseTask.
 */
export async function reconcileMissingFollowUpCaseTasks(
  supabase: SupabaseClient,
  options: { limit?: number } = {}
): Promise<ReconcileMissingFollowUpCaseTasksSummary> {
  const limit = options.limit ?? 100;
  const results: ReconcileMissingFollowUpCaseResult[] = [];

  const { data: caseRows, error: casesErr } = await supabase
    .from("justice_cases")
    .select(CASE_SELECT)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (casesErr) {
    console.warn("reconcile follow-up tasks: list cases", casesErr.message);
    return {
      scanned: 0,
      needing_follow_up: 0,
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
    client_state: unknown;
    archived_at: string | null;
  }>;

  let needingFollowUp = 0;
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

    if (!caseNeedsFollowUpTask(row.client_state)) {
      continue;
    }

    needingFollowUp += 1;

    const hasTask = await caseHasFollowUpTask(supabase, userId, caseId);
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

    const approvedNext = parseApprovedNextActionFromClientState(row.client_state);
    if (!approvedNext || approvedNext.follow_up_needed !== true) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "skipped",
        reason: "follow_up_not_needed",
      });
      skipped += 1;
      continue;
    }

    const ensured = await ensureFollowUpCaseTask(supabase, userId, caseId, approvedNext);
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
    needing_follow_up: needingFollowUp,
    created,
    already_present: alreadyPresent,
    failed,
    skipped,
    results,
  };
}
