import {
  HANDLING_TRACKING_STEP_ADD_CONFIRMATION,
  HANDLING_TRACKING_STEP_ADD_CONFIRMATION_CHAT_INLINE,
  HANDLING_TRACKING_STEP_ADD_FILING,
  HANDLING_TRACKING_STEP_ADD_FILING_CHAT_INLINE,
  HANDLING_TRACKING_STEP_COMPLETE,
  HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED,
  HANDLING_TRACKING_STEP_RECORD_OUTCOME,
  HANDLING_TRACKING_STEP_REVIEW_FOLLOW_UP,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  BBB_PRACTICE_FILING_DESTINATION,
  FTC_PRACTICE_FILING_DESTINATION,
} from "@/lib/justice/submissionAttempt";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";
import {
  ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP,
  hasPendingHumanFulfillmentEscalation,
  shouldExposeCaseResolutionFlow,
} from "@/lib/justice/escalationLadderResolution";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
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

/**
 * Consumer-owned terminal href for "the merchant/company already fixed it" — distinct from
 * both a real escalation destination href and the generic "nothing routable" fallback href
 * used for every other reason a case has no next destination (e.g. a genuinely exhausted
 * ladder). Deliberately absent from MANUAL_ACTION_TRACKING_FILING_DESTINATIONS_BY_HREF below:
 * no filing destination is ever expected or created for it.
 */
export const MERCHANT_RESOLVED_TERMINAL_HREF = "/justice/merchant-resolved";
export const MERCHANT_RESOLVED_TERMINAL_LABEL = "Merchant issue resolved";

/**
 * True for the one recognized consumer-owned terminal state — shared by every surface
 * (chat-ai, Hub, Saved Cases) that derives a handling-tracking step, so none of them can drift
 * on what counts as "the merchant already resolved it, nothing further to track."
 */
export function isMerchantResolvedTerminalAction(
  action: Pick<JusticeApprovedNextAction, "href" | "status">
): boolean {
  return action.href === MERCHANT_RESOLVED_TERMINAL_HREF && action.status === "completed";
}

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

/**
 * True when a filing destination is valid to record against the case's current approved
 * action: an assisted mock-practice destination (exempt — doesn't participate in real
 * ladder-state tracking), or one of the real destinations mapped to the approved action's
 * href. Fails closed (false) for unmapped hrefs or a missing approved action, since an
 * unrecognized or absent destination-to-step relationship must not be trusted to persist a
 * filing record against the wrong escalation step.
 */
export function isFilingDestinationValidForApprovedAction(
  destination: string | null | undefined,
  approvedAction: Pick<JusticeApprovedNextAction, "href" | "label"> | undefined
): boolean {
  if (isAssistedMockPracticeFilingDestination(destination)) return true;
  if (!approvedAction) return false;
  const allowedDestinations = allowedFilingDestinationsForApprovedAction(approvedAction);
  if (allowedDestinations === undefined) return false;
  return filingDestinationMatchesAllowedSet(destination, allowedDestinations);
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

/**
 * Whether chat-ai may show outcome/follow-up after escalation ladder is terminal.
 * Fail-closed: consumer chat never uses DIY outcome capture as a progress path.
 * `suppressOwnedManualUi` is ignored.
 */
export function chatResolutionTrackingFormOpen(_input: {
  action: JusticeApprovedNextAction;
  caseId: string;
  tasks: readonly JusticeCaseTaskRow[];
  filings?: readonly ManualActionTrackingFiling[];
  /** @deprecated Ignored — chat DIY outcome form is always closed. */
  suppressOwnedManualUi?: boolean;
}): boolean {
  return false;
}

/**
 * Whether the handling workbench should show the outcome/follow-up capture form.
 * Visible when filing gates are satisfied and the derived next step requires outcome recording.
 * Independent of chat fail-closed (operator handling workbench is out of chat DIY retirement).
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
  if (
    !shouldExposeCaseResolutionFlow({
      approvedAction: input.action,
      caseId: input.caseId,
      tasks: input.tasks ?? [],
    })
  ) {
    return false;
  }
  return chatOutcomeTrackingFormOpen(input.action);
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

export function chatReadyForManualReview(input: {
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
}): boolean {
  return input.basicsReady && input.draftReviewed && input.preparedPacketApproved;
}

/**
 * Derives the chat-ai handling-tracking step line from already-resolved manual-action-readiness
 * flags. Pure and directly testable — extracted here (rather than kept local to the chat-ai
 * page component) specifically so callers/tests can verify the real production decision for a
 * given approved-action shape without re-deriving or hardcoding the expected step string.
 */
export function deriveChatManualActionNextStep(input: {
  readyForExternalManualAction: boolean;
  actionOpened: boolean;
  hasFilingRecord: boolean;
  hasConfirmationOnFile: boolean;
  href?: string;
  status: JusticeApprovedNextAction["status"];
  outcomeNote?: string;
  handlingRequestedAt?: string;
  handlingAcknowledgedAt?: string;
  followUpNeeded?: boolean;
  canCaptureFilingInline?: boolean;
  /** Signed-in chat-ai may show in-chat filing copy before UUID hydration completes. */
  canCaptureFilingInChat?: boolean;
  pendingHumanFulfillmentEscalation?: boolean;
  resolutionFlowExposed?: boolean;
}): string {
  if (input.pendingHumanFulfillmentEscalation) {
    return ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP;
  }
  // Consumer-owned terminal (merchant/company already resolved it): no external manual action
  // was ever required, so the ordinary "review packet/evidence, open the step, add a
  // filing+confirmation" manual-action checks below don't apply — this href has no filing kind
  // and never will. Scoped strictly to this one href so it can never affect the generic
  // "nothing routable" fallback or a genuinely exhausted escalation ladder, which must keep
  // their existing behavior unchanged.
  if (isMerchantResolvedTerminalAction({ href: input.href, status: input.status })) {
    return HANDLING_TRACKING_STEP_COMPLETE;
  }
  const handlingRequested = Boolean(input.handlingRequestedAt?.trim());
  if (handlingRequested) {
    const closureStep = deriveHandlingClosureStepAfterFilingConfirmation({
      status: input.status,
      outcomeNote: input.outcomeNote,
      handlingRequestedAt: input.handlingRequestedAt,
      handlingAcknowledgedAt: input.handlingAcknowledgedAt,
    });
    if (closureStep === HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED) {
      return closureStep;
    }
    if (closureStep === HANDLING_TRACKING_STEP_RECORD_OUTCOME) {
      return closureStep;
    }
    if (input.handlingAcknowledgedAt?.trim()) {
      if (input.followUpNeeded === true && input.resolutionFlowExposed !== false) {
        return HANDLING_TRACKING_STEP_REVIEW_FOLLOW_UP;
      }
      if (input.resolutionFlowExposed === false) {
        return ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP;
      }
      return HANDLING_TRACKING_STEP_COMPLETE;
    }
  }

  if (!input.readyForExternalManualAction) {
    return "Review packet and saved proof before external manual action.";
  }
  if (!input.actionOpened) {
    return "Open the approved step and prepare the manual action.";
  }
  const useChatInlineFilingCopy =
    input.canCaptureFilingInChat ?? input.canCaptureFilingInline;
  if (!input.hasFilingRecord) {
    return useChatInlineFilingCopy
      ? HANDLING_TRACKING_STEP_ADD_FILING_CHAT_INLINE
      : HANDLING_TRACKING_STEP_ADD_FILING;
  }
  if (!input.hasConfirmationOnFile) {
    return useChatInlineFilingCopy
      ? HANDLING_TRACKING_STEP_ADD_CONFIRMATION_CHAT_INLINE
      : HANDLING_TRACKING_STEP_ADD_CONFIRMATION;
  }
  const closureStep = deriveHandlingClosureStepAfterFilingConfirmation({
    status: input.status,
    outcomeNote: input.outcomeNote,
    handlingRequestedAt: input.handlingRequestedAt,
    handlingAcknowledgedAt: input.handlingAcknowledgedAt,
  });
  if (closureStep) return closureStep;
  if (input.followUpNeeded === true && input.resolutionFlowExposed !== false) {
    return "Review follow-up timing and mark follow-up handled when complete.";
  }
  // Mid-ladder manual steps (filing+confirmation done, not yet terminal) stay on
  // "tracking complete" so consumers can mark the step handled — do not reuse the
  // owned-operator awaiting copy (pendingHumanFulfillmentEscalation is checked above).
  return HANDLING_TRACKING_STEP_COMPLETE;
}

export function deriveChatHandlingTrackingLine(input: {
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
  evidenceCount: number;
  filings: JusticeCaseFilingRow[];
  next: JusticeApprovedNextAction;
  canCaptureFilingInline?: boolean;
  canCaptureFilingInChat?: boolean;
  caseId?: string;
  tasks?: JusticeCaseTaskRow[];
}): string {
  const readyForManualReview = chatReadyForManualReview({
    basicsReady: input.basicsReady,
    draftReviewed: input.draftReviewed,
    preparedPacketApproved: input.preparedPacketApproved,
  });
  const readyForExternalManualAction =
    readyForManualReview && input.evidenceCount > 0;
  const actionOpened = isApprovedActionOpenedForHandlingTracking(input.next);
  const { hasFilingRecord, hasConfirmationOnFile } =
    deriveManualActionTrackingFilingsStateForApprovedAction(input.filings, input.next);
  const caseId = input.caseId?.trim() ?? "";
  const tasks = input.tasks ?? [];
  const pendingHumanFulfillmentEscalation = hasPendingHumanFulfillmentEscalation({
    approvedAction: input.next,
    caseId,
    tasks,
  });
  const resolutionFlowExposed = shouldExposeCaseResolutionFlow({
    approvedAction: input.next,
    caseId,
    tasks,
    filings: input.filings,
  });
  return deriveChatManualActionNextStep({
    readyForExternalManualAction,
    actionOpened,
    hasFilingRecord,
    hasConfirmationOnFile,
    href: input.next.href,
    status: input.next.status,
    outcomeNote: input.next.outcome_note,
    handlingRequestedAt: input.next.handling_requested_at,
    handlingAcknowledgedAt: input.next.handling_acknowledged_at,
    followUpNeeded: input.next.follow_up_needed === true,
    canCaptureFilingInline: input.canCaptureFilingInline,
    canCaptureFilingInChat: input.canCaptureFilingInChat,
    pendingHumanFulfillmentEscalation,
    resolutionFlowExposed,
  });
}
