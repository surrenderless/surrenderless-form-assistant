import type { SupabaseClient } from "@supabase/supabase-js";
import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import { ensureFollowUpCaseTask } from "@/lib/justice/followUpCaseTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { TimelineEntry } from "@/lib/justice/types";

/** Retriable error when follow_up_needed is true but the follow-up task could not be ensured. */
export const FOLLOW_UP_TASK_ENSURE_RETRYABLE_ERROR =
  "Case updated but follow-up task could not be created. Retry to finish follow-up handoff.";

export type EnsureFollowUpAfterOperatorClientStateWriteResult =
  | {
      ok: true;
      timeline: TimelineEntry[] | null;
      created: boolean;
      task: JusticeCaseTaskRow | null;
    }
  | {
      ok: false;
      error: string;
      timeline: TimelineEntry[] | null;
      created: false;
      task: null;
    };

/**
 * After a successful client_state write, ensure the follow-up case task exists whenever
 * follow_up_needed === true (not only on false→true transitions).
 * Idempotent via ensureFollowUpCaseTask marker lookup — never duplicates follow-up tasks.
 * Returns ok: false when follow-up is required but the task is still missing after ensure.
 */
export async function ensureFollowUpAfterOperatorClientStateWrite(
  supabase: SupabaseClient,
  params: {
    userId: string;
    caseId: string;
    /** Retained for call-site compatibility; ensure is gated on nextClientState only. */
    existingClientState?: unknown;
    nextClientState: unknown;
  }
): Promise<EnsureFollowUpAfterOperatorClientStateWriteResult> {
  const userId = params.userId.trim();
  const caseId = params.caseId.trim();
  if (!userId || !caseId) {
    return { ok: true, timeline: null, created: false, task: null };
  }

  const approvedNext = parseApprovedNextActionFromClientState(params.nextClientState);
  if (approvedNext?.follow_up_needed !== true) {
    return { ok: true, timeline: null, created: false, task: null };
  }

  const result = await ensureFollowUpCaseTask(supabase, userId, caseId, approvedNext);
  if (!result.task) {
    return {
      ok: false,
      error: FOLLOW_UP_TASK_ENSURE_RETRYABLE_ERROR,
      timeline: null,
      created: false,
      task: null,
    };
  }

  return {
    ok: true,
    timeline: result.timeline,
    created: result.created,
    task: result.task,
  };
}
