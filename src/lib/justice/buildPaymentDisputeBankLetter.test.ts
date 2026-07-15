import { describe, expect, it } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  buildBankLetter,
  buildDefaultPaymentDisputeDraft,
  inferPaymentDisputeReasonFromIntake,
  type DisputeReasonOption,
} from "@/lib/justice/buildPaymentDisputeBankLetter";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440001";

function intakeWithStory(story: string, extras: Partial<Parameters<typeof buildJusticeIntakeFromParts>[0]> = {}) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "charge_dispute",
    company_name: "Acme Retail",
    money_amount: "$899.00",
    pay_or_order_date: "2026-01-10",
    consumer_us_state: "CA",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    story,
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "No help.",
    ...extras,
  });
}

describe("inferPaymentDisputeReasonFromIntake", () => {
  it.each([
    [
      "goods_not_received",
      "I bought a laptop online and it never arrived.",
    ],
    [
      "goods_not_received",
      "Paid for merchandise that was not received after two weeks.",
    ],
    [
      "goods_not_received",
      "The package never got delivered and customer service stopped answering.",
    ],
    [
      "duplicate_charge",
      "I was charged twice for the same order on my credit card.",
    ],
    [
      "duplicate_charge",
      "This is a duplicate charge for my subscription renewal.",
    ],
    [
      "wrong_amount",
      "They charged the wrong amount — billed $120 instead of $80.",
    ],
    [
      "wrong_amount",
      "I was overcharged for the service I ordered.",
    ],
    [
      "canceled_refunded_still_charged",
      "I canceled the order but was still charged the full amount.",
    ],
    [
      "canceled_refunded_still_charged",
      "Merchant said they refunded me but I never got my refund and the charge remains.",
    ],
    [
      "service_not_as_promised",
      "The repair service was not as promised and left the product defective.",
    ],
    [
      "service_not_as_promised",
      "Item arrived but it is not as described in the listing.",
    ],
    [
      "unauthorized_charge",
      "I did not authorize this charge and do not recognize the merchant.",
    ],
    [
      "unauthorized_charge",
      "Unauthorized charge appeared on my statement from a company I never used.",
    ],
    [
      "other",
      "I am having a billing problem with this company and want help.",
    ],
    [
      "other",
      "Need a refund for a disappointing purchase experience overall.",
    ],
  ] as const satisfies ReadonlyArray<readonly [DisputeReasonOption, string]>)(
    "infers %s from clear narrative",
    (reason, story) => {
      expect(inferPaymentDisputeReasonFromIntake(intakeWithStory(story))).toBe(reason);
    }
  );

  it("reads delivery signals from purchase_or_signup when story is thin", () => {
    const intake = intakeWithStory("Please help with this purchase.", {
      purchase_or_signup: "Ordered a laptop that never arrived.",
    });
    expect(inferPaymentDisputeReasonFromIntake(intake)).toBe("goods_not_received");
  });

  it("prefers non-delivery over weaker overlapping complaint language", () => {
    expect(
      inferPaymentDisputeReasonFromIntake(
        intakeWithStory(
          "I bought a laptop, it never arrived, and now I want the charge reversed as a billing dispute."
        )
      )
    ).toBe("goods_not_received");
  });
});

describe("buildDefaultPaymentDisputeDraft", () => {
  it("uses inferred reason instead of always unauthorized_charge", () => {
    const draft = buildDefaultPaymentDisputeDraft(
      CASE_ID,
      intakeWithStory("I bought a laptop online and it never arrived.")
    );
    expect(draft.dispute_reason).toBe("goods_not_received");
    expect(draft.merchant_name).toBe("Acme Retail");
    expect(draft.case_id).toBe(CASE_ID);
  });

  it("falls back to other for ambiguous intake without asserting unauthorized activity", () => {
    const draft = buildDefaultPaymentDisputeDraft(
      CASE_ID,
      intakeWithStory("Something went wrong with my order and I want assistance.")
    );
    expect(draft.dispute_reason).toBe("other");
  });

  it("writes the formal reason label into the bank letter", () => {
    const intake = intakeWithStory("I bought a laptop online and it never arrived.");
    const draft = buildDefaultPaymentDisputeDraft(CASE_ID, intake);
    const letter = buildBankLetter(draft, intake);
    expect(letter).toContain("I am disputing this charge as: Goods or services not received.");
    expect(letter).not.toContain("Unauthorized charge");
  });
});
