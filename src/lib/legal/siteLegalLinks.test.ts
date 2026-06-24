import { describe, expect, it } from "vitest";
import {
  NO_AUTOMATED_FILING_DEFAULT_DISCLAIMER,
  NO_GUARANTEE_DISCLAIMER,
  NOT_LEGAL_ADVICE_DISCLAIMER,
  PRIVACY_POLICY_PATH,
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
    expect(NO_AUTOMATED_FILING_DEFAULT_DISCLAIMER.length).toBeGreaterThan(10);
  });
});
