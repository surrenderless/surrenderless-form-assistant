/** Explicit opt-out env value for real BBB autofill in production. */
export const REAL_BBB_AUTOFILL_DISABLED_ENV_VALUE = "false";

/** User-facing error when real BBB autofill is explicitly disabled. */
export const REAL_BBB_AUTOFILL_DISABLED_ERROR =
  "Real BBB autofill is not enabled in this environment. Use the copy-draft prep below or contact support if you need help filing.";

/**
 * True when chat may run assisted autofill against the official BBB.org flow.
 * Enabled by default; set NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED=false to disable.
 */
export function isRealBbbComplaintAutofillEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED?.trim().toLowerCase();
  if (flag === REAL_BBB_AUTOFILL_DISABLED_ENV_VALUE) {
    return false;
  }
  return true;
}
