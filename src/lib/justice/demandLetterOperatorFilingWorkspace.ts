import { stateNameFromCode } from "@/lib/justice/buildStateAgComplaintDraft";
import {
  buildDemandLetterDraft,
  demandLetterDesiredResolutionPhrase,
} from "@/lib/justice/buildDemandLetterDraft";
import { parseDemandLetterFilingTaskDraft } from "@/lib/justice/demandLetterFilingTask";
import { resolveDemandLetterRecipientEmail } from "@/lib/justice/demandLetterEmailDelivery";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeIntake } from "@/lib/justice/types";

export type DemandLetterPreparedAnswerField = {
  id: string;
  label: string;
  value: string;
  copyable: boolean;
};

export type DemandLetterWorkspaceEvidenceItem = {
  title: string;
  evidence_type: string;
  file_name: string | null;
  evidence_date: string | null;
};

/** Delivery context for operators — not a government portal; email automation may complete first. */
export type DemandLetterDeliveryGuidance = {
  automated_email_eligible: boolean;
  recipient_email: string | null;
  company_name: string;
  company_website: string;
  operator_guidance: string;
};

export type DemandLetterOperatorFilingWorkspace = {
  filing_destination: string;
  delivery: DemandLetterDeliveryGuidance;
  letter_draft: string;
  prepared_answers: DemandLetterPreparedAnswerField[];
  evidence: DemandLetterWorkspaceEvidenceItem[];
  /** Workspace never claims completion; only the complete API (or accepted email delivery) may. */
  is_submitted: false;
  confirmation_capture: {
    requires_filed_at: true;
    requires_confirmation_number: true;
    requires_destination: true;
  };
};

export type DemandLetterWorkspaceEvidenceInput = {
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
): DemandLetterPreparedAnswerField {
  return { id, label, value: value.trim(), copyable };
}

export function resolveDemandLetterDeliveryGuidance(
  intake: JusticeIntake
): DemandLetterDeliveryGuidance {
  const companyName = intake.company_name.trim() || "(unknown company)";
  const companyWebsite = intake.company_website.trim() || "(not provided)";
  const recipientEmail = resolveDemandLetterRecipientEmail(intake);

  if (recipientEmail) {
    return {
      automated_email_eligible: true,
      recipient_email: recipientEmail,
      company_name: companyName,
      company_website: companyWebsite,
      operator_guidance:
        "Automated email delivery may complete this step when a valid company contact email is on file. If this queue item is still open, send the demand letter manually (email or mail), then record the send confirmation below. This workspace does not invent delivery or mark the letter sent.",
    };
  }

  return {
    automated_email_eligible: false,
    recipient_email: null,
    company_name: companyName,
    company_website: companyWebsite,
    operator_guidance:
      "Automated email delivery is unavailable (no valid company contact email). Send the demand letter manually using the draft and recipient/company fields below, then record the send confirmation. This workspace does not invent delivery or mark the letter sent.",
  };
}

export function buildDemandLetterPreparedAnswers(
  intake: JusticeIntake
): DemandLetterPreparedAnswerField[] {
  const stateCode = intake.consumer_us_state?.trim().toUpperCase() ?? "";
  const recipientEmail = resolveDemandLetterRecipientEmail(intake);

  const fields: DemandLetterPreparedAnswerField[] = [
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
      demandLetterDesiredResolutionPhrase(intake.problem_category)
    ),
    answer(
      "already_contacted",
      "Already contacted company",
      intake.already_contacted === "yes" ? "Yes" : "No"
    ),
  ];

  if (intake.already_contacted === "yes") {
    fields.push(
      answer("contact_method", "Prior contact method", intake.contact_method ?? "(not provided)"),
      answer("contact_date", "Prior contact date", intake.contact_date ?? "(not provided)"),
      answer(
        "merchant_response",
        "Merchant response",
        intake.merchant_response_type?.replace(/_/g, " ") ?? "(not provided)"
      ),
      answer(
        "contact_proof",
        "Contact proof notes",
        intake.contact_proof_text?.trim() || "(not provided)"
      )
    );
  }

  return fields.filter((f) => f.value.length > 0);
}

export function mapDemandLetterWorkspaceEvidence(
  rows: readonly DemandLetterWorkspaceEvidenceInput[]
): DemandLetterWorkspaceEvidenceItem[] {
  return rows.map((row) => ({
    title: (row.title ?? "").trim() || "(untitled)",
    evidence_type: (row.evidence_type ?? "").trim() || "other",
    file_name: row.file_name?.trim() || null,
    evidence_date: row.evidence_date?.trim() || null,
  }));
}

export function resolveDemandLetterDraftForWorkspace(
  intake: JusticeIntake,
  taskNotes: string | null | undefined
): string {
  const fromNotes = parseDemandLetterFilingTaskDraft(taskNotes);
  if (fromNotes.trim()) return fromNotes.trim();
  return buildDemandLetterDraft(intake);
}

export function buildDemandLetterOperatorFilingWorkspace(input: {
  intake: JusticeIntake;
  taskNotes?: string | null;
  evidence?: readonly DemandLetterWorkspaceEvidenceInput[];
}): DemandLetterOperatorFilingWorkspace {
  const filingDestination =
    canonicalFilingDestinationForApprovedActionHref(
      MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF
    ) ?? "Small claims / demand letter";

  return {
    filing_destination: filingDestination,
    delivery: resolveDemandLetterDeliveryGuidance(input.intake),
    letter_draft: resolveDemandLetterDraftForWorkspace(input.intake, input.taskNotes),
    prepared_answers: buildDemandLetterPreparedAnswers(input.intake),
    evidence: mapDemandLetterWorkspaceEvidence(input.evidence ?? []),
    is_submitted: false,
    confirmation_capture: {
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    },
  };
}
