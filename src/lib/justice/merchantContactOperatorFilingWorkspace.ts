import { stateNameFromCode } from "@/lib/justice/buildStateAgComplaintDraft";
import { buildMerchantMessage } from "@/lib/justice/buildMerchantContactMessage";
import { parseMerchantContactFilingTaskDraft } from "@/lib/justice/merchantContactFilingTask";
import { resolveMerchantOutreachRecipientEmail } from "@/lib/justice/merchantContactEmailDelivery";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeIntake } from "@/lib/justice/types";

export type MerchantContactPreparedAnswerField = {
  id: string;
  label: string;
  value: string;
  copyable: boolean;
};

export type MerchantContactWorkspaceEvidenceItem = {
  title: string;
  evidence_type: string;
  file_name: string | null;
  evidence_date: string | null;
};

/** Delivery context — automated merchant email may complete first; workspace is fallback. */
export type MerchantContactDeliveryGuidance = {
  automated_email_eligible: boolean;
  recipient_email: string | null;
  company_name: string;
  company_website: string;
  operator_guidance: string;
};

export type MerchantContactOperatorFilingWorkspace = {
  filing_destination: string;
  delivery: MerchantContactDeliveryGuidance;
  message_draft: string;
  prepared_answers: MerchantContactPreparedAnswerField[];
  evidence: MerchantContactWorkspaceEvidenceItem[];
  /** Workspace never claims completion; only the complete API (or accepted email delivery) may. */
  is_submitted: false;
  confirmation_capture: {
    requires_filed_at: true;
    requires_confirmation_number: true;
    requires_destination: true;
    requires_contact_method: true;
    requires_merchant_response_type: true;
    requires_recipient: true;
  };
};

export type MerchantContactWorkspaceEvidenceInput = {
  title?: string | null;
  evidence_type?: string | null;
  file_name?: string | null;
  evidence_date?: string | null;
};

function answer(
  id: string,
  label: string,
  value: string,
  copyable = true
): MerchantContactPreparedAnswerField {
  return { id, label, value: value.trim(), copyable };
}

function merchantDesiredResolutionPhrase(
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

export function resolveMerchantContactDeliveryGuidance(
  intake: JusticeIntake
): MerchantContactDeliveryGuidance {
  const companyName = intake.company_name.trim() || "(unknown company)";
  const companyWebsite = intake.company_website.trim() || "(not provided)";
  const recipientEmail = resolveMerchantOutreachRecipientEmail(intake);

  if (recipientEmail) {
    return {
      automated_email_eligible: true,
      recipient_email: recipientEmail,
      company_name: companyName,
      company_website: companyWebsite,
      operator_guidance:
        "Automated merchant email may complete this step when a valid company contact email is on file. If this queue item is still open, send the merchant message manually, then record the outreach confirmation below. This workspace does not invent delivery or mark the message sent.",
    };
  }

  return {
    automated_email_eligible: false,
    recipient_email: null,
    company_name: companyName,
    company_website: companyWebsite,
    operator_guidance:
      "Automated merchant email is unavailable (no valid company contact email). Send the merchant message manually using the draft and recipient/company fields below, then record the outreach confirmation. This workspace does not invent delivery or mark the message sent.",
  };
}

export function buildMerchantContactPreparedAnswers(
  intake: JusticeIntake
): MerchantContactPreparedAnswerField[] {
  const stateCode = intake.consumer_us_state?.trim().toUpperCase() ?? "";
  const recipientEmail = resolveMerchantOutreachRecipientEmail(intake);

  const fields: MerchantContactPreparedAnswerField[] = [
    answer("consumer_name", "Consumer name", intake.user_display_name),
    answer("consumer_email", "Consumer email", intake.reply_email),
    answer(
      "consumer_state",
      "Consumer state",
      stateCode ? `${stateNameFromCode(stateCode)} (${stateCode})` : "(not set)"
    ),
    answer("company_name", "Company / recipient name", intake.company_name),
    answer("company_website", "Company website", intake.company_website || "(not provided)"),
    answer(
      "recipient_email",
      "Company contact email",
      recipientEmail ?? "(not available — manual send required)"
    ),
    answer("issue_type", "Issue type", intake.problem_category.replace(/_/g, " ")),
    answer("product_or_service", "Product / service", intake.purchase_or_signup || "(not provided)"),
    answer("what_happened", "What happened", intake.story),
    answer("amount", "Approximate amount", intake.money_involved || "(not provided)"),
    answer(
      "order_or_payment_date",
      "Order / payment date",
      intake.pay_or_order_date || "(not provided)"
    ),
    answer(
      "order_confirmation",
      "Order / confirmation details",
      intake.order_confirmation_details.trim() || "(not provided)"
    ),
    answer(
      "desired_resolution",
      "Desired resolution",
      merchantDesiredResolutionPhrase(intake.problem_category)
    ),
  ];

  return fields.filter((f) => f.value.length > 0);
}

export function mapMerchantContactWorkspaceEvidence(
  rows: readonly MerchantContactWorkspaceEvidenceInput[]
): MerchantContactWorkspaceEvidenceItem[] {
  return rows.map((row) => ({
    title: (row.title ?? "").trim() || "(untitled)",
    evidence_type: (row.evidence_type ?? "").trim() || "other",
    file_name: row.file_name?.trim() || null,
    evidence_date: row.evidence_date?.trim() || null,
  }));
}

export function resolveMerchantContactDraftForWorkspace(
  intake: JusticeIntake,
  taskNotes: string | null | undefined
): string {
  const fromNotes = parseMerchantContactFilingTaskDraft(taskNotes);
  if (fromNotes.trim()) return fromNotes.trim();
  return buildMerchantMessage(intake);
}

export function buildMerchantContactOperatorFilingWorkspace(input: {
  intake: JusticeIntake;
  taskNotes?: string | null;
  evidence?: readonly MerchantContactWorkspaceEvidenceInput[];
}): MerchantContactOperatorFilingWorkspace {
  const filingDestination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF) ??
    "Merchant contact";

  return {
    filing_destination: filingDestination,
    delivery: resolveMerchantContactDeliveryGuidance(input.intake),
    message_draft: resolveMerchantContactDraftForWorkspace(input.intake, input.taskNotes),
    prepared_answers: buildMerchantContactPreparedAnswers(input.intake),
    evidence: mapMerchantContactWorkspaceEvidence(input.evidence ?? []),
    is_submitted: false,
    confirmation_capture: {
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
      requires_contact_method: true,
      requires_merchant_response_type: true,
      requires_recipient: true,
    },
  };
}
