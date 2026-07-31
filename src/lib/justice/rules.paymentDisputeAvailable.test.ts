import { describe, expect, it } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { paymentDisputeAvailable } from "@/lib/justice/rules";
import type { JusticeIntake } from "@/lib/justice/types";

const REQUIRED_PARTS = {
  ...defaultBuildJusticeIntakeParts(),
  company_name: "Acme Retail",
  purchase_or_signup: "widget",
  story: "Never arrived",
  reply_email: "user@example.com",
  pay_or_order_date: "2026-01-01",
};

describe("paymentDisputeAvailable", () => {
  it("is available when a real dollar amount and order date are given", () => {
    const intake = buildJusticeIntakeFromParts({
      ...REQUIRED_PARTS,
      money_amount: "$50",
    });
    expect(paymentDisputeAvailable(intake)).toBe(true);
  });

  it("is NOT available for a resolution-only answer with no dollar figure", () => {
    // Before gating on resolveIntakeMoneyAmount, this read raw money_involved ("I just want a
    // refund" — non-empty, not a sentinel) and incorrectly unlocked payment dispute with no
    // real amount, producing a bank letter with "Amount disputed: I just want a refund."
    const intake = buildJusticeIntakeFromParts({
      ...REQUIRED_PARTS,
      money_amount: "",
      desired_resolution: "I just want a refund",
    });
    expect(paymentDisputeAvailable(intake)).toBe(false);
  });

  it("is not available without a date even when an amount is given", () => {
    const intake = buildJusticeIntakeFromParts({
      ...REQUIRED_PARTS,
      money_amount: "$50",
      pay_or_order_date: "",
    });
    expect(paymentDisputeAvailable(intake)).toBe(false);
  });

  it("treats sentinel non-answers ('not sure', 'n/a') as unavailable", () => {
    const notSure = buildJusticeIntakeFromParts({ ...REQUIRED_PARTS, money_amount: "not sure" });
    const na = buildJusticeIntakeFromParts({ ...REQUIRED_PARTS, money_amount: "n/a" });
    expect(paymentDisputeAvailable(notSure)).toBe(false);
    expect(paymentDisputeAvailable(na)).toBe(false);
  });

  it("still works for legacy intake shapes lacking structured fields", () => {
    const legacyIntake: JusticeIntake = {
      ...buildJusticeIntakeFromParts(REQUIRED_PARTS),
      money_amount: undefined,
      desired_resolution: undefined,
      money_involved: "$899.00 — Desired outcome: full refund",
    };
    expect(paymentDisputeAvailable(legacyIntake)).toBe(true);

    const legacyNotSure: JusticeIntake = {
      ...buildJusticeIntakeFromParts(REQUIRED_PARTS),
      money_amount: undefined,
      desired_resolution: undefined,
      money_involved: "not sure",
    };
    expect(paymentDisputeAvailable(legacyNotSure)).toBe(false);
  });
});
