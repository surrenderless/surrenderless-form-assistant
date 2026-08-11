import { describe, expect, it } from "vitest";
import type { JusticeIntake } from "@/lib/justice/types";
import {
  hasValidPaymentDisputeRecipient,
  resolvePaymentDisputeRecipientEmail,
} from "@/lib/justice/paymentDisputeRecipient";

function intakeWithIssuerEmail(email: string | null | undefined): JusticeIntake {
  return { card_issuer_contact_email: email } as unknown as JusticeIntake;
}

describe("resolvePaymentDisputeRecipientEmail", () => {
  it("returns the normalized address for a valid issuer email", () => {
    expect(resolvePaymentDisputeRecipientEmail(" Disputes@Bank.com ")).toBe("disputes@bank.com");
  });

  it("returns null for empty, sentinel, or invalid values", () => {
    expect(resolvePaymentDisputeRecipientEmail("")).toBeNull();
    expect(resolvePaymentDisputeRecipientEmail(null)).toBeNull();
    expect(resolvePaymentDisputeRecipientEmail("none")).toBeNull();
    expect(resolvePaymentDisputeRecipientEmail("not-an-email")).toBeNull();
  });
});

describe("hasValidPaymentDisputeRecipient", () => {
  it("is true only when the intake carries a valid card_issuer_contact_email", () => {
    expect(hasValidPaymentDisputeRecipient(intakeWithIssuerEmail("disputes@bank.com"))).toBe(true);
  });

  it("is false when the issuer email is missing/invalid — the common case that routes to operators", () => {
    expect(hasValidPaymentDisputeRecipient(intakeWithIssuerEmail(null))).toBe(false);
    expect(hasValidPaymentDisputeRecipient(intakeWithIssuerEmail(""))).toBe(false);
    expect(hasValidPaymentDisputeRecipient(intakeWithIssuerEmail("n/a"))).toBe(false);
    expect(hasValidPaymentDisputeRecipient(null)).toBe(false);
    expect(hasValidPaymentDisputeRecipient(undefined)).toBe(false);
  });
});
