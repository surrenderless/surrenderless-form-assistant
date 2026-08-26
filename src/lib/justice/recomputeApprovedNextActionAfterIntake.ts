import { mergeApprovedNextActionTrackingFields } from "@/lib/justice/approvedNextActionState";
import {
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MERCHANT_RESOLVED_TERMINAL_HREF,
  MERCHANT_RESOLVED_TERMINAL_LABEL,
} from "@/lib/justice/handlingTrackingProgress";
import {
  buildApprovedNextActionTarget,
  pickNextPreparedActionAfterCompleted,
  pickPreparedNextAction,
} from "@/lib/justice/preparedNextAction";
import {
  cfpbLikelyRelevant,
  cfpbPrepUnlockedFromIntake,
  computeJusticeDestinations,
  dotLikelyRelevant,
  fccLikelyRelevant,
  isMerchantResolved,
} from "@/lib/justice/rules";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

export type RecomputeApprovedNextActionAfterIntakeOptions = {
  existing?: JusticeApprovedNextAction;
  manualFtc?: boolean;
  /** True when the case has a real uploaded evidence record (see justiceEvidenceRowHasUploadedFile). */
  hasUploadedEvidenceFile?: boolean;
};

/**
 * Gate for the evidence-change effect that recomputes and PERSISTS the approved next action.
 * `recomputeApprovedNextActionAfterIntake` unconditionally yields a `status: "approved"` action
 * (via `buildApprovedNextActionTarget`), so persisting it before the packet is actually approved
 * would falsely mark an unpaid, un-reviewed case "Approved" (and trigger its operator-fulfillment
 * chat narration). Recompute/persist only once the packet is approved AND the evidence-file signal
 * actually changed — pre-approval, this must never fire.
 */
export function shouldRecomputeApprovedNextActionOnEvidenceChange(input: {
  preparedPacketApproved: boolean;
  evidenceFileChanged: boolean;
}): boolean {
  return input.preparedPacketApproved === true && input.evidenceFileChanged === true;
}

/** Recompute post-packet approved next action from saved intake (e.g. after contact documented). */
export function recomputeApprovedNextActionAfterIntake(
  intake: JusticeIntake,
  options: RecomputeApprovedNextActionAfterIntakeOptions = {}
): JusticeApprovedNextAction {
  const manualFtc = options.manualFtc ?? false;
  const hasUploadedEvidenceFile = options.hasUploadedEvidenceFile ?? false;
  const contacted = intake.already_contacted === "yes";
  const cfpbRel = cfpbLikelyRelevant(intake);
  const fccRel = fccLikelyRelevant(intake);
  const dotRel = dotLikelyRelevant(intake);
  const useCompanyContactLabels = cfpbRel || fccRel || dotRel;

  // An already-approved, not-yet-completed CFPB action stays selected regardless of proof
  // state — it must never be silently reassigned to a different destination. Only its
  // proof_required flag is re-evaluated fresh on every call, from current intake + evidence.
  const existingIsActiveCfpb =
    options.existing?.href === MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF &&
    options.existing?.status !== "completed";
  if (existingIsActiveCfpb) {
    const cfpbProofReady =
      cfpbRel && cfpbPrepUnlockedFromIntake(intake, manualFtc, hasUploadedEvidenceFile);
    const preserved: JusticeApprovedNextAction = {
      ...options.existing,
      label: "CFPB",
      href: MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
      proof_required: !cfpbProofReady,
    };
    return mergeApprovedNextActionTrackingFields(options.existing, preserved);
  }

  // Consumer-owned terminal: the merchant/company already fixed it, so no escalation
  // destination is or ever will be routable (computeJusticeDestinations downgrades every one
  // to "later" once isMerchantResolved is true). Persist an already-completed action directly
  // rather than falling through to pickPreparedNextAction's generic "nothing routable"
  // fallback, which lands on CHAT_INLINE_PACKET_FALLBACK_PREP_HREF with status "approved" and
  // has no owned/operator filing kind, no follow-up-review task, and therefore no path to ever
  // reach "completed" — permanently blocking the consumer's own archive gate. Built with a
  // clean (undefined) base rather than options.existing so this can never inherit a stale
  // handling_requested_at/outcome_note from a different, unrelated in-flight destination.
  if (isMerchantResolved(intake)) {
    // Idempotent: recomputation fires repeatedly (unrelated intake edits, the evidence-change
    // effect re-firing) — if the existing action is ALREADY this same terminal state, keep its
    // original approved_at/completed_at rather than drifting them forward on every call. Any
    // other existing state (a different href, or this href not yet completed) is a genuine
    // transition, so it gets fresh timestamps.
    const alreadyTerminal =
      options.existing?.href === MERCHANT_RESOLVED_TERMINAL_HREF &&
      options.existing?.status === "completed";
    const nowIso = new Date().toISOString();
    const terminal: JusticeApprovedNextAction = {
      label: MERCHANT_RESOLVED_TERMINAL_LABEL,
      href: MERCHANT_RESOLVED_TERMINAL_HREF,
      status: "completed",
      approved_at: (alreadyTerminal && options.existing?.approved_at?.trim()) || nowIso,
      completed_at: (alreadyTerminal && options.existing?.completed_at?.trim()) || nowIso,
    };
    return mergeApprovedNextActionTrackingFields(undefined, terminal);
  }

  const destinations = computeJusticeDestinations(intake, {
    manualFtc,
    useCompanyContactLabels,
    hasUploadedEvidenceFile,
  });
  const prepared = pickPreparedNextAction({ contacted, useCompanyContactLabels, destinations });
  const nextActionTarget = buildApprovedNextActionTarget(prepared);
  return mergeApprovedNextActionTrackingFields(options.existing, nextActionTarget);
}

/** Advance to the next routable approved action after the current href is marked handled. */
export function advanceApprovedNextActionAfterCompleted(
  intake: JusticeIntake,
  completedHref: string,
  options: RecomputeApprovedNextActionAfterIntakeOptions = {}
): JusticeApprovedNextAction | null {
  const manualFtc = options.manualFtc ?? false;
  const hasUploadedEvidenceFile = options.hasUploadedEvidenceFile ?? false;
  const contacted = intake.already_contacted === "yes";
  const cfpbRel = cfpbLikelyRelevant(intake);
  const fccRel = fccLikelyRelevant(intake);
  const dotRel = dotLikelyRelevant(intake);
  const useCompanyContactLabels = cfpbRel || fccRel || dotRel;
  const destinations = computeJusticeDestinations(intake, {
    manualFtc,
    useCompanyContactLabels,
    hasUploadedEvidenceFile,
  });
  const prepared = pickNextPreparedActionAfterCompleted({
    contacted,
    useCompanyContactLabels,
    destinations,
    completedHref,
  });
  if (!prepared?.detailHref) return null;
  const nextActionTarget = buildApprovedNextActionTarget(prepared);
  return mergeApprovedNextActionTrackingFields(options.existing, nextActionTarget);
}
