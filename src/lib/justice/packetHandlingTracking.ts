import {
  deriveHandlingClosureStepAfterFilingConfirmation,
  deriveManualActionTrackingFilingsStateForApprovedAction,
  isApprovedActionOpenedForHandlingTracking,
  isMerchantResolvedTerminalAction,
} from "@/lib/justice/handlingTrackingProgress";
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
  href?: string;
  status: JusticeApprovedNextAction["status"];
  outcomeNote?: string;
  handlingRequestedAt?: string;
  handlingAcknowledgedAt?: string;
  followUpNeeded?: boolean;
}): string {
  // Consumer-owned terminal (merchant/company already resolved it): no external manual action
  // was ever required and no filing destination exists for this href — the ordinary
  // readiness/open-step/filing/confirmation checks below don't apply (and would otherwise
  // incorrectly land on "Add filing records..." since this href is deliberately absent from the
  // filing-destination map). Scoped strictly to this one href so it can never affect the generic
  // "nothing routable" fallback or a genuinely exhausted escalation ladder.
  if (isMerchantResolvedTerminalAction({ href: input.href, status: input.status })) {
    return PACKET_HANDLING_TRACKING_COMPLETE;
  }
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
  const closureStep = deriveHandlingClosureStepAfterFilingConfirmation({
    status: input.status,
    outcomeNote: input.outcomeNote,
    handlingRequestedAt: input.handlingRequestedAt,
    handlingAcknowledgedAt: input.handlingAcknowledgedAt,
  });
  if (closureStep) return closureStep;
  if (input.followUpNeeded === true) {
    return "Review follow-up timing and mark follow-up handled when complete.";
  }
  return PACKET_HANDLING_TRACKING_COMPLETE;
}

export function derivePacketHandlingTrackingLine(input: {
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
  /** Any saved evidence row (text note or uploaded file) — presence-based, not CFPB-verified. */
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
  const actionOpened = isApprovedActionOpenedForHandlingTracking(input.next);
  const { hasFilingRecord, hasConfirmationOnFile } =
    deriveManualActionTrackingFilingsStateForApprovedAction(input.filings, input.next);
  return derivePacketManualActionNextStep({
    readyForExternalManualAction,
    actionOpened,
    hasFilingRecord,
    hasConfirmationOnFile,
    href: input.next.href,
    status: input.next.status,
    outcomeNote: input.next.outcome_note,
    handlingRequestedAt: input.next.handling_requested_at,
    handlingAcknowledgedAt: input.next.handling_acknowledged_at,
    followUpNeeded: input.next.follow_up_needed === true,
  });
}
