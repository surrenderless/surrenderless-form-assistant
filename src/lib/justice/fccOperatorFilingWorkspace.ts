import {
  buildFccComplaintDraft,
  fccDesiredResolutionPhrase,
  fccServiceSummarySegment,
} from "@/lib/justice/buildFccComplaintDraft";
import { stateNameFromCode } from "@/lib/justice/buildStateAgComplaintDraft";
import { parseFccFilingTaskDraft } from "@/lib/justice/fccFilingTask";
import {
  resolveFccOfficialPortal,
  type FccOfficialPortalResolution,
} from "@/lib/justice/fccOfficialPortal";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { fccLikelyRelevant } from "@/lib/justice/rules";
import type { JusticeIntake } from "@/lib/justice/types";
import {
  mapOperatorWorkspaceEvidence,
  type OperatorWorkspaceEvidenceInput,
  type OperatorWorkspaceEvidenceItem,
} from "@/lib/justice/operatorWorkspaceEvidence";

export type FccPreparedAnswerField = {
  id: string;
  label: string;
  value: string;
  copyable: boolean;
};

export type FccWorkspaceEvidenceItem = OperatorWorkspaceEvidenceItem;

export type FccOperatorFilingWorkspace = {
  filing_destination: string;
  portal: FccOfficialPortalResolution;
  complaint_draft: string;
  prepared_answers: FccPreparedAnswerField[];
  evidence: FccWorkspaceEvidenceItem[];
  /** Workspace never claims completion; only the complete API may. */
  is_submitted: false;
  confirmation_capture: {
    requires_filed_at: true;
    requires_confirmation_number: true;
    requires_destination: true;
  };
};

export type FccWorkspaceEvidenceInput = OperatorWorkspaceEvidenceInput;

function answer(
  id: string,
  label: string,
  value: string,
  copyable = true
): FccPreparedAnswerField {
  return { id, label, value: value.trim(), copyable };
}

export function buildFccPreparedAnswers(intake: JusticeIntake): FccPreparedAnswerField[] {
  const stateCode = intake.consumer_us_state?.trim().toUpperCase() ?? "";
  const fccRel = fccLikelyRelevant(intake);

  const fields: FccPreparedAnswerField[] = [
    answer("consumer_name", "Consumer name", intake.user_display_name),
    answer("consumer_email", "Consumer email", intake.reply_email),
    answer(
      "consumer_state",
      "Consumer state",
      stateCode ? `${stateNameFromCode(stateCode)} (${stateCode})` : "(not set)"
    ),
    answer("company_name", "Company / provider name", intake.company_name),
    answer("company_website", "Company website", intake.company_website || "(not provided)"),
    answer(
      "nature_of_complaint",
      "Nature of complaint",
      fccRel ? "Communications service issue" : intake.problem_category.replace(/_/g, " ")
    ),
    answer(
      "product_or_service",
      fccRel ? "Service or product involved" : "Service or product",
      fccRel ? fccServiceSummarySegment(intake) : intake.purchase_or_signup || "(not provided)"
    ),
    answer("what_happened", "What happened", intake.story),
    answer("amount", "Approximate amount", intake.money_involved || "(not provided)"),
    answer(
      "problem_or_start_date",
      "Problem / start date",
      intake.pay_or_order_date || "(not provided)"
    ),
    answer(
      "order_confirmation",
      "Account / confirmation details",
      intake.order_confirmation_details.trim() || "(not provided)"
    ),
    answer(
      "desired_resolution",
      "Desired resolution",
      fccDesiredResolutionPhrase(intake.problem_category)
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

export function mapFccWorkspaceEvidence(
  rows: readonly FccWorkspaceEvidenceInput[]
): FccWorkspaceEvidenceItem[] {
  return mapOperatorWorkspaceEvidence(rows);
}

export function resolveFccComplaintDraftForWorkspace(
  intake: JusticeIntake,
  taskNotes: string | null | undefined
): string {
  const fromNotes = parseFccFilingTaskDraft(taskNotes);
  if (fromNotes.trim()) return fromNotes.trim();
  return buildFccComplaintDraft(intake);
}

export function buildFccOperatorFilingWorkspace(input: {
  intake: JusticeIntake;
  taskNotes?: string | null;
  evidence?: readonly FccWorkspaceEvidenceInput[];
}): FccOperatorFilingWorkspace {
  const filingDestination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF) ??
    "FCC";

  return {
    filing_destination: filingDestination,
    portal: resolveFccOfficialPortal(),
    complaint_draft: resolveFccComplaintDraftForWorkspace(input.intake, input.taskNotes),
    prepared_answers: buildFccPreparedAnswers(input.intake),
    evidence: mapFccWorkspaceEvidence(input.evidence ?? []),
    is_submitted: false,
    confirmation_capture: {
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    },
  };
}
