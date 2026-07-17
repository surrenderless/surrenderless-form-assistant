import {
  buildDotAviationComplaintDraft,
  dotDesiredResolutionPhrase,
} from "@/lib/justice/buildDotAviationComplaintDraft";
import { stateNameFromCode } from "@/lib/justice/buildStateAgComplaintDraft";
import { parseDotFilingTaskDraft } from "@/lib/justice/dotFilingTask";
import {
  resolveDotOfficialPortal,
  type DotOfficialPortalResolution,
} from "@/lib/justice/dotOfficialPortal";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeIntake } from "@/lib/justice/types";
import {
  mapOperatorWorkspaceEvidence,
  type OperatorWorkspaceEvidenceInput,
  type OperatorWorkspaceEvidenceItem,
} from "@/lib/justice/operatorWorkspaceEvidence";

export type DotPreparedAnswerField = {
  id: string;
  label: string;
  value: string;
  copyable: boolean;
};

export type DotWorkspaceEvidenceItem = OperatorWorkspaceEvidenceItem;

export type DotOperatorFilingWorkspace = {
  filing_destination: string;
  portal: DotOfficialPortalResolution;
  complaint_draft: string;
  prepared_answers: DotPreparedAnswerField[];
  evidence: DotWorkspaceEvidenceItem[];
  /** Workspace never claims completion; only the complete API may. */
  is_submitted: false;
  confirmation_capture: {
    requires_filed_at: true;
    requires_confirmation_number: true;
    requires_destination: true;
  };
};

export type DotWorkspaceEvidenceInput = OperatorWorkspaceEvidenceInput;

function answer(
  id: string,
  label: string,
  value: string,
  copyable = true
): DotPreparedAnswerField {
  return { id, label, value: value.trim(), copyable };
}

export function buildDotPreparedAnswers(intake: JusticeIntake): DotPreparedAnswerField[] {
  const stateCode = intake.consumer_us_state?.trim().toUpperCase() ?? "";

  const fields: DotPreparedAnswerField[] = [
    answer("consumer_name", "Consumer name", intake.user_display_name),
    answer("consumer_email", "Consumer email", intake.reply_email),
    answer(
      "consumer_state",
      "Consumer state",
      stateCode ? `${stateNameFromCode(stateCode)} (${stateCode})` : "(not set)"
    ),
    answer("company_name", "Airline / company name", intake.company_name),
    answer("company_website", "Company website", intake.company_website || "(not provided)"),
    answer("issue_type", "Issue type", intake.problem_category.replace(/_/g, " ")),
    answer(
      "flight_or_service",
      "Flight / service / product",
      intake.purchase_or_signup || "(not provided)"
    ),
    answer("what_happened", "What happened", intake.story),
    answer("amount", "Approximate amount", intake.money_involved || "(not provided)"),
    answer(
      "travel_or_payment_date",
      "Travel / order / payment date",
      intake.pay_or_order_date || "(not provided)"
    ),
    answer(
      "order_confirmation",
      "Confirmation / record locator / ticket details",
      intake.order_confirmation_details.trim() || "(not provided)"
    ),
    answer(
      "desired_resolution",
      "Desired resolution",
      dotDesiredResolutionPhrase(intake.problem_category)
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

export function mapDotWorkspaceEvidence(
  rows: readonly DotWorkspaceEvidenceInput[]
): DotWorkspaceEvidenceItem[] {
  return mapOperatorWorkspaceEvidence(rows);
}

export function resolveDotComplaintDraftForWorkspace(
  intake: JusticeIntake,
  taskNotes: string | null | undefined
): string {
  const fromNotes = parseDotFilingTaskDraft(taskNotes);
  if (fromNotes.trim()) return fromNotes.trim();
  return buildDotAviationComplaintDraft(intake);
}

export function buildDotOperatorFilingWorkspace(input: {
  intake: JusticeIntake;
  taskNotes?: string | null;
  evidence?: readonly DotWorkspaceEvidenceInput[];
}): DotOperatorFilingWorkspace {
  const filingDestination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF) ??
    "USDOT / aviation consumer";

  return {
    filing_destination: filingDestination,
    portal: resolveDotOfficialPortal(),
    complaint_draft: resolveDotComplaintDraftForWorkspace(input.intake, input.taskNotes),
    prepared_answers: buildDotPreparedAnswers(input.intake),
    evidence: mapDotWorkspaceEvidence(input.evidence ?? []),
    is_submitted: false,
    confirmation_capture: {
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    },
  };
}
