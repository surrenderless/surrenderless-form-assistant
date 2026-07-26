import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRealFtcComplaintAutofillEnabled,
  isRealFtcOperatorFulfillmentPrimary,
  REAL_FTC_AUTOFILL_DISABLED_ENV_VALUE,
  REAL_FTC_AUTOFILL_DISABLED_ERROR,
  REAL_FTC_AUTOFILL_ENABLED_ENV_VALUE,
} from "@/lib/justice/realFtcAutofillEnabled";

describe("realFtcAutofillEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parks autofill by default so operator fulfillment is primary when env is unset", () => {
    expect(isRealFtcComplaintAutofillEnabled()).toBe(false);
    expect(isRealFtcOperatorFulfillmentPrimary()).toBe(true);
  });

  it("re-enables the harness only when env is explicitly true", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_FTC_AUTOFILL_ENABLED", REAL_FTC_AUTOFILL_ENABLED_ENV_VALUE);
    expect(isRealFtcComplaintAutofillEnabled()).toBe(true);
    expect(isRealFtcOperatorFulfillmentPrimary()).toBe(false);
  });

  it("keeps operator primary when env is explicitly false", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_FTC_AUTOFILL_ENABLED", REAL_FTC_AUTOFILL_DISABLED_ENV_VALUE);
    expect(isRealFtcComplaintAutofillEnabled()).toBe(false);
    expect(isRealFtcOperatorFulfillmentPrimary()).toBe(true);
  });

  it("exports a stable parked-harness error message for callers", () => {
    expect(REAL_FTC_AUTOFILL_DISABLED_ERROR).toMatch(/parked/i);
    expect(REAL_FTC_AUTOFILL_DISABLED_ERROR).toMatch(/operator/i);
  });
});
