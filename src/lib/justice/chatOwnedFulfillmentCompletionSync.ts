import type { ChatEscalationFulfillmentObservation } from "@/lib/justice/chatEscalationFulfillmentSync";
import { observeChatEscalationFulfillmentPending } from "@/lib/justice/chatEscalationFulfillmentSync";
import {
  findOpenBbbFilingTask,
  hasBbbFilingWithConfirmation,
} from "@/lib/justice/bbbFilingTask";
import {
  findOpenCfpbFilingTask,
  hasCfpbFilingWithConfirmation,
} from "@/lib/justice/cfpbFilingTask";
import {
  findOpenDemandLetterFilingTask,
  hasDemandLetterFilingWithConfirmation,
} from "@/lib/justice/demandLetterFilingTask";
import {
  findOpenDotFilingTask,
  hasDotFilingWithConfirmation,
} from "@/lib/justice/dotFilingTask";
import {
  findOpenFccFilingTask,
  hasFccFilingWithConfirmation,
} from "@/lib/justice/fccFilingTask";
import {
  findOpenFtcFilingTask,
  hasFtcFilingWithConfirmation,
} from "@/lib/justice/ftcFilingTask";
import {
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import {
  findOpenMerchantContactFilingTask,
  hasMerchantContactFilingWithConfirmation,
} from "@/lib/justice/merchantContactFilingTask";
import {
  findOpenPaymentDisputeFilingTask,
  hasPaymentDisputeFilingWithConfirmation,
} from "@/lib/justice/paymentDisputeFilingTask";
import {
  findOpenStateAgFilingTask,
  hasStateAgFilingWithConfirmation,
} from "@/lib/justice/stateAgFilingTask";

/** Surrenderless-owned fulfillment steps chat can observe completing in place. */
export type ChatOwnedFulfillmentStepId =
  | "merchant_contact"
  | "state_ag"
  | "demand_letter"
  | "cfpb"
  | "payment_dispute"
  | "fcc"
  | "dot"
  | "ftc"
  | "bbb";

export type ChatOwnedFulfillmentObservationSnapshot = {
  completedStepIds: readonly ChatOwnedFulfillmentStepId[];
  approvedActionHref: string | undefined;
};

export type ChatOwnedFulfillmentCompletionSyncResult = {
  isPending: boolean;
  terminalTransitioned: boolean;
  shouldInitiateResolution: boolean;
  currentSnapshot: ChatOwnedFulfillmentObservationSnapshot;
  ownedStepsNewlyCompleted: readonly ChatOwnedFulfillmentStepId[];
  approvedActionAdvanced: boolean;
  shouldRehydrateCase: boolean;
};

function normalizeApprovedActionHref(
  action: ChatEscalationFulfillmentObservation["approvedAction"]
): string | undefined {
  const href = action?.href?.trim();
  return href || undefined;
}

function isMerchantContactOwnedStepCompleted(
  observation: ChatEscalationFulfillmentObservation
): boolean {
  const caseId = observation.caseId.trim();
  if (!caseId) return false;
  if (!hasMerchantContactFilingWithConfirmation(observation.filings)) return false;
  return !findOpenMerchantContactFilingTask(observation.tasks, caseId);
}

function isStateAgOwnedStepCompleted(observation: ChatEscalationFulfillmentObservation): boolean {
  const caseId = observation.caseId.trim();
  if (!caseId) return false;
  if (!hasStateAgFilingWithConfirmation(observation.filings)) return false;
  return !findOpenStateAgFilingTask(observation.tasks, caseId);
}

function isDemandLetterOwnedStepCompleted(
  observation: ChatEscalationFulfillmentObservation
): boolean {
  const caseId = observation.caseId.trim();
  if (!caseId) return false;
  if (!hasDemandLetterFilingWithConfirmation(observation.filings)) return false;
  return !findOpenDemandLetterFilingTask(observation.tasks, caseId);
}

function isCfpbOwnedStepCompleted(observation: ChatEscalationFulfillmentObservation): boolean {
  const caseId = observation.caseId.trim();
  if (!caseId) return false;
  if (!hasCfpbFilingWithConfirmation(observation.filings)) return false;
  return !findOpenCfpbFilingTask(observation.tasks, caseId);
}

function isPaymentDisputeOwnedStepCompleted(
  observation: ChatEscalationFulfillmentObservation
): boolean {
  const caseId = observation.caseId.trim();
  if (!caseId) return false;
  if (!hasPaymentDisputeFilingWithConfirmation(observation.filings)) return false;
  return !findOpenPaymentDisputeFilingTask(observation.tasks, caseId);
}

function isFccOwnedStepCompleted(observation: ChatEscalationFulfillmentObservation): boolean {
  const caseId = observation.caseId.trim();
  if (!caseId) return false;
  if (!hasFccFilingWithConfirmation(observation.filings)) return false;
  return !findOpenFccFilingTask(observation.tasks, caseId);
}

function isDotOwnedStepCompleted(observation: ChatEscalationFulfillmentObservation): boolean {
  const caseId = observation.caseId.trim();
  if (!caseId) return false;
  if (!hasDotFilingWithConfirmation(observation.filings)) return false;
  return !findOpenDotFilingTask(observation.tasks, caseId);
}

function isBbbOwnedStepCompleted(observation: ChatEscalationFulfillmentObservation): boolean {
  const caseId = observation.caseId.trim();
  if (!caseId) return false;
  if (!hasBbbFilingWithConfirmation(observation.filings)) return false;
  return !findOpenBbbFilingTask(observation.tasks, caseId);
}

function isFtcOwnedStepCompleted(observation: ChatEscalationFulfillmentObservation): boolean {
  const caseId = observation.caseId.trim();
  if (!caseId) return false;
  if (!hasFtcFilingWithConfirmation(observation.filings)) return false;
  return !findOpenFtcFilingTask(observation.tasks, caseId);
}

function buildOwnedFulfillmentObservationSnapshot(
  observation: ChatEscalationFulfillmentObservation
): ChatOwnedFulfillmentObservationSnapshot {
  const completedStepIds: ChatOwnedFulfillmentStepId[] = [];
  if (isMerchantContactOwnedStepCompleted(observation)) {
    completedStepIds.push("merchant_contact");
  }
  if (isStateAgOwnedStepCompleted(observation)) {
    completedStepIds.push("state_ag");
  }
  if (isDemandLetterOwnedStepCompleted(observation)) {
    completedStepIds.push("demand_letter");
  }
  if (isCfpbOwnedStepCompleted(observation)) {
    completedStepIds.push("cfpb");
  }
  if (isPaymentDisputeOwnedStepCompleted(observation)) {
    completedStepIds.push("payment_dispute");
  }
  if (isFccOwnedStepCompleted(observation)) {
    completedStepIds.push("fcc");
  }
  if (isDotOwnedStepCompleted(observation)) {
    completedStepIds.push("dot");
  }
  if (isFtcOwnedStepCompleted(observation)) {
    completedStepIds.push("ftc");
  }
  if (isBbbOwnedStepCompleted(observation)) {
    completedStepIds.push("bbb");
  }
  return {
    completedStepIds,
    approvedActionHref: normalizeApprovedActionHref(observation.approvedAction),
  };
}

function detectNewlyCompletedOwnedSteps(
  previous: ChatOwnedFulfillmentObservationSnapshot | null | undefined,
  current: ChatOwnedFulfillmentObservationSnapshot
): ChatOwnedFulfillmentStepId[] {
  if (!previous) return [];
  const previouslyCompleted = new Set(previous.completedStepIds);
  return current.completedStepIds.filter((stepId) => !previouslyCompleted.has(stepId));
}

function detectApprovedActionAdvanced(
  previous: ChatOwnedFulfillmentObservationSnapshot | null | undefined,
  current: ChatOwnedFulfillmentObservationSnapshot
): boolean {
  if (!previous) return false;
  const previousHref = previous.approvedActionHref;
  const currentHref = current.approvedActionHref;
  if (!previousHref || !currentHref || previousHref === currentHref) return false;
  return true;
}

/** True when chat should re-fetch case + tasks/filings after owned-step completion or terminal transition. */
export function shouldRehydrateCaseAfterOwnedFulfillmentSync(
  result: Pick<ChatOwnedFulfillmentCompletionSyncResult, "shouldRehydrateCase">
): boolean {
  return result.shouldRehydrateCase;
}

/**
 * Generic owned-fulfillment completion observer for chat polling.
 * State AG is the first registered step; additional owned destinations can extend snapshot detection.
 */
export function observeChatOwnedFulfillmentCompletionSync(input: {
  observation: ChatEscalationFulfillmentObservation;
  previousSnapshot: ChatOwnedFulfillmentObservationSnapshot | null | undefined;
  wasPending: boolean;
}): ChatOwnedFulfillmentCompletionSyncResult {
  const escalation = observeChatEscalationFulfillmentPending({
    observation: input.observation,
    wasPending: input.wasPending,
  });
  const currentSnapshot = buildOwnedFulfillmentObservationSnapshot(input.observation);
  const ownedStepsNewlyCompleted = detectNewlyCompletedOwnedSteps(
    input.previousSnapshot,
    currentSnapshot
  );
  const approvedActionAdvanced = detectApprovedActionAdvanced(
    input.previousSnapshot,
    currentSnapshot
  );

  const shouldRehydrateCase =
    escalation.terminalTransitioned ||
    ownedStepsNewlyCompleted.length > 0 ||
    approvedActionAdvanced;

  return {
    ...escalation,
    currentSnapshot,
    ownedStepsNewlyCompleted,
    approvedActionAdvanced,
    shouldRehydrateCase,
  };
}

/** Approved action href for the merchant-contact owned step. */
export const CHAT_OWNED_FULFILLMENT_MERCHANT_CONTACT_APPROVED_HREF =
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF;

/** Approved action href for the State AG owned step (for tests and future registry entries). */
export const CHAT_OWNED_FULFILLMENT_STATE_AG_APPROVED_HREF =
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF;

/** Approved action href for the demand-letter owned step. */
export const CHAT_OWNED_FULFILLMENT_DEMAND_LETTER_APPROVED_HREF =
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF;

/** Approved action href for the CFPB owned step. */
export const CHAT_OWNED_FULFILLMENT_CFPB_APPROVED_HREF = MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF;

/** Approved action href for the payment-dispute owned step. */
export const CHAT_OWNED_FULFILLMENT_PAYMENT_DISPUTE_APPROVED_HREF =
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF;

/** Approved action href for the FCC owned step. */
export const CHAT_OWNED_FULFILLMENT_FCC_APPROVED_HREF = MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF;

/** Approved action href for the DOT owned step. */
export const CHAT_OWNED_FULFILLMENT_DOT_APPROVED_HREF = MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF;

/** Approved action href for the BBB owned step. */
export const CHAT_OWNED_FULFILLMENT_BBB_APPROVED_HREF = MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF;

/** Approved action href for the FTC owned step. */
export const CHAT_OWNED_FULFILLMENT_FTC_APPROVED_HREF = MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF;
