import { describe, expect, it } from "vitest";
import type { JusticeIntake } from "@/lib/justice/types";
import {
  hasValidMerchantContactRecipient,
  MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE,
  resolveMerchantContactRecipientEmail,
} from "@/lib/justice/merchantContactRecipient";

function intakeWithEmail(email: string | null | undefined): JusticeIntake {
  return { company_contact_email: email } as unknown as JusticeIntake;
}

describe("resolveMerchantContactRecipientEmail", () => {
  it("returns the lowercased, trimmed address for a valid email", () => {
    expect(resolveMerchantContactRecipientEmail("  Support@Company.com ")).toBe("support@company.com");
  });

  it("returns null for empty / whitespace", () => {
    expect(resolveMerchantContactRecipientEmail("")).toBeNull();
    expect(resolveMerchantContactRecipientEmail("   ")).toBeNull();
    expect(resolveMerchantContactRecipientEmail(null)).toBeNull();
    expect(resolveMerchantContactRecipientEmail(undefined)).toBeNull();
  });

  it("returns null for skip sentinels (none / n/a / unknown)", () => {
    for (const raw of ["none", "N/A", "na", "unknown", "skip", "I don't know"]) {
      expect(resolveMerchantContactRecipientEmail(raw)).toBeNull();
    }
  });

  it("returns null for a syntactically invalid address", () => {
    expect(resolveMerchantContactRecipientEmail("not-an-email")).toBeNull();
    expect(resolveMerchantContactRecipientEmail("a@b")).toBeNull();
  });
});

describe("hasValidMerchantContactRecipient", () => {
  it("is true only when the intake carries a valid company_contact_email", () => {
    expect(hasValidMerchantContactRecipient(intakeWithEmail("support@company.com"))).toBe(true);
  });

  it("is false when the email is missing, blank, a sentinel, or invalid", () => {
    expect(hasValidMerchantContactRecipient(intakeWithEmail(null))).toBe(false);
    expect(hasValidMerchantContactRecipient(intakeWithEmail(""))).toBe(false);
    expect(hasValidMerchantContactRecipient(intakeWithEmail("none"))).toBe(false);
    expect(hasValidMerchantContactRecipient(intakeWithEmail("nope"))).toBe(false);
  });

  it("is false for a null/undefined intake", () => {
    expect(hasValidMerchantContactRecipient(null)).toBe(false);
    expect(hasValidMerchantContactRecipient(undefined)).toBe(false);
  });
});

describe("MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE", () => {
  it("names the company's contact email so the consumer knows what to add", () => {
    expect(MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE.toLowerCase()).toContain("contact email");
  });
});
