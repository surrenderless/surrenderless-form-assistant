/**
 * Validated merchant outreach email environment.
 * Never hardcodes credentials; returns disabled when incomplete.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MerchantOutreachEmailEnv =
  | {
      enabled: true;
      apiKey: string;
      from: string;
    }
  | {
      enabled: false;
      reason: string;
    };

function trimEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function isValidMerchantOutreachEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 3 && trimmed.length <= 320 && EMAIL_RE.test(trimmed);
}

/**
 * Production email autopilot requires RESEND_API_KEY + MERCHANT_OUTREACH_FROM_EMAIL.
 * Set MERCHANT_OUTREACH_EMAIL_ENABLED=0 to force operator/manual fallback even when keys exist.
 */
export function resolveMerchantOutreachEmailEnv(): MerchantOutreachEmailEnv {
  const enabledRaw = trimEnv("MERCHANT_OUTREACH_EMAIL_ENABLED").toLowerCase();
  if (enabledRaw === "0" || enabledRaw === "false" || enabledRaw === "off") {
    return { enabled: false, reason: "MERCHANT_OUTREACH_EMAIL_ENABLED is off" };
  }

  const apiKey = trimEnv("RESEND_API_KEY");
  const from = trimEnv("MERCHANT_OUTREACH_FROM_EMAIL");

  if (!apiKey) {
    return { enabled: false, reason: "RESEND_API_KEY is not configured" };
  }
  if (!from || !isValidMerchantOutreachEmailAddress(from)) {
    return {
      enabled: false,
      reason: "MERCHANT_OUTREACH_FROM_EMAIL is missing or invalid",
    };
  }

  return { enabled: true, apiKey, from };
}

/** Playwright-only mock provider gate (never active when VERCEL_ENV=production). */
export function isPlaywrightMockMerchantOutreachEmailEnabled(): boolean {
  if (process.env.VERCEL_ENV === "production") return false;
  const flag = process.env.PLAYWRIGHT_MOCK_MERCHANT_OUTREACH_EMAIL?.trim();
  return flag === "1" || flag === "true";
}
