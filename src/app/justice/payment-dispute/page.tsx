"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/app/components/Header";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1 } from "@/lib/justice/types";
import { useJusticeActionPageHydration } from "@/lib/justice/useJusticeActionPageHydration";
import {
  appendPaymentChecklistViewedOnce,
  appendTimelineEvent,
  readTimeline,
  replaceTimelineForCase,
} from "@/lib/justice/timeline";

type PaymentMethodOption =
  | "credit_card"
  | "debit_card"
  | "bank_account_ach"
  | "paypal"
  | "apple_google_pay"
  | "other";

type PaymentDisputeProofType =
  | "receipt_order_confirmation"
  | "screenshot"
  | "email_chain"
  | "merchant_chat_log"
  | "bank_statement"
  | "none_yet"
  | "other";

type DisputeReasonOption =
  | "unauthorized_charge"
  | "duplicate_charge"
  | "wrong_amount"
  | "canceled_refunded_still_charged"
  | "goods_not_received"
  | "service_not_as_promised"
  | "other";

const DISPUTE_REASON_VALUES: DisputeReasonOption[] = [
  "unauthorized_charge",
  "duplicate_charge",
  "wrong_amount",
  "canceled_refunded_still_charged",
  "goods_not_received",
  "service_not_as_promised",
  "other",
];

function isDisputeReasonOption(s: string): s is DisputeReasonOption {
  return DISPUTE_REASON_VALUES.includes(s as DisputeReasonOption);
}

type PaymentDraft = {
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

function loadDraft(caseId: string): Partial<PaymentDraft> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<PaymentDraft> & { dispute_reason?: string };
    if (d.case_id !== caseId) return null;
    return d;
  } catch {
    return null;
  }
}

function saveDraft(draft: PaymentDraft) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1, JSON.stringify(draft));
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

function buildDisputeReasonLetterLines(draft: PaymentDraft): string[] {
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

function buildBankLetter(draft: PaymentDraft, intake: JusticeIntake): string {
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

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

export default function JusticePaymentDisputePage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const { status: hydrationStatus, intake } = useJusticeActionPageHydration();
  const [caseId, setCaseId] = useState("");
  const [formReady, setFormReady] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodOption>("credit_card");
  const [chargeDate, setChargeDate] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [disputeReason, setDisputeReason] = useState<DisputeReasonOption>("unauthorized_charge");
  const [disputeReasonOther, setDisputeReasonOther] = useState("");
  const [priorContact, setPriorContact] = useState<"yes" | "no">("no");
  const [proofType, setProofType] = useState<PaymentDisputeProofType>("receipt_order_confirmation");
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (hydrationStatus !== "ready" || !intake) return;
    if (typeof window === "undefined") return;
    const cid = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    if (!cid) {
      router.replace("/justice/intake");
      return;
    }
    setCaseId(cid);
    appendPaymentChecklistViewedOnce(cid);
    void fetch("/api/justice/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: "payment_dispute_checklist_viewed",
        payload: { case_id: cid },
      }),
    }).catch(() => {});

    const saved = loadDraft(cid);
    if (saved && saved.case_id === cid) {
      if (saved.payment_method) setPaymentMethod(saved.payment_method);
      if (typeof saved.charge_date === "string") setChargeDate(saved.charge_date);
      if (typeof saved.charge_amount === "string") setChargeAmount(saved.charge_amount);
      if (typeof saved.merchant_name === "string") setMerchantName(saved.merchant_name);
      if (typeof saved.dispute_reason === "string") {
        if (isDisputeReasonOption(saved.dispute_reason)) {
          setDisputeReason(saved.dispute_reason);
          if (typeof saved.dispute_reason_other === "string") {
            setDisputeReasonOther(saved.dispute_reason_other);
          }
        } else {
          setDisputeReason("other");
          setDisputeReasonOther(saved.dispute_reason);
        }
      }
      if (saved.prior_company_contact === "yes" || saved.prior_company_contact === "no") {
        setPriorContact(saved.prior_company_contact);
      }
      if (saved.proof_type) setProofType(saved.proof_type);
    } else {
      setChargeAmount(intake.money_involved.trim());
      setChargeDate(intake.pay_or_order_date.trim());
      setMerchantName(intake.company_name.trim());
      setDisputeReason("unauthorized_charge");
      setDisputeReasonOther("");
      setPriorContact(intake.already_contacted === "yes" ? "yes" : "no");
    }
    setFormReady(true);
  }, [hydrationStatus, intake, router]);

  const draft: PaymentDraft | null = useMemo(() => {
    if (!caseId) return null;
    const draft: PaymentDraft = {
      case_id: caseId,
      payment_method: paymentMethod,
      charge_date: chargeDate,
      charge_amount: chargeAmount,
      merchant_name: merchantName,
      dispute_reason: disputeReason,
      prior_company_contact: priorContact,
      proof_type: proofType,
    };
    if (disputeReason === "other" && disputeReasonOther.trim()) {
      draft.dispute_reason_other = disputeReasonOther.trim();
    }
    return draft;
  }, [caseId, paymentMethod, chargeDate, chargeAmount, merchantName, disputeReason, disputeReasonOther, priorContact, proofType]);

  const letterText = useMemo(() => {
    if (!intake || !draft) return "";
    return buildBankLetter(draft, intake);
  }, [intake, draft]);

  async function copyLetter() {
    try {
      await navigator.clipboard.writeText(letterText);
      setCopyHint("Copied to clipboard.");
      window.setTimeout(() => setCopyHint(null), 2500);
    } catch {
      setCopyHint("Copy failed — select the text and copy manually.");
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!intake || !draft || !caseId) return;
    setSaving(true);
    try {
      saveDraft(draft);
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
            console.warn("justice payment-dispute: PATCH /api/justice/cases/[id] failed", res.status);
          }
        } catch (e) {
          console.warn("justice payment-dispute: PATCH /api/justice/cases/[id] error", e);
        }
      }

      await fetch("/api/justice/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "payment_dispute_checklist_prepared",
          payload: { case_id: caseId },
        }),
      }).catch(() => {});
      router.push("/justice/plan");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]";
  const labelCls = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

  if (hydrationStatus === "needs_sign_in") {
    return <JusticeActionResumeSignInPrompt />;
  }

  if (hydrationStatus !== "ready" || !intake || !formReady) {
    return (
      <>
        <Header />
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
          Loading…
        </main>
      </>
    );
  }

  const issueSummary = intake.problem_category.replace(/_/g, " ");

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <Link href="/justice/plan" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
          Back to action plan
        </Link>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Payment dispute checklist</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Fill this in, copy the letter below for your bank or card issuer, then save to record it on your case timeline.
        </p>

        <div className={`mt-6 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Case summary</p>
          <ul className="mt-3 space-y-2 text-sm text-neutral-800 dark:text-neutral-200">
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Company:</span> {intake.company_name}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Purchase / signup:</span>{" "}
              {intake.purchase_or_signup.trim() || "—"}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Issue type:</span> {issueSummary}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Money (from intake):</span> {intake.money_involved}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Order / problem date (from intake):</span>{" "}
              {intake.pay_or_order_date}
            </li>
          </ul>
          <p className="mt-3 rounded-xl border border-neutral-200/80 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 shadow-inner dark:border-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-400">
            Case id: {caseId || "—"}
          </p>
        </div>

        <form onSubmit={(e) => void handleSave(e)} className={`mt-6 space-y-4 ${cardCls}`}>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Dispute details</p>

          <div>
            <label className={labelCls}>Payment method used</label>
            <select
              className={inputCls}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodOption)}
              required
            >
              <option value="credit_card">Credit card</option>
              <option value="debit_card">Debit card</option>
              <option value="bank_account_ach">Bank account / ACH</option>
              <option value="paypal">PayPal / similar wallet</option>
              <option value="apple_google_pay">Apple Pay / Google Pay</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Charge date (statement or transaction date)</label>
            <input
              className={inputCls}
              value={chargeDate}
              onChange={(e) => setChargeDate(e.target.value)}
              required
              placeholder="e.g. 2026-04-15 or as shown on your statement"
            />
          </div>

          <div>
            <label className={labelCls}>Charge amount</label>
            <input
              className={inputCls}
              value={chargeAmount}
              onChange={(e) => setChargeAmount(e.target.value)}
              required
              placeholder="e.g. $49.99"
            />
          </div>

          <div>
            <label className={labelCls}>Merchant / company name</label>
            <input
              className={inputCls}
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              required
              placeholder="As it appears on your statement"
            />
          </div>

          <div>
            <label className={labelCls}>Dispute reason</label>
            <select
              className={inputCls}
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value as DisputeReasonOption)}
              required
            >
              <option value="unauthorized_charge">Unauthorized charge</option>
              <option value="duplicate_charge">Duplicate charge</option>
              <option value="wrong_amount">Wrong amount</option>
              <option value="canceled_refunded_still_charged">Canceled or refunded but still charged</option>
              <option value="goods_not_received">Goods or services not received</option>
              <option value="service_not_as_promised">Service not as promised</option>
              <option value="other">Other</option>
            </select>
            {disputeReason === "other" ? (
              <textarea
                className={`${inputCls} mt-2`}
                rows={3}
                value={disputeReasonOther}
                onChange={(e) => setDisputeReasonOther(e.target.value)}
                required
                placeholder="Briefly explain what happened."
              />
            ) : null}
          </div>

          <div>
            <span className={labelCls}>Prior contact with the company about this charge?</span>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                <input type="radio" name="prior" checked={priorContact === "yes"} onChange={() => setPriorContact("yes")} />
                Yes
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                <input type="radio" name="prior" checked={priorContact === "no"} onChange={() => setPriorContact("no")} />
                No
              </label>
            </div>
          </div>

          <div>
            <label className={labelCls}>Proof you have (or will gather)</label>
            <select
              className={inputCls}
              value={proofType}
              onChange={(e) => setProofType(e.target.value as PaymentDisputeProofType)}
              required
            >
              <option value="receipt_order_confirmation">Receipt or order confirmation</option>
              <option value="screenshot">Screenshot(s)</option>
              <option value="email_chain">Email thread with merchant</option>
              <option value="merchant_chat_log">Chat log with merchant</option>
              <option value="bank_statement">Bank or card statement showing the charge</option>
              <option value="none_yet">No proof gathered yet</option>
              <option value="other">Other</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-blue-600 px-4 py-3.5 font-semibold text-white shadow-lg shadow-blue-900/25 transition hover:bg-blue-700 hover:shadow-xl disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save and return to action plan"}
          </button>
        </form>

        <div className={`mt-6 ${cardCls}`}>
          <label className={labelCls}>Copy for your bank or card issuer</label>
          <textarea readOnly className={`${inputCls} mt-2 font-mono text-xs leading-relaxed`} rows={18} value={letterText} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void copyLetter()}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
            >
              Copy text
            </button>
            {copyHint ? (
              <span className="text-xs text-emerald-700 dark:text-emerald-400">{copyHint}</span>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            Paste into your banking app dispute flow or read aloud if you call the number on your card. This app does not
            submit disputes for you.
          </p>
        </div>
      </main>
    </>
  );
}
