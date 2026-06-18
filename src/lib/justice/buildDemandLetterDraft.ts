import type { JusticeIntake } from "@/lib/justice/types";

export function demandLetterDesiredResolutionPhrase(
  category: JusticeIntake["problem_category"]
): string {
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

export function buildDemandLetterDraft(intake: JusticeIntake): string {
  const issue = intake.problem_category.replace(/_/g, " ");
  const ask = demandLetterDesiredResolutionPhrase(intake.problem_category);
  const toLine = intake.company_name.trim() ? intake.company_name.trim() : "[Add company or person name]";
  const lines: string[] = [
    "DRAFT DEMAND LETTER — FOR YOUR REVIEW AND EDITING ONLY",
    "(This app does not send or file this letter. This is not legal advice.)",
    "",
    "Date: ________________________________  (add today’s date before sending)",
    "",
    `To: ${toLine}`,
    intake.company_website.trim() ? `Website on file: ${intake.company_website.trim()}` : "",
    "",
    "Subject: Request to resolve a consumer issue",
    "",
    "Dear Sir or Madam,",
    "",
    "I am writing to ask you to resolve an issue involving the following product or service:",
    intake.purchase_or_signup.trim() || "[Describe the product or service]",
    "",
    "Background (what happened):",
    intake.story.trim() || "[Add a clear, factual summary]",
    "",
    `Issue type (from my notes): ${issue}`,
    "",
    `Approximate amount involved: ${intake.money_involved}`,
    `Relevant date or order / payment date: ${intake.pay_or_order_date}`,
    "",
    intake.order_confirmation_details.trim()
      ? `Order or confirmation details: ${intake.order_confirmation_details.trim()}`
      : "",
    "",
    "What I am requesting:",
    ask,
    "",
  ];

  if (intake.already_contacted === "yes" && intake.contact_method) {
    lines.push(
      "Earlier contact:",
      `I previously contacted you by: ${intake.contact_method}`,
      intake.contact_date ? `Date: ${intake.contact_date}` : "",
      intake.merchant_response_type
        ? `Outcome as I understood it: ${intake.merchant_response_type.replace(/_/g, " ")}`
        : "",
      intake.contact_proof_text?.trim() ? `Additional notes: ${intake.contact_proof_text.trim()}` : "",
      ""
    );
  }

  lines.push(
    "If this is not resolved, I may consider available next steps, including consumer complaint options or small claims where appropriate.",
    "",
    "Please respond in writing so we can resolve this without further steps.",
    "",
    "Sincerely,",
    `${intake.user_display_name}`,
    intake.reply_email.trim() ? intake.reply_email.trim() : "",
    "",
    "---",
    "Reminder: Verify deadlines, court rules, dollar limits, service rules, and venue or jurisdiction with your local court or other official resources before taking any court-related step."
  );

  return lines.filter(Boolean).join("\n").trim();
}
