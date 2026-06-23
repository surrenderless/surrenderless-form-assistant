import {
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
  REAL_BBB_COMPLAINT_SUBMISSION_URL,
} from "@/lib/justice/assistedSubmissionLane";
import { isRealBbbComplaintAutofillEnabled } from "@/lib/justice/realBbbAutofillEnabled";

export const ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR =
  "This submission URL is not allowed for assisted form fill.";

const MOCK_ASSISTED_SUBMISSION_PATHS = new Set<string>([
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath,
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath,
]);

export type AssistedSubmissionUrlPolicyResult =
  | { allowed: true }
  | { allowed: false; error: string };

function normalizeRequestOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, "");
}

/** True when url is a same-origin mock FTC or BBB practice submission page. */
export function isSameOriginMockAssistedSubmissionUrl(url: string, requestOrigin: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (parsed.origin !== normalizeRequestOrigin(requestOrigin)) {
      return false;
    }
    return MOCK_ASSISTED_SUBMISSION_PATHS.has(parsed.pathname);
  } catch {
    return false;
  }
}

/** True when url is exactly the configured real BBB submission URL and autofill is enabled. */
export function isAllowedExternalAssistedSubmissionUrl(url: string): boolean {
  if (!isRealBbbComplaintAutofillEnabled()) {
    return false;
  }
  try {
    const parsed = new URL(url.trim());
    const allowed = new URL(REAL_BBB_COMPLAINT_SUBMISSION_URL);
    return parsed.origin === allowed.origin && parsed.pathname === allowed.pathname;
  } catch {
    return false;
  }
}

/** Server-side assisted-submission URL policy for `/api/submit-form`. */
export function evaluateAssistedSubmissionUrlPolicy(
  url: unknown,
  requestOrigin: string
): AssistedSubmissionUrlPolicyResult {
  if (typeof url !== "string" || !url.trim()) {
    return { allowed: false, error: "Missing url" };
  }

  const trimmed = url.trim();
  if (isSameOriginMockAssistedSubmissionUrl(trimmed, requestOrigin)) {
    return { allowed: true };
  }
  if (isAllowedExternalAssistedSubmissionUrl(trimmed)) {
    return { allowed: true };
  }

  return { allowed: false, error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR };
}
