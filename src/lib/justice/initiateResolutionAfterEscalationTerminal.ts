import {
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  parseApprovedNextActionFromClientState,
} from "@/lib/justice/approvedNextActionState";
import {
  buildDefaultFollowUpAtAfterRealBbbAutofill,
  hasConfirmationOnFileForRealBbbAutofill,
  shouldAutoAcknowledgeHandlingAfterRealBbbAutofill,
  shouldSetDefaultFollowUpAfterRealBbbAutofill,
  shouldSetDefaultOutcomeNoteAfterRealBbbAutofill,
} from "@/lib/justice/autoOutcomeTrackingAfterRealBbbAutofill";
import { isEscalationLadderTerminalForResolution } from "@/lib/justice/escalationLadderResolution";
import { applyServerTimelineFromResponse } from "@/lib/justice/timeline";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

const HANDLING_REQUEST_NOTE_MAX_LENGTH = 500;
const OUTCOME_NOTE_MAX_LENGTH = 500;

/** Default handling-request note when escalation ladder reaches terminal resolution. */
export function buildDefaultHandlingRequestNoteAfterEscalationTerminal(
  intake: JusticeIntake
): string {
  const company = intake.company_name.trim() || "the merchant";
  const purchase = intake.purchase_or_signup.trim();
  const purchasePart = purchase ? ` (${purchase})` : "";
  return `Escalation steps complete for ${company}${purchasePart}. Monitor responses and guide follow-up.`.slice(
    0,
    HANDLING_REQUEST_NOTE_MAX_LENGTH
  );
}

/** Default outcome note when escalation ladder reaches terminal resolution. */
export function buildDefaultOutcomeNoteAfterEscalationTerminal(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "the merchant";
  const purchase = intake.purchase_or_signup.trim();
  const purchasePart = purchase ? ` (${purchase})` : "";
  return `Escalation complete for ${company}${purchasePart}. BBB, State AG, and demand letter steps recorded. Awaiting responses.`.slice(
    0,
    OUTCOME_NOTE_MAX_LENGTH
  );
}

export function shouldInitiateResolutionAfterEscalationTerminal(
  action: JusticeApprovedNextAction | null | undefined
): action is JusticeApprovedNextAction {
  if (!action) return false;
  if (!isEscalationLadderTerminalForResolution(action)) return false;
  if (action.handling_requested_at?.trim() && action.outcome_note?.trim()) return false;
  return true;
}

export function buildResolutionTrackingAfterEscalationTerminal(
  action: JusticeApprovedNextAction,
  intake: JusticeIntake,
  options: { filedAt?: string; acknowledgedAt?: string } = {}
): { withTracking: JusticeApprovedNextAction; local: JusticeApprovedNextAction } {
  const next: JusticeApprovedNextAction = { ...action };

  if (!next.handling_requested_at?.trim()) {
    next.handling_requested_at = new Date().toISOString();
    next.handling_request_note = buildDefaultHandlingRequestNoteAfterEscalationTerminal(intake);
  }

  if (shouldSetDefaultOutcomeNoteAfterRealBbbAutofill(next)) {
    next.outcome_note = buildDefaultOutcomeNoteAfterEscalationTerminal(intake);
  }
  if (shouldSetDefaultFollowUpAfterRealBbbAutofill(next)) {
    next.follow_up_needed = true;
    if (!next.follow_up_at?.trim()) {
      next.follow_up_at = buildDefaultFollowUpAtAfterRealBbbAutofill(options.filedAt);
    }
  }
  if (
    shouldAutoAcknowledgeHandlingAfterRealBbbAutofill(
      next,
      hasConfirmationOnFileForRealBbbAutofill("confirmed")
    )
  ) {
    next.handling_acknowledged_at = options.acknowledgedAt ?? new Date().toISOString();
  }

  const withTracking = mergeApprovedNextActionTrackingFields(action, next);
  const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
  return { withTracking, local };
}

export type InitiateResolutionAfterEscalationTerminalParams = {
  caseId: string;
  intake: JusticeIntake;
  clientState: unknown;
  logLabel?: string;
  fetchFn?: typeof fetch;
  applyTimeline?: typeof applyServerTimelineFromResponse;
};

export type InitiateResolutionAfterEscalationTerminalResult = {
  action: JusticeApprovedNextAction | undefined;
  persisted: boolean;
};

/** Idempotent: starts resolution/follow-up tracking when escalation ladder is terminal. */
export async function initiateResolutionAfterEscalationTerminal(
  params: InitiateResolutionAfterEscalationTerminalParams
): Promise<InitiateResolutionAfterEscalationTerminalResult> {
  const action = parseApprovedNextActionFromClientState(params.clientState);
  if (!shouldInitiateResolutionAfterEscalationTerminal(action)) {
    return { action, persisted: false };
  }

  const logLabel = params.logLabel ?? "justice escalation-terminal";
  const fetchFn = params.fetchFn ?? fetch;
  const applyTimeline = params.applyTimeline ?? applyServerTimelineFromResponse;
  const { withTracking, local } = buildResolutionTrackingAfterEscalationTerminal(
    action,
    params.intake
  );

  let persisted = false;
  try {
    const getRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(params.caseId)}`);
    if (!getRes.ok) {
      console.warn(`${logLabel}: GET before resolution initiation failed`, getRes.status);
      return { action: local, persisted: false };
    }
    const existing = (await getRes.json()) as { client_state?: unknown };
    const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
    const patchRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(params.caseId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_state: merged }),
    });
    if (!patchRes.ok) {
      console.warn(`${logLabel}: PATCH resolution initiation failed`, patchRes.status);
      return { action: local, persisted: false };
    }
    const payload = (await patchRes.json()) as unknown;
    applyTimeline(params.caseId, payload);
    persisted = true;
  } catch (e) {
    console.warn(`${logLabel}: resolution initiation error`, e);
  }

  return { action: local, persisted };
}

/** Server-side: merge resolution tracking into client_state without fetch. */
export function mergeResolutionTrackingIntoClientState(
  clientState: unknown,
  intake: JusticeIntake
): Record<string, unknown> | undefined {
  const action = parseApprovedNextActionFromClientState(clientState);
  if (!shouldInitiateResolutionAfterEscalationTerminal(action)) {
    return undefined;
  }
  const { withTracking } = buildResolutionTrackingAfterEscalationTerminal(action, intake);
  return mergeClientStateWithApprovedNextAction(clientState, withTracking) as Record<string, unknown>;
}
