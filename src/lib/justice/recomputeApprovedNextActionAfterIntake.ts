import { mergeApprovedNextActionTrackingFields } from "@/lib/justice/approvedNextActionState";
import { MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
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
