import { isValidMerchantOutreachEmailAddress } from "@/lib/email/merchantOutreachEmailEnv";
import type { BuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";

/**
 * The preview requirement is the consumer's OWN reply address (`reply_email`).
 *
 * `reply_email` is normally seeded from the signed-in account's verified email, and can
 * also be captured explicitly in chat when the account email is unavailable. Either way it
 * must be a syntactically valid address to clear the gate.
 *
 * `company_contact_email` is the merchant/company's address for outreach and is a SEPARATE
 * concern — it must never satisfy or populate this consumer-email requirement.
 */
export function hasCapturedConsumerEmail(parts: BuildJusticeIntakeParts): boolean {
  return isValidMerchantOutreachEmailAddress(parts.reply_email.trim());
}

/** Fields that still block the "review & preview" step, in display order. */
export function getPreviewBasicsMissing(parts: BuildJusticeIntakeParts): string[] {
  const missing: string[] = [];
  if (!parts.company_name.trim()) missing.push("company");
  if (!parts.purchase_or_signup.trim()) missing.push("product/service");
  if (!parts.story.trim()) missing.push("what happened");
  if (!hasCapturedConsumerEmail(parts)) missing.push("your email");
  if (!parts.money_amount.trim() && !parts.desired_resolution.trim()) missing.push("requested outcome");
  return missing;
}

export function stillNeededBeforePreviewMessage(missing: string[]): string {
  return `Still needed before preview: ${missing.join(", ")}.`;
}
