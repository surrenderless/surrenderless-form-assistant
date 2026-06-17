import { describe, expect, it } from "vitest";
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
