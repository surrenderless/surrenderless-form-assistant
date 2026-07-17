import { stateNameFromCode } from "@/lib/justice/buildStateAgComplaintDraft";
import {
  buildBankLetter,
  buildDefaultPaymentDisputeDraft,
  type PaymentDisputeDraft,
  type PaymentMethodOption,
  type DisputeReasonOption,
  type PaymentDisputeProofType,
} from "@/lib/justice/buildPaymentDisputeBankLetter";
import {
  isPaymentDisputeDraftPayload,
  parsePaymentDisputeFilingTaskDraft,
} from "@/lib/justice/paymentDisputeFilingTask";
import { resolvePaymentDisputeRecipientEmail } from "@/lib/justice/paymentDisputeEmailDelivery";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeIntake } from "@/lib/justice/types";

export type PaymentDisputePreparedAnswerField = {
  id: string;
  label: string;
  value: string;
  copyable: boolean;
};

export type PaymentDisputeWorkspaceEvidenceItem = {
  title: string;
  evidence_type: string;
  file_name: string | null;
  evidence_date: string | null;
};

/** Delivery context — automated issuer email may complete first; workspace is fallback. */
export type PaymentDisputeDeliveryGuidance = {
  automated_email_eligible: boolean;
  recipient_email: string | null;
  merchant_name: string;
  operator_guidance: string;
};

export type PaymentDisputeChargeFields = {
  payment_method: string;
  charge_date: string;
  charge_amount: string;
  merchant_name: string;
  dispute_reason: string;
  prior_company_contact: string;
  proof_type: string;
};

export type PaymentDisputeOperatorFilingWorkspace = {
  filing_destination: string;
  delivery: PaymentDisputeDeliveryGuidance;
  charge_fields: PaymentDisputeChargeFields;
  letter_draft: string;
  prepared_answers: PaymentDisputePreparedAnswerField[];
  evidence: PaymentDisputeWorkspaceEvidenceItem[];
  /** Workspace never claims completion; only the complete API (or accepted email delivery) may. */
  is_submitted: false;
  confirmation_capture: {
    requires_filed_at: true;
    requires_confirmation_number: true;
    requires_destination: true;
  };
};

export type PaymentDisputeWorkspaceEvidenceInput = {
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
): PaymentDisputePreparedAnswerField {
  return { id, label, value: value.trim(), copyable };
}

function paymentMethodLabel(m: PaymentMethodOption): string {
  switch (m) {
    case "credit_card":
      return "Credit card";
    case "debit_card":
      return "Debit card";
    case "bank_account_ach":
      return "Bank account / ACH";
    case "paypal":
      return "PayPal / similar wallet";
    case "apple_google_pay":
      return "Apple Pay / Google Pay";
    case "other":
      return "Other";
    default:
      return m;
  }
}

function disputeReasonLabel(r: DisputeReasonOption): string {
  switch (r) {
    case "unauthorized_charge":
      return "Unauthorized charge";
    case "duplicate_charge":
      return "Duplicate charge";
    case "wrong_amount":
      return "Wrong amount";
    case "canceled_refunded_still_charged":
      return "Canceled or refunded but still charged";
    case "goods_not_received":
      return "Goods or services not received";
    case "service_not_as_promised":
      return "Service not as promised";
    case "other":
      return "Other";
    default:
      return r;
  }
}

function proofTypeLabel(p: PaymentDisputeProofType): string {
  switch (p) {
    case "receipt_order_confirmation":
      return "Receipt or order confirmation";
    case "screenshot":
      return "Screenshot(s)";
    case "email_chain":
      return "Email thread with merchant";
    case "merchant_chat_log":
      return "Chat log with merchant";
    case "bank_statement":
      return "Bank or card statement showing the charge";
    case "none_yet":
      return "No proof gathered yet";
    case "other":
      return "Other";
    default:
      return p;
  }
}

const PAYMENT_METHODS = new Set<PaymentMethodOption>([
  "credit_card",
  "debit_card",
  "bank_account_ach",
  "paypal",
  "apple_google_pay",
  "other",
]);

const DISPUTE_REASONS = new Set<DisputeReasonOption>([
  "unauthorized_charge",
  "duplicate_charge",
  "wrong_amount",
  "canceled_refunded_still_charged",
  "goods_not_received",
  "service_not_as_promised",
  "other",
]);

const PROOF_TYPES = new Set<PaymentDisputeProofType>([
  "receipt_order_confirmation",
  "screenshot",
  "email_chain",
  "merchant_chat_log",
  "bank_statement",
  "none_yet",
  "other",
]);

/** Best-effort packet parse from operator task notes when no saved draft is passed in. */
export function parsePaymentDisputeDraftFromTaskNotes(
  caseId: string,
  intake: JusticeIntake,
  taskNotes: string | null | undefined
): PaymentDisputeDraft {
  const fallback = buildDefaultPaymentDisputeDraft(caseId, intake);
  const trimmed = taskNotes?.trim() ?? "";
  if (!trimmed) return fallback;

  const packetIdx = trimmed.indexOf("\npacket:\n");
  if (packetIdx < 0) return fallback;
  const afterPacket = trimmed.slice(packetIdx + "\npacket:\n".length);
  const endMarkers = ["\nevidence:\n", "\ndraft:\n"];
  let end = afterPacket.length;
  for (const marker of endMarkers) {
    const idx = afterPacket.indexOf(marker);
    if (idx >= 0 && idx < end) end = idx;
  }
  const block = afterPacket.slice(0, end);
  const map = new Map<string, string>();
  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    map.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }

  const paymentMethodRaw = map.get("payment_method") ?? "";
  const disputeReasonRaw = map.get("dispute_reason") ?? "";
  const proofTypeRaw = map.get("proof_type") ?? "";
  const priorRaw = map.get("prior_company_contact") ?? "";

  return {
    case_id: caseId.trim() || fallback.case_id,
    payment_method: PAYMENT_METHODS.has(paymentMethodRaw as PaymentMethodOption)
      ? (paymentMethodRaw as PaymentMethodOption)
      : fallback.payment_method,
    charge_date: map.get("charge_date")?.replace(/^\(not set\)$/, "") || fallback.charge_date,
    charge_amount:
      map.get("charge_amount")?.replace(/^\(not set\)$/, "") || fallback.charge_amount,
    merchant_name:
      map.get("merchant_name") && map.get("merchant_name") !== "(unknown merchant)"
        ? (map.get("merchant_name") as string)
        : fallback.merchant_name,
    dispute_reason: DISPUTE_REASONS.has(disputeReasonRaw as DisputeReasonOption)
      ? (disputeReasonRaw as DisputeReasonOption)
      : fallback.dispute_reason,
    ...(map.get("dispute_reason_other")
      ? { dispute_reason_other: map.get("dispute_reason_other") }
      : {}),
    prior_company_contact:
      priorRaw === "yes" || priorRaw === "no" ? priorRaw : fallback.prior_company_contact,
    proof_type: PROOF_TYPES.has(proofTypeRaw as PaymentDisputeProofType)
      ? (proofTypeRaw as PaymentDisputeProofType)
      : fallback.proof_type,
  };
}

export function resolvePaymentDisputeDraftForWorkspace(input: {
  caseId: string;
  intake: JusticeIntake;
  taskNotes?: string | null;
  draft?: unknown;
}): PaymentDisputeDraft {
  if (isPaymentDisputeDraftPayload(input.draft)) {
    return { ...input.draft, case_id: input.caseId.trim() || input.draft.case_id };
  }
  return parsePaymentDisputeDraftFromTaskNotes(input.caseId, input.intake, input.taskNotes);
}

export function resolvePaymentDisputeDeliveryGuidance(
  intake: JusticeIntake,
  draft: PaymentDisputeDraft
): PaymentDisputeDeliveryGuidance {
  const merchantName =
    draft.merchant_name.trim() || intake.company_name.trim() || "(unknown merchant)";
  const recipientEmail = resolvePaymentDisputeRecipientEmail(intake);

  if (recipientEmail) {
    return {
      automated_email_eligible: true,
      recipient_email: recipientEmail,
      merchant_name: merchantName,
      operator_guidance:
        "Automated payment-dispute email may complete this step when a valid card-issuer contact email is on file. If this queue item is still open, send the bank/card dispute letter manually, then record the send confirmation below. This workspace does not invent delivery or mark the dispute sent.",
    };
  }

  return {
    automated_email_eligible: false,
    recipient_email: null,
    merchant_name: merchantName,
    operator_guidance:
      "Automated payment-dispute email is unavailable (no valid card-issuer contact email). Send the bank/card dispute letter manually using the draft and issuer/charge fields below, then record the send confirmation. This workspace does not invent delivery or mark the dispute sent.",
  };
}

export function buildPaymentDisputeChargeFields(
  draft: PaymentDisputeDraft
): PaymentDisputeChargeFields {
  const reason =
    draft.dispute_reason === "other" && draft.dispute_reason_other?.trim()
      ? `${disputeReasonLabel(draft.dispute_reason)}: ${draft.dispute_reason_other.trim()}`
      : disputeReasonLabel(draft.dispute_reason);

  return {
    payment_method: paymentMethodLabel(draft.payment_method),
    charge_date: draft.charge_date.trim() || "(not set)",
    charge_amount: draft.charge_amount.trim() || "(not set)",
    merchant_name: draft.merchant_name.trim() || "(unknown merchant)",
    dispute_reason: reason,
    prior_company_contact: draft.prior_company_contact === "yes" ? "Yes" : "No",
    proof_type: proofTypeLabel(draft.proof_type),
  };
}

export function buildPaymentDisputePreparedAnswers(
  intake: JusticeIntake,
  draft: PaymentDisputeDraft
): PaymentDisputePreparedAnswerField[] {
  const stateCode = intake.consumer_us_state?.trim().toUpperCase() ?? "";
  const recipientEmail = resolvePaymentDisputeRecipientEmail(intake);
  const charge = buildPaymentDisputeChargeFields(draft);

  const fields: PaymentDisputePreparedAnswerField[] = [
    answer("consumer_name", "Consumer name", intake.user_display_name),
    answer("consumer_email", "Consumer email", intake.reply_email),
    answer(
      "consumer_state",
      "Consumer state",
      stateCode ? `${stateNameFromCode(stateCode)} (${stateCode})` : "(not set)"
    ),
    answer("merchant_name", "Merchant / seller", charge.merchant_name),
    answer(
      "issuer_email",
      "Card issuer contact email",
      recipientEmail ?? "(not available — manual send required)"
    ),
    answer("payment_method", "Payment method", charge.payment_method),
    answer("charge_date", "Charge date", charge.charge_date),
    answer("charge_amount", "Charge amount", charge.charge_amount),
    answer("dispute_reason", "Dispute reason", charge.dispute_reason),
    answer("prior_company_contact", "Prior merchant contact", charge.prior_company_contact),
    answer("proof_type", "Evidence / proof type", charge.proof_type),
    answer("what_happened", "What happened", intake.story),
    answer(
      "order_confirmation",
      "Order / confirmation details",
      intake.order_confirmation_details.trim() || "(not provided)"
    ),
  ];

  return fields.filter((f) => f.value.length > 0);
}

export function mapPaymentDisputeWorkspaceEvidence(
  rows: readonly PaymentDisputeWorkspaceEvidenceInput[]
): PaymentDisputeWorkspaceEvidenceItem[] {
  return rows.map((row) => ({
    title: (row.title ?? "").trim() || "(untitled)",
    evidence_type: (row.evidence_type ?? "").trim() || "other",
    file_name: row.file_name?.trim() || null,
    evidence_date: row.evidence_date?.trim() || null,
  }));
}

export function resolvePaymentDisputeDraftLetterForWorkspace(
  intake: JusticeIntake,
  draft: PaymentDisputeDraft,
  taskNotes: string | null | undefined
): string {
  const fromNotes = parsePaymentDisputeFilingTaskDraft(taskNotes);
  if (fromNotes.trim()) return fromNotes.trim();
  return buildBankLetter(draft, intake);
}

export function buildPaymentDisputeOperatorFilingWorkspace(input: {
  intake: JusticeIntake;
  caseId?: string;
  taskNotes?: string | null;
  draft?: unknown;
  evidence?: readonly PaymentDisputeWorkspaceEvidenceInput[];
}): PaymentDisputeOperatorFilingWorkspace {
  const caseId =
    input.caseId?.trim() ||
    (isPaymentDisputeDraftPayload(input.draft) ? input.draft.case_id.trim() : "") ||
    "00000000-0000-0000-0000-000000000000";

  const draft = resolvePaymentDisputeDraftForWorkspace({
    caseId,
    intake: input.intake,
    taskNotes: input.taskNotes,
    draft: input.draft,
  });

  const filingDestination =
    canonicalFilingDestinationForApprovedActionHref(
      MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF
    ) ?? "Payment dispute (bank/card)";

  return {
    filing_destination: filingDestination,
    delivery: resolvePaymentDisputeDeliveryGuidance(input.intake, draft),
    charge_fields: buildPaymentDisputeChargeFields(draft),
    letter_draft: resolvePaymentDisputeDraftLetterForWorkspace(
      input.intake,
      draft,
      input.taskNotes
    ),
    prepared_answers: buildPaymentDisputePreparedAnswers(input.intake, draft),
    evidence: mapPaymentDisputeWorkspaceEvidence(input.evidence ?? []),
    is_submitted: false,
    confirmation_capture: {
      requires_filed_at: true,
      requires_confirmation_number: true,
      requires_destination: true,
    },
  };
}
