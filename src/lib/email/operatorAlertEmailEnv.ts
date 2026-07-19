import { isValidMerchantOutreachEmailAddress } from "@/lib/email/merchantOutreachEmailEnv";

/**
 * Recipient for proactive operator fallback alerts.
 * Returns null (fail-safe, no alert delivered) when OPERATOR_ALERT_EMAIL is unset or invalid.
 */
export function resolveOperatorAlertEmail(): string | null {
  const candidate = process.env.OPERATOR_ALERT_EMAIL?.trim() ?? "";
  if (!candidate || !isValidMerchantOutreachEmailAddress(candidate)) return null;
  return candidate.toLowerCase();
}
