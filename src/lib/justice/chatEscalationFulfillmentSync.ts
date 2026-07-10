import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  isEscalationLadderTerminalForResolution,
  isOperatorFulfillmentTerminalFromTasksAndFilings,
  resolveTerminalApprovedActionForResolution,
} from "@/lib/justice/escalationLadderResolution";
import type { ManualActionTrackingFiling } from "@/lib/justice/handlingTrackingProgress";
import {
  initiateResolutionAfterEscalationTerminal,
  shouldInitiateResolutionAfterEscalationTerminal,
} from "@/lib/justice/initiateResolutionAfterEscalationTerminal";
import {
  isChatPendingHumanFulfillmentEscalation,
  shouldRefreshChatAfterEscalationTerminalTransition,
} from "@/lib/justice/chatPendingHumanFulfillmentRefresh";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

export type ChatEscalationFulfillmentObservation = {
  caseId: string;
  approvedAction: JusticeApprovedNextAction | undefined;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
};

function shouldSeedResolutionTracking(
  action: JusticeApprovedNextAction | undefined
): action is JusticeApprovedNextAction {
  if (!action) return false;
  if (action.handling_requested_at?.trim() && action.outcome_note?.trim()) return false;
  return true;
}

/** Whether chat should seed resolution from approved action and/or operator tasks + filings. */
export function shouldInitiateResolutionFromFulfillmentObservation(
  observation: ChatEscalationFulfillmentObservation
): boolean {
  const action = observation.approvedAction;
  if (!shouldSeedResolutionTracking(action)) return false;
  if (isEscalationLadderTerminalForResolution(action)) return true;
  return isOperatorFulfillmentTerminalFromTasksAndFilings({
    caseId: observation.caseId,
    tasks: observation.tasks,
    filings: observation.filings,
  });
}

export function resolveActionForResolutionInitiation(input: {
  approvedAction: JusticeApprovedNextAction | undefined;
  caseId: string;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
}): JusticeApprovedNextAction | undefined {
  const action = input.approvedAction;
  if (!action) return undefined;
  if (isEscalationLadderTerminalForResolution(action)) return action;
  if (
    isOperatorFulfillmentTerminalFromTasksAndFilings({
      caseId: input.caseId,
      tasks: input.tasks,
      filings: input.filings,
    })
  ) {
    return resolveTerminalApprovedActionForResolution(action);
  }
  return undefined;
}

export function observeChatEscalationFulfillmentPending(input: {
  observation: ChatEscalationFulfillmentObservation;
  wasPending: boolean;
}): {
  isPending: boolean;
  terminalTransitioned: boolean;
  shouldInitiateResolution: boolean;
} {
  const isPending = isChatPendingHumanFulfillmentEscalation({
    approvedAction: input.observation.approvedAction,
    caseId: input.observation.caseId,
    tasks: input.observation.tasks,
    filings: input.observation.filings,
  });
  const terminalTransitioned = shouldRefreshChatAfterEscalationTerminalTransition({
    wasPending: input.wasPending,
    isPending,
  });
  const shouldInitiateResolution =
    !isPending && shouldInitiateResolutionFromFulfillmentObservation(input.observation);
  return { isPending, terminalTransitioned, shouldInitiateResolution };
}

/** True when chat should run resolution initiation (live-wait poll or cold load / return visit). */
export function shouldSyncChatEscalationResolution(input: {
  observation: ChatEscalationFulfillmentObservation;
  wasPending: boolean;
}): boolean {
  return observeChatEscalationFulfillmentPending(input).shouldInitiateResolution;
}

export type EnsureChatResolutionAfterEscalationFulfillmentResult = {
  action: JusticeApprovedNextAction | undefined;
  persisted: boolean;
};

/** Rehydrate only after resolution tracking was confirmed persisted on the server. */
export function shouldRehydrateCaseAfterResolutionSync(
  result: EnsureChatResolutionAfterEscalationFulfillmentResult
): boolean {
  return result.persisted;
}

export async function ensureChatResolutionAfterEscalationFulfillment(input: {
  caseId: string;
  approvedAction: JusticeApprovedNextAction | undefined;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
  intakeFallback: JusticeIntake;
  logLabel?: string;
  fetchFn?: typeof fetch;
  onLocalAction?: (action: JusticeApprovedNextAction) => void;
}): Promise<EnsureChatResolutionAfterEscalationFulfillmentResult> {
  const observation: ChatEscalationFulfillmentObservation = {
    caseId: input.caseId,
    approvedAction: input.approvedAction,
    tasks: input.tasks,
    filings: input.filings,
  };
  if (!shouldInitiateResolutionFromFulfillmentObservation(observation)) {
    return { action: input.approvedAction, persisted: false };
  }

  const resolvedAction = resolveActionForResolutionInitiation({
    approvedAction: input.approvedAction,
    caseId: input.caseId,
    tasks: input.tasks,
    filings: input.filings,
  });
  if (!resolvedAction || !shouldInitiateResolutionAfterEscalationTerminal(resolvedAction)) {
    return { action: input.approvedAction, persisted: false };
  }

  const fetchFn = input.fetchFn ?? fetch;
  const caseRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(input.caseId)}`);
  if (!caseRes.ok) {
    return { action: input.approvedAction, persisted: false };
  }

  const caseData = (await caseRes.json()) as { intake?: unknown; client_state?: unknown };
  const intake = isJusticeIntakePayload(caseData.intake)
    ? caseData.intake
    : input.intakeFallback;

  const initiation = await initiateResolutionAfterEscalationTerminal({
    caseId: input.caseId,
    intake,
    clientState: caseData.client_state,
    resolvedAction,
    logLabel: input.logLabel ?? "justice chat-ai escalation-terminal",
    fetchFn,
  });

  if (initiation.action) {
    input.onLocalAction?.(initiation.action);
  }

  return {
    action: initiation.action ?? input.approvedAction,
    persisted: initiation.persisted,
  };
}
