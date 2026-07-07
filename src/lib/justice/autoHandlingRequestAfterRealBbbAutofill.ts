import {
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import { isDownstreamHumanFulfillmentEscalationAction } from "@/lib/justice/escalationLadderResolution";
import { applyServerTimelineFromResponse } from "@/lib/justice/timeline";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

const HANDLING_REQUEST_NOTE_MAX_LENGTH = 500;

/** Concise case-derived default note after successful real BBB autofill. */
export function buildDefaultHandlingRequestNoteAfterRealBbbAutofill(
  intake: JusticeIntake
): string {
  const company = intake.company_name.trim() || "the merchant";
  const issueLabel = intake.problem_category.replace(/_/g, " ");
  const purchase = intake.purchase_or_signup.trim();
  const purchasePart = purchase ? ` (${purchase})` : "";
  return `BBB complaint filed for ${company}${purchasePart}. Issue: ${issueLabel}. Please monitor BBB response and guide next steps.`.slice(
    0,
    HANDLING_REQUEST_NOTE_MAX_LENGTH
  );
}

export function shouldAutoRequestHandlingAfterRealBbbAutofill(
  action: JusticeApprovedNextAction | null | undefined
): action is JusticeApprovedNextAction {
  if (!action) return false;
  if (action.handling_requested_at?.trim()) return false;
  return true;
}

export function buildHandlingRequestAfterRealBbbAutofill(
  action: JusticeApprovedNextAction,
  intake: JusticeIntake,
  requestedAt: string = new Date().toISOString()
): { withTracking: JusticeApprovedNextAction; local: JusticeApprovedNextAction } {
  const next: JusticeApprovedNextAction = {
    ...action,
    handling_requested_at: requestedAt,
    handling_request_note: buildDefaultHandlingRequestNoteAfterRealBbbAutofill(intake),
  };
  const withTracking = mergeApprovedNextActionTrackingFields(action, next);
  const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
  return { withTracking, local };
}

export type AutoRequestHandlingAfterRealBbbAutofillParams = {
  caseId: string;
  intake: JusticeIntake;
  actionAfterAdvance: JusticeApprovedNextAction;
  logLabel?: string;
  fetchFn?: typeof fetch;
  applyTimeline?: typeof applyServerTimelineFromResponse;
};

/** Idempotent: skips when handling was already requested on the action. */
export async function autoRequestHandlingAfterSuccessfulRealBbbAutofill(
  params: AutoRequestHandlingAfterRealBbbAutofillParams
): Promise<JusticeApprovedNextAction> {
  const { actionAfterAdvance, intake, caseId } = params;
  if (isDownstreamHumanFulfillmentEscalationAction(actionAfterAdvance)) {
    return actionAfterAdvance;
  }
  if (!shouldAutoRequestHandlingAfterRealBbbAutofill(actionAfterAdvance)) {
    return actionAfterAdvance;
  }

  const logLabel = params.logLabel ?? "justice bbb-complaint";
  const fetchFn = params.fetchFn ?? fetch;
  const applyTimeline = params.applyTimeline ?? applyServerTimelineFromResponse;
  const { withTracking, local } = buildHandlingRequestAfterRealBbbAutofill(actionAfterAdvance, intake);

  try {
    const getRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(caseId)}`);
    if (!getRes.ok) {
      console.warn(`${logLabel}: GET before auto handling request failed`, getRes.status);
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
      console.warn(`${logLabel}: PATCH auto handling request failed`, patchRes.status);
      return local;
    }
    const payload = (await patchRes.json()) as unknown;
    applyTimeline(caseId, payload);
  } catch (e) {
    console.warn(`${logLabel}: auto handling request error`, e);
  }

  return local;
}
