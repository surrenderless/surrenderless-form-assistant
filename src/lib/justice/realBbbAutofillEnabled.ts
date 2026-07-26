/** Explicit opt-in env value to re-enable the parked real BBB browser autofill harness. */
export const REAL_BBB_AUTOFILL_ENABLED_ENV_VALUE = "true";

/** Explicit opt-out env value (same effect as unset — operator fulfillment stays primary). */
export const REAL_BBB_AUTOFILL_DISABLED_ENV_VALUE = "false";

/**
 * User-facing error when a caller tries to run the browser autofill harness while it is parked.
 * Operator fulfillment is the durable product path; this message is for harness/API callers only.
 */
export const REAL_BBB_AUTOFILL_DISABLED_ERROR =
  "Real BBB browser autofill is parked pending portal stability. Surrenderless operators fulfill BBB filings for you in chat. Set NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED=true only for controlled harness or dry-run work.";

/**
 * True only when the bounded BBB browser autofill harness is explicitly re-enabled.
 *
 * Product default is OFF: BBB complaint filing is fulfilled by Surrenderless operators
 * (`isRealBbbOperatorFulfillmentPrimary`). Set NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED=true
 * only for controlled dry-runs / portal-stability experiments. Does not delete the harness.
 */
export function isRealBbbComplaintAutofillEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED?.trim().toLowerCase();
  return flag === REAL_BBB_AUTOFILL_ENABLED_ENV_VALUE;
}

/**
 * Code-level primary mode for real BBB: operator fulfillment via the existing workspace queue.
 * True whenever the browser autofill harness is not explicitly opted in.
 */
export function isRealBbbOperatorFulfillmentPrimary(): boolean {
  return !isRealBbbComplaintAutofillEnabled();
}
