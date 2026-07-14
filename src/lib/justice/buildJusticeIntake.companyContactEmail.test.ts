import { describe, expect, it } from "vitest";
import {
  buildJusticeIntakeFromParts,
  defaultBuildJusticeIntakeParts,
  justiceIntakeToBuildJusticeIntakeParts,
} from "@/lib/justice/buildJusticeIntake";

describe("buildJusticeIntake company_contact_email", () => {
  it("persists valid company_contact_email onto JusticeIntake", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      company_name: "Acme Retail",
      purchase_or_signup: "widget",
      story: "Never arrived",
      reply_email: "user@example.com",
      company_contact_email: "Support@Acme.Example",
    });
    expect(intake.company_contact_email).toBe("support@acme.example");
  });

  it("omits company_contact_email when missing or invalid (operator fallback)", () => {
    const missing = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      company_name: "Acme",
      purchase_or_signup: "x",
      story: "y",
      reply_email: "user@example.com",
      company_contact_email: "",
    });
    expect(missing.company_contact_email).toBeUndefined();

    const invalid = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      company_name: "Acme",
      purchase_or_signup: "x",
      story: "y",
      reply_email: "user@example.com",
      company_contact_email: "not-an-email",
    });
    expect(invalid.company_contact_email).toBeUndefined();
  });

  it("round-trips company_contact_email through hydrate parts", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      company_name: "Acme",
      purchase_or_signup: "widget",
      story: "story",
      reply_email: "user@example.com",
      company_contact_email: "support@acme.example",
    });
    const parts = justiceIntakeToBuildJusticeIntakeParts(intake);
    expect(parts.company_contact_email).toBe("support@acme.example");
    expect(buildJusticeIntakeFromParts(parts).company_contact_email).toBe("support@acme.example");
  });
});
