import { deriveManualActionTrackingFilingsStateForApprovedAction } from "@/lib/justice/handlingTrackingProgress";
import type { ManualActionTrackingFiling } from "@/lib/justice/handlingTrackingProgress";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

const PACKET_HANDLING_TRACKING_COMPLETE = "Tracking complete for now.";

function packetReadyForManualReview(input: {
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
}): boolean {
  return input.basicsReady && input.draftReviewed && input.preparedPacketApproved;
}

function derivePacketManualActionNextStep(input: {
  readyForExternalManualAction: boolean;
  actionOpened: boolean;
  hasFilingRecord: boolean;
  hasConfirmationOnFile: boolean;
  status: JusticeApprovedNextAction["status"];
  outcomeNote?: string;
  handlingRequestedAt?: string;
  handlingAcknowledgedAt?: string;
  followUpNeeded?: boolean;
}): string {
  if (!input.readyForExternalManualAction) {
    return "Review packet and saved proof before external manual action.";
  }
  if (!input.actionOpened) {
    return "Open the approved step and prepare the manual action.";
  }
  if (!input.hasFilingRecord) {
    return "Add filing records from the case packet after external submission.";
  }
  if (!input.hasConfirmationOnFile) {
    return "Add or edit the filing confirmation from the case packet after external submission.";
  }
  if (input.status === "completed" && !input.outcomeNote?.trim()) {
    return "Record the handling outcome.";
  }
  if (
    input.status === "completed" &&
    input.outcomeNote?.trim() &&
    input.handlingRequestedAt?.trim() &&
    !input.handlingAcknowledgedAt?.trim()
  ) {
    return "Mark the handling request acknowledged.";
  }
  if (input.followUpNeeded === true) {
    return "Review follow-up timing and mark follow-up handled when complete.";
  }
  return PACKET_HANDLING_TRACKING_COMPLETE;
}

export function derivePacketHandlingTrackingLine(input: {
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
  evidenceCount: number;
  filings: ManualActionTrackingFiling[];
  next: JusticeApprovedNextAction;
}): string {
  const readyForManualReview = packetReadyForManualReview({
    basicsReady: input.basicsReady,
    draftReviewed: input.draftReviewed,
    preparedPacketApproved: input.preparedPacketApproved,
  });
  const readyForExternalManualAction =
    readyForManualReview && input.evidenceCount > 0;
  const actionOpened = input.next.status === "started" || input.next.status === "completed";
  const { hasFilingRecord, hasConfirmationOnFile } =
    deriveManualActionTrackingFilingsStateForApprovedAction(input.filings, input.next);
  return derivePacketManualActionNextStep({
    readyForExternalManualAction,
    actionOpened,
    hasFilingRecord,
    hasConfirmationOnFile,
    status: input.next.status,
    outcomeNote: input.next.outcome_note,
    handlingRequestedAt: input.next.handling_requested_at,
    handlingAcknowledgedAt: input.next.handling_acknowledged_at,
    followUpNeeded: input.next.follow_up_needed === true,
  });
}
