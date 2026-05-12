"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Header from "@/app/components/Header";
import JusticeSavedEvidenceList from "@/app/components/JusticeSavedEvidenceList";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import type { JusticeIntake } from "@/lib/justice/types";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import { cfpbLikelyRelevant } from "@/lib/justice/rules";
import {
  appendCfpbComplaintFiledOnce,
  appendCfpbPrepOpenedOnce,
  readTimeline,
  syncCaseTimelineToServer,
} from "@/lib/justice/timeline";
import { useJusticeActionPageHydration } from "@/lib/justice/useJusticeActionPageHydration";

/** Matches merchant CFPB branch — financial resolution, not refund/replacement retail wording. */
const CFPB_PREP_RESOLUTION_TEXT =
  "I am requesting that you review the issue, correct any account error, refund or credit any improper charge, and provide written confirmation.";

function cfpbFinancialProductSummary(intake: JusticeIntake): string {
  const s = intake.purchase_or_signup.trim();
  return s || "financial product, account, or billing issue";
}

function desiredResolutionPhrase(category: JusticeIntake["problem_category"]): string {
  switch (category) {
    case "online_purchase":
      return "A full refund or a correct replacement, whichever fairly applies.";
    case "subscription":
      return "Cancellation of unwanted recurring charges and any refund owed for improper renewals.";
    case "service_failed":
      return "A remedy that matches what was promised (refund, redo, or credit).";
    case "charge_dispute":
      return "Reversal of the charge or a clear written justification.";
    case "something_else":
      return "A fair resolution that puts me back to where I should have been.";
    default:
      return "A fair resolution that puts me back to where I should have been.";
  }
}

function buildCfpbComplaintDraft(intake: JusticeIntake): string {
  const cfpbRel = cfpbLikelyRelevant(intake);
  const issue = intake.problem_category.replace(/_/g, " ");
  const ask = cfpbRel ? CFPB_PREP_RESOLUTION_TEXT : desiredResolutionPhrase(intake.problem_category);

  const lines: string[] = [
    "DRAFT FOR CFPB COMPLAINT",
    "(Copy and paste into the official Consumer Financial Protection Bureau complaint flow — this app does not submit for you.)",
    "",
    `Company or provider: ${intake.company_name}`,
    intake.company_website.trim() ? `Website: ${intake.company_website.trim()}` : "",
    "",
  ];

  if (cfpbRel) {
    const fpLine = cfpbFinancialProductSummary(intake);
    lines.push(
      "Nature of complaint:",
      "Financial product, billing, or account matter",
      "",
      "Financial product or service:",
      fpLine,
      "",
      "What happened:",
      intake.story.trim(),
      "",
      `Approximate amount involved (if any): ${intake.money_involved}`,
      `Problem date / start date: ${intake.pay_or_order_date}`,
      "",
      intake.order_confirmation_details.trim()
        ? `Confirmation / reference details: ${intake.order_confirmation_details.trim()}`
        : "",
      "",
      "Resolution I am seeking:",
      ask,
      "",
      "My contact:",
      `${intake.user_display_name} <${intake.reply_email}>`
    );
  } else {
    lines.push(
      "Type of issue (from my intake):",
      issue,
      "",
      "Product or service:",
      intake.purchase_or_signup,
      "",
      "What happened:",
      intake.story.trim(),
      "",
      `Approximate amount involved: ${intake.money_involved}`,
      `Order or transaction date: ${intake.pay_or_order_date}`,
      "",
      intake.order_confirmation_details.trim()
        ? `Confirmation / reference details: ${intake.order_confirmation_details.trim()}`
        : "",
      "",
      "Resolution I am seeking:",
      ask,
      "",
      "My contact:",
      `${intake.user_display_name} <${intake.reply_email}>`
    );
  }

  if (intake.already_contacted === "yes" && intake.contact_method) {
    lines.push(
      "",
      "Prior contact with the company:",
      `Method: ${intake.contact_method}`,
      intake.contact_date ? `Date: ${intake.contact_date}` : "",
      intake.merchant_response_type
        ? `Their response (as I understand it): ${intake.merchant_response_type.replace(/_/g, " ")}`
        : "",
      intake.contact_proof_text?.trim()
        ? intake.contact_proof_type === "none"
          ? `Contact attempt notes: ${intake.contact_proof_text.trim()}`
          : intake.contact_proof_type === "ticket"
            ? `Ticket/case number: ${intake.contact_proof_text.trim()}`
            : `Notes on proof: ${intake.contact_proof_text.trim()}`
        : ""
    );
  }

  return lines.filter(Boolean).join("\n").trim();
}

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

export default function JusticeCfpbPrepPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const { status: hydrationStatus, intake } = useJusticeActionPageHydration();
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [caseId, setCaseId] = useState("");
  const [cfpbComplaintFiled, setCfpbComplaintFiled] = useState(false);

  useEffect(() => {
    if (hydrationStatus !== "ready" || !intake) return;
    const cid = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    setCaseId(cid);
    if (cid) {
      appendCfpbPrepOpenedOnce(cid);
      setCfpbComplaintFiled(readTimeline(cid).some((e) => e.type === "cfpb_complaint_filed"));
    } else {
      setCfpbComplaintFiled(false);
    }

    if (isLoaded && isSignedIn && cid) {
      void syncCaseTimelineToServer(cid);
    }
  }, [hydrationStatus, intake, isLoaded, isSignedIn]);

  const complaintText = useMemo(() => (intake ? buildCfpbComplaintDraft(intake) : ""), [intake]);
  const likelyFit = intake ? cfpbLikelyRelevant(intake) : false;

  async function copyComplaint() {
    try {
      await navigator.clipboard.writeText(complaintText);
      setCopyHint("Copied to clipboard.");
      window.setTimeout(() => setCopyHint(null), 2500);
    } catch {
      setCopyHint("Copy failed — select the text and copy manually.");
    }
  }

  async function markCfpbComplaintFiled() {
    const cid = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    if (!cid) return;
    if (!appendCfpbComplaintFiledOnce(cid)) return;
    setCfpbComplaintFiled(true);
    if (isLoaded && isSignedIn) {
      await syncCaseTimelineToServer(cid);
    }
  }

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

  const issueSummary = likelyFit
    ? `${intake.company_name} — ${cfpbFinancialProductSummary(intake)}`
    : `${intake.company_name} — ${intake.problem_category.replace(/_/g, " ")}`;
  const desiredResolution = likelyFit ? CFPB_PREP_RESOLUTION_TEXT : desiredResolutionPhrase(intake.problem_category);

  const fitNote = likelyFit
    ? "Based on your answers (subscription or charge dispute, or billing/bank/credit-related wording in your description), a CFPB complaint may be in scope. This is only a rough guide — confirm your situation fits their rules before filing."
    : "Your intake does not automatically signal a strong CFPB match. Add clear billing, bank, loan, or credit details in your story, or use subscription / charge dispute if that fits — then revisit the action plan. You can also review consumerfinance.gov to see whether your issue fits.";

  const evidenceItems: string[] = [
    "Order number, confirmation email, or receipt (from your intake where applicable).",
    "Screenshots or exports of chats/emails with the company about billing, credits, or refunds.",
    intake.already_contacted === "yes" && intake.contact_date
      ? `Documented company contact (${intake.contact_method ?? "method"} on ${intake.contact_date}).`
      : "Proof you contacted the company (dates, method, ticket numbers).",
    intake.contact_proof_type && intake.contact_proof_type !== "none"
      ? `Proof type you noted: ${intake.contact_proof_type.replace(/_/g, " ")}.`
      : null,
    intake.contact_proof_text?.trim() ? `Notes: ${intake.contact_proof_text.trim()}` : null,
    "Bank or card statements or dispute letters, if the issue involves charges or payments.",
  ].filter((x): x is string => Boolean(x));

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <Link href="/justice/plan" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
          Back to action plan
        </Link>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">CFPB complaint prep</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Prepare text you can paste into the official Consumer Financial Protection Bureau complaint process. This page
          does not file anything for you.
        </p>

        <div className="mt-4 rounded-2xl border border-amber-200/90 bg-amber-50/95 p-4 text-sm text-amber-950 shadow-md shadow-amber-900/10 ring-1 ring-amber-950/[0.06] dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100 dark:shadow-black/30 dark:ring-amber-500/10">
          <strong>Manual filing required.</strong> You must complete your complaint yourself on the{" "}
          <a
            href="https://www.consumerfinance.gov/complaint/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-amber-900 underline dark:text-amber-200"
          >
            official CFPB site (consumerfinance.gov)
          </a>
          . Follow their steps for company matching, categories, and uploads.
        </div>

        <div className={`mt-6 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
            When the CFPB may apply
          </p>
          <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
            The CFPB mainly handles{" "}
            <strong className="font-semibold text-neutral-900 dark:text-neutral-100">
              consumer financial products and services
            </strong>
            . Examples include billing and charges, credit reporting, debt collection, bank or card problems, loans,
            payments, and account issues. Not every consumer problem belongs there — use their official complaint flow to
            confirm.
          </p>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Complaint fit note</p>
          <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{fitNote}</p>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Company info</p>
          <ul className="mt-3 space-y-2 text-sm text-neutral-800 dark:text-neutral-200">
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Name:</span> {intake.company_name || "—"}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Website:</span>{" "}
              {intake.company_website.trim() || "—"}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Your name:</span> {intake.user_display_name}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Your email:</span> {intake.reply_email}
            </li>
            {intake.already_contacted === "yes" && intake.contact_method ? (
              <li>
                <span className="text-neutral-500 dark:text-neutral-400">How you contacted them:</span>{" "}
                {intake.contact_method.replace(/_/g, " ")}
              </li>
            ) : null}
          </ul>
          {!intake.company_name.trim() ? (
            <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">
              Add a company name from <Link href="/justice/intake" className="underline">Edit answers</Link> so your
              complaint matches the right business.
            </p>
          ) : null}
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Complaint summary</p>
          <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{issueSummary}</p>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            {likelyFit ? "Financial product or service:" : "Purchase / signup:"} {intake.purchase_or_signup.trim() || "—"}
          </p>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Money: {intake.money_involved} ·{" "}
            {likelyFit ? "Problem date / start date:" : "Date:"} {intake.pay_or_order_date}
          </p>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">What happened</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">{intake.story.trim()}</p>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Desired resolution</p>
          <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{desiredResolution}</p>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Evidence checklist</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-neutral-800 dark:text-neutral-200">
            {evidenceItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <JusticeSavedEvidenceList />

        <div className={`mt-5 ${cardCls}`}>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Copy-ready CFPB complaint text
          </label>
          <textarea
            readOnly
            className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]"
            rows={20}
            value={complaintText}
            aria-label="Draft CFPB complaint text"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void copyComplaint()}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
            >
              Copy text
            </button>
            <button
              type="button"
              disabled={!caseId || cfpbComplaintFiled}
              onClick={() => void markCfpbComplaintFiled()}
              className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Mark CFPB complaint filed
            </button>
            {copyHint ? (
              <span className="text-xs text-emerald-700 dark:text-emerald-400">{copyHint}</span>
            ) : null}
          </div>
          <p className="mt-4 text-xs text-neutral-600 dark:text-neutral-400">
            File manually on the{" "}
            <a
              href="https://www.consumerfinance.gov/complaint/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 underline dark:text-blue-400"
            >
              official CFPB complaint site
            </a>
            . This assistant does not submit to any government system.
          </p>
        </div>
      </main>
    </>
  );
}
