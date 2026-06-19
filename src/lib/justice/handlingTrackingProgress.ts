import {
  HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED,
  HANDLING_TRACKING_STEP_RECORD_OUTCOME,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

/** Approved step opened by user action or by a Surrenderless handling request. */
export function isApprovedActionOpenedForHandlingTracking(
  action: Pick<JusticeApprovedNextAction, "status" | "handling_requested_at">
): boolean {
  if (action.status === "started" || action.status === "completed") return true;
  return Boolean(action.handling_requested_at?.trim());
}

/**
 * After filing/confirmation is on file, returns the next required closure step
 * (outcome, then acknowledgement) or null when follow-up/complete logic may proceed.
 */
export function deriveHandlingClosureStepAfterFilingConfirmation(input: {
  status?: JusticeApprovedNextAction["status"];
  outcomeNote?: string;
  handlingRequestedAt?: string;
  handlingAcknowledgedAt?: string;
}): string | null {
  const outcomeNote = input.outcomeNote?.trim();
  const handlingRequested = Boolean(input.handlingRequestedAt?.trim());
  const handlingAcknowledged = Boolean(input.handlingAcknowledgedAt?.trim());
  const completed = input.status === "completed";

  if ((completed || handlingRequested) && !outcomeNote) {
    return HANDLING_TRACKING_STEP_RECORD_OUTCOME;
  }

  if (handlingRequested && outcomeNote && !handlingAcknowledged) {
    return HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED;
  }

  return null;
}

/** Whether chat-ai should show the outcome/follow-up capture form. */
export function chatOutcomeTrackingFormOpen(action: JusticeApprovedNextAction): boolean {
  if (!action.outcome_note?.trim()) return true;
  return action.follow_up_needed === true;
}

/** Whether chat-ai may persist outcome/follow-up fields for the current action. */
export function chatOutcomeTrackingSaveAllowed(
  action: Pick<JusticeApprovedNextAction, "status" | "handling_requested_at">
): boolean {
  if (action.status === "completed") return true;
  return Boolean(action.handling_requested_at?.trim());
}
