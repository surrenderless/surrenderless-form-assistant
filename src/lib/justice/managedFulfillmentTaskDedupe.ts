import type { SupabaseClient } from "@supabase/supabase-js";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

export type InsertManagedFulfillmentTaskResult =
  | { ok: true; task: JusticeCaseTaskRow; created: boolean }
  | { ok: false; error: string };

/**
 * Conflict-safe managed-fulfillment-task creation. justice_case_tasks.dedupe_key plus a partial
 * unique index (WHERE completed_at IS NULL — see the justice_case_tasks_dedupe_key migration)
 * enforces at most one OPEN task per (case, destination) at the database level, closing the
 * select-then-insert race every ensure*FilingTask / ensureOrphanedPaidCaseApprovalTask function
 * previously had on its own: two concurrent callers (a Stripe webhook redelivery, the 5-minute
 * orphan-recovery reconciler, and/or an operator action) can both pass the "no open task found"
 * fast-path select, but only ONE of their inserts can ever actually land. The loser gets a real
 * 23505 conflict on dedupe_key here, and this recovers by re-reading and returning the winner's
 * row (created: false) instead of propagating a hard failure or leaving a second, duplicate task
 * behind.
 */
export async function insertManagedFulfillmentTaskConflictSafe(
  supabase: SupabaseClient,
  params: { userId: string; caseId: string; marker: string; title: string; notes: string }
): Promise<InsertManagedFulfillmentTaskResult> {
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .insert({
      user_id: params.userId,
      case_id: params.caseId,
      title: params.title,
      notes: params.notes,
      dedupe_key: params.marker,
    })
    .select(TASK_SELECT)
    .single();

  if (!error) {
    return { ok: true, task: data as JusticeCaseTaskRow, created: true };
  }

  if (error.code !== "23505") {
    return { ok: false, error: error.message };
  }

  const { data: existingRows, error: selectErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", params.userId)
    .eq("case_id", params.caseId)
    .like("notes", `${params.marker}%`)
    .is("completed_at", null)
    .limit(1);

  if (selectErr) {
    return { ok: false, error: selectErr.message };
  }
  const existing = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (!existing) {
    return {
      ok: false,
      error: "Conflict creating fulfillment task but no open task found on retry",
    };
  }
  return { ok: true, task: existing, created: false };
}
