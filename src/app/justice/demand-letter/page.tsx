"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Header from "@/app/components/Header";
import JusticeFilingRecords from "@/app/components/JusticeFilingRecords";
import JusticeSavedEvidenceList from "@/app/components/JusticeSavedEvidenceList";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import type { JusticeIntake } from "@/lib/justice/types";
import { useJusticeActionPageHydration } from "@/lib/justice/useJusticeActionPageHydration";

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

function buildDemandLetterDraft(intake: JusticeIntake): string {
  const issue = intake.problem_category.replace(/_/g, " ");
  const ask = desiredResolutionPhrase(intake.problem_category);
  const toLine = intake.company_name.trim() ? intake.company_name.trim() : "[Add company or person name]";
  const lines: string[] = [
    "DRAFT DEMAND LETTER — FOR YOUR REVIEW AND EDITING ONLY",
    "(This app does not send or file this letter. This is not legal advice.)",
    "",
    "Date: ________________________________  (add today’s date before sending)",
    "",
    `To: ${toLine}`,
    intake.company_website.trim() ? `Website on file: ${intake.company_website.trim()}` : "",
    "",
    "Subject: Request to resolve a consumer issue",
    "",
    "Dear Sir or Madam,",
    "",
    "I am writing to ask you to resolve an issue involving the following product or service:",
    intake.purchase_or_signup.trim() || "[Describe the product or service]",
    "",
    "Background (what happened):",
    intake.story.trim() || "[Add a clear, factual summary]",
    "",
    `Issue type (from my notes): ${issue}`,
    "",
    `Approximate amount involved: ${intake.money_involved}`,
    `Relevant date or order / payment date: ${intake.pay_or_order_date}`,
    "",
    intake.order_confirmation_details.trim()
      ? `Order or confirmation details: ${intake.order_confirmation_details.trim()}`
      : "",
    "",
    "What I am requesting:",
    ask,
    "",
  ];

  if (intake.already_contacted === "yes" && intake.contact_method) {
    lines.push(
      "Earlier contact:",
      `I previously contacted you by: ${intake.contact_method}`,
      intake.contact_date ? `Date: ${intake.contact_date}` : "",
      intake.merchant_response_type
        ? `Outcome as I understood it: ${intake.merchant_response_type.replace(/_/g, " ")}`
        : "",
      intake.contact_proof_text?.trim() ? `Additional notes: ${intake.contact_proof_text.trim()}` : "",
      ""
    );
  }

  lines.push(
    "If this is not resolved, I may consider available next steps, including consumer complaint options or small claims where appropriate.",
    "",
    "Please respond in writing so we can resolve this without further steps.",
    "",
    "Sincerely,",
    `${intake.user_display_name}`,
    intake.reply_email.trim() ? intake.reply_email.trim() : "",
    "",
    "---",
    "Reminder: Verify deadlines, court rules, dollar limits, service rules, and venue or jurisdiction with your local court or other official resources before taking any court-related step."
  );

  return lines.filter(Boolean).join("\n").trim();
}

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

export default function JusticeDemandLetterPrepPage() {
  const { status: hydrationStatus, intake } = useJusticeActionPageHydration();
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const letterText = useMemo(() => (intake ? buildDemandLetterDraft(intake) : ""), [intake]);

  async function copyLetter() {
    try {
      await navigator.clipboard.writeText(letterText);
      setCopyHint("Copied to clipboard.");
      window.setTimeout(() => setCopyHint(null), 2500);
    } catch {
      setCopyHint("Copy failed — select the text and copy manually.");
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

  const issueSummary = `${intake.company_name || "—"} — ${intake.problem_category.replace(/_/g, " ")}`;
  const desiredResolution = desiredResolutionPhrase(intake.problem_category);

  const evidenceItems: string[] = [
    "Order confirmation, receipt, contract, or invoice that matches your intake details.",
    "Screenshots or exports of emails or chats with the company.",
    intake.already_contacted === "yes" && intake.contact_date
      ? `Notes on prior contact (${intake.contact_method ?? "method"} on ${intake.contact_date}).`
      : "Notes showing you tried to resolve the issue with the company first, if applicable.",
    intake.contact_proof_text?.trim() ? `Proof or reference text: ${intake.contact_proof_text.trim()}` : null,
    "Photos or attachments that support dates, amounts, or what was promised.",
  ].filter((x): x is string => Boolean(x));

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <Link href="/justice/plan" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
          Back to action plan
        </Link>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Demand letter prep</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Build neutral text you can copy, edit, and send yourself. Surrenderless does not mail, file, or submit this
          letter for you.
        </p>

        <div className="mt-4 rounded-2xl border border-amber-200/90 bg-amber-50/95 p-4 text-sm text-amber-950 shadow-md shadow-amber-900/10 ring-1 ring-amber-950/[0.06] dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100 dark:shadow-black/30 dark:ring-amber-500/10">
          <strong>Not legal advice.</strong> This page does not tell you whether you qualify for small claims court or
          any other remedy, and it does not decide strategy for you. Verify deadlines, court rules, dollar limits, service
          rules, and venue or jurisdiction with your local court or official resources before relying on any court
          process.
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Case summary</p>
          <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{issueSummary}</p>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Product or service: {intake.purchase_or_signup.trim() || "—"}
          </p>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Money: {intake.money_involved} · Order or payment date: {intake.pay_or_order_date}
          </p>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Company / person</p>
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
          </ul>
          {!intake.company_name.trim() ? (
            <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">
              Add who the letter should go to from{" "}
              <Link href="/justice/intake" className="underline">
                Edit answers
              </Link>
              .
            </p>
          ) : null}
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">What happened</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">{intake.story.trim()}</p>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Requested resolution</p>
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
            Copy-ready demand letter
          </label>
          <textarea
            readOnly
            className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]"
            rows={22}
            value={letterText}
            aria-label="Draft demand letter text"
          />
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
          <p className="mt-4 text-xs text-neutral-600 dark:text-neutral-400">
            You choose how and when to send this. Surrenderless does not file with any court or agency and does not
            embed court websites here.
          </p>
        </div>

        <JusticeFilingRecords />
      </main>
    </>
  );
}
