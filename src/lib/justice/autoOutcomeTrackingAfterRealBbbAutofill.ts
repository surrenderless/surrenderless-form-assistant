import {
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import { isDownstreamHumanFulfillmentEscalationAction } from "@/lib/justice/escalationLadderResolution";
import { applyServerTimelineFromResponse } from "@/lib/justice/timeline";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

const OUTCOME_NOTE_MAX_LENGTH = 500;
const DEFAULT_FOLLOW_UP_DAYS = 45;

export function hasConfirmationOnFileForRealBbbAutofill(
  confirmationNumber: string | null | undefined
): boolean {
  return Boolean(confirmationNumber?.trim());
}

/** Concise case-derived default outcome note after successful real BBB autofill. */
export function buildDefaultOutcomeNoteAfterRealBbbAutofill(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "the merchant";
  const purchase = intake.purchase_or_signup.trim();
  const purchasePart = purchase ? ` (${purchase})` : "";
  return `BBB filing recorded for ${company}${purchasePart}. Confirmation on file. Awaiting BBB/merchant response.`.slice(
    0,
    OUTCOME_NOTE_MAX_LENGTH
  );
}

export function buildDefaultFollowUpAtAfterRealBbbAutofill(
  filedAt: string = new Date().toISOString()
): string {
  const date = new Date(filedAt);
  date.setUTCDate(date.getUTCDate() + DEFAULT_FOLLOW_UP_DAYS);
  return new Date(`${date.toISOString().slice(0, 10)}T12:00:00.000Z`).toISOString();
}

export function shouldSetDefaultOutcomeNoteAfterRealBbbAutofill(
  action: JusticeApprovedNextAction
): boolean {
  return !action.outcome_note?.trim();
}

export function shouldSetDefaultFollowUpAfterRealBbbAutofill(
  action: JusticeApprovedNextAction
): boolean {
  if (action.follow_up_needed === true) return false;
  return true;
}

export function shouldAutoAcknowledgeHandlingAfterRealBbbAutofill(
  action: JusticeApprovedNextAction,
  hasConfirmationOnFile: boolean
): boolean {
  if (!hasConfirmationOnFile) return false;
  if (!action.handling_requested_at?.trim()) return false;
  if (action.handling_acknowledged_at?.trim()) return false;
  return true;
}

export function shouldAutoInitiateOutcomeTrackingAfterRealBbbAutofill(
  action: JusticeApprovedNextAction,
  hasConfirmationOnFile: boolean
): boolean {
  if (!hasConfirmationOnFile) return false;
  return (
    shouldSetDefaultOutcomeNoteAfterRealBbbAutofill(action) ||
    shouldSetDefaultFollowUpAfterRealBbbAutofill(action) ||
    shouldAutoAcknowledgeHandlingAfterRealBbbAutofill(action, hasConfirmationOnFile)
  );
}

export function buildOutcomeTrackingAfterRealBbbAutofill(
  action: JusticeApprovedNextAction,
  intake: JusticeIntake,
  options: {
    hasConfirmationOnFile: boolean;
    filedAt?: string;
    acknowledgedAt?: string;
  }
): { withTracking: JusticeApprovedNextAction; local: JusticeApprovedNextAction } {
  let next: JusticeApprovedNextAction = { ...action };

  if (options.hasConfirmationOnFile) {
    if (shouldSetDefaultOutcomeNoteAfterRealBbbAutofill(action)) {
      next.outcome_note = buildDefaultOutcomeNoteAfterRealBbbAutofill(intake);
    }
    if (shouldSetDefaultFollowUpAfterRealBbbAutofill(action)) {
      next.follow_up_needed = true;
      if (!next.follow_up_at?.trim()) {
        next.follow_up_at = buildDefaultFollowUpAtAfterRealBbbAutofill(options.filedAt);
      }
    }
    if (shouldAutoAcknowledgeHandlingAfterRealBbbAutofill(action, options.hasConfirmationOnFile)) {
      next.handling_acknowledged_at = options.acknowledgedAt ?? new Date().toISOString();
    }
  }

  const withTracking = mergeApprovedNextActionTrackingFields(action, next);
  const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
  return { withTracking, local };
}

export type AutoInitiateOutcomeTrackingAfterRealBbbAutofillParams = {
  caseId: string;
  intake: JusticeIntake;
  actionAfterHandling: JusticeApprovedNextAction;
  confirmationNumber?: string | null;
  filedAt?: string;
  logLabel?: string;
  fetchFn?: typeof fetch;
  applyTimeline?: typeof applyServerTimelineFromResponse;
};

/** Idempotent: preserves existing outcome, follow-up, and acknowledgement fields. */
export async function autoInitiateOutcomeTrackingAfterSuccessfulRealBbbAutofill(
  params: AutoInitiateOutcomeTrackingAfterRealBbbAutofillParams
): Promise<JusticeApprovedNextAction> {
  const { actionAfterHandling, intake, caseId } = params;
  if (isDownstreamHumanFulfillmentEscalationAction(actionAfterHandling)) {
    return actionAfterHandling;
  }
  const hasConfirmationOnFile = hasConfirmationOnFileForRealBbbAutofill(params.confirmationNumber);
  if (!shouldAutoInitiateOutcomeTrackingAfterRealBbbAutofill(actionAfterHandling, hasConfirmationOnFile)) {
    return actionAfterHandling;
  }

  const logLabel = params.logLabel ?? "justice bbb-complaint";
  const fetchFn = params.fetchFn ?? fetch;
  const applyTimeline = params.applyTimeline ?? applyServerTimelineFromResponse;
  const { withTracking, local } = buildOutcomeTrackingAfterRealBbbAutofill(actionAfterHandling, intake, {
    hasConfirmationOnFile,
    filedAt: params.filedAt,
  });

  try {
    const getRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(caseId)}`);
    if (!getRes.ok) {
      console.warn(`${logLabel}: GET before auto outcome tracking failed`, getRes.status);
      return local;
    }
    const existing = (await getRes.json()) as { client_state?: unknown };
    const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
    const patchRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_state: merged }),
    });
    if (!patchRes.ok) {
      console.warn(`${logLabel}: PATCH auto outcome tracking failed`, patchRes.status);
      return local;
    }
    const payload = (await patchRes.json()) as unknown;
    applyTimeline(caseId, payload);
  } catch (e) {
    console.warn(`${logLabel}: auto outcome tracking error`, e);
  }

  return local;
}
