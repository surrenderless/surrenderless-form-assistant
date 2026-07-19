/**
 * Fail-closed live-submission arming for owned BBB/FTC Browserless filing.
 * Server-only: never expose via NEXT_PUBLIC_*.
 *
 * When unset/false, the scheduled worker must not claim or submit live tasks.
 * Dry-run verification uses a separate CRON_SECRET endpoint and never requires arming.
 */

const ARMED_VALUES = new Set(["1", "true", "yes", "on"]);

/** Production-critical live submit arm. Default off (fail closed). */
export function isOwnedFilingSubmitArmed(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env.OWNED_FILING_SUBMIT_ARMED?.trim().toLowerCase() ?? "";
  return ARMED_VALUES.has(raw);
}

export const OWNED_FILING_SUBMIT_UNARMED_REASON =
  "OWNED_FILING_SUBMIT_ARMED is not enabled — live claim/submit refused (fail closed)";
