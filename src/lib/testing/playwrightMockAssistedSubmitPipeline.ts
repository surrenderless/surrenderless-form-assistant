import {
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
} from "@/lib/justice/assistedSubmissionLane";

const PLAYWRIGHT_MOCK_ASSISTED_SUBMISSION_PATHS = new Set<string>([
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath,
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.mockUrlPath,
]);

/** Enabled only when Playwright webServer sets PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE=1. */
export function isPlaywrightMockAssistedSubmitPipelineEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE !== "1") {
    return false;
  }
  // Never allow on deployed production, even if the env var is set.
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  return true;
}

function isLocalLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Playwright E2E only: allow mock FTC/BBB practice URLs on localhost / 127.0.0.1 when the
 * request origin is also loopback (localhost and 127.0.0.1 are treated as equivalent).
 */
export function isPlaywrightLocalMockAssistedSubmissionUrl(
  url: string,
  requestOrigin: string
): boolean {
  if (!isPlaywrightMockAssistedSubmitPipelineEnabled()) {
    return false;
  }

  try {
    const parsed = new URL(url.trim());
    const origin = new URL(requestOrigin.trim().replace(/\/$/, ""));

    if (!PLAYWRIGHT_MOCK_ASSISTED_SUBMISSION_PATHS.has(parsed.pathname)) {
      return false;
    }
    if (!isLocalLoopbackHostname(parsed.hostname) || !isLocalLoopbackHostname(origin.hostname)) {
      return false;
    }
    if (parsed.protocol !== origin.protocol || parsed.port !== origin.port) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function isPlaywrightMockAssistedSubmitUrl(url: string, requestOrigin: string): boolean {
  return isPlaywrightLocalMockAssistedSubmissionUrl(url, requestOrigin);
}

type AnalyzedField = {
  name?: string;
  id?: string;
};

const USER_DATA_ALIASES: Record<string, readonly string[]> = {
  company_name: ["company_name", "business_name"],
  company_website: ["company_website"],
  issue_type: ["issue_type"],
  complaint_description: ["complaint_description", "what_happened", "story"],
  incident_date: ["incident_date", "pay_or_order_date"],
  order_date: ["order_date", "pay_or_order_date"],
  contact_full_name: ["contact_full_name", "user_display_name", "name"],
  contact_email: ["contact_email", "email", "reply_email"],
  contact_phone: ["contact_phone", "phone"],
  contact_address_line1: ["contact_address_line1", "address"],
  contact_city: ["contact_city", "city"],
  contact_state: ["contact_state", "state", "consumer_us_state"],
  contact_zip: ["contact_zip", "zip"],
};

function readUserDataString(userData: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = userData[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** Deterministic match-fields output for mock FTC/BBB practice forms during Playwright E2E. */
export function buildPlaywrightMockMatchFieldInstructions(
  fields: AnalyzedField[],
  userData: Record<string, unknown>
): { selector: string; value: string }[] {
  const instructions: { selector: string; value: string }[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    const selector = field.name?.trim() || field.id?.trim();
    if (!selector || seen.has(selector)) continue;

    const aliasKeys = USER_DATA_ALIASES[selector] ?? [selector];
    const value = readUserDataString(userData, aliasKeys);
    if (!value) continue;

    seen.add(selector);
    instructions.push({ selector, value });
  }

  return instructions;
}

export function buildPlaywrightMockFillFormResult(pageData: unknown = null) {
  return {
    status: "success" as const,
    screenshot: null,
    pageData,
    storageSkipped: true,
    storageReason: "Playwright mock assisted submit pipeline (local E2E only)",
  };
}
