import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRealBbbComplaintAutofillEnabled,
  REAL_BBB_AUTOFILL_DISABLED_ENV_VALUE,
  REAL_BBB_AUTOFILL_DISABLED_ERROR,
} from "@/lib/justice/realBbbAutofillEnabled";

describe("realBbbAutofillEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is enabled by default when env is unset", () => {
    expect(isRealBbbComplaintAutofillEnabled()).toBe(true);
  });

  it("is enabled when env is true", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    expect(isRealBbbComplaintAutofillEnabled()).toBe(true);
  });

  it("is disabled only when env is explicitly false", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", REAL_BBB_AUTOFILL_DISABLED_ENV_VALUE);
    expect(isRealBbbComplaintAutofillEnabled()).toBe(false);
  });

  it("exports a stable disabled error message for callers", () => {
    expect(REAL_BBB_AUTOFILL_DISABLED_ERROR).toMatch(/copy-draft prep/i);
  });
});
