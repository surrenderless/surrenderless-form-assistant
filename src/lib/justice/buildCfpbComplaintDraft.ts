import { cfpbLikelyRelevant } from "@/lib/justice/rules";
import type { JusticeIntake } from "@/lib/justice/types";

/** Matches merchant CFPB branch — financial resolution, not refund/replacement retail wording. */
export const CFPB_PREP_RESOLUTION_TEXT =
  "I am requesting that you review the issue, correct any account error, refund or credit any improper charge, and provide written confirmation.";

export function cfpbFinancialProductSummary(intake: JusticeIntake): string {
  const s = intake.purchase_or_signup.trim();
  return s || "financial product, account, or billing issue";
}

export function cfpbDesiredResolutionPhrase(category: JusticeIntake["problem_category"]): string {
  switch (category) {
    case "online_purchase":
      return "A full refund or a correct replacement, whichever fairly applies.";
    case "subscription":
      return "Cancellation of unwanted recurring charges and any refund owed for improper renewals.";
    case "service_failed":
      return "A remedy that matches what was promised (refund, redo, or credit).";
    case "charge_dispute":
      return "Reversal of the charge or a clear written justification.";
    case "something_else":
      return "A fair resolution that puts me back to where I should have been.";
    default:
      return "A fair resolution that puts me back to where I should have been.";
  }
}

export function buildCfpbComplaintDraft(intake: JusticeIntake): string {
  const cfpbRel = cfpbLikelyRelevant(intake);
  const issue = intake.problem_category.replace(/_/g, " ");
  const ask = cfpbRel ? CFPB_PREP_RESOLUTION_TEXT : cfpbDesiredResolutionPhrase(intake.problem_category);

  const lines: string[] = [
    "DRAFT FOR CFPB COMPLAINT",
    "(Copy and paste into the official Consumer Financial Protection Bureau complaint flow — this app does not submit for you.)",
    "",
    `Company or provider: ${intake.company_name}`,
    intake.company_website.trim() ? `Website: ${intake.company_website.trim()}` : "",
    "",
  ];

  if (cfpbRel) {
    const fpLine = cfpbFinancialProductSummary(intake);
    lines.push(
      "Nature of complaint:",
      "Financial product, billing, or account matter",
      "",
      "Financial product or service:",
      fpLine,
      "",
      "What happened:",
      intake.story.trim(),
      "",
      `Approximate amount involved (if any): ${intake.money_involved}`,
      `Problem date / start date: ${intake.pay_or_order_date}`,
      "",
      intake.order_confirmation_details.trim()
        ? `Confirmation / reference details: ${intake.order_confirmation_details.trim()}`
        : "",
      "",
      "Resolution I am seeking:",
      ask,
      "",
      "My contact:",
      `${intake.user_display_name} <${intake.reply_email}>`
    );
  } else {
    lines.push(
      "Type of issue (from my intake):",
      issue,
      "",
      "Product or service:",
      intake.purchase_or_signup,
      "",
      "What happened:",
      intake.story.trim(),
      "",
      `Approximate amount involved: ${intake.money_involved}`,
      `Order or transaction date: ${intake.pay_or_order_date}`,
      "",
      intake.order_confirmation_details.trim()
        ? `Confirmation / reference details: ${intake.order_confirmation_details.trim()}`
        : "",
      "",
      "Resolution I am seeking:",
      ask,
      "",
      "My contact:",
      `${intake.user_display_name} <${intake.reply_email}>`
    );
  }

  if (intake.already_contacted === "yes" && intake.contact_method) {
    lines.push(
      "",
      "Prior contact with the company:",
      `Method: ${intake.contact_method}`,
      intake.contact_date ? `Date: ${intake.contact_date}` : "",
      intake.merchant_response_type
        ? `Their response (as I understand it): ${intake.merchant_response_type.replace(/_/g, " ")}`
        : "",
      intake.contact_proof_text?.trim()
        ? intake.contact_proof_type === "none"
          ? `Contact attempt notes: ${intake.contact_proof_text.trim()}`
          : intake.contact_proof_type === "ticket"
            ? `Ticket/case number: ${intake.contact_proof_text.trim()}`
            : `Notes on proof: ${intake.contact_proof_text.trim()}`
        : ""
    );
  }

  return lines.filter(Boolean).join("\n").trim();
}
