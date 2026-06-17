import { describe, expect, it } from "vitest";
import {
  advanceApprovedNextActionAfterCompleted,
  recomputeApprovedNextActionAfterIntake,
} from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
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
});
