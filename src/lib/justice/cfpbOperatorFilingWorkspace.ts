import {
  buildCfpbComplaintDraft,
  CFPB_PREP_RESOLUTION_TEXT,
  cfpbDesiredResolutionPhrase,
  cfpbFinancialProductSummary,
} from "@/lib/justice/buildCfpbComplaintDraft";
import { parseCfpbFilingTaskDraft } from "@/lib/justice/cfpbFilingTask";
import {
  resolveCfpbOfficialPortal,
  type CfpbOfficialPortalResolution,
} from "@/lib/justice/cfpbOfficialPortal";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { cfpbLikelyRelevant } from "@/lib/justice/rules";
import { stateNameFromCode } from "@/lib/justice/buildStateAgComplaintDraft";
import type { JusticeIntake } from "@/lib/justice/types";

export type CfpbPreparedAnswerField = {
  id: string;
  label: string;
  value: string;
  copyable: boolean;
};

export type CfpbWorkspaceEvidenceItem = {
  title: string;
  evidence_type: string;
  file_name: string | null;
  evidence_date: string | null;
};

export type CfpbOperatorFilingWorkspace = {
  filing_destination: string;
  portal: CfpbOfficialPortalResolution;
  complaint_draft: string;
  prepared_answers: CfpbPreparedAnswerField[];
  evidence: CfpbWorkspaceEvidenceItem[];
  /** Workspace never claims completion; only the complete API may. */
  is_submitted: false;
  confirmation_capture: {
    requires_filed_at: true;
    requires_confirmation_number: true;
    requires_destination: true;
  };
};

export type CfpbWorkspaceEvidenceInput = {
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
): CfpbPreparedAnswerField {
  return { id, label, value: value.trim(), copyable };
}

export function buildCfpbPreparedAnswers(intake: JusticeIntake): CfpbPreparedAnswerField[] {
  const stateCode = intake.consumer_us_state?.trim().toUpperCase() ?? "";
  const cfpbRel = cfpbLikelyRelevant(intake);
  const desiredResolution = cfpbRel
    ? CFPB_PREP_RESOLUTION_TEXT
    : cfpbDesiredResolutionPhrase(intake.problem_category);

  const fields: CfpbPreparedAnswerField[] = [
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
      cfpbRel
        ? "Financial product, billing, or account matter"
        : intake.problem_category.replace(/_/g, " ")
    ),
    answer(
      "product_or_service",
      cfpbRel ? "Financial product or service" : "Product / service",
      cfpbRel
        ? cfpbFinancialProductSummary(intake)
        : intake.purchase_or_signup || "(not provided)"
    ),
    answer("what_happened", "What happened", intake.story),
    answer("amount", "Approximate amount", intake.money_involved || "(not provided)"),
    answer(
      "problem_or_transaction_date",
      cfpbRel ? "Problem / start date" : "Order / transaction date",
      intake.pay_or_order_date || "(not provided)"
    ),
    answer(
      "order_confirmation",
      "Confirmation / reference details",
      intake.order_confirmation_details.trim() || "(not provided)"
    ),
    answer("desired_resolution", "Desired resolution", desiredResolution),
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

export function mapCfpbWorkspaceEvidence(
  rows: readonly CfpbWorkspaceEvidenceInput[]
): CfpbWorkspaceEvidenceItem[] {
  return rows.map((row) => ({
    title: (row.title ?? "").trim() || "(untitled)",
    evidence_type: (row.evidence_type ?? "").trim() || "other",
    file_name: row.file_name?.trim() || null,
    evidence_date: row.evidence_date?.trim() || null,
  }));
}

export function resolveCfpbComplaintDraftForWorkspace(
  intake: JusticeIntake,
  taskNotes: string | null | undefined
): string {
  const fromNotes = parseCfpbFilingTaskDraft(taskNotes);
  if (fromNotes.trim()) return fromNotes.trim();
  return buildCfpbComplaintDraft(intake);
}

export function buildCfpbOperatorFilingWorkspace(input: {
  intake: JusticeIntake;
  taskNotes?: string | null;
  evidence?: readonly CfpbWorkspaceEvidenceInput[];
}): CfpbOperatorFilingWorkspace {
  const filingDestination =
    canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF) ??
    "CFPB";

  return {
    filing_destination: filingDestination,
    portal: resolveCfpbOfficialPortal(),
    complaint_draft: resolveCfpbComplaintDraftForWorkspace(input.intake, input.taskNotes),
    prepared_answers: buildCfpbPreparedAnswers(input.intake),
    evidence: mapCfpbWorkspaceEvidence(input.evidence ?? []),
    is_submitted: false,
    confirmation_capture: {
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    },
  };
}
