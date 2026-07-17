import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import {
  patchJusticeCaseFromChat,
  type PatchJusticeCaseFromChatFetch,
} from "@/lib/justice/patchJusticeCaseFromChat";
import { OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR } from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import type { JusticeApprovedNextAction, JusticeCaseClientState } from "@/lib/justice/types";

export type PersistPreparedPacketApprovalResult =
  | {
      ok: true;
      clientState: unknown;
      timeline: unknown;
      attempts: number;
    }
  | {
      ok: false;
      error: string;
      retryableOwnedFilingEnsure: boolean;
      attempts: number;
    };

/**
 * Persist prepared-packet approval to the case without optimistic local commit.
 * Callers must apply client_state / session only when ok: true.
 */
export async function persistPreparedPacketApprovalToCase(params: {
  caseId: string;
  nextAction: JusticeApprovedNextAction;
  fetchFn?: PatchJusticeCaseFromChatFetch;
  maxAttempts?: number;
  retryDelayMs?: number;
  logLabel?: string;
}): Promise<PersistPreparedPacketApprovalResult> {
  const caseId = params.caseId.trim();
  const fetchFn = params.fetchFn ?? fetch;
  const logLabel = params.logLabel ?? "justice chat-ai";

  if (!caseId) {
    return {
      ok: false,
      error: "Missing case id",
      retryableOwnedFilingEnsure: false,
      attempts: 0,
    };
  }

  let getRes: Response;
  try {
    getRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(caseId)}`);
  } catch (e) {
    console.warn(`${logLabel}: GET before prepared packet approve error`, e);
    return {
      ok: false,
      error: "Could not load case before approval",
      retryableOwnedFilingEnsure: false,
      attempts: 0,
    };
  }

  if (!getRes.ok) {
    console.warn(`${logLabel}: GET before prepared packet approve failed`, getRes.status);
    return {
      ok: false,
      error: "Could not load case before approval",
      retryableOwnedFilingEnsure: false,
      attempts: 0,
    };
  }

  let existing: { client_state?: unknown };
  try {
    existing = (await getRes.json()) as { client_state?: unknown };
  } catch (e) {
    console.warn(`${logLabel}: GET before prepared packet approve JSON error`, e);
    return {
      ok: false,
      error: "Could not load case before approval",
      retryableOwnedFilingEnsure: false,
      attempts: 0,
    };
  }

  const merged: JusticeCaseClientState = {
    ...parseJusticeCaseClientState(existing.client_state),
    prepared_packet_approved: true,
    approved_next_action: params.nextAction,
  };

  const patchResult = await patchJusticeCaseFromChat({
    caseId,
    patch: { client_state: merged },
    fetchFn,
    maxAttempts: params.maxAttempts,
    retryDelayMs: params.retryDelayMs,
    logLabel,
  });

  if (!patchResult.ok) {
    return {
      ok: false,
      error: patchResult.retryableOwnedFilingEnsure
        ? OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR
        : patchResult.error,
      retryableOwnedFilingEnsure: patchResult.retryableOwnedFilingEnsure,
      attempts: patchResult.attempts,
    };
  }

  return {
    ok: true,
    clientState: patchResult.data.client_state ?? merged,
    timeline: patchResult.data.timeline,
    attempts: patchResult.attempts,
  };
}
