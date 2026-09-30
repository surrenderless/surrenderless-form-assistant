import { isMockPracticePreparedActionDestination } from "@/lib/justice/preparedNextAction";
import {
  cfpbLikelyRelevant,
  computeJusticeDestinations,
  dotLikelyRelevant,
  fccLikelyRelevant,
} from "@/lib/justice/rules";
import type { JusticeIntake } from "@/lib/justice/types";

export type EligibleOrphanedPaidCaseApprovalAction = { href: string; label: string };

/**
 * The complete, bounded set of actions an operator may pick when manually resolving an
 * orphaned_paid_case_approval review task — never an arbitrary string. Mirrors
 * resolveIntendedPreparedAction.ts's own computation (same inputs, same rules), but returns every
 * currently routable candidate rather than only the single top-priority pick, since the whole
 * point of manual review is a human choosing between real options a pure recompute couldn't
 * disambiguate on its own (see reconcileOrphanedPaidCaseApprovals.ts). `manualFtc` is deliberately
 * never considered here — it is an ephemeral, client-only signal an operator has no way to know,
 * so the FTC-manual-unlock-gated destination is never offered as an operator-selectable option.
 */
export function computeEligibleOrphanedPaidCaseApprovalActions(
  intake: JusticeIntake,
  options: { hasUploadedEvidenceFile: boolean }
): EligibleOrphanedPaidCaseApprovalAction[] {
  const contacted = intake.already_contacted === "yes";
  const useCompanyContactLabels =
    cfpbLikelyRelevant(intake) || fccLikelyRelevant(intake) || dotLikelyRelevant(intake);

  if (!contacted) {
    return [
      {
        href: "/justice/merchant",
        label: useCompanyContactLabels ? "Company contact" : "Merchant contact",
      },
    ];
  }

  const destinations = computeJusticeDestinations(intake, {
    manualFtc: false,
    useCompanyContactLabels,
    hasUploadedEvidenceFile: options.hasUploadedEvidenceFile,
  });

  const seen = new Set<string>();
  const eligible: EligibleOrphanedPaidCaseApprovalAction[] = [];
  for (const destination of destinations) {
    const href = destination.internalRoute?.trim();
    if (!href || seen.has(href)) continue;
    if (isMockPracticePreparedActionDestination(destination)) continue;
    if (
      destination.status !== "recommended" &&
      destination.status !== "available" &&
      destination.status !== "manual"
    ) {
      continue;
    }
    seen.add(href);
    eligible.push({ href, label: destination.label });
  }
  return eligible;
}

/**
 * True when href is a legitimate destination for this intake, whether or not it is the top
 * pick — the full known-route set for this intake at any status, plus the uncontacted merchant
 * default. Used to allow an operator to select the durably-paid-for action even when it is no
 * longer the CURRENT top-priority recompute (e.g. intake changed after checkout), while still
 * refusing an arbitrary/unknown href outright.
 */
export function isKnownDestinationHrefForIntake(intake: JusticeIntake, href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  if (trimmed === "/justice/merchant") return true;
  const useCompanyContactLabels =
    cfpbLikelyRelevant(intake) || fccLikelyRelevant(intake) || dotLikelyRelevant(intake);
  const destinations = computeJusticeDestinations(intake, {
    manualFtc: false,
    useCompanyContactLabels,
    hasUploadedEvidenceFile: false,
  });
  return destinations.some((d) => d.internalRoute?.trim() === trimmed);
}
