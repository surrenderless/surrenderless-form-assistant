import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRealBbbComplaintAutofillEnabled,
  isRealBbbOperatorFulfillmentPrimary,
  REAL_BBB_AUTOFILL_DISABLED_ENV_VALUE,
  REAL_BBB_AUTOFILL_DISABLED_ERROR,
  REAL_BBB_AUTOFILL_ENABLED_ENV_VALUE,
} from "@/lib/justice/realBbbAutofillEnabled";

describe("realBbbAutofillEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parks autofill by default so operator fulfillment is primary when env is unset", () => {
    expect(isRealBbbComplaintAutofillEnabled()).toBe(false);
    expect(isRealBbbOperatorFulfillmentPrimary()).toBe(true);
  });

  it("re-enables the harness only when env is explicitly true", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", REAL_BBB_AUTOFILL_ENABLED_ENV_VALUE);
    expect(isRealBbbComplaintAutofillEnabled()).toBe(true);
    expect(isRealBbbOperatorFulfillmentPrimary()).toBe(false);
  });

  it("keeps operator primary when env is explicitly false", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", REAL_BBB_AUTOFILL_DISABLED_ENV_VALUE);
    expect(isRealBbbComplaintAutofillEnabled()).toBe(false);
    expect(isRealBbbOperatorFulfillmentPrimary()).toBe(true);
  });

  it("exports a stable parked-harness error message for callers", () => {
    expect(REAL_BBB_AUTOFILL_DISABLED_ERROR).toMatch(/parked/i);
    expect(REAL_BBB_AUTOFILL_DISABLED_ERROR).toMatch(/operator/i);
  });
});
