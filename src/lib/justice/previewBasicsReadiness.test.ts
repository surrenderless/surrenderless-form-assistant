import { describe, expect, it } from "vitest";
import {
  buildJusticeIntakeFromParts,
  defaultBuildJusticeIntakeParts,
  justiceIntakeToBuildJusticeIntakeParts,
  type BuildJusticeIntakeParts,
} from "@/lib/justice/buildJusticeIntake";
import {
  getPreviewBasicsMissing,
  hasCapturedConsumerEmail,
  stillNeededBeforePreviewMessage,
} from "@/lib/justice/previewBasicsReadiness";

/** All preview basics satisfied except the consumer's own email, which the caller supplies. */
function completeExceptEmail(
  overrides: Partial<BuildJusticeIntakeParts> = {}
): BuildJusticeIntakeParts {
  return {
    ...defaultBuildJusticeIntakeParts(),
    company_name: "Acme Corp",
    purchase_or_signup: "Annual subscription",
    story: "They charged me twice and the company replied refusing a refund.",
    desired_resolution: "Full refund",
    reply_email: "",
    company_contact_email: "",
    ...overrides,
  };
}

describe("getPreviewBasicsMissing — consumer email requirement", () => {
  it("company contact email alone does NOT clear the consumer-email requirement", () => {
    // Repro of the mislabeled fix: a merchant email must never satisfy the consumer requirement.
    const parts = completeExceptEmail({ company_contact_email: "support@example.invalid" });

    const missing = getPreviewBasicsMissing(parts);
    expect(missing).toContain("your email");
    expect(hasCapturedConsumerEmail(parts)).toBe(false);
  });

  it("an explicitly captured consumer reply_email clears the requirement", () => {
    const parts = completeExceptEmail({ reply_email: "consumer@example.com" });

    const missing = getPreviewBasicsMissing(parts);
    expect(missing).not.toContain("your email");
    expect(missing).toHaveLength(0);
    expect(hasCapturedConsumerEmail(parts)).toBe(true);
  });

  it("a seeded (signed-in account) consumer email clears the requirement, even alongside a company email", () => {
    // The page seeds reply_email from the account; company_contact_email stays independent.
    const parts = completeExceptEmail({
      reply_email: "signed-in-user@example.com",
      company_contact_email: "support@merchant.com",
    });

    expect(getPreviewBasicsMissing(parts)).not.toContain("your email");
    expect(hasCapturedConsumerEmail(parts)).toBe(true);
  });

  it("still blocks preview when no consumer email is captured", () => {
    const missing = getPreviewBasicsMissing(completeExceptEmail());
    expect(missing).toContain("your email");
    expect(stillNeededBeforePreviewMessage(missing)).toBe(
      "Still needed before preview: your email."
    );
  });

  it("still blocks preview for an invalid consumer email; a company email cannot rescue it", () => {
    expect(hasCapturedConsumerEmail(completeExceptEmail({ reply_email: "no-at-sign" }))).toBe(false);
    expect(
      getPreviewBasicsMissing(
        completeExceptEmail({ reply_email: "no-at-sign", company_contact_email: "support@merchant.com" })
      )
    ).toContain("your email");
  });

  it("company contact email persists independently through the case/session/server round-trip", () => {
    const parts = completeExceptEmail({
      reply_email: "consumer@example.com",
      company_contact_email: "  Support@Merchant.COM ",
    });

    // parts → JusticeIntake (persisted) → parts (re-hydrated in chat)
    const intake = buildJusticeIntakeFromParts(parts);
    expect(intake.company_contact_email).toBe("support@merchant.com");
    expect(intake.reply_email).toBe("consumer@example.com");

    const rehydrated = justiceIntakeToBuildJusticeIntakeParts(intake);
    expect(rehydrated.company_contact_email).toBe("support@merchant.com");
    expect(rehydrated.reply_email).toBe("consumer@example.com");
    expect(getPreviewBasicsMissing(rehydrated)).not.toContain("your email");
  });

  it("neither field overwrites the other on the round-trip", () => {
    // Only a company email present: consumer email stays empty (requirement still blocks).
    const companyOnly = justiceIntakeToBuildJusticeIntakeParts(
      buildJusticeIntakeFromParts(completeExceptEmail({ company_contact_email: "support@merchant.com" }))
    );
    expect(companyOnly.reply_email).toBe("");
    expect(companyOnly.company_contact_email).toBe("support@merchant.com");
    expect(getPreviewBasicsMissing(companyOnly)).toContain("your email");

    // Only a consumer email present: company email stays empty.
    const consumerOnly = justiceIntakeToBuildJusticeIntakeParts(
      buildJusticeIntakeFromParts(completeExceptEmail({ reply_email: "consumer@example.com" }))
    );
    expect(consumerOnly.company_contact_email).toBe("");
    expect(consumerOnly.reply_email).toBe("consumer@example.com");
    expect(getPreviewBasicsMissing(consumerOnly)).not.toContain("your email");
  });

  it("existing company-contact-email normalization behavior remains intact", () => {
    // Valid address is normalized (lowercased) and persisted.
    const intakeValid = buildJusticeIntakeFromParts(
      completeExceptEmail({ reply_email: "consumer@example.com", company_contact_email: "Support@Example.com" })
    );
    expect(intakeValid.company_contact_email).toBe("support@example.com");

    // Invalid address is dropped entirely (operator/manual fallback), never persisted.
    const intakeInvalid = buildJusticeIntakeFromParts(
      completeExceptEmail({ reply_email: "consumer@example.com", company_contact_email: "garbage" })
    );
    expect(intakeInvalid.company_contact_email).toBeUndefined();

    // Skip sentinels are dropped too.
    const intakeSkip = buildJusticeIntakeFromParts(
      completeExceptEmail({ reply_email: "consumer@example.com", company_contact_email: "unknown" })
    );
    expect(intakeSkip.company_contact_email).toBeUndefined();
  });
});
