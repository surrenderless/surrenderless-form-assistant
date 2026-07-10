import type { ChatEscalationFulfillmentObservation } from "@/lib/justice/chatEscalationFulfillmentSync";
import { observeChatEscalationFulfillmentPending } from "@/lib/justice/chatEscalationFulfillmentSync";
import {
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import {
  findOpenStateAgFilingTask,
  hasStateAgFilingWithConfirmation,
} from "@/lib/justice/stateAgFilingTask";

/** Surrenderless-owned fulfillment steps chat can observe completing in place. */
export type ChatOwnedFulfillmentStepId = "state_ag";

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

function isStateAgOwnedStepCompleted(observation: ChatEscalationFulfillmentObservation): boolean {
  const caseId = observation.caseId.trim();
  if (!caseId) return false;
  if (!hasStateAgFilingWithConfirmation(observation.filings)) return false;
  return !findOpenStateAgFilingTask(observation.tasks, caseId);
}

function buildOwnedFulfillmentObservationSnapshot(
  observation: ChatEscalationFulfillmentObservation
): ChatOwnedFulfillmentObservationSnapshot {
  const completedStepIds: ChatOwnedFulfillmentStepId[] = [];
  if (isStateAgOwnedStepCompleted(observation)) {
    completedStepIds.push("state_ag");
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

/** Approved action href for the State AG owned step (for tests and future registry entries). */
export const CHAT_OWNED_FULFILLMENT_STATE_AG_APPROVED_HREF =
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF;
