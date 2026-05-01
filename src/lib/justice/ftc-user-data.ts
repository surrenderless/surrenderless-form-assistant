import type { JusticeIntake } from "./types";

/** Maps §5A-style intake to mock /mock/ftc-complaint field names for submit-form → match-fields. */
export function intakeToMockFtcUserData(intake: JusticeIntake): Record<string, string> {
  const issue_type = mapProblemCategoryToIssueType(intake.problem_category);
  const complaint_description = buildComplaintDescription(intake);

  const out: Record<string, string> = {
    issue_type,
    company_name: intake.company_name.trim(),
    complaint_description,
    incident_date: normalizeDate(intake.pay_or_order_date),
    contact_full_name: intake.user_display_name.trim(),
    contact_email: intake.reply_email.trim(),
    email: intake.reply_email.trim(),
  };

  if (intake.company_website?.trim()) {
    out.company_website = intake.company_website.trim();
  }

  return out;
}

function mapProblemCategoryToIssueType(cat: JusticeIntake["problem_category"]): string {
  switch (cat) {
    case "subscription":
    case "charge_dispute":
      return "billing";
    case "online_purchase":
      return "delivery";
    case "service_failed":
      return "other";
    case "something_else":
    default:
      return "other";
  }
}

function buildComplaintDescription(intake: JusticeIntake): string {
  const parts: string[] = [
    `Problem type: ${intake.problem_category.replace(/_/g, " ")}.`,
    `Purchase/signup: ${intake.purchase_or_signup.trim()}`,
    `What happened: ${intake.story.trim()}`,
    `Money involved: ${intake.money_involved.trim()}`,
    `Pay/order date: ${intake.pay_or_order_date.trim()}`,
  ];
  if (intake.order_confirmation_details?.trim()) {
    parts.push(`Order/account details: ${intake.order_confirmation_details.trim()}`);
  }
  if (intake.already_contacted === "yes") {
    parts.push(
      `Prior contact: ${intake.contact_method ?? ""} on ${intake.contact_date ?? "unknown date"}.`,
      `Company response: ${intake.merchant_response_type ?? "unknown"}.`
    );
    if (intake.contact_proof_text?.trim()) {
      parts.push(`Proof notes: ${intake.contact_proof_text.trim()}`);
    } else if (intake.contact_proof_type && intake.contact_proof_type !== "none") {
      parts.push(`Proof type: ${intake.contact_proof_type}`);
    }
  }
  return parts.join("\n\n");
}

function normalizeDate(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return t.slice(0, 50);
}
