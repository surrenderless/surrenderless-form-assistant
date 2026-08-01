import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRealFccComplaintAutofillEnabled,
  isRealFccOperatorFulfillmentPrimary,
  REAL_FCC_AUTOFILL_DISABLED_ENV_VALUE,
  REAL_FCC_AUTOFILL_DISABLED_ERROR,
  REAL_FCC_AUTOFILL_ENABLED_ENV_VALUE,
} from "@/lib/justice/realFccAutofillEnabled";

describe("realFccAutofillEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays disabled by default so operator fulfillment is primary when env is unset", () => {
    expect(isRealFccComplaintAutofillEnabled()).toBe(false);
    expect(isRealFccOperatorFulfillmentPrimary()).toBe(true);
  });

  it("enables the harness flag only when env is explicitly true", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_FCC_AUTOFILL_ENABLED", REAL_FCC_AUTOFILL_ENABLED_ENV_VALUE);
    expect(isRealFccComplaintAutofillEnabled()).toBe(true);
    expect(isRealFccOperatorFulfillmentPrimary()).toBe(false);
  });

  it("keeps operator primary when env is explicitly false", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_FCC_AUTOFILL_ENABLED", REAL_FCC_AUTOFILL_DISABLED_ENV_VALUE);
    expect(isRealFccComplaintAutofillEnabled()).toBe(false);
    expect(isRealFccOperatorFulfillmentPrimary()).toBe(true);
  });

  it("exports a stable disabled-harness error message for callers", () => {
    expect(REAL_FCC_AUTOFILL_DISABLED_ERROR).toMatch(/not enabled/i);
    expect(REAL_FCC_AUTOFILL_DISABLED_ERROR).toMatch(/operator/i);
  });
});
