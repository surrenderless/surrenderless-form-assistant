import { hasPendingHumanFulfillmentEscalation } from "@/lib/justice/escalationLadderResolution";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

/** Poll interval while human-fulfillment escalation is pending in chat. */
export const CHAT_PENDING_HUMAN_FULFILLMENT_POLL_MS = 2_000;

export function isChatPendingHumanFulfillmentEscalation(input: {
  approvedAction: JusticeApprovedNextAction | undefined;
  caseId: string;
  tasks: readonly JusticeCaseTaskRow[];
}): boolean {
  return hasPendingHumanFulfillmentEscalation(input);
}

/**
 * True when chat should run a follow-up refresh after escalation is no longer pending
 * (e.g. operator completed demand letter and resolution should appear).
 */
export function shouldRefreshChatAfterEscalationTerminalTransition(input: {
  wasPending: boolean;
  isPending: boolean;
}): boolean {
  return input.wasPending && !input.isPending;
}
