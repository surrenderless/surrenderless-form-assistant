/**
 * Validated payment-dispute outreach email environment.
 * Never hardcodes credentials; returns disabled when incomplete.
 */

import { isValidMerchantOutreachEmailAddress } from "@/lib/email/merchantOutreachEmailEnv";

export type PaymentDisputeOutreachEmailEnv =
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

/**
 * Production payment-dispute email autopilot requires RESEND_API_KEY and a verified from address.
 * Prefers PAYMENT_DISPUTE_OUTREACH_FROM_EMAIL; falls back to MERCHANT_OUTREACH_FROM_EMAIL.
 * Set PAYMENT_DISPUTE_OUTREACH_EMAIL_ENABLED=0 to force operator fallback even when keys exist.
 */
export function resolvePaymentDisputeOutreachEmailEnv(): PaymentDisputeOutreachEmailEnv {
  const enabledRaw = trimEnv("PAYMENT_DISPUTE_OUTREACH_EMAIL_ENABLED").toLowerCase();
  if (enabledRaw === "0" || enabledRaw === "false" || enabledRaw === "off") {
    return { enabled: false, reason: "PAYMENT_DISPUTE_OUTREACH_EMAIL_ENABLED is off" };
  }

  const apiKey = trimEnv("RESEND_API_KEY");
  const from =
    trimEnv("PAYMENT_DISPUTE_OUTREACH_FROM_EMAIL") || trimEnv("MERCHANT_OUTREACH_FROM_EMAIL");

  if (!apiKey) {
    return { enabled: false, reason: "RESEND_API_KEY is not configured" };
  }
  if (!from || !isValidMerchantOutreachEmailAddress(from)) {
    return {
      enabled: false,
      reason:
        "PAYMENT_DISPUTE_OUTREACH_FROM_EMAIL (or MERCHANT_OUTREACH_FROM_EMAIL) is missing or invalid",
    };
  }

  return { enabled: true, apiKey, from };
}

/** Playwright-only mock provider gate (never active when VERCEL_ENV=production). */
export function isPlaywrightMockPaymentDisputeOutreachEmailEnabled(): boolean {
  if (process.env.VERCEL_ENV === "production") return false;
  const flag = process.env.PLAYWRIGHT_MOCK_PAYMENT_DISPUTE_OUTREACH_EMAIL?.trim();
  return flag === "1" || flag === "true";
}
