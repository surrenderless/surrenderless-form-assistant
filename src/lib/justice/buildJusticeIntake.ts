import { normalizeCompanyWebsite } from "@/lib/justice/normalizeCompanyWebsite";
import type { JusticeIntake } from "@/lib/justice/types";

/** Collected chat-intake fields before merge into `JusticeIntake`. */
export type BuildJusticeIntakeParts = {
  problem_category: JusticeIntake["problem_category"];
  company_name: string;
  company_website: string;
  purchase_or_signup: string;
  story: string;
  money_amount: string;
  desired_resolution: string;
  pay_or_order_date: string;
  order_confirmation_details: string;
  user_display_name: string;
  reply_email: string;
  already_contacted: JusticeIntake["already_contacted"];
  contact_method: NonNullable<JusticeIntake["contact_method"]>;
  contact_date: string;
  merchant_response_type: NonNullable<JusticeIntake["merchant_response_type"]>;
  contact_proof_type: NonNullable<JusticeIntake["contact_proof_type"]>;
  contact_proof_text: string;
  consumer_us_state: string;
};

/**
 * Build a `JusticeIntake` from chat-style collected parts (scripted or future AI intake).
 * Matches legacy `/justice/chat` `buildIntake()` semantics.
 */
export function buildJusticeIntakeFromParts(parts: BuildJusticeIntakeParts): JusticeIntake {
  const moneyPart = parts.money_amount.trim();
  const resPart = parts.desired_resolution.trim();
  const money_involved =
    moneyPart && resPart ? `${moneyPart} — Desired outcome: ${resPart}` : moneyPart || resPart || "—";

  const intake: JusticeIntake = {
    problem_category: parts.problem_category,
    company_name: parts.company_name.trim(),
    company_website: normalizeCompanyWebsite(parts.company_website),
    purchase_or_signup: parts.purchase_or_signup.trim(),
    story: parts.story.trim(),
    money_involved,
    pay_or_order_date: parts.pay_or_order_date.trim(),
    order_confirmation_details: parts.order_confirmation_details.trim(),
    user_display_name: parts.user_display_name.trim(),
    reply_email: parts.reply_email.trim(),
    already_contacted: parts.already_contacted,
    ...(parts.already_contacted === "yes"
      ? {
          contact_method: parts.contact_method,
          contact_date: parts.contact_date.trim(),
          merchant_response_type: parts.merchant_response_type,
          contact_proof_type: parts.contact_proof_type,
          ...(parts.contact_proof_text.trim()
            ? { contact_proof_text: parts.contact_proof_text.trim() }
            : {}),
        }
      : {}),
  };

  const st = parts.consumer_us_state.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(st)) {
    intake.consumer_us_state = st;
  }

  return intake;
}
