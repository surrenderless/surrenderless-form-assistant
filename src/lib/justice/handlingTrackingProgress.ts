import {
  HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED,
  HANDLING_TRACKING_STEP_RECORD_OUTCOME,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  BBB_PRACTICE_FILING_DESTINATION,
  FTC_PRACTICE_FILING_DESTINATION,
} from "@/lib/justice/submissionAttempt";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";
import { shouldExposeCaseResolutionFlow } from "@/lib/justice/escalationLadderResolution";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

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

/** Approved-action href for CFPB manual filing tracking. */
export const MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF = "/justice/cfpb";

/** Approved-action href for FCC manual filing tracking. */
export const MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF = "/justice/fcc";

/** Approved-action href for payment-dispute manual filing tracking. */
export const MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF = "/justice/payment-dispute";

/** Approved-action href for merchant-contact manual filing tracking. */
export const MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF = "/justice/merchant";

/** Approved-action href for Surrenderless-owned FTC consumer-complaint filing. */
export const MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF = "/justice/ftc";

/** Approved-action href for FTC practice / ftc-review (practice-only tracking lock). */
export const MANUAL_ACTION_TRACKING_REAL_FTC_REVIEW_PREP_HREF = "/justice/ftc-review";

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

/** Filing row destinations that count for CFPB manual-action tracking. */
export const MANUAL_ACTION_TRACKING_REAL_CFPB_FILING_DESTINATIONS = ["CFPB"] as const;

/** Filing row destinations that count for FCC manual-action tracking. */
export const MANUAL_ACTION_TRACKING_REAL_FCC_FILING_DESTINATIONS = ["FCC"] as const;

/** Filing row destinations that count for payment-dispute manual-action tracking. */
export const MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_FILING_DESTINATIONS = [
  "Payment dispute (bank/card)",
] as const;

/** Filing row destinations that count for merchant-contact manual-action tracking. */
export const MANUAL_ACTION_TRACKING_REAL_MERCHANT_FILING_DESTINATIONS = [
  "Merchant contact",
  "Company contact",
  "Merchant contact & proof",
  "Company contact & proof",
  "Contact merchant",
] as const;

/** Filing row destinations that count for FTC consumer-complaint manual-action tracking. */
export const MANUAL_ACTION_TRACKING_REAL_FTC_REVIEW_FILING_DESTINATIONS = [
  "FTC (consumer complaint)",
] as const;

/** Alias: owned FTC uses the same destination label as practice tracking. */
export const MANUAL_ACTION_TRACKING_REAL_FTC_FILING_DESTINATIONS =
  MANUAL_ACTION_TRACKING_REAL_FTC_REVIEW_FILING_DESTINATIONS;

const MANUAL_ACTION_TRACKING_FILING_DESTINATIONS_BY_HREF: Readonly<
  Record<string, readonly string[]>
> = {
  [MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF]: MANUAL_ACTION_TRACKING_REAL_BBB_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF]:
    MANUAL_ACTION_TRACKING_REAL_STATE_AG_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF]: MANUAL_ACTION_TRACKING_REAL_DOT_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF]:
    MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF]: MANUAL_ACTION_TRACKING_REAL_CFPB_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF]: MANUAL_ACTION_TRACKING_REAL_FCC_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF]:
    MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF]:
    MANUAL_ACTION_TRACKING_REAL_MERCHANT_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF]: MANUAL_ACTION_TRACKING_REAL_FTC_FILING_DESTINATIONS,
  [MANUAL_ACTION_TRACKING_REAL_FTC_REVIEW_PREP_HREF]:
    MANUAL_ACTION_TRACKING_REAL_FTC_REVIEW_FILING_DESTINATIONS,
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

/** Skip duplicate chat filing capture when assisted real BBB already recorded this step. */
export function shouldSuppressChatInlineFilingCaptureForAssistedRealBbb(params: {
  approvedAction: Pick<JusticeApprovedNextAction, "href" | "label">;
  filings: readonly ManualActionTrackingFiling[];
}): boolean {
  if (params.approvedAction.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF) {
    return false;
  }
  const { hasFilingRecord, hasConfirmationOnFile } =
    deriveManualActionTrackingFilingsStateForApprovedAction(
      params.filings,
      params.approvedAction
    );
  return hasFilingRecord && hasConfirmationOnFile;
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

/** Whether chat-ai may show outcome/follow-up after escalation ladder is terminal. */
export function chatResolutionTrackingFormOpen(input: {
  action: JusticeApprovedNextAction;
  caseId: string;
  tasks: readonly JusticeCaseTaskRow[];
  filings?: readonly ManualActionTrackingFiling[];
}): boolean {
  if (
    !shouldExposeCaseResolutionFlow({
      approvedAction: input.action,
      caseId: input.caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    return false;
  }
  return chatOutcomeTrackingFormOpen(input.action);
}

/**
 * Whether the handling workbench should show the outcome/follow-up capture form.
 * Visible when filing gates are satisfied and the derived next step requires outcome recording.
 */
export function handlingWorkbenchOutcomeTrackingFormVisible(input: {
  manualActionNextStep: string | null;
  filingsReady: boolean;
  action: JusticeApprovedNextAction;
  caseId: string;
  tasks?: readonly JusticeCaseTaskRow[];
}): boolean {
  if (!input.filingsReady) return false;
  if (input.manualActionNextStep !== HANDLING_TRACKING_STEP_RECORD_OUTCOME) {
    return false;
  }
  return chatResolutionTrackingFormOpen({
    action: input.action,
    caseId: input.caseId,
    tasks: input.tasks ?? [],
  });
}

/** Whether the handling workbench may show handling-request acknowledgment controls. */
export function handlingWorkbenchClosureAcknowledgmentVisible(input: {
  manualActionNextStep: string | null;
  handlingAcknowledgedAt?: string;
  action: JusticeApprovedNextAction;
  caseId: string;
  tasks?: readonly JusticeCaseTaskRow[];
}): boolean {
  if (
    !shouldExposeCaseResolutionFlow({
      approvedAction: input.action,
      caseId: input.caseId,
      tasks: input.tasks ?? [],
    })
  ) {
    return false;
  }
  return handlingClosureAcknowledgmentVisible({
    manualActionNextStep: input.manualActionNextStep,
    handlingAcknowledgedAt: input.handlingAcknowledgedAt,
  });
}

/** Whether follow-up clear controls may be shown after escalation is terminal. */
export function handlingWorkbenchFollowUpActionsVisible(input: {
  action: JusticeApprovedNextAction;
  caseId: string;
  tasks?: readonly JusticeCaseTaskRow[];
}): boolean {
  if (input.action.follow_up_needed !== true) return false;
  return shouldExposeCaseResolutionFlow({
    approvedAction: input.action,
    caseId: input.caseId,
    tasks: input.tasks ?? [],
  });
}

/**
 * Whether a surface should show the handling-request acknowledgment control.
 * Visible only when the derived next step requires acknowledgement and none is on file.
 */
export function handlingClosureAcknowledgmentVisible(input: {
  manualActionNextStep: string | null;
  handlingAcknowledgedAt?: string;
}): boolean {
  if (input.handlingAcknowledgedAt?.trim()) return false;
  return input.manualActionNextStep === HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED;
}

/** Whether chat-ai may persist outcome/follow-up fields for the current action. */
export function chatOutcomeTrackingSaveAllowed(
  action: Pick<JusticeApprovedNextAction, "status" | "handling_requested_at">
): boolean {
  if (action.status === "completed") return true;
  return Boolean(action.handling_requested_at?.trim());
}
