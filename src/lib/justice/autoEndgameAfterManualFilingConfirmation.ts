import {
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import {
  buildDefaultFollowUpAtAfterRealBbbAutofill,
  hasConfirmationOnFileForRealBbbAutofill,
  shouldAutoAcknowledgeHandlingAfterRealBbbAutofill,
  shouldSetDefaultFollowUpAfterRealBbbAutofill,
  shouldSetDefaultOutcomeNoteAfterRealBbbAutofill,
} from "@/lib/justice/autoOutcomeTrackingAfterRealBbbAutofill";
import {
  isDownstreamHumanFulfillmentEscalationAction,
  stripResolutionTrackingFromApprovedAction,
} from "@/lib/justice/escalationLadderResolution";
import {
  canonicalFilingDestinationForApprovedActionHref,
  deriveManualActionTrackingFilingsStateForApprovedAction,
  type ManualActionTrackingFiling,
} from "@/lib/justice/handlingTrackingProgress";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import { applyServerTimelineFromResponse } from "@/lib/justice/timeline";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { validate as isUuid } from "uuid";

const NOTE_MAX_LENGTH = 500;

function filingLaneShortLabel(action: Pick<JusticeApprovedNextAction, "href" | "label">): string {
  const canonical = canonicalFilingDestinationForApprovedActionHref(action.href);
  if (canonical) return canonical;
  const label = action.label?.trim();
  if (label) return label;
  return "this step";
}

/** Case-derived handling-request note after manual filing confirmation. */
export function buildDefaultHandlingRequestNoteAfterManualFilingConfirmation(
  intake: JusticeIntake,
  action: Pick<JusticeApprovedNextAction, "href" | "label">
): string {
  const company = intake.company_name.trim() || "the merchant";
  const purchase = intake.purchase_or_signup.trim();
  const purchasePart = purchase ? ` (${purchase})` : "";
  const lane = filingLaneShortLabel(action);
  return `${lane} recorded for ${company}${purchasePart}. Monitor responses and guide next steps.`.slice(
    0,
    NOTE_MAX_LENGTH
  );
}

/** Case-derived outcome note after manual filing confirmation. */
export function buildDefaultOutcomeNoteAfterManualFilingConfirmation(
  intake: JusticeIntake,
  action: Pick<JusticeApprovedNextAction, "href" | "label">
): string {
  const company = intake.company_name.trim() || "the merchant";
  const purchase = intake.purchase_or_signup.trim();
  const purchasePart = purchase ? ` (${purchase})` : "";
  const lane = filingLaneShortLabel(action);
  return `${lane} filing recorded for ${company}${purchasePart}. Confirmation on file. Awaiting response.`.slice(
    0,
    NOTE_MAX_LENGTH
  );
}

export function shouldRunManualFilingConfirmationEndgame(params: {
  approvedAction: JusticeApprovedNextAction | null | undefined;
  caseId: string;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
  confirmationNumber?: string | null;
}): boolean {
  const action = params.approvedAction;
  if (!action) return false;
  if (!hasConfirmationOnFileForRealBbbAutofill(params.confirmationNumber)) {
    const { hasConfirmationOnFile } = deriveManualActionTrackingFilingsStateForApprovedAction(
      params.filings,
      action
    );
    if (!hasConfirmationOnFile) return false;
  }
  if (
    shouldSuppressChatManualActionForSurrenderlessOwnedStep({
      approvedAction: action,
      caseId: params.caseId,
      tasks: params.tasks,
      filings: params.filings,
    })
  ) {
    return false;
  }
  return true;
}

function buildCompletedApprovedNextAction(action: JusticeApprovedNextAction): {
  withTracking: JusticeApprovedNextAction;
  local: JusticeApprovedNextAction;
} {
  const completed: JusticeApprovedNextAction = {
    ...action,
    status: "completed",
    completed_at: action.completed_at?.trim() || new Date().toISOString(),
  };
  const withTracking = mergeApprovedNextActionTrackingFields(action, completed);
  const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
  return { withTracking, local };
}

function buildHandlingAndOutcomeAfterManualConfirmation(
  action: JusticeApprovedNextAction,
  intake: JusticeIntake,
  options: { filedAt?: string; acknowledgedAt?: string } = {}
): { withTracking: JusticeApprovedNextAction; local: JusticeApprovedNextAction } {
  let next: JusticeApprovedNextAction = { ...action };

  if (!next.handling_requested_at?.trim()) {
    next.handling_requested_at = new Date().toISOString();
    next.handling_request_note = buildDefaultHandlingRequestNoteAfterManualFilingConfirmation(
      intake,
      action
    );
  }

  if (shouldSetDefaultOutcomeNoteAfterRealBbbAutofill(next)) {
    next.outcome_note = buildDefaultOutcomeNoteAfterManualFilingConfirmation(intake, action);
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

async function persistApprovedNextActionClientState(params: {
  caseId: string;
  withTracking: JusticeApprovedNextAction;
  logLabel: string;
  fetchFn: typeof fetch;
  applyTimeline: typeof applyServerTimelineFromResponse;
}): Promise<boolean> {
  const { caseId, withTracking, logLabel, fetchFn, applyTimeline } = params;
  try {
    const getRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(caseId)}`);
    if (!getRes.ok) {
      console.warn(`${logLabel}: GET before manual filing endgame failed`, getRes.status);
      return false;
    }
    const existing = (await getRes.json()) as { client_state?: unknown };
    const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
    const patchRes = await fetchFn(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_state: merged }),
    });
    if (!patchRes.ok) {
      console.warn(`${logLabel}: PATCH manual filing endgame failed`, patchRes.status);
      return false;
    }
    applyTimeline(caseId, (await patchRes.json()) as unknown);
    return true;
  } catch (e) {
    console.warn(`${logLabel}: manual filing endgame error`, e);
    return false;
  }
}

export type AutoEndgameAfterManualFilingConfirmationParams = {
  caseId: string;
  intake: JusticeIntake;
  approvedAction: JusticeApprovedNextAction;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
  confirmationNumber?: string | null;
  filedAt?: string;
  manualFtc?: boolean;
  logLabel?: string;
  fetchFn?: typeof fetch;
  applyTimeline?: typeof applyServerTimelineFromResponse;
};

/**
 * After chat manual filing confirmation: complete the step, advance when a later
 * approved action exists, otherwise seed handling + outcome + follow-up (terminal endgame).
 * Skips Surrenderless-owned State AG / demand-letter steps.
 */
export async function autoEndgameAfterManualFilingConfirmation(
  params: AutoEndgameAfterManualFilingConfirmationParams
): Promise<JusticeApprovedNextAction> {
  const {
    caseId,
    intake,
    approvedAction,
    tasks,
    filings,
    confirmationNumber,
    filedAt,
    manualFtc = false,
  } = params;

  if (!caseId.trim() || !isUuid(caseId)) return approvedAction;
  if (
    !shouldRunManualFilingConfirmationEndgame({
      approvedAction,
      caseId,
      tasks,
      filings,
      confirmationNumber,
    })
  ) {
    return approvedAction;
  }

  const logLabel = params.logLabel ?? "justice chat-ai manual-filing";
  const fetchFn = params.fetchFn ?? fetch;
  const applyTimeline = params.applyTimeline ?? applyServerTimelineFromResponse;

  const completedHref = approvedAction.href?.trim() ?? "";
  const { withTracking: completedWithTracking, local: completedLocal } =
    approvedAction.status === "completed"
      ? {
          withTracking: mergeApprovedNextActionTrackingFields(approvedAction, approvedAction),
          local: omitClearedHandlingRequestNoteFromApprovedNextAction(approvedAction),
        }
      : buildCompletedApprovedNextAction(approvedAction);

  const advanced = advanceApprovedNextActionAfterCompleted(intake, completedHref, {
    existing: completedWithTracking,
    manualFtc,
  });

  if (
    advanced?.href?.trim() &&
    advanced.href.trim() !== completedHref &&
    advanced.status === "approved"
  ) {
    const cleanedForPersist = isDownstreamHumanFulfillmentEscalationAction(advanced)
      ? stripResolutionTrackingFromApprovedAction(advanced)
      : advanced;
    const resultLocal = omitClearedHandlingRequestNoteFromApprovedNextAction(cleanedForPersist);
    await persistApprovedNextActionClientState({
      caseId,
      withTracking: cleanedForPersist,
      logLabel,
      fetchFn,
      applyTimeline,
    });
    return resultLocal;
  }

  if (isDownstreamHumanFulfillmentEscalationAction(completedWithTracking)) {
    await persistApprovedNextActionClientState({
      caseId,
      withTracking: completedWithTracking,
      logLabel,
      fetchFn,
      applyTimeline,
    });
    return completedLocal;
  }

  const { withTracking, local } = buildHandlingAndOutcomeAfterManualConfirmation(
    completedWithTracking,
    intake,
    { filedAt }
  );
  await persistApprovedNextActionClientState({
    caseId,
    withTracking,
    logLabel,
    fetchFn,
    applyTimeline,
  });
  return local;
}
