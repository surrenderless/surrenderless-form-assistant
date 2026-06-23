import { bbbDesiredResolutionPhrase } from "@/lib/justice/buildBbbComplaintDraft";
import type { JusticeIntake } from "@/lib/justice/types";

/** Maps intake to BBB-oriented semantic fields for real BBB.org assisted autofill. */
export function intakeToRealBbbUserData(intake: JusticeIntake): Record<string, string> {
  const out: Record<string, string> = {
    business_name: intake.company_name.trim(),
    issue_type: intake.problem_category.replace(/_/g, " "),
    product_or_service: intake.purchase_or_signup.trim(),
    what_happened: intake.story.trim(),
    complaint_narrative: buildRealBbbComplaintNarrative(intake),
    desired_resolution: bbbDesiredResolutionPhrase(intake.problem_category),
    amount_involved: intake.money_involved.trim(),
    order_or_payment_date: normalizeDate(intake.pay_or_order_date),
    contact_full_name: intake.user_display_name.trim(),
    contact_email: intake.reply_email.trim(),
    email: intake.reply_email.trim(),
  };

  if (intake.company_website?.trim()) {
    out.business_website = intake.company_website.trim();
  }

  if (intake.order_confirmation_details?.trim()) {
    out.order_confirmation_details = intake.order_confirmation_details.trim();
  }

  if (intake.already_contacted === "yes") {
    appendPriorContactFields(out, intake);
  }

  return out;
}

function buildRealBbbComplaintNarrative(intake: JusticeIntake): string {
  const parts: string[] = [
    `Issue type: ${intake.problem_category.replace(/_/g, " ")}.`,
    `Product/service: ${intake.purchase_or_signup.trim()}.`,
    `What happened: ${intake.story.trim()}.`,
    `Approximate amount involved: ${intake.money_involved.trim()}.`,
    `Order or payment date: ${intake.pay_or_order_date.trim()}.`,
  ];

  if (intake.order_confirmation_details?.trim()) {
    parts.push(`Order/confirmation details: ${intake.order_confirmation_details.trim()}.`);
  }

  parts.push(`Desired resolution: ${bbbDesiredResolutionPhrase(intake.problem_category)}.`);

  if (intake.already_contacted === "yes") {
    parts.push(buildPriorContactNarrative(intake));
  }

  return parts.join("\n\n");
}

function buildPriorContactNarrative(intake: JusticeIntake): string {
  const lines: string[] = ["Prior contact with business:"];
  if (intake.contact_method) {
    lines.push(`Method: ${intake.contact_method}.`);
  }
  if (intake.contact_date?.trim()) {
    lines.push(`Date: ${intake.contact_date.trim()}.`);
  }
  if (intake.merchant_response_type) {
    lines.push(`Their response: ${intake.merchant_response_type.replace(/_/g, " ")}.`);
  }
  if (intake.contact_proof_text?.trim()) {
    lines.push(`Proof notes: ${intake.contact_proof_text.trim()}.`);
  } else if (intake.contact_proof_type && intake.contact_proof_type !== "none") {
    lines.push(`Proof type: ${intake.contact_proof_type}.`);
  }
  return lines.join("\n");
}

function appendPriorContactFields(out: Record<string, string>, intake: JusticeIntake): void {
  if (intake.contact_method) {
    out.prior_contact_method = intake.contact_method;
  }
  if (intake.contact_date?.trim()) {
    out.prior_contact_date = intake.contact_date.trim();
  }
  if (intake.merchant_response_type) {
    out.prior_contact_response = intake.merchant_response_type.replace(/_/g, " ");
  }
  if (intake.contact_proof_text?.trim()) {
    out.prior_contact_proof_notes = intake.contact_proof_text.trim();
  } else if (intake.contact_proof_type && intake.contact_proof_type !== "none") {
    out.prior_contact_proof_type = intake.contact_proof_type;
  }
  out.prior_contact_summary = buildPriorContactNarrative(intake);
}

function normalizeDate(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return t.slice(0, 50);
}
