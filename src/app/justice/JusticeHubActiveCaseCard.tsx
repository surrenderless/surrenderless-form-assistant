"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readValidLocalJusticeIntake } from "@/lib/justice/hydrateActiveCaseFromServer";
import { readTimeline, SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID } from "@/lib/justice/timeline";
import type { JusticeIntake, ProblemCategory } from "@/lib/justice/types";
import { STORAGE_CASE_ID } from "@/lib/justice/types";

const CATEGORY_LABEL: Record<ProblemCategory, string> = {
  online_purchase: "Something I bought online",
  financial_account_issue: "Bank, credit, loan, payment, or billing issue",
  subscription: "Subscription or recurring charge",
  service_failed: "Service didn’t work as promised",
  charge_dispute: "Charge dispute",
  something_else: "Something else",
};

function submissionDraftReviewedInTimeline(caseId: string): boolean {
  const entries = caseId ? readTimeline(caseId) : [];
  return entries.some(
    (e) => e.id === SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID || e.type === "submission_draft_reviewed"
  );
}

const activeCardCls =
  "block rounded-2xl border border-blue-200/90 bg-white p-5 shadow-md shadow-neutral-900/5 ring-1 ring-blue-950/[0.06] transition hover:border-blue-300 hover:shadow-lg dark:border-blue-900/50 dark:bg-neutral-900 dark:ring-blue-500/10 dark:hover:border-blue-800";

export default function JusticeHubActiveCaseCard() {
  const [snapshot, setSnapshot] = useState<{
    intake: JusticeIntake;
    reviewed: boolean;
  } | null>(null);

  useEffect(() => {
    const intake = readValidLocalJusticeIntake();
    if (!intake) {
      setSnapshot(null);
      return;
    }
    const caseId = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    const reviewed = submissionDraftReviewedInTimeline(caseId);
    setSnapshot({ intake, reviewed });
  }, []);

  if (!snapshot) return null;

  const { intake, reviewed } = snapshot;
  const company = intake.company_name.trim() || "Current case";
  const categoryLabel = CATEGORY_LABEL[intake.problem_category] ?? intake.problem_category;
  const product = intake.purchase_or_signup.trim();
  const href = reviewed ? "/justice/plan" : "/justice/preview";
  const primaryLabel = reviewed ? "Continue to action plan" : "Continue to submission preview";
  const statusLabel = reviewed ? "Submission draft reviewed" : "Submission draft not reviewed";

  return (
    <div className="mt-8">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Current case
      </p>
      <Link href={href} className={`${activeCardCls} text-left`}>
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{company}</span>
        <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">{categoryLabel}</span>
        {product ? (
          <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-500">{product}</span>
        ) : null}
        <span className="mt-2 block text-xs font-medium text-neutral-700 dark:text-neutral-300">{statusLabel}</span>
        <span className="mt-3 inline-flex text-sm font-semibold text-blue-600 dark:text-blue-400">{primaryLabel}</span>
      </Link>
    </div>
  );
}
