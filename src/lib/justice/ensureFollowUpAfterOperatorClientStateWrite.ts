import type { SupabaseClient } from "@supabase/supabase-js";
import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import {
  ensureFollowUpCaseTask,
  isFirstFollowUpNeededTransition,
} from "@/lib/justice/followUpCaseTask";
import type { TimelineEntry } from "@/lib/justice/types";

export type EnsureFollowUpAfterOperatorClientStateWriteResult = {
  timeline: TimelineEntry[] | null;
  created: boolean;
};

/**
 * After a successful direct client_state write (bypassing PATCH /api/justice/cases/[id]),
 * create the follow-up case task when follow_up_needed transitions false/missing → true.
 * Idempotent via ensureFollowUpCaseTask marker lookup — never duplicates open follow-up tasks.
 */
export async function ensureFollowUpAfterOperatorClientStateWrite(
  supabase: SupabaseClient,
  params: {
    userId: string;
    caseId: string;
    existingClientState: unknown;
    nextClientState: unknown;
  }
): Promise<EnsureFollowUpAfterOperatorClientStateWriteResult> {
  const userId = params.userId.trim();
  const caseId = params.caseId.trim();
  if (!userId || !caseId) {
    return { timeline: null, created: false };
  }

  if (!isFirstFollowUpNeededTransition(params.existingClientState, params.nextClientState)) {
    return { timeline: null, created: false };
  }

  const approvedNext = parseApprovedNextActionFromClientState(params.nextClientState);
  if (approvedNext?.follow_up_needed !== true) {
    return { timeline: null, created: false };
  }

  const result = await ensureFollowUpCaseTask(supabase, userId, caseId, approvedNext);
  return { timeline: result.timeline, created: result.created };
}
