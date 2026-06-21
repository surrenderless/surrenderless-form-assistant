import {
  HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED,
  HANDLING_TRACKING_STEP_RECORD_OUTCOME,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  BBB_PRACTICE_FILING_DESTINATION,
  FTC_PRACTICE_FILING_DESTINATION,
} from "@/lib/justice/submissionAttempt";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

export type ManualActionTrackingFiling = {
  destination: string;
  confirmation_number?: string | null;
};

const ASSISTED_MOCK_PRACTICE_FILING_DESTINATIONS: ReadonlySet<string> = new Set([
  FTC_PRACTICE_FILING_DESTINATION,
  BBB_PRACTICE_FILING_DESTINATION,
]);

/** True when a filing row was created by assisted FTC/BBB mock practice recording. */
export function isAssistedMockPracticeFilingDestination(
  destination: string | null | undefined
): boolean {
  const trimmed = destination?.trim();
  if (!trimmed) return false;
  return ASSISTED_MOCK_PRACTICE_FILING_DESTINATIONS.has(trimmed);
}

/** Filings that count toward external manual-action filing/confirmation tracking gates. */
export function filingsForManualActionTracking<T extends ManualActionTrackingFiling>(
  filings: readonly T[]
): T[] {
  return filings.filter((f) => !isAssistedMockPracticeFilingDestination(f.destination));
}

/** Manual-action tracking gates — excludes assisted mock-practice filing rows only. */
export function deriveManualActionTrackingFilingsState(
  filings: readonly ManualActionTrackingFiling[]
): { hasFilingRecord: boolean; hasConfirmationOnFile: boolean } {
  const trackingFilings = filingsForManualActionTracking(filings);
  return {
    hasFilingRecord: trackingFilings.length > 0,
    hasConfirmationOnFile: trackingFilings.some((f) => Boolean(f.confirmation_number?.trim())),
  };
}

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
