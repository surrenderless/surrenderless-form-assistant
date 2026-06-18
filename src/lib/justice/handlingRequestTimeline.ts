import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import { APPROVED_NEXT_ACTION_HANDLING_REQUESTED_LABEL } from "@/lib/justice/approvedNextActionHandlingDisplay";
import type { JusticeApprovedNextAction, TimelineEntryType } from "@/lib/justice/types";

export function handlingRequestTimelineEntryId(caseId: string): string {
  return `handling_request:${caseId}`;
}

function pickHandlingRequestedAt(clientState: unknown): string {
  return parseApprovedNextActionFromClientState(clientState)?.handling_requested_at?.trim() ?? "";
}

/** True when handling_requested_at goes from empty/missing to a non-empty value. */
export function isFirstHandlingRequestTransition(
  existingClientState: unknown,
  incomingClientState: unknown
): boolean {
  const before = pickHandlingRequestedAt(existingClientState);
  const after = pickHandlingRequestedAt(incomingClientState);
  return !before && Boolean(after);
}

export function buildHandlingRequestTimelineDetail(
  approvedNext: JusticeApprovedNextAction
): string | undefined {
  const label = approvedNext.label?.trim();
  const note = approvedNext.handling_request_note?.trim();
  if (label && note) return `${label} — ${note}`;
  if (label) return label;
  if (note) return note;
  return undefined;
}

export function buildHandlingRequestTimelineEntry(
  caseId: string,
  approvedNext: JusticeApprovedNextAction
): {
  id: string;
  type: TimelineEntryType;
  label: string;
  detail?: string;
  ts?: string;
} {
  const detail = buildHandlingRequestTimelineDetail(approvedNext);
  const requestedAt = approvedNext.handling_requested_at?.trim();
  return {
    id: handlingRequestTimelineEntryId(caseId),
    type: "handling_requested",
    label: APPROVED_NEXT_ACTION_HANDLING_REQUESTED_LABEL,
    ...(requestedAt ? { ts: requestedAt } : {}),
    ...(detail ? { detail } : {}),
  };
}
