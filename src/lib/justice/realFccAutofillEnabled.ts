/** Explicit opt-in env value to enable the not-yet-built real FCC browser autofill harness. */
export const REAL_FCC_AUTOFILL_ENABLED_ENV_VALUE = "true";

/** Explicit opt-out env value (same effect as unset — operator fulfillment stays primary). */
export const REAL_FCC_AUTOFILL_DISABLED_ENV_VALUE = "false";

/**
 * User-facing error when a caller tries to run the FCC browser autofill harness while it is
 * disabled or unimplemented. Operator fulfillment is the durable product path; this message is
 * for harness/API callers only.
 */
export const REAL_FCC_AUTOFILL_DISABLED_ERROR =
  "Real FCC browser autofill is not enabled. Surrenderless operators fulfill FCC filings for you in chat. Set NEXT_PUBLIC_JUSTICE_REAL_FCC_AUTOFILL_ENABLED=true only for controlled harness or dry-run scaffolding work.";

/**
 * True only when the (not-yet-built) FCC browser autofill harness is explicitly enabled.
 *
 * Product default is OFF: FCC complaint filing is fulfilled by Surrenderless operators
 * (`isRealFccOperatorFulfillmentPrimary`). Set NEXT_PUBLIC_JUSTICE_REAL_FCC_AUTOFILL_ENABLED=true
 * only for controlled dry-run scaffolding work — no real field-selector harness exists yet, so
 * enabling this flag alone does not grant real submission capability.
 */
export function isRealFccComplaintAutofillEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_JUSTICE_REAL_FCC_AUTOFILL_ENABLED?.trim().toLowerCase();
  return flag === REAL_FCC_AUTOFILL_ENABLED_ENV_VALUE;
}

/**
 * Code-level primary mode for FCC: operator fulfillment via the existing workspace queue.
 * True whenever the browser autofill harness is not explicitly opted in.
 */
export function isRealFccOperatorFulfillmentPrimary(): boolean {
  return !isRealFccComplaintAutofillEnabled();
}
