import type { JusticeApprovedNextAction, JusticeDestination } from "@/lib/justice/types";

export type PreparedNextActionPick = {
  detailHref: string | null;
  stepLabel: string;
};

/** Post-review next step; packet canonical attach point (plan has a separate page-local variant). */
export function pickPreparedNextAction(params: {
  contacted: boolean;
  useCompanyContactLabels: boolean;
  destinations: JusticeDestination[];
}): PreparedNextActionPick {
  const { contacted, useCompanyContactLabels, destinations } = params;

  if (!contacted) {
    return {
      detailHref: "/justice/merchant",
      stepLabel: useCompanyContactLabels ? "Company contact" : "Merchant contact",
    };
  }

  return pickFirstRoutablePreparedAction(destinations);
}

function pickFirstRoutablePreparedAction(
  destinations: JusticeDestination[],
  skipHref?: string
): PreparedNextActionPick {
  const skip = skipHref?.trim();
  const firstRoutableDest = destinations.find(
    (d) =>
      d.internalRoute &&
      d.internalRoute !== skip &&
      (d.status === "recommended" || d.status === "available")
  );

  if (firstRoutableDest?.internalRoute) {
    return {
      detailHref: firstRoutableDest.internalRoute,
      stepLabel: firstRoutableDest.label,
    };
  }

  return {
    detailHref: null,
    stepLabel: "Prepared case review",
  };
}

/** Next routable approved step after the user marks the current href handled. */
export function pickNextPreparedActionAfterCompleted(params: {
  contacted: boolean;
  useCompanyContactLabels: boolean;
  destinations: JusticeDestination[];
  completedHref: string;
}): PreparedNextActionPick | null {
  const { contacted, useCompanyContactLabels, destinations, completedHref } = params;
  const completed = completedHref.trim();
  if (!completed) return null;

  if (!contacted) {
    if (completed !== "/justice/merchant") return null;
    const next = pickFirstRoutablePreparedAction(destinations, completed);
    return next.detailHref ? next : null;
  }

  const next = pickFirstRoutablePreparedAction(destinations, completed);
  return next.detailHref ? next : null;
}

export function buildApprovedNextActionTarget(
  prepared: PreparedNextActionPick
): JusticeApprovedNextAction {
  return {
    label: prepared.stepLabel,
    href: prepared.detailHref ?? "/justice/packet",
    status: "approved",
    approved_at: new Date().toISOString(),
  };
}
