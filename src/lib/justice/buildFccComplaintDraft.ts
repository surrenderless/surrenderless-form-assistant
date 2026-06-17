import { fccLikelyRelevant } from "@/lib/justice/rules";
import type { JusticeIntake } from "@/lib/justice/types";

export function fccDesiredResolutionPhrase(category: JusticeIntake["problem_category"]): string {
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

/** For FCC-style framing: headline segment and draft labels (not raw intake problem_category). */
export function fccServiceSummarySegment(intake: JusticeIntake): string {
  const svc = intake.purchase_or_signup.trim();
  return svc || "communications service issue";
}

export function buildFccComplaintDraft(intake: JusticeIntake): string {
  const fccRel = fccLikelyRelevant(intake);
  const intakeCategoryLabel = intake.problem_category.replace(/_/g, " ");
  const serviceSummary = fccServiceSummarySegment(intake);
  const ask = fccDesiredResolutionPhrase(intake.problem_category);
  const lines: string[] = [
    "DRAFT FOR FCC CONSUMER COMPLAINT",
    "(Copy and paste into the official FCC consumer complaint flow — this app does not submit for you.)",
    "",
    `Company or provider: ${intake.company_name}`,
    intake.company_website.trim() ? `Website: ${intake.company_website.trim()}` : "",
    "",
  ];

  if (fccRel) {
    lines.push(
      "Nature of complaint:",
      "Communications service issue",
      "",
      "Service or product involved:",
      serviceSummary,
      ""
    );
  } else {
    lines.push(
      "Type of issue (from my intake):",
      intakeCategoryLabel,
      "",
      "Service or product:",
      intake.purchase_or_signup,
      ""
    );
  }

  lines.push(
    "What happened:",
    intake.story.trim(),
    "",
    `Approximate amount involved (if any): ${intake.money_involved}`,
    `Problem date / start date: ${intake.pay_or_order_date}`,
    "",
    intake.order_confirmation_details.trim()
      ? `Account / confirmation details: ${intake.order_confirmation_details.trim()}`
      : "",
    "",
    "Outcome I am seeking:",
    ask,
    "",
    "My contact:",
    `${intake.user_display_name} <${intake.reply_email}>`
  );

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
        ? `Notes on proof: ${intake.contact_proof_text.trim()}`
        : ""
    );
  }

  return lines.filter(Boolean).join("\n").trim();
}
