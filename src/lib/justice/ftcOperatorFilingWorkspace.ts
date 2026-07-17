import { stateNameFromCode } from "@/lib/justice/buildStateAgComplaintDraft";
import {
  buildFtcComplaintDraft,
  ftcDesiredResolutionPhrase,
} from "@/lib/justice/buildFtcComplaintDraft";
import { parseFtcFilingTaskDraft } from "@/lib/justice/ftcFilingTask";
import {
  resolveFtcOfficialPortal,
  type FtcOfficialPortalResolution,
} from "@/lib/justice/ftcOfficialPortal";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeIntake } from "@/lib/justice/types";
import {
  mapOperatorWorkspaceEvidence,
  type OperatorWorkspaceEvidenceInput,
  type OperatorWorkspaceEvidenceItem,
} from "@/lib/justice/operatorWorkspaceEvidence";

export type FtcPreparedAnswerField = {
  id: string;
  label: string;
  value: string;
  copyable: boolean;
};

export type FtcWorkspaceEvidenceItem = OperatorWorkspaceEvidenceItem;

export type FtcOperatorFilingWorkspace = {
  filing_destination: string;
  portal: FtcOfficialPortalResolution;
  complaint_draft: string;
  prepared_answers: FtcPreparedAnswerField[];
  evidence: FtcWorkspaceEvidenceItem[];
  /** Workspace never claims completion; only the complete API may. */
  is_submitted: false;
  confirmation_capture: {
    requires_filed_at: true;
    requires_confirmation_number: true;
    requires_destination: true;
  };
};

export type FtcWorkspaceEvidenceInput = OperatorWorkspaceEvidenceInput;

function answer(
  id: string,
  label: string,
  value: string,
  copyable = true
): FtcPreparedAnswerField {
  return { id, label, value: value.trim(), copyable };
}

export function buildFtcPreparedAnswers(intake: JusticeIntake): FtcPreparedAnswerField[] {
  const stateCode = intake.consumer_us_state?.trim().toUpperCase() ?? "";

  const fields: FtcPreparedAnswerField[] = [
    answer("consumer_name", "Consumer name", intake.user_display_name),
    answer("consumer_email", "Consumer email", intake.reply_email),
    answer(
      "consumer_state",
      "Consumer state",
      stateCode ? `${stateNameFromCode(stateCode)} (${stateCode})` : "(not set)"
    ),
    answer("company_name", "Company / business name", intake.company_name),
    answer("company_website", "Company website", intake.company_website || "(not provided)"),
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
      ftcDesiredResolutionPhrase(intake.problem_category)
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

export function mapFtcWorkspaceEvidence(
  rows: readonly FtcWorkspaceEvidenceInput[]
): FtcWorkspaceEvidenceItem[] {
  return mapOperatorWorkspaceEvidence(rows);
}

export function resolveFtcComplaintDraftForWorkspace(
  intake: JusticeIntake,
  taskNotes: string | null | undefined
): string {
  const fromNotes = parseFtcFilingTaskDraft(taskNotes);
  if (fromNotes.trim()) return fromNotes.trim();
  return buildFtcComplaintDraft(intake);
}

export function buildFtcOperatorFilingWorkspace(input: {
  intake: JusticeIntake;
  taskNotes?: string | null;
  evidence?: readonly FtcWorkspaceEvidenceInput[];
}): FtcOperatorFilingWorkspace {
  const filingDestination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF) ??
    "FTC (consumer complaint)";

  return {
    filing_destination: filingDestination,
    portal: resolveFtcOfficialPortal(),
    complaint_draft: resolveFtcComplaintDraftForWorkspace(input.intake, input.taskNotes),
    prepared_answers: buildFtcPreparedAnswers(input.intake),
    evidence: mapFtcWorkspaceEvidence(input.evidence ?? []),
    is_submitted: false,
    confirmation_capture: {
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    },
  };
}
