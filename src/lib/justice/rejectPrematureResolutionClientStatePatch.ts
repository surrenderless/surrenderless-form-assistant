import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import {
  canArchiveCaseForEscalationLadder,
  hasPendingHumanFulfillmentEscalation,
} from "@/lib/justice/escalationLadderResolution";
import { rejectManualOwnedStepClientStatePatch } from "@/lib/justice/rejectManualOwnedStepClientStatePatch";
import type { ManualActionTrackingFiling } from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

export const REJECT_PREMATURE_RESOLUTION_CLIENT_STATE_PATCH_MESSAGE =
  "Outcome, follow-up, and resolution tracking cannot be updated until Surrenderless completes the current escalation step.";

export const REJECT_PREMATURE_CASE_ARCHIVE_PATCH_MESSAGE =
  "This case cannot be archived until escalation is complete and follow-up is handled.";

type ResolutionTrackingField =
  | "outcome_note"
  | "follow_up_needed"
  | "follow_up_at"
  | "handling_acknowledged_at";

const RESOLUTION_TRACKING_FIELDS: readonly ResolutionTrackingField[] = [
  "outcome_note",
  "follow_up_needed",
  "follow_up_at",
  "handling_acknowledged_at",
];

function readApprovedActionRaw(clientState: unknown): Record<string, unknown> | null {
  if (!clientState || typeof clientState !== "object" || Array.isArray(clientState)) {
    return null;
  }
  const next = (clientState as Record<string, unknown>).approved_next_action;
  if (!next || typeof next !== "object" || Array.isArray(next)) {
    return null;
  }
  return next as Record<string, unknown>;
}

function normalizedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolutionFieldChangedOnRaw(
  field: ResolutionTrackingField,
  existingRaw: Record<string, unknown> | null,
  incomingRaw: Record<string, unknown>
): boolean {
  if (!Object.prototype.hasOwnProperty.call(incomingRaw, field)) {
    return false;
  }

  const existingValue = existingRaw?.[field];
  const incomingValue = incomingRaw[field];

  if (field === "follow_up_needed") {
    return (existingValue === true) !== (incomingValue === true);
  }

  if (field === "outcome_note" || field === "follow_up_at" || field === "handling_acknowledged_at") {
    return normalizedString(incomingValue) !== normalizedString(existingValue);
  }

  return incomingValue !== existingValue;
}

/** True when a client_state PATCH adds or changes outcome/follow-up/resolution fields. */
export function incomingAddsPrematureResolutionTracking(
  existingClientState: unknown,
  incomingClientState: unknown
): boolean {
  const existingRaw = readApprovedActionRaw(existingClientState);
  const incomingRaw = readApprovedActionRaw(incomingClientState);
  if (!incomingRaw) return false;

  return RESOLUTION_TRACKING_FIELDS.some((field) =>
    resolutionFieldChangedOnRaw(field, existingRaw, incomingRaw)
  );
}

export type RejectPrematureResolutionClientStatePatchParams = {
  caseId: string;
  existingClientState: unknown;
  incomingClientState: unknown;
  tasks: readonly JusticeCaseTaskRow[];
};

export function rejectPrematureResolutionClientStatePatch(
  params: RejectPrematureResolutionClientStatePatchParams
): string | null {
  const existingAction = parseApprovedNextActionFromClientState(params.existingClientState);
  if (
    !hasPendingHumanFulfillmentEscalation({
      approvedAction: existingAction,
      caseId: params.caseId,
      tasks: params.tasks,
    })
  ) {
    return null;
  }

  if (
    !incomingAddsPrematureResolutionTracking(params.existingClientState, params.incomingClientState)
  ) {
    return null;
  }

  return REJECT_PREMATURE_RESOLUTION_CLIENT_STATE_PATCH_MESSAGE;
}

export type RejectPrematureCaseArchivePatchParams = {
  caseId: string;
  existingClientState: unknown;
  existingArchivedAt: string | null | undefined;
  incomingArchivedAt: unknown;
  tasks: readonly JusticeCaseTaskRow[];
};

export function rejectPrematureCaseArchivePatch(
  params: RejectPrematureCaseArchivePatchParams
): string | null {
  if (params.incomingArchivedAt === null || params.incomingArchivedAt === undefined) {
    return null;
  }
  if (typeof params.incomingArchivedAt !== "string" || !params.incomingArchivedAt.trim()) {
    return null;
  }
  if (params.existingArchivedAt?.trim()) {
    return null;
  }

  const approvedAction = parseApprovedNextActionFromClientState(params.existingClientState);
  if (
    canArchiveCaseForEscalationLadder({
      approvedAction,
      caseId: params.caseId,
      tasks: params.tasks,
    })
  ) {
    return null;
  }

  return REJECT_PREMATURE_CASE_ARCHIVE_PATCH_MESSAGE;
}

export type RejectCasePatchEscalationViolationsParams = {
  caseId: string;
  existingClientState: unknown;
  existingArchivedAt: string | null | undefined;
  patch: Record<string, unknown>;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
};

/** Combined server-side rejects for escalation-ladder sequencing on case PATCH. */
export function rejectCasePatchEscalationViolations(
  params: RejectCasePatchEscalationViolationsParams
): string | null {
  if (Object.prototype.hasOwnProperty.call(params.patch, "client_state")) {
    const ownedStepReject = rejectManualOwnedStepClientStatePatch({
      caseId: params.caseId,
      existingClientState: params.existingClientState,
      incomingClientState: params.patch.client_state,
      tasks: params.tasks,
      filings: params.filings,
    });
    if (ownedStepReject) return ownedStepReject;

    const prematureResolutionReject = rejectPrematureResolutionClientStatePatch({
      caseId: params.caseId,
      existingClientState: params.existingClientState,
      incomingClientState: params.patch.client_state,
      tasks: params.tasks,
    });
    if (prematureResolutionReject) return prematureResolutionReject;
  }

  if (Object.prototype.hasOwnProperty.call(params.patch, "archived_at")) {
    const archiveReject = rejectPrematureCaseArchivePatch({
      caseId: params.caseId,
      existingClientState: params.existingClientState,
      existingArchivedAt: params.existingArchivedAt,
      incomingArchivedAt: params.patch.archived_at,
      tasks: params.tasks,
    });
    if (archiveReject) return archiveReject;
  }

  return null;
}
