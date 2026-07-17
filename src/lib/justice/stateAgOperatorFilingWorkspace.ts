import {
  buildStateAgComplaintDraft,
  stateAgDesiredResolutionPhrase,
  stateNameFromCode,
} from "@/lib/justice/buildStateAgComplaintDraft";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import {
  resolveStateAgOfficialPortal,
  type StateAgOfficialPortalResolution,
} from "@/lib/justice/stateAgOfficialPortal";
import { parseStateAgFilingTaskDraft } from "@/lib/justice/stateAgFilingTask";
import type { JusticeIntake } from "@/lib/justice/types";
import {
  mapOperatorWorkspaceEvidence,
  type OperatorWorkspaceEvidenceInput,
  type OperatorWorkspaceEvidenceItem,
} from "@/lib/justice/operatorWorkspaceEvidence";

export type StateAgPreparedAnswerField = {
  id: string;
  label: string;
  value: string;
  copyable: boolean;
};

export type StateAgWorkspaceEvidenceItem = OperatorWorkspaceEvidenceItem;

export type StateAgOperatorFilingWorkspace = {
  filing_destination: string;
  portal: StateAgOfficialPortalResolution;
  complaint_draft: string;
  prepared_answers: StateAgPreparedAnswerField[];
  evidence: StateAgWorkspaceEvidenceItem[];
  /** Workspace never claims completion; only the complete API may. */
  is_submitted: false;
  confirmation_capture: {
    requires_filed_at: true;
    requires_confirmation_number: true;
    requires_destination: true;
  };
};

export type StateAgWorkspaceEvidenceInput = OperatorWorkspaceEvidenceInput;

function answer(
  id: string,
  label: string,
  value: string,
  copyable = true
): StateAgPreparedAnswerField {
  return { id, label, value: value.trim(), copyable };
}

export function buildStateAgPreparedAnswers(intake: JusticeIntake): StateAgPreparedAnswerField[] {
  const stateCode = intake.consumer_us_state?.trim().toUpperCase() ?? "";
  const fields: StateAgPreparedAnswerField[] = [
    answer("consumer_name", "Consumer name", intake.user_display_name),
    answer("consumer_email", "Consumer email", intake.reply_email),
    answer(
      "consumer_state",
      "Consumer state",
      stateCode ? `${stateNameFromCode(stateCode)} (${stateCode})` : "(not set)"
    ),
    answer("company_name", "Business / company name", intake.company_name),
    answer("company_website", "Company website", intake.company_website || "(not provided)"),
    answer("issue_type", "Issue type", intake.problem_category.replace(/_/g, " ")),
    answer("product_or_service", "Product / service", intake.purchase_or_signup || "(not provided)"),
    answer("what_happened", "What happened", intake.story),
    answer("amount", "Approximate amount", intake.money_involved || "(not provided)"),
    answer("order_or_payment_date", "Order / payment date", intake.pay_or_order_date || "(not provided)"),
    answer(
      "order_confirmation",
      "Order / confirmation details",
      intake.order_confirmation_details.trim() || "(not provided)"
    ),
    answer(
      "desired_resolution",
      "Desired resolution",
      stateAgDesiredResolutionPhrase(intake.problem_category)
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

export function mapStateAgWorkspaceEvidence(
  rows: readonly StateAgWorkspaceEvidenceInput[]
): StateAgWorkspaceEvidenceItem[] {
  return mapOperatorWorkspaceEvidence(rows);
}

export function resolveStateAgComplaintDraftForWorkspace(
  intake: JusticeIntake,
  taskNotes: string | null | undefined
): string {
  const fromNotes = parseStateAgFilingTaskDraft(taskNotes);
  if (fromNotes.trim()) return fromNotes.trim();
  return buildStateAgComplaintDraft(intake);
}

export function buildStateAgOperatorFilingWorkspace(input: {
  intake: JusticeIntake;
  taskNotes?: string | null;
  evidence?: readonly StateAgWorkspaceEvidenceInput[];
}): StateAgOperatorFilingWorkspace {
  const filingDestination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF) ??
    "State Attorney General (consumer)";

  return {
    filing_destination: filingDestination,
    portal: resolveStateAgOfficialPortal(input.intake.consumer_us_state),
    complaint_draft: resolveStateAgComplaintDraftForWorkspace(input.intake, input.taskNotes),
    prepared_answers: buildStateAgPreparedAnswers(input.intake),
    evidence: mapStateAgWorkspaceEvidence(input.evidence ?? []),
    is_submitted: false,
    confirmation_capture: {
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    },
  };
}
