import { hasPendingHumanFulfillmentEscalation, shouldExposeCaseResolutionFlow } from "@/lib/justice/escalationLadderResolution";
import type { ManualActionTrackingFiling } from "@/lib/justice/handlingTrackingProgress";
import { hasOperatorTerminalResponseReviewOutcome } from "@/lib/justice/operatorOwnedCaseArchive";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

/** Poll interval while human-fulfillment escalation is pending in chat. */
export const CHAT_PENDING_HUMAN_FULFILLMENT_POLL_MS = 2_000;

export function isChatPendingHumanFulfillmentEscalation(input: {
  approvedAction: JusticeApprovedNextAction | undefined;
  caseId: string;
  tasks: readonly JusticeCaseTaskRow[];
  filings?: readonly ManualActionTrackingFiling[];
}): boolean {
  return hasPendingHumanFulfillmentEscalation(input);
}

/**
 * True while Surrenderless owns final closure after a terminal response-review outcome
 * and the server has not yet reported archived_at. Keeps chat polling so the closed-case
 * handoff surfaces live without a reload; stops as soon as archived_at is observed.
 */
export function isChatOperatorOwnedClosurePollPending(input: {
  approvedAction: JusticeApprovedNextAction | undefined;
  archivedAt: string | null | undefined;
}): boolean {
  if (input.archivedAt?.trim()) return false;
  return hasOperatorTerminalResponseReviewOutcome(input.approvedAction);
}

/**
 * True while owned post-filing endgame is waiting on Surrenderless follow-up / close.
 * Keeps chat polling so response-review and operator archive appear without a reload.
 */
export function isChatOwnedEndgameWaitPollPending(input: {
  approvedAction: JusticeApprovedNextAction | undefined;
  caseId: string;
  tasks: readonly JusticeCaseTaskRow[];
  filings?: readonly ManualActionTrackingFiling[];
  archivedAt?: string | null;
}): boolean {
  if (input.archivedAt?.trim()) return false;
  if (!input.approvedAction) return false;
  if (
    !shouldSuppressChatManualActionForSurrenderlessOwnedStep({
      approvedAction: input.approvedAction,
      caseId: input.caseId,
      tasks: input.tasks,
      filings: input.filings ?? [],
    })
  ) {
    return false;
  }
  return shouldExposeCaseResolutionFlow({
    approvedAction: input.approvedAction,
    caseId: input.caseId,
    tasks: input.tasks,
    filings: input.filings,
  });
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
