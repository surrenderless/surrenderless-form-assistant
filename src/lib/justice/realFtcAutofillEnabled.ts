/** Explicit opt-out env value for real FTC autofill in production. */
export const REAL_FTC_AUTOFILL_DISABLED_ENV_VALUE = "false";

/** User-facing error when real FTC autofill is explicitly disabled. */
export const REAL_FTC_AUTOFILL_DISABLED_ERROR =
  "Real FTC autofill is not enabled in this environment. Use the copy-draft prep below or contact support if you need help filing.";

/**
 * True when chat may run assisted autofill against the official FTC ReportFraud flow.
 * Enabled by default; set NEXT_PUBLIC_JUSTICE_REAL_FTC_AUTOFILL_ENABLED=false to disable.
 */
export function isRealFtcComplaintAutofillEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_JUSTICE_REAL_FTC_AUTOFILL_ENABLED?.trim().toLowerCase();
  if (flag === REAL_FTC_AUTOFILL_DISABLED_ENV_VALUE) {
    return false;
  }
  return true;
}
