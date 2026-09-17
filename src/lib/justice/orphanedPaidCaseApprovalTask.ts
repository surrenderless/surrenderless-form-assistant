import type { SupabaseClient } from "@supabase/supabase-js";
import { insertManagedFulfillmentTaskConflictSafe } from "@/lib/justice/managedFulfillmentTaskDedupe";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const MAX_NOTES = 8000;
const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Stable idempotency marker stored at the start of task notes. */
export function orphanedPaidCaseApprovalTaskNotesMarker(caseId: string): string {
  return `orphaned_paid_case_approval_queue:${caseId.trim()}`;
}

export function taskNotesMatchOrphanedPaidCaseApprovalMarker(
  notes: string | null | undefined,
  caseId: string
): boolean {
  const marker = orphanedPaidCaseApprovalTaskNotesMarker(caseId);
  const trimmed = (notes ?? "").trim();
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

export type EnsureOrphanedPaidCaseApprovalTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: unknown;
  created: boolean;
};

export type CompleteOrphanedPaidCaseApprovalTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: unknown;
  completed: boolean;
  failed: boolean;
};

function orphanedPaidCaseApprovalTaskCompletedTimelineId(taskId: string): string {
  return `orphaned_paid_case_approval_task_completed:${taskId}`;
}

/**
 * Durable operator-visible marker for a paid case whose intended approval could not be
 * automatically finalized (no captured intended action, and current intake either invalid or no
 * destination currently routable) — deliberately NOT auto-guessed, per
 * reconcileOrphanedPaidCaseApprovals.ts's own doc comment. Idempotent on the open-task marker,
 * matching every other owned-filing task's ensure pattern; picked up by the existing operator
 * queue-alert mechanism (operatorFallbackAlertReconciler.ts) like any other destination — no new
 * alerting path, reusing the one already proven for the other 10.
 */
export async function ensureOrphanedPaidCaseApprovalTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  reason: string
): Promise<EnsureOrphanedPaidCaseApprovalTaskResult> {
  const marker = orphanedPaidCaseApprovalTaskNotesMarker(caseId);

  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .is("completed_at", null)
    .limit(1);

  if (existingErr) {
    console.warn("orphaned paid case approval task: select existing", existingErr.message);
    return { task: null, timeline: null, created: false };
  }

  const existing = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (existing) {
    return { task: existing, timeline: null, created: false };
  }

  const notes = clampLen(
    [marker, `reason: ${reason}`, "This case was paid but Surrenderless could not automatically determine and finalize which action to approve. Review the case and approve the correct action manually."].join(
      "\n"
    ),
    MAX_NOTES
  );

  const insertResult = await insertManagedFulfillmentTaskConflictSafe(supabase, {
    userId,
    caseId,
    marker,
    title: "Paid case needs manual approval review",
    notes,
  });

  if (!insertResult.ok) {
    console.warn("orphaned paid case approval task: insert", insertResult.error);
    return { task: null, timeline: null, created: false };
  }

  const task = insertResult.task;
  const timeline = insertResult.created
    ? await appendCaseTimelineEntry(supabase, userId, caseId, {
        id: `justice_task_add:${task.id}`,
        type: "task_added",
        label: "Paid case flagged for manual approval review",
        detail: reason,
      })
    : null;

  return { task, timeline, created: insertResult.created };
}

/**
 * Closes any still-open orphaned_paid_case_approval review task for this case — idempotent
 * no-op when none is open. Called from every path that confirms a case is (now) durably
 * approved: finalizePaidPreparedPacketApproval (automatic finalization, whether that happened
 * just now or on an earlier attempt) and the operator manual-resolution endpoint. A stale open
 * review task left behind after the underlying problem is actually resolved would otherwise
 * escalate forever via operatorFallbackAlertReconciler's recurring-every-72h schedule.
 */
export async function completeOrphanedPaidCaseApprovalTaskIfOpen(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<CompleteOrphanedPaidCaseApprovalTaskResult> {
  const marker = orphanedPaidCaseApprovalTaskNotesMarker(caseId);

  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .is("completed_at", null)
    .limit(1);

  if (existingErr) {
    console.warn("orphaned paid case approval task: select for complete", existingErr.message);
    return { task: null, timeline: null, completed: false, failed: true };
  }

  const task = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (!task) {
    return { task: null, timeline: null, completed: false, failed: false };
  }

  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .update({ completed_at: completedAt })
    .eq("id", task.id)
    .eq("user_id", userId)
    .select(TASK_SELECT)
    .maybeSingle();

  if (error || !data) {
    console.warn(
      "orphaned paid case approval task: complete update",
      error?.message ?? "not found"
    );
    return { task, timeline: null, completed: false, failed: true };
  }

  const completedTask = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: orphanedPaidCaseApprovalTaskCompletedTimelineId(completedTask.id),
    type: "task_completed",
    label: "Paid case approval review resolved",
    detail: completedTask.title.trim(),
    ts: completedTask.completed_at ?? completedAt,
  });

  return { task: completedTask, timeline, completed: true, failed: false };
}
