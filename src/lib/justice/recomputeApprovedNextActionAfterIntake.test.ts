import { describe, expect, it } from "vitest";
import { ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF } from "@/lib/justice/assistedSubmissionLane";
import {
  advanceApprovedNextActionAfterCompleted,
  recomputeApprovedNextActionAfterIntake,
} from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import { computeJusticeDestinations } from "@/lib/justice/rules";
import type { JusticeIntake } from "@/lib/justice/types";

function baseIntake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return {
    problem_category: "charge_dispute",
    company_name: "Acme Bank",
    company_website: "",
    purchase_or_signup: "credit card account",
    story: "Unauthorized charge on my credit card billing statement",
    money_involved: "$250",
    pay_or_order_date: "2024-06-01",
    order_confirmation_details: "",
    user_display_name: "Test User",
    reply_email: "user@example.com",
    already_contacted: "no",
    ...overrides,
  };
}

describe("recomputeApprovedNextActionAfterIntake", () => {
  it("recommends merchant contact when user has not contacted the company", () => {
    const action = recomputeApprovedNextActionAfterIntake(baseIntake());
    expect(action.href).toBe("/justice/merchant");
    expect(action.status).toBe("approved");
  });

  it("preserves handling request tracking from the existing approved action", () => {
    const action = recomputeApprovedNextActionAfterIntake(baseIntake(), {
      existing: {
        href: "/justice/merchant",
        handling_requested_at: "2024-01-02T00:00:00.000Z",
      },
    });
    expect(action.handling_requested_at).toBe("2024-01-02T00:00:00.000Z");
    expect(action.href).toBe("/justice/merchant");
  });
});

describe("advanceApprovedNextActionAfterCompleted", () => {
  const contactedIntake = baseIntake({
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2024-05-15",
    merchant_response_type: "no_response",
    contact_proof_type: "paste",
    contact_proof_text: "No reply after two emails",
  });

  it("advances queue from merchant to payment dispute after merchant is handled", () => {
    const next = advanceApprovedNextActionAfterCompleted(
      contactedIntake,
      "/justice/merchant"
    );
    expect(next?.href).toBe("/justice/payment-dispute");
    expect(next?.status).toBe("approved");
  });

  it("returns null when completed href is empty", () => {
    expect(advanceApprovedNextActionAfterCompleted(contactedIntake, "  ")).toBeNull();
  });

  it("advances from merchant to real BBB after merchant is handled for failed-contact retail intake", () => {
    const practiceIntake = baseIntake({
      problem_category: "online_purchase",
      company_name: "Acme Retail",
      story: "Item never arrived",
      purchase_or_signup: "web order",
      money_involved: "",
      pay_or_order_date: "",
      already_contacted: "yes",
      contact_method: "email",
      contact_date: "2024-05-15",
      merchant_response_type: "refused_help",
      contact_proof_type: "paste",
      contact_proof_text: "Refund denied",
    });

    expect(
      advanceApprovedNextActionAfterCompleted(practiceIntake, "/justice/merchant")?.href
    ).toBe("/justice/bbb");

    expect(
      advanceApprovedNextActionAfterCompleted(practiceIntake, "/justice/ftc-review")?.href
    ).toBe("/justice/bbb");
  });
});

describe("computeJusticeDestinations bbb_practice routing", () => {
  const failedContactIntake = baseIntake({
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2024-05-15",
    merchant_response_type: "no_response",
    contact_proof_type: "paste",
    contact_proof_text: "No reply after two emails",
  });

  it("includes BBB mock practice when failed-contact unlock matches FTC practice", () => {
    const destinations = computeJusticeDestinations(failedContactIntake, { manualFtc: false });
    const bbbPractice = destinations.find((d) => d.id === "bbb_practice");

    expect(bbbPractice).toMatchObject({
      status: "available",
      priority: 31,
      internalRoute: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
    });
  });

  it("keeps BBB mock practice locked until failed contact is documented", () => {
    const destinations = computeJusticeDestinations(baseIntake(), { manualFtc: false });
    const bbbPractice = destinations.find((d) => d.id === "bbb_practice");

    expect(bbbPractice).toMatchObject({
      status: "later",
      internalRoute: undefined,
    });
  });

  it("leaves the real BBB complaint destination on /justice/bbb", () => {
    const destinations = computeJusticeDestinations(failedContactIntake, { manualFtc: false });
    const bbb = destinations.find((d) => d.id === "bbb");

    expect(bbb).toMatchObject({
      status: "manual",
      internalRoute: "/justice/bbb",
    });
  });
});
