import { isValidMerchantOutreachEmailAddress } from "@/lib/email/merchantOutreachEmailEnv";

/**
 * Normalize optional `JusticeIntake.company_contact_email` for intake and chat flows.
 * Empty / skip sentinels → "". Invalid addresses → "" (operator/manual fallback).
 * Valid addresses return lowercased trim.
 */
export function normalizeCompanyContactEmail(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (
    lower === "none" ||
    lower === "n/a" ||
    lower === "na" ||
    lower === "-" ||
    lower === "no" ||
    lower === "unknown" ||
    lower === "skip" ||
    lower === "don't know" ||
    lower === "dont know" ||
    lower === "i don't know" ||
    lower === "i dont know"
  ) {
    return "";
  }
  if (!isValidMerchantOutreachEmailAddress(t)) return "";
  return t.toLowerCase();
}
