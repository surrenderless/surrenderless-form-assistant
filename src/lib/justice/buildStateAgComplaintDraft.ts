import type { JusticeIntake } from "@/lib/justice/types";

export const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

export function stateNameFromCode(code: string | undefined): string {
  if (!code?.trim()) return "(not selected — choose your state above)";
  const u = code.trim().toUpperCase();
  return US_STATES.find((s) => s.code === u)?.name ?? u;
}

export function stateAgDesiredResolutionPhrase(category: JusticeIntake["problem_category"]): string {
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

export function buildStateAgComplaintDraft(intake: JusticeIntake): string {
  const issue = intake.problem_category.replace(/_/g, " ");
  const ask = stateAgDesiredResolutionPhrase(intake.problem_category);
  const stateLine = intake.consumer_us_state?.trim()
    ? `I am a consumer seeking help in ${stateNameFromCode(intake.consumer_us_state)} (${intake.consumer_us_state.trim().toUpperCase()}).`
    : "STATE NOT YET SELECTED — choose your state on the full State AG prep page before filing.";

  const lines: string[] = [
    "DRAFT FOR STATE ATTORNEY GENERAL / STATE CONSUMER COMPLAINT",
    "(Copy and paste into the correct official state portal — this app does not submit for you.)",
    "",
    stateLine,
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

  lines.push(
    "",
    "Next step: open your state Attorney General or consumer protection office’s official complaint site for the state above and follow their instructions."
  );

  return lines.filter(Boolean).join("\n").trim();
}
