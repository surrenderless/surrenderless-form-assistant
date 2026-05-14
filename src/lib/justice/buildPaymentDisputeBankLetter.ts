import type { JusticeIntake } from "@/lib/justice/types";

export type PaymentMethodOption =
  | "credit_card"
  | "debit_card"
  | "bank_account_ach"
  | "paypal"
  | "apple_google_pay"
  | "other";

export type PaymentDisputeProofType =
  | "receipt_order_confirmation"
  | "screenshot"
  | "email_chain"
  | "merchant_chat_log"
  | "bank_statement"
  | "none_yet"
  | "other";

export type DisputeReasonOption =
  | "unauthorized_charge"
  | "duplicate_charge"
  | "wrong_amount"
  | "canceled_refunded_still_charged"
  | "goods_not_received"
  | "service_not_as_promised"
  | "other";

export type PaymentDisputeDraft = {
  case_id: string;
  payment_method: PaymentMethodOption;
  charge_date: string;
  charge_amount: string;
  merchant_name: string;
  dispute_reason: DisputeReasonOption;
  dispute_reason_other?: string;
  prior_company_contact: "yes" | "no";
  proof_type: PaymentDisputeProofType;
};

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
    default: {
      const _e: never = m;
      return _e;
    }
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
    default: {
      const _e: never = p;
      return _e;
    }
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
    default: {
      const _e: never = r;
      return _e;
    }
  }
}

function buildDisputeReasonLetterLines(draft: PaymentDisputeDraft): string[] {
  const category = disputeReasonLabel(draft.dispute_reason);
  if (draft.dispute_reason === "other") {
    const detail = draft.dispute_reason_other?.trim() ?? "";
    return [
      `I am disputing this charge as: ${category}.`,
      detail ? `Further explanation: ${detail}` : "",
    ];
  }
  return [`I am disputing this charge as: ${category}.`];
}

/** Same defaults as /justice/payment-dispute when no saved session draft exists. */
export function buildDefaultPaymentDisputeDraft(caseId: string, intake: JusticeIntake): PaymentDisputeDraft {
  return {
    case_id: caseId,
    payment_method: "credit_card",
    charge_date: intake.pay_or_order_date.trim(),
    charge_amount: intake.money_involved.trim(),
    merchant_name: intake.company_name.trim(),
    dispute_reason: "unauthorized_charge",
    prior_company_contact: intake.already_contacted === "yes" ? "yes" : "no",
    proof_type: "receipt_order_confirmation",
  };
}

/** Deterministic bank/card issuer dispute letter from checklist draft + intake. */
export function buildBankLetter(draft: PaymentDisputeDraft, intake: JusticeIntake): string {
  const reasonLines = buildDisputeReasonLetterLines(draft);
  const lines = [
    "DISPUTE REQUEST — copy into your bank/card issuer message or dispute form",
    "",
    `Consumer: ${intake.user_display_name.trim()}`,
    `Contact email: ${intake.reply_email.trim()}`,
    "",
    "Transaction / merchant",
    `Merchant or seller name: ${draft.merchant_name.trim()}`,
    `Amount disputed: ${draft.charge_amount.trim()}`,
    `Charge date (as shown on statement if known): ${draft.charge_date.trim()}`,
    `Payment method I used: ${paymentMethodLabel(draft.payment_method)}`,
    "",
    "Reason for dispute",
    ...reasonLines,
    "",
    `Prior contact with the merchant/company about this charge: ${draft.prior_company_contact === "yes" ? "Yes" : "No"}`,
    `Evidence I have or will provide: ${proofTypeLabel(draft.proof_type)}`,
    "",
    intake.order_confirmation_details.trim()
      ? `Additional reference from my records: ${intake.order_confirmation_details.trim()}`
      : "",
    "",
    "I am requesting that this charge be reversed or credited according to my issuer’s dispute rules.",
    "",
    "Thank you,",
    intake.user_display_name.trim(),
  ];
  return lines.filter(Boolean).join("\n").trim();
}
