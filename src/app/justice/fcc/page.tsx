"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/app/components/Header";
import type { JusticeIntake } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import { fccLikelyRelevant } from "@/lib/justice/rules";
import { appendFccPrepOpenedOnce } from "@/lib/justice/timeline";

const FCC_COMPLAINT_URL = "https://consumercomplaints.fcc.gov/";

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

/** For FCC-style framing: headline segment and draft labels (not raw intake problem_category). */
function fccServiceSummarySegment(intake: JusticeIntake): string {
  const svc = intake.purchase_or_signup.trim();
  return svc || "communications service issue";
}

function buildFccComplaintDraft(intake: JusticeIntake): string {
  const fccRel = fccLikelyRelevant(intake);
  const intakeCategoryLabel = intake.problem_category.replace(/_/g, " ");
  const serviceSummary = fccServiceSummarySegment(intake);
  const ask = desiredResolutionPhrase(intake.problem_category);
  const lines: string[] = [
    "DRAFT FOR FCC CONSUMER COMPLAINT",
    "(Copy and paste into the official FCC consumer complaint flow — this app does not submit for you.)",
    "",
    `Company or provider: ${intake.company_name}`,
    intake.company_website.trim() ? `Website: ${intake.company_website.trim()}` : "",
    "",
  ];

  if (fccRel) {
    lines.push(
      "Nature of complaint:",
      "Communications service issue",
      "",
      "Service or product involved:",
      serviceSummary,
      ""
    );
  } else {
    lines.push(
      "Type of issue (from my intake):",
      intakeCategoryLabel,
      "",
      "Service or product:",
      intake.purchase_or_signup,
      ""
    );
  }

  lines.push(
    "What happened:",
    intake.story.trim(),
    "",
    `Approximate amount involved (if any): ${intake.money_involved}`,
    `Problem date / start date: ${intake.pay_or_order_date}`,
    "",
    intake.order_confirmation_details.trim()
      ? `Account / confirmation details: ${intake.order_confirmation_details.trim()}`
      : "",
    "",
    "Outcome I am seeking:",
    ask,
    "",
    "My contact:",
    `${intake.user_display_name} <${intake.reply_email}>`
  );

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
        ? `Notes on proof: ${intake.contact_proof_text.trim()}`
        : ""
    );
  }

  return lines.filter(Boolean).join("\n").trim();
}

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

export default function JusticeFccPrepPage() {
  const router = useRouter();
  const [intake, setIntake] = useState<JusticeIntake | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_INTAKE);
    if (!raw) {
      router.replace("/justice/intake");
      return;
    }
    try {
      const data = JSON.parse(raw) as JusticeIntake;
      setIntake(data);
      const cid = sessionStorage.getItem(STORAGE_CASE_ID);
      if (cid) appendFccPrepOpenedOnce(cid);
    } catch {
      router.replace("/justice/intake");
    }
  }, [router]);

  const complaintText = useMemo(() => (intake ? buildFccComplaintDraft(intake) : ""), [intake]);
  const likelyFit = intake ? fccLikelyRelevant(intake) : false;

  async function copyComplaint() {
    try {
      await navigator.clipboard.writeText(complaintText);
      setCopyHint("Copied to clipboard.");
      window.setTimeout(() => setCopyHint(null), 2500);
    } catch {
      setCopyHint("Copy failed — select the text and copy manually.");
    }
  }

  if (!intake) {
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
    ? `${intake.company_name} — ${fccServiceSummarySegment(intake)}`
    : `${intake.company_name} — ${intake.problem_category.replace(/_/g, " ")}`;
  const desiredResolution = desiredResolutionPhrase(intake.problem_category);

  const fitNote = likelyFit
    ? "Your description includes wording that often lines up with FCC topics (for example phone, internet, cable, or unwanted calls). This is only a rough guide — use the official FCC complaint site to confirm categories and required details."
    : "Your intake does not automatically read like a telecom or communications issue. Add specifics about phone, internet, cable, broadcast, or unwanted calls or texts in your story, then revisit the action plan. You can still review the FCC site to see whether your issue belongs there.";

  const evidenceItems: string[] = [
    "Phone number(s), dates, and times involved (from your story or notes).",
    "Screenshots of caller ID, text messages, or account pages from the provider.",
    "Bills, plan summaries, or outage notices if the dispute involves service or charges.",
    intake.already_contacted === "yes" && intake.contact_date
      ? `Documented company contact (${intake.contact_method ?? "method"} on ${intake.contact_date}).`
      : "Proof you contacted the company (dates, method, ticket or confirmation numbers).",
    intake.contact_proof_type && intake.contact_proof_type !== "none"
      ? `Proof type you noted: ${intake.contact_proof_type.replace(/_/g, " ")}.`
      : null,
    intake.contact_proof_text?.trim() ? `Notes: ${intake.contact_proof_text.trim()}` : null,
  ].filter((x): x is string => Boolean(x));

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <Link href="/justice/plan" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
          Back to action plan
        </Link>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">FCC complaint prep</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Prepare text you can paste into the official Federal Communications Commission consumer complaint process. This
          page does not file anything for you.
        </p>

        <div className="mt-4 rounded-2xl border border-amber-200/90 bg-amber-50/95 p-4 text-sm text-amber-950 shadow-md shadow-amber-900/10 ring-1 ring-amber-950/[0.06] dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100 dark:shadow-black/30 dark:ring-amber-500/10">
          <strong>Manual filing required.</strong> You must submit any complaint yourself on the{" "}
          <a
            href={FCC_COMPLAINT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-amber-900 underline dark:text-amber-200"
          >
            official FCC consumer complaint site
          </a>
          . Follow their categories, forms, and instructions for attachments.
        </div>

        <div className={`mt-6 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
            When the FCC may apply
          </p>
          <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
            The FCC handles many{" "}
            <strong className="font-semibold text-neutral-900 dark:text-neutral-100">
              communications-related consumer problems
            </strong>
            . Examples include phone, internet, and cable service; broadcast and radio or TV topics where the FCC takes
            complaints; and unwanted robocalls, spam calls, or spam texts in some situations. Not every frustration with a
            company is an FCC matter — their intake tool will help you see what fits.
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
              complaint matches the right provider.
            </p>
          ) : null}
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Complaint summary</p>
          <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{issueSummary}</p>
          {!likelyFit ? (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              Service / product: {intake.purchase_or_signup}
            </p>
          ) : null}
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Money (if any): {intake.money_involved} · Problem date / start date: {intake.pay_or_order_date}
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

        <div className={`mt-5 ${cardCls}`}>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Copy-ready FCC complaint text
          </label>
          <textarea
            readOnly
            className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]"
            rows={20}
            value={complaintText}
            aria-label="Draft FCC complaint text"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void copyComplaint()}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
            >
              Copy text
            </button>
            {copyHint ? (
              <span className="text-xs text-emerald-700 dark:text-emerald-400">{copyHint}</span>
            ) : null}
          </div>
          <p className="mt-4 text-xs text-neutral-600 dark:text-neutral-400">
            File manually on the{" "}
            <a
              href={FCC_COMPLAINT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 underline dark:text-blue-400"
            >
              official FCC consumer complaint site
            </a>
            . This assistant does not submit to any government system.
          </p>
        </div>
      </main>
    </>
  );
}
