import { describe, expect, it } from "vitest";
import { normalizeCompanyContactEmail } from "@/lib/justice/normalizeCompanyContactEmail";

describe("normalizeCompanyContactEmail", () => {
  it("keeps and lowercases valid addresses", () => {
    expect(normalizeCompanyContactEmail("  Support@Acme.Example  ")).toBe("support@acme.example");
  });

  it("clears empty and skip sentinels", () => {
    expect(normalizeCompanyContactEmail("")).toBe("");
    expect(normalizeCompanyContactEmail("none")).toBe("");
    expect(normalizeCompanyContactEmail("N/A")).toBe("");
    expect(normalizeCompanyContactEmail("unknown")).toBe("");
    expect(normalizeCompanyContactEmail("don't know")).toBe("");
  });

  it("clears invalid addresses so operator fallback remains available", () => {
    expect(normalizeCompanyContactEmail("not-an-email")).toBe("");
    expect(normalizeCompanyContactEmail("missing-domain@")).toBe("");
  });
});
