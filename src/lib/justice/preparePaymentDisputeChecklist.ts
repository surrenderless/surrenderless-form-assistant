import {
  buildDefaultPaymentDisputeDraft,
  type DisputeReasonOption,
  type PaymentDisputeDraft,
  type PaymentDisputeProofType,
  type PaymentMethodOption,
} from "@/lib/justice/buildPaymentDisputeBankLetter";
import {
  appendPaymentChecklistViewedOnce,
  appendTimelineEvent,
  readTimeline,
  replaceTimelineForCase,
} from "@/lib/justice/timeline";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1 } from "@/lib/justice/types";

export const DISPUTE_REASON_VALUES: DisputeReasonOption[] = [
  "unauthorized_charge",
  "duplicate_charge",
  "wrong_amount",
  "canceled_refunded_still_charged",
  "goods_not_received",
  "service_not_as_promised",
  "other",
];

export function isDisputeReasonOption(s: string): s is DisputeReasonOption {
  return DISPUTE_REASON_VALUES.includes(s as DisputeReasonOption);
}

export function loadPaymentDisputeDraftFromSession(caseId: string): Partial<PaymentDisputeDraft> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<PaymentDisputeDraft> & { dispute_reason?: string };
    if (d.case_id !== caseId) return null;
    return d;
  } catch {
    return null;
  }
}

export function savePaymentDisputeDraftToSession(draft: PaymentDisputeDraft): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1, JSON.stringify(draft));
}

export type PaymentDisputeFormFields = {
  paymentMethod: PaymentMethodOption;
  chargeDate: string;
  chargeAmount: string;
  merchantName: string;
  disputeReason: DisputeReasonOption;
  disputeReasonOther: string;
  priorContact: "yes" | "no";
  proofType: PaymentDisputeProofType;
};

export function resolvePaymentDisputeFormFields(caseId: string, intake: JusticeIntake): PaymentDisputeFormFields {
  const saved = loadPaymentDisputeDraftFromSession(caseId);
  if (saved && saved.case_id === caseId) {
    let disputeReason: DisputeReasonOption = "unauthorized_charge";
    let disputeReasonOther = "";
    if (typeof saved.dispute_reason === "string") {
      if (isDisputeReasonOption(saved.dispute_reason)) {
        disputeReason = saved.dispute_reason;
        if (typeof saved.dispute_reason_other === "string") {
          disputeReasonOther = saved.dispute_reason_other;
        }
      } else {
        disputeReason = "other";
        disputeReasonOther = saved.dispute_reason;
      }
    }
    return {
      paymentMethod: saved.payment_method ?? "credit_card",
      chargeDate: typeof saved.charge_date === "string" ? saved.charge_date : "",
      chargeAmount: typeof saved.charge_amount === "string" ? saved.charge_amount : "",
      merchantName: typeof saved.merchant_name === "string" ? saved.merchant_name : "",
      disputeReason,
      disputeReasonOther,
      priorContact:
        saved.prior_company_contact === "yes" || saved.prior_company_contact === "no"
          ? saved.prior_company_contact
          : "no",
      proofType: saved.proof_type ?? "receipt_order_confirmation",
    };
  }

  const defaults = buildDefaultPaymentDisputeDraft(caseId, intake);
  return {
    paymentMethod: defaults.payment_method,
    chargeDate: defaults.charge_date,
    chargeAmount: defaults.charge_amount,
    merchantName: defaults.merchant_name,
    disputeReason: defaults.dispute_reason,
    disputeReasonOther: "",
    priorContact: defaults.prior_company_contact,
    proofType: defaults.proof_type,
  };
}

export function buildPaymentDisputeDraftFromFields(
  caseId: string,
  fields: PaymentDisputeFormFields
): PaymentDisputeDraft {
  const draft: PaymentDisputeDraft = {
    case_id: caseId,
    payment_method: fields.paymentMethod,
    charge_date: fields.chargeDate,
    charge_amount: fields.chargeAmount,
    merchant_name: fields.merchantName,
    dispute_reason: fields.disputeReason,
    prior_company_contact: fields.priorContact,
    proof_type: fields.proofType,
  };
  if (fields.disputeReason === "other" && fields.disputeReasonOther.trim()) {
    draft.dispute_reason_other = fields.disputeReasonOther.trim();
  }
  return draft;
}

export async function logPaymentDisputeChecklistViewed(caseId: string, logLabel?: string): Promise<void> {
  if (!caseId.trim()) return;
  appendPaymentChecklistViewedOnce(caseId);
  try {
    await fetch("/api/justice/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: "payment_dispute_checklist_viewed",
        payload: { case_id: caseId },
      }),
    });
  } catch (e) {
    console.warn(`${logLabel ?? "justice payment-dispute"}: checklist viewed event error`, e);
  }
}

export type PreparePaymentDisputeChecklistParams = {
  draft: PaymentDisputeDraft;
  caseId: string;
  isLoaded: boolean;
  isSignedIn: boolean;
  logLabel?: string;
};

/** Persist payment-dispute checklist (session, timeline, optional signed-in PATCH). */
export async function preparePaymentDisputeChecklist({
  draft,
  caseId,
  isLoaded,
  isSignedIn,
  logLabel = "justice payment-dispute",
}: PreparePaymentDisputeChecklistParams): Promise<{ ok: true }> {
  savePaymentDisputeDraftToSession(draft);
  appendTimelineEvent(caseId, {
    type: "payment_dispute_checklist_prepared",
    label: "Payment dispute checklist prepared",
  });

  if (isLoaded && isSignedIn && caseId) {
    try {
      const timeline = readTimeline(caseId);
      const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_dispute_draft: draft, timeline }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          payment_dispute_draft?: unknown;
          timeline?: unknown;
        };
        if (data.payment_dispute_draft != null) {
          sessionStorage.setItem(
            STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1,
            JSON.stringify(data.payment_dispute_draft)
          );
        }
        if (Array.isArray(data.timeline)) {
          replaceTimelineForCase(caseId, data.timeline as TimelineEntry[]);
        }
      } else {
        console.warn(`${logLabel}: PATCH /api/justice/cases/[id] failed`, res.status);
      }
    } catch (e) {
      console.warn(`${logLabel}: PATCH /api/justice/cases/[id] error`, e);
    }
  }

  try {
    await fetch("/api/justice/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: "payment_dispute_checklist_prepared",
        payload: { case_id: caseId },
      }),
    });
  } catch {
    /* ignore */
  }

  return { ok: true };
}
