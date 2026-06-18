import type { JusticeIntake } from "@/lib/justice/types";

export function bbbDesiredResolutionPhrase(category: JusticeIntake["problem_category"]): string {
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

export function buildBbbComplaintDraft(intake: JusticeIntake): string {
  const issue = intake.problem_category.replace(/_/g, " ");
  const ask = bbbDesiredResolutionPhrase(intake.problem_category);
  const lines: string[] = [
    "DRAFT FOR BBB COMPLAINT (copy and paste into BBB.org — this app does not submit for you)",
    "",
    `Business: ${intake.company_name}`,
    intake.company_website.trim() ? `Website: ${intake.company_website.trim()}` : "",
    "",
    "Issue type:",
    issue,
    "",
    "Product/service:",
    intake.purchase_or_signup,
    "",
    "What happened:",
    intake.story.trim(),
    "",
    `Approximate amount involved: ${intake.money_involved}`,
    `Order or payment date: ${intake.pay_or_order_date}`,
    "",
    intake.order_confirmation_details.trim()
      ? `Order / confirmation details: ${intake.order_confirmation_details.trim()}`
      : "",
    "",
    "Desired resolution:",
    ask,
    "",
    "My contact:",
    `${intake.user_display_name} <${intake.reply_email}>`,
  ];

  if (intake.already_contacted === "yes" && intake.contact_method) {
    lines.push(
      "",
      "Prior contact with business:",
      `Method: ${intake.contact_method}`,
      intake.contact_date ? `Date: ${intake.contact_date}` : "",
      intake.merchant_response_type
        ? `Their response (as I understand it): ${intake.merchant_response_type.replace(/_/g, " ")}`
        : "",
      intake.contact_proof_text?.trim()
        ? `Proof notes: ${intake.contact_proof_text.trim()}`
        : ""
    );
  }

  return lines.filter(Boolean).join("\n").trim();
}
