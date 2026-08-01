import { describe, expect, it } from "vitest";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { cfpbPrepDocumentedFromIntake, cfpbPrepUnlockedFromIntake } from "@/lib/justice/rules";

const REQUIRED_PARTS = {
  ...defaultBuildJusticeIntakeParts(),
  company_name: "North Bank",
  purchase_or_signup: "checking account",
  story: "Unauthorized charge on my checking account",
  reply_email: "user@example.com",
  already_contacted: "yes" as const,
  contact_method: "email" as const,
  contact_date: "2026-03-05",
  merchant_response_type: "refused_help" as const,
};

function contactedIntake(overrides: Record<string, unknown> = {}) {
  return buildJusticeIntakeFromParts({ ...REQUIRED_PARTS, ...overrides });
}

describe("cfpbPrepDocumentedFromIntake per proof-type requirement", () => {
  it("requires non-blank contact_proof_text for 'none'", () => {
    expect(
      cfpbPrepDocumentedFromIntake(
        contactedIntake({ contact_proof_type: "none", contact_proof_text: "" })
      )
    ).toBe(false);
    expect(
      cfpbPrepDocumentedFromIntake(
        contactedIntake({ contact_proof_type: "none", contact_proof_text: "They said no over the phone." })
      )
    ).toBe(true);
  });

  it("requires non-blank contact_proof_text for 'ticket'", () => {
    expect(
      cfpbPrepDocumentedFromIntake(
        contactedIntake({ contact_proof_type: "ticket", contact_proof_text: "" })
      )
    ).toBe(false);
    expect(
      cfpbPrepDocumentedFromIntake(
        contactedIntake({ contact_proof_type: "ticket", contact_proof_text: "Case #12345" })
      )
    ).toBe(true);
  });

  it("requires non-blank contact_proof_text for 'paste' (previously unchecked)", () => {
    expect(
      cfpbPrepDocumentedFromIntake(
        contactedIntake({ contact_proof_type: "paste", contact_proof_text: "" })
      )
    ).toBe(false);
    expect(
      cfpbPrepDocumentedFromIntake(
        contactedIntake({ contact_proof_type: "paste", contact_proof_text: "Pasted email thread here." })
      )
    ).toBe(true);
  });

  it("requires hasUploadedEvidenceFile for 'upload', ignoring any contact_proof_text", () => {
    const intake = contactedIntake({
      contact_proof_type: "upload",
      contact_proof_text: "I definitely uploaded something, trust me",
    });
    expect(cfpbPrepDocumentedFromIntake(intake, false)).toBe(false);
    expect(cfpbPrepDocumentedFromIntake(intake, true)).toBe(true);
  });

  it("requires hasUploadedEvidenceFile for 'screenshot'", () => {
    const intake = contactedIntake({ contact_proof_type: "screenshot" });
    expect(cfpbPrepDocumentedFromIntake(intake, false)).toBe(false);
    expect(cfpbPrepDocumentedFromIntake(intake, true)).toBe(true);
  });

  it("defaults hasUploadedEvidenceFile to false when omitted", () => {
    const intake = contactedIntake({ contact_proof_type: "upload" });
    expect(cfpbPrepDocumentedFromIntake(intake)).toBe(false);
  });

  it("fails closed for an unrecognized proof type", () => {
    const intake = {
      ...contactedIntake({ contact_proof_type: "none", contact_proof_text: "x" }),
      contact_proof_type: "carrier_pigeon" as never,
    };
    expect(cfpbPrepDocumentedFromIntake(intake, true)).toBe(false);
  });

  it("requires already_contacted, contact_method, a valid date, and merchant_response_type regardless of proof type", () => {
    expect(
      cfpbPrepDocumentedFromIntake(
        contactedIntake({
          already_contacted: "no",
          contact_proof_type: "upload",
        }),
        true
      )
    ).toBe(false);
    expect(
      cfpbPrepDocumentedFromIntake(
        contactedIntake({ contact_date: "not-a-date", contact_proof_type: "upload" }),
        true
      )
    ).toBe(false);
  });
});

describe("cfpbPrepUnlockedFromIntake", () => {
  it("bypasses proof requirements entirely when manualEscalate is true", () => {
    const intake = contactedIntake({ contact_proof_type: "upload" });
    expect(cfpbPrepUnlockedFromIntake(intake, true, false)).toBe(true);
  });

  it("falls through to cfpbPrepDocumentedFromIntake when manualEscalate is false", () => {
    const intake = contactedIntake({ contact_proof_type: "upload" });
    expect(cfpbPrepUnlockedFromIntake(intake, false, false)).toBe(false);
    expect(cfpbPrepUnlockedFromIntake(intake, false, true)).toBe(true);
  });
});
