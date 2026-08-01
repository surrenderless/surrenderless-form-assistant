import { describe, expect, it } from "vitest";
import {
  validateMerchantContactDocumentation,
  type MerchantContactDocumentationInput,
} from "@/lib/justice/documentMerchantContact";

function baseInput(overrides: Partial<MerchantContactDocumentationInput> = {}): MerchantContactDocumentationInput {
  return {
    contactMethod: "email",
    contactDate: "2026-03-05",
    merchantResponseType: "refused_help",
    contactProofType: "none",
    contactProofText: "",
    ...overrides,
  };
}

describe("validateMerchantContactDocumentation proof-type alignment with the CFPB gate", () => {
  it("blocks 'none' without text (unchanged)", () => {
    const result = validateMerchantContactDocumentation(baseInput({ contactProofType: "none" }));
    expect(result.ok).toBe(false);
  });

  it("blocks 'ticket' without text (unchanged)", () => {
    const result = validateMerchantContactDocumentation(baseInput({ contactProofType: "ticket" }));
    expect(result.ok).toBe(false);
  });

  it("blocks 'paste' without text (previously allowed to save silently)", () => {
    const result = validateMerchantContactDocumentation(baseInput({ contactProofType: "paste" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.contactProofError).toMatch(/paste/i);
  });

  it("allows 'paste' with text", () => {
    const result = validateMerchantContactDocumentation(
      baseInput({ contactProofType: "paste", contactProofText: "Pasted the email here." })
    );
    expect(result.ok).toBe(true);
  });

  it("blocks 'upload' without a real uploaded evidence record, even with text present", () => {
    const result = validateMerchantContactDocumentation(
      baseInput({ contactProofType: "upload", contactProofText: "I uploaded a file, I promise" }),
      false
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.contactProofError).toMatch(/upload/i);
  });

  it("allows 'upload' once hasUploadedEvidenceFile is true, even with blank text", () => {
    const result = validateMerchantContactDocumentation(
      baseInput({ contactProofType: "upload", contactProofText: "" }),
      true
    );
    expect(result.ok).toBe(true);
  });

  it("blocks 'screenshot' without a real uploaded evidence record", () => {
    const result = validateMerchantContactDocumentation(
      baseInput({ contactProofType: "screenshot" }),
      false
    );
    expect(result.ok).toBe(false);
  });

  it("defaults hasUploadedEvidenceFile to false when omitted", () => {
    const result = validateMerchantContactDocumentation(baseInput({ contactProofType: "upload" }));
    expect(result.ok).toBe(false);
  });

  it("still requires a valid contact date regardless of proof type", () => {
    const result = validateMerchantContactDocumentation(
      baseInput({ contactDate: "", contactProofType: "upload" }),
      true
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.contactDateError).toBeTruthy();
  });
});
