import { stateNameFromCode } from "@/lib/justice/buildStateAgComplaintDraft";
import {
  bbbDesiredResolutionPhrase,
  buildBbbComplaintDraft,
} from "@/lib/justice/buildBbbComplaintDraft";
import { parseBbbFilingTaskDraft } from "@/lib/justice/bbbFilingTask";
import {
  resolveBbbOfficialPortal,
  type BbbOfficialPortalResolution,
} from "@/lib/justice/bbbOfficialPortal";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { isRealBbbComplaintAutofillEnabled } from "@/lib/justice/realBbbAutofillEnabled";
import type { JusticeIntake } from "@/lib/justice/types";
import {
  mapOperatorWorkspaceEvidence,
  type OperatorWorkspaceEvidenceInput,
  type OperatorWorkspaceEvidenceItem,
} from "@/lib/justice/operatorWorkspaceEvidence";

export type BbbPreparedAnswerField = {
  id: string;
  label: string;
  value: string;
  copyable: boolean;
};

export type BbbWorkspaceEvidenceItem = OperatorWorkspaceEvidenceItem;

export type BbbOperatorFilingWorkspace = {
  filing_destination: string;
  portal: BbbOfficialPortalResolution;
  /** True when the owned autofill path is enabled in this environment (does not claim it ran). */
  owned_autofill_enabled: boolean;
  complaint_draft: string;
  prepared_answers: BbbPreparedAnswerField[];
  evidence: BbbWorkspaceEvidenceItem[];
  /** Workspace never claims completion; only the complete API (or successful owned autofill) may. */
  is_submitted: false;
  confirmation_capture: {
    requires_filed_at: true;
    requires_confirmation_number: true;
    requires_destination: true;
  };
};

export type BbbWorkspaceEvidenceInput = OperatorWorkspaceEvidenceInput;

function answer(
  id: string,
  label: string,
  value: string,
  copyable = true
): BbbPreparedAnswerField {
  return { id, label, value: value.trim(), copyable };
}

export function buildBbbPreparedAnswers(intake: JusticeIntake): BbbPreparedAnswerField[] {
  const stateCode = intake.consumer_us_state?.trim().toUpperCase() ?? "";

  const fields: BbbPreparedAnswerField[] = [
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
      bbbDesiredResolutionPhrase(intake.problem_category)
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

export function mapBbbWorkspaceEvidence(
  rows: readonly BbbWorkspaceEvidenceInput[]
): BbbWorkspaceEvidenceItem[] {
  return mapOperatorWorkspaceEvidence(rows);
}

export function resolveBbbComplaintDraftForWorkspace(
  intake: JusticeIntake,
  taskNotes: string | null | undefined
): string {
  const fromNotes = parseBbbFilingTaskDraft(taskNotes);
  if (fromNotes.trim()) return fromNotes.trim();
  return buildBbbComplaintDraft(intake);
}

export function buildBbbOperatorFilingWorkspace(input: {
  intake: JusticeIntake;
  taskNotes?: string | null;
  evidence?: readonly BbbWorkspaceEvidenceInput[];
}): BbbOperatorFilingWorkspace {
  const filingDestination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF) ??
    "Better Business Bureau";

  return {
    filing_destination: filingDestination,
    portal: resolveBbbOfficialPortal(),
    owned_autofill_enabled: isRealBbbComplaintAutofillEnabled(),
    complaint_draft: resolveBbbComplaintDraftForWorkspace(input.intake, input.taskNotes),
    prepared_answers: buildBbbPreparedAnswers(input.intake),
    evidence: mapBbbWorkspaceEvidence(input.evidence ?? []),
    is_submitted: false,
    confirmation_capture: {
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    },
  };
}
