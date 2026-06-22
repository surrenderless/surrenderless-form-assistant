import {
  ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
} from "@/lib/justice/assistedSubmissionLane";
import type { JusticeApprovedNextAction, JusticeDestination } from "@/lib/justice/types";

/** Real BBB complaint prep (distinct from mock practice assisted lane). */
const REAL_BBB_COMPLAINT_PREP_HREF = "/justice/bbb";

/** Real State AG complaint prep. */
const REAL_STATE_AG_PREP_HREF = "/justice/state-ag";

/** Real DOT complaint prep. */
const REAL_DOT_PREP_HREF = "/justice/dot";

/** Demand letter prep route (small claims). */
const DEMAND_LETTER_PREP_HREF = "/justice/demand-letter";

type PickFirstRoutablePreparedActionOptions = {
  /** After BBB mock practice only: allow the real BBB manual destination. */
  allowRealBbbManualAfterMockPractice?: boolean;
  /** After real BBB completion only: allow the first downstream manual destination. */
  allowManualAfterRealBbbCompletion?: boolean;
  /** After State AG completion only: allow the first downstream manual destination. */
  allowManualAfterStateAgCompletion?: boolean;
  /** After State AG completion only: allow the downstream demand-letter destination. */
  allowDemandLetterAfterStateAgCompletion?: boolean;
  /** After DOT completion only: allow the downstream demand-letter destination. */
  allowDemandLetterAfterDotCompletion?: boolean;
};

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
  skipHref?: string,
  options: PickFirstRoutablePreparedActionOptions = {}
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

  if (options.allowRealBbbManualAfterMockPractice) {
    const realBbbDest = destinations.find(
      (d) =>
        d.id === "bbb" &&
        d.internalRoute === REAL_BBB_COMPLAINT_PREP_HREF &&
        d.internalRoute !== skip &&
        d.status === "manual"
    );
    if (realBbbDest?.internalRoute) {
      return {
        detailHref: realBbbDest.internalRoute,
        stepLabel: realBbbDest.label,
      };
    }
  }

  if (options.allowManualAfterRealBbbCompletion || options.allowManualAfterStateAgCompletion) {
    const manualDest = destinations.find(
      (d) =>
        d.internalRoute &&
        d.internalRoute !== skip &&
        d.status === "manual"
    );
    if (manualDest?.internalRoute) {
      return {
        detailHref: manualDest.internalRoute,
        stepLabel: manualDest.label,
      };
    }
  }

  if (
    options.allowDemandLetterAfterStateAgCompletion ||
    options.allowDemandLetterAfterDotCompletion
  ) {
    const demandLetterDest = destinations.find(
      (d) =>
        d.id === "small_claims" &&
        d.internalRoute === DEMAND_LETTER_PREP_HREF &&
        d.internalRoute !== skip
    );
    if (demandLetterDest?.internalRoute) {
      return {
        detailHref: demandLetterDest.internalRoute,
        stepLabel: demandLetterDest.label,
      };
    }
  }

  return {
    detailHref: null,
    stepLabel: "Prepared case review",
  };
}

function findCompletedDestination(
  destinations: JusticeDestination[],
  completedHref: string
): JusticeDestination | undefined {
  const completed = completedHref.trim();
  const byRoute = destinations.find((d) => d.internalRoute === completed);
  if (byRoute) return byRoute;
  if (completed === ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF) {
    return destinations.find((d) => d.id === "ftc");
  }
  if (completed === ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF) {
    return destinations.find((d) => d.id === "bbb_practice");
  }
  return undefined;
}

function destinationsAfterCompletedPriority(
  destinations: JusticeDestination[],
  completedHref: string
): JusticeDestination[] {
  const completedDest = findCompletedDestination(destinations, completedHref);
  if (completedDest === undefined) {
    return destinations;
  }
  return destinations.filter((d) => d.priority > completedDest.priority);
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

  const downstreamDestinations = destinationsAfterCompletedPriority(destinations, completed);
  const pickOptions: PickFirstRoutablePreparedActionOptions = {
    allowRealBbbManualAfterMockPractice:
      completed === ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
    allowManualAfterRealBbbCompletion: completed === REAL_BBB_COMPLAINT_PREP_HREF,
    allowManualAfterStateAgCompletion: completed === REAL_STATE_AG_PREP_HREF,
    allowDemandLetterAfterStateAgCompletion: completed === REAL_STATE_AG_PREP_HREF,
    allowDemandLetterAfterDotCompletion: completed === REAL_DOT_PREP_HREF,
  };

  if (!contacted) {
    if (completed !== "/justice/merchant") return null;
    const next = pickFirstRoutablePreparedAction(
      downstreamDestinations,
      completed,
      pickOptions
    );
    return next.detailHref ? next : null;
  }

  const next = pickFirstRoutablePreparedAction(
    downstreamDestinations,
    completed,
    pickOptions
  );
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
