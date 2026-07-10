import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
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
};

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
  });
  const terminalTransitioned = shouldRefreshChatAfterEscalationTerminalTransition({
    wasPending: input.wasPending,
    isPending,
  });
  const shouldInitiateResolution =
    !isPending &&
    shouldInitiateResolutionAfterEscalationTerminal(input.observation.approvedAction);
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
  intakeFallback: JusticeIntake;
  logLabel?: string;
  fetchFn?: typeof fetch;
  onLocalAction?: (action: JusticeApprovedNextAction) => void;
}): Promise<EnsureChatResolutionAfterEscalationFulfillmentResult> {
  if (!shouldInitiateResolutionAfterEscalationTerminal(input.approvedAction)) {
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
