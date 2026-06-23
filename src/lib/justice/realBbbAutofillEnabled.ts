/** User-facing error when real BBB autofill is disabled (default). */
export const REAL_BBB_AUTOFILL_DISABLED_ERROR =
  "Real BBB autofill is not enabled in this environment. Use the copy-draft prep below or contact support if you need help filing.";

/** True when chat may run assisted autofill against the official BBB.org flow. */
export function isRealBbbComplaintAutofillEnabled(): boolean {
  return process.env.NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED === "true";
}
