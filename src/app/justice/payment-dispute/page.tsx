"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/app/components/Header";
import JusticeFilingRecords from "@/app/components/JusticeFilingRecords";
import JusticeSavedEvidenceList from "@/app/components/JusticeSavedEvidenceList";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import {
  buildBankLetter,
  type DisputeReasonOption,
  type PaymentDisputeDraft,
  type PaymentDisputeProofType,
  type PaymentMethodOption,
} from "@/lib/justice/buildPaymentDisputeBankLetter";
import {
  logPaymentDisputeChecklistViewed,
  preparePaymentDisputeChecklist,
  resolvePaymentDisputeFormFields,
} from "@/lib/justice/preparePaymentDisputeChecklist";
import { useJusticeActionPageHydration } from "@/lib/justice/useJusticeActionPageHydration";
import { useRedirectConsumerActiveCaseOffOptionalHubEscapePage } from "@/lib/justice/useRedirectConsumerActiveCaseOffOptionalHubEscapePage";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import { SurrenderlessOwnedHumanFulfillmentPrepReadOnly } from "@/app/components/SurrenderlessOwnedHumanFulfillmentPrepReadOnly";
import { useSurrenderlessOwnedHumanFulfillmentPrepPage } from "@/lib/justice/useSurrenderlessOwnedHumanFulfillmentPrepPage";

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

export default function JusticePaymentDisputePage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const ownedPrepPage = useSurrenderlessOwnedHumanFulfillmentPrepPage(
    MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF
  );
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
      router.replace("/justice");
      return;
    }
    setCaseId(cid);
    void logPaymentDisputeChecklistViewed(cid);

    const fields = resolvePaymentDisputeFormFields(cid, intake);
    setPaymentMethod(fields.paymentMethod);
    setChargeDate(fields.chargeDate);
    setChargeAmount(fields.chargeAmount);
    setMerchantName(fields.merchantName);
    setDisputeReason(fields.disputeReason);
    setDisputeReasonOther(fields.disputeReasonOther);
    setPriorContact(fields.priorContact);
    setProofType(fields.proofType);
    setFormReady(true);
  }, [hydrationStatus, intake, router]);

  const draft: PaymentDisputeDraft | null = useMemo(() => {
    if (!caseId) return null;
    const draft: PaymentDisputeDraft = {
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
      await preparePaymentDisputeChecklist({
        draft,
        caseId,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
      });
      router.push("/justice/chat-ai");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]";
  const labelCls = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

  const redirectOffOptionalHub = useRedirectConsumerActiveCaseOffOptionalHubEscapePage({
    escapePageHref: "/justice/payment-dispute",
    caseId,
    hasResumableCase: hydrationStatus === "ready" && Boolean(intake),
  });

  if (ownedPrepPage.status === "owned") {
    return <SurrenderlessOwnedHumanFulfillmentPrepReadOnly stepLabel={ownedPrepPage.stepLabel} />;
  }

  if (hydrationStatus === "needs_sign_in") {
    return <JusticeActionResumeSignInPrompt />;
  }

  if (hydrationStatus !== "ready" || !intake || !formReady || redirectOffOptionalHub) {
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
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/justice/chat-ai" className="text-blue-600 hover:underline dark:text-blue-400">
            Update in chat
          </Link>
          {" · "}
          <Link href="/justice" className="text-blue-600 hover:underline dark:text-blue-400">
            Justice workspace
          </Link>
        </p>

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
            {saving ? "Saving…" : "Save and continue in chat"}
          </button>
        </form>

        <JusticeSavedEvidenceList />

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

        <JusticeFilingRecords
          lockedDestination={canonicalFilingDestinationForApprovedActionHref(
            MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF
          )}
        />
      </main>
    </>
  );
}
