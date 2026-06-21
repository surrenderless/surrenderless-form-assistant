import { describe, expect, it } from "vitest";
import { ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF } from "@/lib/justice/assistedSubmissionLane";
import {
  buildApprovedNextActionTarget,
  pickNextPreparedActionAfterCompleted,
  pickPreparedNextAction,
} from "@/lib/justice/preparedNextAction";
import type { JusticeDestination } from "@/lib/justice/types";

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

  it("does not advance past the last routable practice step", () => {
    expect(
      pickNextPreparedActionAfterCompleted({
        contacted: true,
        useCompanyContactLabels: false,
        destinations: [merchantDest, ftcDest, bbbPracticeDest],
        completedHref: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
      })
    ).toBeNull();
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
