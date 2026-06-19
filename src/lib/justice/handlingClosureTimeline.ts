import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import type { JusticeApprovedNextAction, TimelineEntryType } from "@/lib/justice/types";

const MAX_OUTCOME_DETAIL = 500;

export const HANDLING_OUTCOME_RECORDED_TIMELINE_LABEL = "Handling outcome recorded";

export const HANDLING_ACKNOWLEDGED_TIMELINE_LABEL = "Handling request acknowledged";

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function pickOutcomeNote(clientState: unknown): string {
  return parseApprovedNextActionFromClientState(clientState)?.outcome_note?.trim() ?? "";
}

function pickHandlingAcknowledgedAt(clientState: unknown): string {
  return (
    parseApprovedNextActionFromClientState(clientState)?.handling_acknowledged_at?.trim() ?? ""
  );
}

/** True when outcome_note goes from empty/missing to a non-empty value. */
export function isFirstOutcomeNoteTransition(
  existingClientState: unknown,
  incomingClientState: unknown
): boolean {
  const before = pickOutcomeNote(existingClientState);
  const after = pickOutcomeNote(incomingClientState);
  return !before && Boolean(after);
}

/** True when handling_acknowledged_at goes from empty/missing to a non-empty value. */
export function isFirstHandlingAcknowledgedTransition(
  existingClientState: unknown,
  incomingClientState: unknown
): boolean {
  const before = pickHandlingAcknowledgedAt(existingClientState);
  const after = pickHandlingAcknowledgedAt(incomingClientState);
  return !before && Boolean(after);
}

export function outcomeRecordedTimelineEntryId(caseId: string): string {
  return `outcome_recorded:${caseId}`;
}

export function handlingAcknowledgedTimelineEntryId(caseId: string): string {
  return `handling_acknowledged:${caseId}`;
}

export function buildOutcomeRecordedTimelineDetail(
  approvedNext: JusticeApprovedNextAction
): string | undefined {
  const note = approvedNext.outcome_note?.trim();
  if (!note) return undefined;
  return clampLen(note, MAX_OUTCOME_DETAIL);
}

export function buildOutcomeRecordedTimelineEntry(
  caseId: string,
  approvedNext: JusticeApprovedNextAction
): {
  id: string;
  type: TimelineEntryType;
  label: string;
  detail?: string;
} {
  const detail = buildOutcomeRecordedTimelineDetail(approvedNext);
  return {
    id: outcomeRecordedTimelineEntryId(caseId),
    type: "outcome_recorded",
    label: HANDLING_OUTCOME_RECORDED_TIMELINE_LABEL,
    ...(detail ? { detail } : {}),
  };
}

export function buildHandlingAcknowledgedTimelineEntry(
  caseId: string,
  approvedNext: JusticeApprovedNextAction
): {
  id: string;
  type: TimelineEntryType;
  label: string;
  ts?: string;
} {
  const acknowledgedAt = approvedNext.handling_acknowledged_at?.trim();
  return {
    id: handlingAcknowledgedTimelineEntryId(caseId),
    type: "handling_acknowledged",
    label: HANDLING_ACKNOWLEDGED_TIMELINE_LABEL,
    ...(acknowledgedAt ? { ts: acknowledgedAt } : {}),
  };
}
