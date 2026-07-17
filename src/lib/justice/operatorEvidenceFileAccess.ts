import type { SupabaseClient } from "@supabase/supabase-js";
import { taskNotesMatchBbbFilingMarker } from "@/lib/justice/bbbFilingTask";
import { taskNotesMatchCfpbFilingMarker } from "@/lib/justice/cfpbFilingTask";
import { taskNotesMatchDemandLetterFilingMarker } from "@/lib/justice/demandLetterFilingTask";
import { taskNotesMatchDotFilingMarker } from "@/lib/justice/dotFilingTask";
import { taskNotesMatchFccFilingMarker } from "@/lib/justice/fccFilingTask";
import { taskNotesMatchFtcFilingMarker } from "@/lib/justice/ftcFilingTask";
import { taskNotesMatchFollowUpResponseReviewMarker } from "@/lib/justice/followUpResponseReviewTask";
import { taskNotesMatchMerchantContactFilingMarker } from "@/lib/justice/merchantContactFilingTask";
import { taskNotesMatchPaymentDisputeFilingMarker } from "@/lib/justice/paymentDisputeFilingTask";
import { taskNotesMatchStateAgFilingMarker } from "@/lib/justice/stateAgFilingTask";

export type OperatorFulfillmentTaskAccessRow = {
  case_id?: string | null;
  notes?: string | null;
  completed_at?: string | null;
};

/** True when task notes match any open operator fulfillment lane for this case. */
export function taskNotesMatchAnyOperatorFulfillmentMarker(
  notes: string | null | undefined,
  caseId: string
): boolean {
  const trimmedCaseId = caseId.trim();
  if (!trimmedCaseId) return false;
  return (
    taskNotesMatchFollowUpResponseReviewMarker(notes, trimmedCaseId) ||
    taskNotesMatchMerchantContactFilingMarker(notes, trimmedCaseId) ||
    taskNotesMatchStateAgFilingMarker(notes, trimmedCaseId) ||
    taskNotesMatchDemandLetterFilingMarker(notes, trimmedCaseId) ||
    taskNotesMatchCfpbFilingMarker(notes, trimmedCaseId) ||
    taskNotesMatchPaymentDisputeFilingMarker(notes, trimmedCaseId) ||
    taskNotesMatchFccFilingMarker(notes, trimmedCaseId) ||
    taskNotesMatchDotFilingMarker(notes, trimmedCaseId) ||
    taskNotesMatchBbbFilingMarker(notes, trimmedCaseId) ||
    taskNotesMatchFtcFilingMarker(notes, trimmedCaseId)
  );
}

/**
 * Pure authorization gate: evidence may be opened only when the case has an
 * incomplete operator fulfillment task whose notes match a known lane marker.
 */
export function openTasksGrantOperatorEvidenceAccess(
  caseId: string,
  tasks: readonly OperatorFulfillmentTaskAccessRow[]
): boolean {
  const trimmedCaseId = caseId.trim();
  if (!trimmedCaseId) return false;
  return tasks.some((task) => {
    if (task.completed_at) return false;
    const taskCaseId = (task.case_id ?? "").trim();
    if (taskCaseId !== trimmedCaseId) return false;
    return taskNotesMatchAnyOperatorFulfillmentMarker(task.notes, trimmedCaseId);
  });
}

/** Load open tasks for a case and decide whether an operator may open its evidence files. */
export async function caseHasOpenOperatorFulfillmentTask(
  supabase: SupabaseClient,
  caseId: string
): Promise<boolean> {
  const trimmedCaseId = caseId.trim();
  if (!trimmedCaseId) return false;

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .select("case_id, notes, completed_at")
    .eq("case_id", trimmedCaseId)
    .is("completed_at", null)
    .limit(100);

  if (error) {
    console.warn("operator evidence access: list open tasks", error.message);
    return false;
  }

  return openTasksGrantOperatorEvidenceAccess(trimmedCaseId, data ?? []);
}
