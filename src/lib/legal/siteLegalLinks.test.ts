import { describe, expect, it } from "vitest";
import {
  LEGAL_ENTITY_NAME,
  NO_GUARANTEE_DISCLAIMER,
  NOT_LEGAL_ADVICE_DISCLAIMER,
  PRIVACY_POLICY_PATH,
  SUPPORT_EMAIL,
  TERMS_OF_SERVICE_PATH,
} from "@/lib/legal/siteLegalLinks";

describe("siteLegalLinks", () => {
  it("exports stable legal page paths", () => {
    expect(PRIVACY_POLICY_PATH).toBe("/privacy");
    expect(TERMS_OF_SERVICE_PATH).toBe("/terms");
  });

  it("includes core product disclaimers used on legal pages", () => {
    expect(NOT_LEGAL_ADVICE_DISCLAIMER.length).toBeGreaterThan(10);
    expect(NO_GUARANTEE_DISCLAIMER.length).toBeGreaterThan(10);
  });

  it("names the operating entity and a valid support email", () => {
    expect(LEGAL_ENTITY_NAME).toBe("Surrenderless LLC");
    expect(SUPPORT_EMAIL).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });
});
