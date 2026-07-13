import { isDownstreamHumanFulfillmentEscalationAction } from "@/lib/justice/escalationLadderResolution";
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
  findOpenMerchantContactFilingTask,
  hasMerchantContactFilingWithConfirmation,
} from "@/lib/justice/merchantContactFilingTask";
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
  type ManualActionTrackingFiling,
} from "@/lib/justice/handlingTrackingProgress";
import {
  findOpenPaymentDisputeFilingTask,
  hasPaymentDisputeFilingWithConfirmation,
} from "@/lib/justice/paymentDisputeFilingTask";
import {
  findOpenStateAgFilingTask,
  hasStateAgFilingWithConfirmation,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

export type SurrenderlessOwnedStepCheckParams = {
  approvedAction: Pick<JusticeApprovedNextAction, "href" | "label" | "status">;
  caseId: string;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
};

function isActiveApprovedHumanFulfillmentEscalation(
  action: Pick<JusticeApprovedNextAction, "href" | "status">
): boolean {
  const status = action.status;
  return (
    (status === "approved" || status === "started") &&
    isDownstreamHumanFulfillmentEscalationAction(action)
  );
}

function isStateAgStepOwnedBySurrenderless(params: SurrenderlessOwnedStepCheckParams): boolean {
  if (params.approvedAction.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF) {
    return false;
  }
  const caseId = params.caseId.trim();
  if (!caseId) return false;
  if (findOpenStateAgFilingTask(params.tasks, caseId)) return true;
  if (hasStateAgFilingWithConfirmation(params.filings)) return true;
  if (isActiveApprovedHumanFulfillmentEscalation(params.approvedAction)) return true;
  return false;
}

function isDemandLetterStepOwnedBySurrenderless(
  params: SurrenderlessOwnedStepCheckParams
): boolean {
  if (params.approvedAction.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF) {
    return false;
  }
  const caseId = params.caseId.trim();
  if (!caseId) return false;
  if (findOpenDemandLetterFilingTask(params.tasks, caseId)) return true;
  if (hasDemandLetterFilingWithConfirmation(params.filings)) return true;
  if (isActiveApprovedHumanFulfillmentEscalation(params.approvedAction)) return true;
  return false;
}

function isCfpbStepOwnedBySurrenderless(params: SurrenderlessOwnedStepCheckParams): boolean {
  if (params.approvedAction.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF) {
    return false;
  }
  const caseId = params.caseId.trim();
  if (!caseId) return false;
  if (findOpenCfpbFilingTask(params.tasks, caseId)) return true;
  if (hasCfpbFilingWithConfirmation(params.filings)) return true;
  if (isActiveApprovedHumanFulfillmentEscalation(params.approvedAction)) return true;
  return false;
}

function isPaymentDisputeStepOwnedBySurrenderless(
  params: SurrenderlessOwnedStepCheckParams
): boolean {
  if (
    params.approvedAction.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF
  ) {
    return false;
  }
  const caseId = params.caseId.trim();
  if (!caseId) return false;
  if (findOpenPaymentDisputeFilingTask(params.tasks, caseId)) return true;
  if (hasPaymentDisputeFilingWithConfirmation(params.filings)) return true;
  if (isActiveApprovedHumanFulfillmentEscalation(params.approvedAction)) return true;
  return false;
}

function isFccStepOwnedBySurrenderless(params: SurrenderlessOwnedStepCheckParams): boolean {
  if (params.approvedAction.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF) {
    return false;
  }
  const caseId = params.caseId.trim();
  if (!caseId) return false;
  if (findOpenFccFilingTask(params.tasks, caseId)) return true;
  if (hasFccFilingWithConfirmation(params.filings)) return true;
  if (isActiveApprovedHumanFulfillmentEscalation(params.approvedAction)) return true;
  return false;
}

function isDotStepOwnedBySurrenderless(params: SurrenderlessOwnedStepCheckParams): boolean {
  if (params.approvedAction.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF) {
    return false;
  }
  const caseId = params.caseId.trim();
  if (!caseId) return false;
  if (findOpenDotFilingTask(params.tasks, caseId)) return true;
  if (hasDotFilingWithConfirmation(params.filings)) return true;
  if (isActiveApprovedHumanFulfillmentEscalation(params.approvedAction)) return true;
  return false;
}

function isBbbStepOwnedBySurrenderless(params: SurrenderlessOwnedStepCheckParams): boolean {
  if (params.approvedAction.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF) {
    return false;
  }
  const caseId = params.caseId.trim();
  if (!caseId) return false;
  if (findOpenBbbFilingTask(params.tasks, caseId)) return true;
  if (hasBbbFilingWithConfirmation(params.filings)) return true;
  if (isActiveApprovedHumanFulfillmentEscalation(params.approvedAction)) return true;
  return false;
}

function isFtcStepOwnedBySurrenderless(params: SurrenderlessOwnedStepCheckParams): boolean {
  if (params.approvedAction.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF) {
    return false;
  }
  const caseId = params.caseId.trim();
  if (!caseId) return false;
  if (findOpenFtcFilingTask(params.tasks, caseId)) return true;
  if (hasFtcFilingWithConfirmation(params.filings)) return true;
  if (isActiveApprovedHumanFulfillmentEscalation(params.approvedAction)) return true;
  return false;
}

function isMerchantContactStepOwnedBySurrenderless(
  params: SurrenderlessOwnedStepCheckParams
): boolean {
  if (params.approvedAction.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF) {
    return false;
  }
  const caseId = params.caseId.trim();
  if (!caseId) return false;
  if (findOpenMerchantContactFilingTask(params.tasks, caseId)) return true;
  if (hasMerchantContactFilingWithConfirmation(params.filings)) return true;
  if (isActiveApprovedHumanFulfillmentEscalation(params.approvedAction)) return true;
  return false;
}

/**
 * True when Surrenderless owns the active approved step (human-fulfillment queue or confirmed filing).
 * Suppresses conflicting copy/paste prep and manual filing capture in chat for that step.
 */
export function shouldSuppressChatManualActionForSurrenderlessOwnedStep(
  params: SurrenderlessOwnedStepCheckParams
): boolean {
  return (
    isMerchantContactStepOwnedBySurrenderless(params) ||
    isStateAgStepOwnedBySurrenderless(params) ||
    isDemandLetterStepOwnedBySurrenderless(params) ||
    isCfpbStepOwnedBySurrenderless(params) ||
    isPaymentDisputeStepOwnedBySurrenderless(params) ||
    isFccStepOwnedBySurrenderless(params) ||
    isDotStepOwnedBySurrenderless(params) ||
    isFtcStepOwnedBySurrenderless(params) ||
    isBbbStepOwnedBySurrenderless(params)
  );
}
