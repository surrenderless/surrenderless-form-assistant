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

/** Approved-action href for real BBB manual filing tracking. */
export const MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF = "/justice/bbb";

/** Approved-action href for real State AG manual filing tracking. */
export const MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF = "/justice/state-ag";

/** Approved-action href for real DOT manual filing tracking. */
export const MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF = "/justice/dot";

/** Approved-action href for real demand-letter manual filing tracking. */
export const MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF = "/justice/demand-letter";

/** Filing row destinations that count for real BBB manual-action tracking. */
export const MANUAL_ACTION_TRACKING_REAL_BBB_FILING_DESTINATIONS = [
  "Better Business Bureau",
] as const;

/** Filing row destinations that count for real State AG manual-action tracking. */
export const MANUAL_ACTION_TRACKING_REAL_STATE_AG_FILING_DESTINATIONS = [
  "State Attorney General (consumer)",
  "State Attorney General",
] as const;

/** Filing row destinations that count for real DOT manual-action tracking. */
export const MANUAL_ACTION_TRACKING_REAL_DOT_FILING_DESTINATIONS = [
  "USDOT / aviation consumer",
] as const;

/** Filing row destinations that count for real demand-letter manual-action tracking. */
export const MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_FILING_DESTINATIONS = [
  "Small claims / demand letter",
] as const;

const MANUAL_ACTION_TRACKING_FILING_DESTINATIONS_BY_HREF: Readonly<
  Record<string, readonly string[]>
> = {
  [MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF]: MANUAL_ACTION_TRACKING_REAL_BBB_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF]:
    MANUAL_ACTION_TRACKING_REAL_STATE_AG_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF]: MANUAL_ACTION_TRACKING_REAL_DOT_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF]:
    MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_FILING_DESTINATIONS,
};

function normalizedFilingDestination(destination: string | null | undefined): string {
  return destination?.trim() ?? "";
}

function filingDestinationMatchesAllowedSet(
  destination: string | null | undefined,
  allowedDestinations: readonly string[]
): boolean {
  const normalized = normalizedFilingDestination(destination);
  if (!normalized) return false;
  return allowedDestinations.some((allowed) => allowed === normalized);
}

function allowedFilingDestinationsForApprovedAction(
  approvedAction: Pick<JusticeApprovedNextAction, "href" | "label">
): readonly string[] | undefined {
  const href = approvedAction.href?.trim();
  if (href && href in MANUAL_ACTION_TRACKING_FILING_DESTINATIONS_BY_HREF) {
    return MANUAL_ACTION_TRACKING_FILING_DESTINATIONS_BY_HREF[href];
  }
  return undefined;
}

/**
 * Canonical filing destination for inline filing capture on a mapped manual-action step.
 * Unknown hrefs return undefined so callers retain editable destination behavior.
 */
export function canonicalFilingDestinationForApprovedActionHref(
  href: string | null | undefined
): string | undefined {
  const trimmed = href?.trim();
  if (!trimmed || !(trimmed in MANUAL_ACTION_TRACKING_FILING_DESTINATIONS_BY_HREF)) {
    return undefined;
  }
  return MANUAL_ACTION_TRACKING_FILING_DESTINATIONS_BY_HREF[trimmed][0];
}

/** Practice-filtered filings scoped to the active approved manual-action step. */
export function filingsForApprovedActionManualTracking<T extends ManualActionTrackingFiling>(
  filings: readonly T[],
  approvedAction: Pick<JusticeApprovedNextAction, "href" | "label">
): T[] {
  const trackingFilings = filingsForManualActionTracking(filings);
  const allowedDestinations = allowedFilingDestinationsForApprovedAction(approvedAction);
  if (allowedDestinations === undefined) {
    return trackingFilings;
  }
  return trackingFilings.filter((f) =>
    filingDestinationMatchesAllowedSet(f.destination, allowedDestinations)
  );
}

/** Manual-action tracking gates scoped to the active approved action. */
export function deriveManualActionTrackingFilingsStateForApprovedAction(
  filings: readonly ManualActionTrackingFiling[],
  approvedAction: Pick<JusticeApprovedNextAction, "href" | "label">
): { hasFilingRecord: boolean; hasConfirmationOnFile: boolean } {
  const stepFilings = filingsForApprovedActionManualTracking(filings, approvedAction);
  return {
    hasFilingRecord: stepFilings.length > 0,
    hasConfirmationOnFile: stepFilings.some((f) => Boolean(f.confirmation_number?.trim())),
  };
}

/** First current-action filing row missing confirmation, if any. */
export function findApprovedActionFilingMissingConfirmation<
  T extends ManualActionTrackingFiling & { confirmation_number?: string | null },
>(filings: readonly T[], approvedAction: Pick<JusticeApprovedNextAction, "href" | "label">): T | undefined {
  return filingsForApprovedActionManualTracking(filings, approvedAction).find(
    (row) => !row.confirmation_number?.trim()
  );
}

/**
 * Whether a handling-workbench row still needs filing or confirmation for the active approved action.
 * Uses the same step-scoped gate rules as chat-ai.
 */
export function isHandlingWorkbenchPostExternalConfirmationFollowUp(
  approvedAction: Pick<JusticeApprovedNextAction, "status" | "href" | "label">,
  savedFilings: readonly ManualActionTrackingFiling[] | undefined,
  filingsReady: boolean
): boolean {
  if (!filingsReady) return false;
  if (approvedAction.status !== "started" && approvedAction.status !== "completed") {
    return false;
  }
  const { hasFilingRecord, hasConfirmationOnFile } =
    deriveManualActionTrackingFilingsStateForApprovedAction(savedFilings ?? [], approvedAction);
  return !hasFilingRecord || !hasConfirmationOnFile;
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

/**
 * Whether the handling workbench should show the outcome/follow-up capture form.
 * Visible when filing gates are satisfied and the derived next step requires outcome recording.
 */
export function handlingWorkbenchOutcomeTrackingFormVisible(input: {
  manualActionNextStep: string | null;
  filingsReady: boolean;
  action: JusticeApprovedNextAction;
}): boolean {
  if (!input.filingsReady) return false;
  if (input.manualActionNextStep !== HANDLING_TRACKING_STEP_RECORD_OUTCOME) {
    return false;
  }
  return chatOutcomeTrackingFormOpen(input.action);
}

/** Whether chat-ai may persist outcome/follow-up fields for the current action. */
export function chatOutcomeTrackingSaveAllowed(
  action: Pick<JusticeApprovedNextAction, "status" | "handling_requested_at">
): boolean {
  if (action.status === "completed") return true;
  return Boolean(action.handling_requested_at?.trim());
}
