import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";

export const REJECT_UNPAID_PREPARED_PACKET_APPROVAL_MESSAGE =
  "This case requires a one-time payment before Surrenderless can begin handling it.";

function pickPreparedPacketApproved(clientState: unknown): boolean {
  return parseJusticeCaseClientState(clientState).prepared_packet_approved === true;
}

/**
 * True only for the FIRST transition of prepared_packet_approved to true — the exact moment
 * Surrenderless/operator labor is committed for this case. Already-approved/in-progress cases
 * (prepared_packet_approved already true) never match this again, so this can never re-block a
 * case that has already passed this point.
 */
export function isFirstPreparedPacketApprovalTransition(
  existingClientState: unknown,
  incomingClientState: unknown
): boolean {
  return (
    !pickPreparedPacketApproved(existingClientState) &&
    pickPreparedPacketApproved(incomingClientState)
  );
}

/**
 * Rejects the first prepared-packet-approval transition unless the case has confirmed one-time
 * payment. paid_at is written only by the Stripe webhook handler after signature verification —
 * this function trusts nothing from the request itself, only the durable paid_at value the
 * caller already read from the database. Intake, evidence, and case preparation are never
 * touched by this gate: it only ever fires on the specific client_state transition that commits
 * operator labor.
 */
export function rejectUnpaidPreparedPacketApprovalPatch(params: {
  existingClientState: unknown;
  incomingClientState: unknown;
  paidAt: string | null | undefined;
}): string | null {
  if (params.paidAt?.trim()) return null;
  if (
    !isFirstPreparedPacketApprovalTransition(params.existingClientState, params.incomingClientState)
  ) {
    return null;
  }
  return REJECT_UNPAID_PREPARED_PACKET_APPROVAL_MESSAGE;
}
