/**
 * Fail-closed live-submission arming for owned BBB/FTC Browserless filing.
 * Server-only: never expose via NEXT_PUBLIC_*.
 *
 * When unset/false, the scheduled worker must not claim or submit live tasks.
 * Dry-run verification uses a separate CRON_SECRET endpoint and never requires arming.
 *
 * When armed, live claim/execute also requires OWNED_FILING_LIVE_CASE_ALLOWLIST
 * (comma-separated case UUIDs). Empty/unset allowlist while armed → claim nothing.
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

export const OWNED_FILING_LIVE_CASE_NOT_ALLOWLISTED_REASON =
  "case_id is not in OWNED_FILING_LIVE_CASE_ALLOWLIST — live claim/submit refused (fail closed)";

export const OWNED_FILING_LIVE_CASE_ALLOWLIST_EMPTY_REASON =
  "OWNED_FILING_LIVE_CASE_ALLOWLIST is empty while armed — live claim refused (fail closed)";

/**
 * Parses OWNED_FILING_LIVE_CASE_ALLOWLIST into a set of trimmed case ids.
 * Empty/unset → empty set (fail closed while armed). Never reads NEXT_PUBLIC_*.
 */
export function parseOwnedFilingLiveCaseAllowlist(
  env: Record<string, string | undefined> = process.env
): ReadonlySet<string> {
  const raw = env.OWNED_FILING_LIVE_CASE_ALLOWLIST?.trim() ?? "";
  if (!raw) return new Set();
  const ids = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id) ids.add(id);
  }
  return ids;
}

/** True when caseId is explicitly listed for live owned-filing claim/execute. */
export function isOwnedFilingLiveCaseAllowlisted(
  caseId: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  const trimmed = caseId.trim();
  if (!trimmed) return false;
  return parseOwnedFilingLiveCaseAllowlist(env).has(trimmed);
}
