import { mergeApprovedNextActionTrackingFields } from "@/lib/justice/approvedNextActionState";
import {
  buildApprovedNextActionTarget,
  pickPreparedNextAction,
} from "@/lib/justice/preparedNextAction";
import {
  cfpbLikelyRelevant,
  computeJusticeDestinations,
  dotLikelyRelevant,
  fccLikelyRelevant,
} from "@/lib/justice/rules";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

export type RecomputeApprovedNextActionAfterIntakeOptions = {
  existing?: JusticeApprovedNextAction;
  manualFtc?: boolean;
};

/** Recompute post-packet approved next action from saved intake (e.g. after contact documented). */
export function recomputeApprovedNextActionAfterIntake(
  intake: JusticeIntake,
  options: RecomputeApprovedNextActionAfterIntakeOptions = {}
): JusticeApprovedNextAction {
  const manualFtc = options.manualFtc ?? false;
  const contacted = intake.already_contacted === "yes";
  const cfpbRel = cfpbLikelyRelevant(intake);
  const fccRel = fccLikelyRelevant(intake);
  const dotRel = dotLikelyRelevant(intake);
  const useCompanyContactLabels = cfpbRel || fccRel || dotRel;
  const destinations = computeJusticeDestinations(intake, { manualFtc, useCompanyContactLabels });
  const prepared = pickPreparedNextAction({ contacted, useCompanyContactLabels, destinations });
  const nextActionTarget = buildApprovedNextActionTarget(prepared);
  return mergeApprovedNextActionTrackingFields(options.existing, nextActionTarget);
}
