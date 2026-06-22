import { describe, expect, it } from "vitest";
import { ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF } from "@/lib/justice/assistedSubmissionLane";
import {
  buildApprovedNextActionTarget,
  pickNextPreparedActionAfterCompleted,
  pickPreparedNextAction,
} from "@/lib/justice/preparedNextAction";
import { computeJusticeDestinations } from "@/lib/justice/rules";
import type { JusticeDestination, JusticeIntake } from "@/lib/justice/types";

const merchantDest: JusticeDestination = {
  id: "merchant_resolution",
  label: "Merchant contact & proof",
  rationale: "",
  status: "available",
  priority: 10,
  internalRoute: "/justice/merchant",
};

const paymentDest: JusticeDestination = {
  id: "payment_dispute",
  label: "Payment dispute (bank/card)",
  rationale: "",
  status: "available",
  priority: 20,
  internalRoute: "/justice/payment-dispute",
};

const cfpbDest: JusticeDestination = {
  id: "cfpb",
  label: "CFPB complaint prep",
  rationale: "",
  status: "recommended",
  priority: 50,
  internalRoute: "/justice/cfpb",
};

const ftcDest: JusticeDestination = {
  id: "ftc",
  label: "FTC (consumer complaint)",
  rationale: "",
  status: "recommended",
  priority: 30,
  internalRoute: "/justice/ftc-review",
};

const bbbPracticeDest: JusticeDestination = {
  id: "bbb_practice",
  label: "BBB mock practice",
  rationale: "",
  status: "recommended",
  priority: 31,
  internalRoute: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
};

const realBbbDest: JusticeDestination = {
  id: "bbb",
  label: "Better Business Bureau",
  rationale: "",
  status: "manual",
  priority: 40,
  internalRoute: "/justice/bbb",
};

const stateAgDest: JusticeDestination = {
  id: "state_ag",
  label: "State Attorney General (consumer)",
  rationale: "",
  status: "manual",
  priority: 50,
  internalRoute: "/justice/state-ag",
};

const fccDownstreamDest: JusticeDestination = {
  id: "fcc",
  label: "FCC complaint prep",
  rationale: "",
  status: "recommended",
  priority: 45,
  internalRoute: "/justice/fcc",
};

const dotManualDest: JusticeDestination = {
  id: "dot",
  label: "USDOT / aviation consumer",
  rationale: "",
  status: "manual",
  priority: 80,
  internalRoute: "/justice/dot",
};

const demandLetterLaterDest: JusticeDestination = {
  id: "small_claims",
  label: "Small claims / demand letter",
  rationale: "",
  status: "later",
  priority: 90,
  internalRoute: "/justice/demand-letter",
};

function dotEligibleTravelIntake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return failedContactPracticeIntake({
    story: "My airline flight was canceled and baggage was lost at the airport.",
    ...overrides,
  });
}

function failedContactPracticeIntake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return {
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "",
    purchase_or_signup: "web order",
    story: "Item never arrived",
    money_involved: "",
    pay_or_order_date: "",
    order_confirmation_details: "",
    user_display_name: "Test User",
    reply_email: "user@example.com",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2024-05-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Refund denied",
    ...overrides,
  };
}

describe("pickPreparedNextAction", () => {
  it("routes not-contacted users to merchant contact first", () => {
    expect(
      pickPreparedNextAction({
        contacted: false,
        useCompanyContactLabels: false,
        destinations: [paymentDest, cfpbDest],
      })
    ).toEqual({
      detailHref: "/justice/merchant",
      stepLabel: "Merchant contact",
    });
  });

  it("uses company contact label when requested", () => {
    expect(
      pickPreparedNextAction({
        contacted: false,
        useCompanyContactLabels: true,
        destinations: [],
      }).stepLabel
    ).toBe("Company contact");
  });

  it("picks first routable destination when already contacted", () => {
    expect(
      pickPreparedNextAction({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, paymentDest, cfpbDest],
      })
    ).toEqual({
      detailHref: "/justice/merchant",
      stepLabel: "Merchant contact & proof",
    });
  });
});

describe("pickNextPreparedActionAfterCompleted", () => {
  const destinations = [merchantDest, paymentDest, cfpbDest];

  it("advances from merchant to payment dispute when contacted", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations,
        completedHref: "/justice/merchant",
      })
    ).toEqual({
      detailHref: "/justice/payment-dispute",
      stepLabel: "Payment dispute (bank/card)",
    });
  });

  it("returns null when no routable destination remains after skip", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [paymentDest],
        completedHref: "/justice/payment-dispute",
      })
    ).toBeNull();
  });

  it("after merchant when not contacted only advances once merchant is completed", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: false,
        useCompanyContactLabels: false,
        destinations,
        completedHref: "/justice/merchant",
      })
    ).toEqual({
      detailHref: "/justice/payment-dispute",
      stepLabel: "Payment dispute (bank/card)",
    });
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: false,
        useCompanyContactLabels: false,
        destinations,
        completedHref: "/justice/payment-dispute",
      })
    ).toBeNull();
  });

  it("advances from FTC practice to BBB mock practice without re-picking earlier steps", () => {
    const practiceDestinations = [merchantDest, paymentDest, ftcDest, bbbPracticeDest, cfpbDest];

    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: practiceDestinations,
        completedHref: "/justice/ftc-review",
      })
    ).toEqual({
      detailHref: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
      stepLabel: "BBB mock practice",
    });
  });

  it("advances from BBB mock practice to real BBB prep with full computed destinations", () => {
    const destinations = computeJusticeDestinations(failedContactPracticeIntake(), {
      manualFtc: false,
    });

    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations,
        completedHref: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
      })
    ).toEqual({
      detailHref: "/justice/bbb",
      stepLabel: "Better Business Bureau",
    });
  });

  it("selects real BBB over other manual destinations after BBB mock practice", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, ftcDest, bbbPracticeDest, realBbbDest, stateAgDest],
        completedHref: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
      })
    ).toEqual({
      detailHref: "/justice/bbb",
      stepLabel: "Better Business Bureau",
    });
  });

  it("does not allow real BBB manual selection except after BBB mock practice", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, paymentDest, ftcDest, bbbPracticeDest, realBbbDest, stateAgDest],
        completedHref: "/justice/ftc-review",
      })
    ).toEqual({
      detailHref: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
      stepLabel: "BBB mock practice",
    });
  });

  it("leaves BBB mock completed when no eligible real BBB destination exists", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: computeJusticeDestinations(
          failedContactPracticeIntake({ company_name: "" }),
          { manualFtc: false }
        ),
        completedHref: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
      })
    ).toBeNull();
  });

  it("does not advance past BBB mock practice when real BBB is absent from destinations", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, ftcDest, bbbPracticeDest],
        completedHref: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
      })
    ).toBeNull();
  });

  it("advances from real BBB to state AG when it is the first eligible downstream manual destination", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, ftcDest, bbbPracticeDest, realBbbDest, stateAgDest],
        completedHref: "/justice/bbb",
      })
    ).toEqual({
      detailHref: "/justice/state-ag",
      stepLabel: "State Attorney General (consumer)",
    });
  });

  it("advances from real BBB to state AG with full computed destinations", () => {
    const destinations = computeJusticeDestinations(failedContactPracticeIntake(), {
      manualFtc: false,
    });

    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations,
        completedHref: "/justice/bbb",
      })
    ).toEqual({
      detailHref: "/justice/state-ag",
      stepLabel: "State Attorney General (consumer)",
    });
  });

  it("prefers a downstream recommended destination over manual after real BBB completion", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [
          merchantDest,
          ftcDest,
          bbbPracticeDest,
          realBbbDest,
          fccDownstreamDest,
          stateAgDest,
        ],
        completedHref: "/justice/bbb",
      })
    ).toEqual({
      detailHref: "/justice/fcc",
      stepLabel: "FCC complaint prep",
    });
  });

  it("returns null after real BBB when no downstream destination is eligible", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: computeJusticeDestinations(
          failedContactPracticeIntake({ company_name: "" }),
          { manualFtc: false }
        ),
        completedHref: "/justice/bbb",
      })
    ).toBeNull();
  });

  it("does not broadly select manual destinations after other completed hrefs", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, paymentDest, realBbbDest, stateAgDest],
        completedHref: "/justice/payment-dispute",
      })
    ).toBeNull();
  });

  it("preserves priority ordering among downstream manual destinations after real BBB", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, realBbbDest, stateAgDest, dotManualDest],
        completedHref: "/justice/bbb",
      })
    ).toEqual({
      detailHref: "/justice/state-ag",
      stepLabel: "State Attorney General (consumer)",
    });
  });

  it("advances from State AG to DOT for DOT-eligible intake with computed destinations", () => {
    const destinations = computeJusticeDestinations(dotEligibleTravelIntake(), {
      manualFtc: false,
    });

    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations,
        completedHref: "/justice/state-ag",
      })
    ).toEqual({
      detailHref: "/justice/dot",
      stepLabel: "USDOT / aviation consumer",
    });
  });

  it("advances from State AG to DOT when it is the first eligible downstream manual destination", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, realBbbDest, stateAgDest, dotManualDest],
        completedHref: "/justice/state-ag",
      })
    ).toEqual({
      detailHref: "/justice/dot",
      stepLabel: "USDOT / aviation consumer",
    });
  });

  it("prefers a downstream recommended destination over manual after State AG completion", () => {
    const downstreamRecommendedDest: JusticeDestination = {
      id: "cfpb",
      label: "CFPB complaint prep",
      rationale: "",
      status: "recommended",
      priority: 55,
      internalRoute: "/justice/cfpb",
    };

    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, stateAgDest, downstreamRecommendedDest, dotManualDest],
        completedHref: "/justice/state-ag",
      })
    ).toEqual({
      detailHref: "/justice/cfpb",
      stepLabel: "CFPB complaint prep",
    });
  });

  it("returns null after State AG when no downstream manual destination is eligible", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: computeJusticeDestinations(failedContactPracticeIntake(), {
          manualFtc: false,
        }),
        completedHref: "/justice/state-ag",
      })
    ).toBeNull();
  });

  it("does not select later destinations after State AG completion", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, stateAgDest, demandLetterLaterDest],
        completedHref: "/justice/state-ag",
      })
    ).toBeNull();
  });

  it("does not broadly select manual destinations after FTC practice completion", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, ftcDest, bbbPracticeDest, stateAgDest, dotManualDest],
        completedHref: "/justice/ftc-review",
      })
    ).toEqual({
      detailHref: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
      stepLabel: "BBB mock practice",
    });
  });

  it("preserves priority ordering among downstream manual destinations after State AG", () => {
    const lowerPriorityManualDest: JusticeDestination = {
      id: "small_claims",
      label: "Other manual step",
      rationale: "",
      status: "manual",
      priority: 85,
      internalRoute: "/justice/other-manual",
    };

    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, stateAgDest, dotManualDest, lowerPriorityManualDest],
        completedHref: "/justice/state-ag",
      })
    ).toEqual({
      detailHref: "/justice/dot",
      stepLabel: "USDOT / aviation consumer",
    });
  });
});

describe("buildApprovedNextActionTarget", () => {
  it("falls back to packet href when detail href is null", () => {
    const action = buildApprovedNextActionTarget({
      detailHref: null,
      stepLabel: "Prepared case review",
    });
    expect(action.href).toBe("/justice/packet");
    expect(action.status).toBe("approved");
    expect(action.label).toBe("Prepared case review");
  });
});
