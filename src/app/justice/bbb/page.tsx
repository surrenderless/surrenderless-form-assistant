"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/app/components/Header";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import { appendBbbPrepOpenedOnce, readTimeline, replaceTimelineForCase } from "@/lib/justice/timeline";

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

function buildBbbComplaintDraft(intake: JusticeIntake): string {
  const issue = intake.problem_category.replace(/_/g, " ");
  const ask = desiredResolutionPhrase(intake.problem_category);
  const lines: string[] = [
    "DRAFT FOR BBB COMPLAINT (copy and paste into BBB.org — this app does not submit for you)",
    "",
    `Business: ${intake.company_name}`,
    intake.company_website.trim() ? `Website: ${intake.company_website.trim()}` : "",
    "",
    "Issue type:",
    issue,
    "",
    "Product/service:",
    intake.purchase_or_signup,
    "",
    "What happened:",
    intake.story.trim(),
    "",
    `Approximate amount involved: ${intake.money_involved}`,
    `Order or payment date: ${intake.pay_or_order_date}`,
    "",
    intake.order_confirmation_details.trim()
      ? `Order / confirmation details: ${intake.order_confirmation_details.trim()}`
      : "",
    "",
    "Desired resolution:",
    ask,
    "",
    "My contact:",
    `${intake.user_display_name} <${intake.reply_email}>`,
  ];

  if (intake.already_contacted === "yes" && intake.contact_method) {
    lines.push(
      "",
      "Prior contact with business:",
      `Method: ${intake.contact_method}`,
      intake.contact_date ? `Date: ${intake.contact_date}` : "",
      intake.merchant_response_type
        ? `Their response (as I understand it): ${intake.merchant_response_type.replace(/_/g, " ")}`
        : "",
      intake.contact_proof_text?.trim()
        ? `Proof notes: ${intake.contact_proof_text.trim()}`
        : ""
    );
  }

  return lines.filter(Boolean).join("\n").trim();
}

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

export default function JusticeBbbPrepPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
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
      if (cid) appendBbbPrepOpenedOnce(cid);

      if (isLoaded && isSignedIn && cid) {
        void (async () => {
          try {
            const timeline = readTimeline(cid);
            const res = await fetch(`/api/justice/cases/${encodeURIComponent(cid)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ timeline }),
            });
            if (res.ok) {
              const payload = (await res.json()) as { timeline?: unknown };
              if (Array.isArray(payload.timeline)) {
                replaceTimelineForCase(cid, payload.timeline as TimelineEntry[]);
              }
            } else {
              console.warn("justice bbb: PATCH /api/justice/cases/[id] failed", res.status);
            }
          } catch (e) {
            console.warn("justice bbb: PATCH /api/justice/cases/[id] error", e);
          }
        })();
      }
    } catch {
      router.replace("/justice/intake");
    }
  }, [router, isLoaded, isSignedIn]);

  const complaintText = useMemo(() => (intake ? buildBbbComplaintDraft(intake) : ""), [intake]);

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

  const issueSummary = `${intake.company_name} — ${intake.problem_category.replace(/_/g, " ")}`;
  const desiredResolution = desiredResolutionPhrase(intake.problem_category);

  const evidenceItems: string[] = [
    "Order number, confirmation email, or receipt (from your intake where applicable).",
    "Screenshots or exports of chats/emails with the business.",
    intake.already_contacted === "yes" && intake.contact_date
      ? `Documented merchant contact (${intake.contact_method ?? "method"} on ${intake.contact_date}).`
      : "Proof you contacted the business (dates, method, ticket numbers).",
    intake.contact_proof_type && intake.contact_proof_type !== "none"
      ? `Proof type you noted: ${intake.contact_proof_type.replace(/_/g, " ")}.`
      : null,
    intake.contact_proof_text?.trim() ? `Notes: ${intake.contact_proof_text.trim()}` : null,
    "Bank or card dispute confirmation, if you opened one.",
  ].filter((x): x is string => Boolean(x));

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <Link href="/justice/plan" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
          Back to action plan
        </Link>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">BBB complaint prep</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Prepare what you will paste into a complaint on the official Better Business Bureau website. This page does not
          file anything for you.
        </p>

        <div className="mt-4 rounded-2xl border border-amber-200/90 bg-amber-50/95 p-4 text-sm text-amber-950 shadow-md shadow-amber-900/10 ring-1 ring-amber-950/[0.06] dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100 dark:shadow-black/30 dark:ring-amber-500/10">
          <strong>Manual filing required.</strong> Complete your complaint on{" "}
          <a
            href="https://www.bbb.org"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-amber-900 underline dark:text-amber-200"
          >
            BBB.org
          </a>
          . Verify you select the correct business profile and follow their instructions for attachments.
        </div>

        <div className={`mt-6 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Complaint summary</p>
          <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{issueSummary}</p>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Purchase / signup: {intake.purchase_or_signup}
          </p>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Money: {intake.money_involved} · Date: {intake.pay_or_order_date}
          </p>
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
          </ul>
          {!intake.company_name.trim() ? (
            <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">
              Add a company name from <Link href="/justice/intake" className="underline">Edit answers</Link> so your BBB
              filing matches the right business.
            </p>
          ) : null}
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
            Copy-ready complaint text
          </label>
          <textarea
            readOnly
            className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]"
            rows={18}
            value={complaintText}
            aria-label="Draft BBB complaint text"
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
        </div>
      </main>
    </>
  );
}
