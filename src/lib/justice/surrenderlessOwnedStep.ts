import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
  type ManualActionTrackingFiling,
} from "@/lib/justice/handlingTrackingProgress";
import {
  findOpenDemandLetterFilingTask,
  hasDemandLetterFilingWithConfirmation,
} from "@/lib/justice/demandLetterFilingTask";
import {
  findOpenStateAgFilingTask,
  hasStateAgFilingWithConfirmation,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

export type SurrenderlessOwnedStepCheckParams = {
  approvedAction: Pick<JusticeApprovedNextAction, "href" | "label">;
  caseId: string;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
};

function isStateAgStepOwnedBySurrenderless(params: SurrenderlessOwnedStepCheckParams): boolean {
  if (params.approvedAction.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF) {
    return false;
  }
  const caseId = params.caseId.trim();
  if (!caseId) return false;
  if (findOpenStateAgFilingTask(params.tasks, caseId)) return true;
  if (hasStateAgFilingWithConfirmation(params.filings)) return true;
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
    isStateAgStepOwnedBySurrenderless(params) || isDemandLetterStepOwnedBySurrenderless(params)
  );
}
