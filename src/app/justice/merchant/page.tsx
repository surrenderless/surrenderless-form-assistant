"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/app/components/Header";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK, STORAGE_INTAKE } from "@/lib/justice/types";
import { cfpbLikelyRelevant, fccLikelyRelevant, isValidDocumentedContactDate } from "@/lib/justice/rules";
import {
  appendEscalationUnlockedFromMerchantSaveOnce,
  appendTimelineEvent,
  readTimeline,
  replaceTimelineForCase,
} from "@/lib/justice/timeline";
import { useJusticeActionPageHydration } from "@/lib/justice/useJusticeActionPageHydration";

async function logEvent(event_name: string, payload: Record<string, unknown>) {
  try {
    await fetch("/api/justice/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name, payload }),
    });
  } catch {
    /* ignore */
  }
}

function desiredResolutionPhrase(category: JusticeIntake["problem_category"]): string {
  switch (category) {
    case "online_purchase":
      return "a full refund or a correct replacement, whichever fairly applies";
    case "subscription":
      return "cancellation of unwanted recurring charges and any refund owed for improper renewals";
    case "service_failed":
      return "a remedy that matches what was promised (refund, redo, or credit)";
    case "charge_dispute":
      return "reversal of the charge or a clear written justification";
    case "something_else":
      return "a fair resolution that puts me back to where I should have been";
    default:
      return "a fair resolution that puts me back to where I should have been";
  }
}

/** Merchant-facing line for CFPB-style cases (not raw intake problem_category). */
function cfpbFinancialProductSummary(intake: JusticeIntake): string {
  const s = intake.purchase_or_signup.trim();
  return s || "financial product, account, or billing issue";
}

function isOrderPurchaseIntake(intake: JusticeIntake): boolean {
  return intake.problem_category === "online_purchase";
}

const CFPB_MERCHANT_RESOLUTION_ASK =
  "review the issue, correct any account error, refund or credit any improper charge, and provide written confirmation";

function buildMerchantMessage(intake: JusticeIntake): string {
  const issueLabel = intake.problem_category.replace(/_/g, " ");
  const ask = desiredResolutionPhrase(intake.problem_category);
  const serviceLine = intake.purchase_or_signup.trim() || "communications service";

  if (fccLikelyRelevant(intake)) {
    const aboutLine = intake.purchase_or_signup.trim() || serviceLine;
    return `Dear ${intake.company_name} Support,

I am writing about the following: ${aboutLine}.
Service or product involved: ${serviceLine}.

What happened:
${intake.story.trim()}

Approximate amount involved: ${intake.money_involved}. Problem date / start date: ${intake.pay_or_order_date}.

I am requesting ${ask}.

Please send a substantive reply by a specific date you propose, or within 10 business days of this message. I am keeping a dated copy of this contact and your response as proof.

Sincerely,
${intake.user_display_name}
${intake.reply_email}`.trim();
  }

  if (cfpbLikelyRelevant(intake)) {
    const financialLine = cfpbFinancialProductSummary(intake);
    const aboutLine = intake.purchase_or_signup.trim() || financialLine;
    const introBlock = isOrderPurchaseIntake(intake)
      ? `I am writing about the following: ${aboutLine}.
Financial product or service involved: ${financialLine}.`
      : `I am writing about a problem involving this financial product or service: ${financialLine}.`;
    const amountLine = isOrderPurchaseIntake(intake)
      ? `Approximate amount involved: ${intake.money_involved}. Problem date / start date: ${intake.pay_or_order_date}.`
      : `Approximate amount involved (if any): ${intake.money_involved}. Problem date / start date: ${intake.pay_or_order_date}.`;
    return `Dear ${intake.company_name} Support,

${introBlock}

What happened:
${intake.story.trim()}

${amountLine}

I am requesting that you ${CFPB_MERCHANT_RESOLUTION_ASK}.

Please send a substantive reply by a specific date you propose, or within 10 business days of this message. I am keeping a dated copy of this contact and your response as proof.

Sincerely,
${intake.user_display_name}
${intake.reply_email}`.trim();
  }

  return `Dear ${intake.company_name} Support,

I am writing about the following: ${intake.purchase_or_signup}.
Issue type: ${issueLabel}.

What happened:
${intake.story.trim()}

Approximate amount involved: ${intake.money_involved}. Order or payment date: ${intake.pay_or_order_date}.

I am requesting ${ask}.

Please send a substantive reply by a specific date you propose, or within 10 business days of this message. I am keeping a dated copy of this contact and your response as proof.

Sincerely,
${intake.user_display_name}
${intake.reply_email}`.trim();
}

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

export default function JusticeMerchantPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const { status: hydrationStatus, intake: hydratedIntake } = useJusticeActionPageHydration();
  const [intake, setIntake] = useState<JusticeIntake | null>(null);
  const [contactMethod, setContactMethod] = useState<NonNullable<JusticeIntake["contact_method"]>>("email");
  const [contactDate, setContactDate] = useState("");
  const [merchantResponseType, setMerchantResponseType] =
    useState<NonNullable<JusticeIntake["merchant_response_type"]>>("no_response");
  const [contactProofType, setContactProofType] =
    useState<NonNullable<JusticeIntake["contact_proof_type"]>>("none");
  const [contactProofText, setContactProofText] = useState("");
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [contactDateError, setContactDateError] = useState<string | null>(null);
  const [contactProofError, setContactProofError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (hydrationStatus !== "ready" || !hydratedIntake) return;
    const data = hydratedIntake;
    setIntake(data);
    if (data.already_contacted === "yes") {
      if (data.contact_method) setContactMethod(data.contact_method);
      if (typeof data.contact_date === "string" && isValidDocumentedContactDate(data.contact_date)) {
        setContactDate(data.contact_date.trim());
      }
      if (data.merchant_response_type) setMerchantResponseType(data.merchant_response_type);
      if (data.contact_proof_type) setContactProofType(data.contact_proof_type);
      if (typeof data.contact_proof_text === "string") setContactProofText(data.contact_proof_text);
    }
  }, [hydrationStatus, hydratedIntake]);

  const message = useMemo(() => (intake ? buildMerchantMessage(intake) : ""), [intake]);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopyHint("Copied to clipboard.");
      window.setTimeout(() => setCopyHint(null), 2500);
    } catch {
      setCopyHint("Copy failed — select the text and copy manually.");
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!intake) return;
    const dateTrimmed = contactDate.trim();
    if (!dateTrimmed || !isValidDocumentedContactDate(dateTrimmed)) {
      setContactDateError("Enter the contact date.");
      return;
    }
    setContactDateError(null);
    if (contactProofType === "none" && !contactProofText.trim()) {
      setContactProofError("Describe your contact attempt before saving.");
      return;
    }
    if (contactProofType === "ticket" && !contactProofText.trim()) {
      setContactProofError("Enter the ticket or case number before saving.");
      return;
    }
    setContactProofError(null);
    setSaving(true);
    try {
      const updated: JusticeIntake = {
        ...intake,
        already_contacted: "yes",
        contact_method: contactMethod,
        contact_date: dateTrimmed,
        merchant_response_type: merchantResponseType,
        contact_proof_type: contactProofType,
      };
      if (contactProofText.trim()) {
        updated.contact_proof_text = contactProofText.trim();
      } else {
        delete updated.contact_proof_text;
      }
      sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(updated));
      sessionStorage.removeItem("justice_ftc_mock_completed");
      sessionStorage.removeItem(STORAGE_FTC_MANUAL_UNLOCK);

      const caseId = sessionStorage.getItem(STORAGE_CASE_ID);
      if (caseId) {
        const companyContact =
          cfpbLikelyRelevant(updated) || fccLikelyRelevant(updated);
        appendTimelineEvent(caseId, {
          type: "merchant_contact_saved",
          label: companyContact ? "Company contact documented" : "Merchant contact saved",
          detail: `${companyContact ? "Company" : "Merchant"} response: ${merchantResponseType}`,
        });
        appendEscalationUnlockedFromMerchantSaveOnce(caseId, updated);
      }

      if (isLoaded && isSignedIn && caseId) {
        try {
          const timeline = readTimeline(caseId);
          const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intake: updated, timeline }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              intake?: JusticeIntake;
              timeline?: unknown;
            };
            if (data.intake) {
              sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(data.intake));
            }
            if (Array.isArray(data.timeline)) {
              replaceTimelineForCase(caseId, data.timeline as TimelineEntry[]);
            }
          } else {
            console.warn("justice merchant: PATCH /api/justice/cases/[id] failed", res.status);
          }
        } catch (e) {
          console.warn("justice merchant: PATCH /api/justice/cases/[id] error", e);
        }
      }

      await logEvent("merchant_contact_saved", {
        case_id: sessionStorage.getItem(STORAGE_CASE_ID),
        merchant_response_type: merchantResponseType,
      });
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

  if (hydrationStatus !== "ready" || !intake) {
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
  const fccRel = fccLikelyRelevant(intake);
  const cfpbRel = cfpbLikelyRelevant(intake);
  const useCompanyContactLabels = cfpbRel || fccRel;
  const proofDetailsLabel =
    contactProofType === "none"
      ? "Describe your contact attempt"
      : contactProofType === "ticket"
        ? "Ticket or case number"
        : "Proof details (optional)";
  const proofDetailsPlaceholder =
    contactProofType === "none"
      ? "Example: I called on 04/27, waited 20 minutes, spoke to support, and they said they could not help."
      : contactProofType === "ticket"
        ? "e.g. Case #12345 or support ticket ID"
        : "Ticket number, paste of email, case ID, etc.";

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <Link href="/justice/plan" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
          Back to action plan
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {useCompanyContactLabels ? "Company contact & proof" : "Merchant contact & proof"}
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Use the message below with the company, then save what happened so your action plan stays accurate.
        </p>

        <div className={`mt-6 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Case summary</p>
          <ul className="mt-3 space-y-2 text-sm text-neutral-800 dark:text-neutral-200">
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Company:</span> {intake.company_name}
            </li>
            {fccRel ? (
              <li>
                <span className="text-neutral-500 dark:text-neutral-400">Service / product:</span>{" "}
                {intake.purchase_or_signup.trim() || "—"}
              </li>
            ) : cfpbRel ? (
              <li>
                <span className="text-neutral-500 dark:text-neutral-400">Financial product or service:</span>{" "}
                {cfpbFinancialProductSummary(intake)}
              </li>
            ) : (
              <li>
                <span className="text-neutral-500 dark:text-neutral-400">Issue:</span> {issueSummary}
              </li>
            )}
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Money:</span> {intake.money_involved}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">
                {fccRel || cfpbRel ? "When did this problem happen or start?" : "Order / pay date:"}
              </span>{" "}
              {intake.pay_or_order_date}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Your email:</span> {intake.reply_email}
            </li>
          </ul>
          <p className="mt-3 rounded-xl border border-neutral-200/80 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 shadow-inner dark:border-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-400">
            Case id: {typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) ?? "—" : "—"}
          </p>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <label className={labelCls}>Message to send (copy and paste)</label>
          <textarea
            readOnly
            className={`${inputCls} mt-2 font-mono text-xs leading-relaxed`}
            rows={14}
            value={message}
            aria-label={
              useCompanyContactLabels ? "Generated company contact message" : "Generated merchant contact message"
            }
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void copyMessage()}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
            >
              Copy message
            </button>
            {copyHint ? (
              <span className="text-xs text-emerald-700 dark:text-emerald-400">{copyHint}</span>
            ) : null}
          </div>
        </div>

        <form onSubmit={(e) => void handleSave(e)} className={`mt-6 space-y-4 ${cardCls}`}>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">After you contact them</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Record how you reached out, when, and what they did — this updates your plan and unlocks escalation when
            appropriate.
          </p>

          <div>
            <label className={labelCls}>Contact method</label>
            <select
              className={inputCls}
              value={contactMethod}
              onChange={(e) => setContactMethod(e.target.value as NonNullable<JusticeIntake["contact_method"]>)}
              required
            >
              <option value="email">Email</option>
              <option value="chat">Live chat</option>
              <option value="phone">Phone</option>
              <option value="form">Online contact form</option>
              <option value="in_person">In person</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className={labelCls} htmlFor="justice-contact-date">
              Contact date
            </label>
            <input
              id="justice-contact-date"
              type="date"
              className={inputCls}
              value={contactDate}
              onChange={(e) => {
                setContactDate(e.target.value);
                setContactDateError(null);
              }}
              aria-invalid={contactDateError ? true : undefined}
              aria-describedby={contactDateError ? "justice-contact-date-error" : undefined}
            />
            {contactDateError ? (
              <p id="justice-contact-date-error" className="mt-1 text-xs text-red-600 dark:text-red-400">
                {contactDateError}
              </p>
            ) : null}
          </div>

          <div>
            <label className={labelCls}>{useCompanyContactLabels ? "Company response" : "Merchant response"}</label>
            <select
              className={inputCls}
              value={merchantResponseType}
              onChange={(e) =>
                setMerchantResponseType(e.target.value as NonNullable<JusticeIntake["merchant_response_type"]>)
              }
              required
            >
              <option value="no_response">No response yet</option>
              <option value="refused_help">They refused a refund or real help</option>
              <option value="promised_but_did_not_fix">They said they would fix it but did not</option>
              <option value="resolved">
                {useCompanyContactLabels ? "Resolved — company fixed the issue" : "Resolved — merchant fixed the issue"}
              </option>
              <option value="partial_help">They gave partial refund or partial help</option>
              <option value="asked_more_info">They asked for more information</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Proof type</label>
            <select
              className={inputCls}
              value={contactProofType}
              onChange={(e) => {
                setContactProofType(e.target.value as NonNullable<JusticeIntake["contact_proof_type"]>);
                setContactProofError(null);
              }}
              required
            >
              <option value="upload">I can upload a file</option>
              <option value="paste">I can paste text</option>
              <option value="ticket">I have a ticket or case number</option>
              <option value="screenshot">I have a screenshot</option>
              <option value="none">No written proof — I can describe the attempt</option>
            </select>
          </div>

          <div>
            <label className={labelCls} htmlFor="justice-contact-proof-details">
              {proofDetailsLabel}
            </label>
            <textarea
              id="justice-contact-proof-details"
              className={inputCls}
              rows={3}
              value={contactProofText}
              onChange={(e) => {
                setContactProofText(e.target.value);
                setContactProofError(null);
              }}
              placeholder={proofDetailsPlaceholder}
              aria-invalid={contactProofError ? true : undefined}
              aria-describedby={contactProofError ? "justice-contact-proof-error" : undefined}
            />
            {contactProofError ? (
              <p id="justice-contact-proof-error" className="mt-1 text-xs text-red-600 dark:text-red-400">
                {contactProofError}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-blue-600 px-4 py-3.5 font-semibold text-white shadow-lg shadow-blue-900/25 transition hover:bg-blue-700 hover:shadow-xl disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save and return to action plan"}
          </button>
        </form>
      </main>
    </>
  );
}
