/** Explicit opt-in env value to re-enable the parked real FTC browser autofill harness. */
export const REAL_FTC_AUTOFILL_ENABLED_ENV_VALUE = "true";

/** Explicit opt-out env value (same effect as unset — operator fulfillment stays primary). */
export const REAL_FTC_AUTOFILL_DISABLED_ENV_VALUE = "false";

/**
 * User-facing error when a caller tries to run the browser autofill harness while it is parked.
 * Operator fulfillment is the durable product path; this message is for harness/API callers only.
 */
export const REAL_FTC_AUTOFILL_DISABLED_ERROR =
  "Real FTC browser autofill is parked pending a genuine live canary. Surrenderless operators fulfill FTC filings for you in chat. Set NEXT_PUBLIC_JUSTICE_REAL_FTC_AUTOFILL_ENABLED=true only for controlled harness, dry-run, or future canary work.";

/**
 * True only when the bounded FTC browser autofill harness is explicitly re-enabled.
 *
 * Product default is OFF: FTC complaint filing is fulfilled by Surrenderless operators
 * (`isRealFtcOperatorFulfillmentPrimary`). Set NEXT_PUBLIC_JUSTICE_REAL_FTC_AUTOFILL_ENABLED=true
 * only for controlled dry-runs / future live canary. Does not delete the harness.
 */
export function isRealFtcComplaintAutofillEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_JUSTICE_REAL_FTC_AUTOFILL_ENABLED?.trim().toLowerCase();
  return flag === REAL_FTC_AUTOFILL_ENABLED_ENV_VALUE;
}

/**
 * Code-level primary mode for real FTC: operator fulfillment via the existing workspace queue.
 * True whenever the browser autofill harness is not explicitly opted in.
 */
export function isRealFtcOperatorFulfillmentPrimary(): boolean {
  return !isRealFtcComplaintAutofillEnabled();
}
