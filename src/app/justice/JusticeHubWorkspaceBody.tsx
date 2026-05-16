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

const cardCls =
  "block rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-md shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] transition hover:border-blue-200/80 hover:shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:ring-white/[0.06] dark:hover:border-blue-800/50";

const activeCardCls =
  "block rounded-2xl border border-blue-200/90 bg-white p-5 shadow-md shadow-neutral-900/5 ring-1 ring-blue-950/[0.06] transition hover:border-blue-300 hover:shadow-lg dark:border-blue-900/50 dark:bg-neutral-900 dark:ring-blue-500/10 dark:hover:border-blue-800";

function submissionDraftReviewedInTimeline(caseId: string): boolean {
  const entries = caseId ? readTimeline(caseId) : [];
  return entries.some(
    (e) => e.id === SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID || e.type === "submission_draft_reviewed"
  );
}

/** Client-only snapshot of active case card state from session/timeline helpers. */
function readSnapshotFromLocalSession(): { intake: JusticeIntake; reviewed: boolean } | null {
  const intake = readValidLocalJusticeIntake();
  if (!intake) return null;
  const caseId = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
  return { intake, reviewed: submissionDraftReviewedInTimeline(caseId) };
}

export default function JusticeHubWorkspaceBody() {
  const [snapshot, setSnapshot] = useState<{
    intake: JusticeIntake;
    reviewed: boolean;
  } | null>(null);

  useEffect(() => {
    function refreshFromLocalSession() {
      setSnapshot(readSnapshotFromLocalSession());
    }

    refreshFromLocalSession();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshFromLocalSession();
      }
    }

    window.addEventListener("focus", refreshFromLocalSession);
    window.addEventListener("storage", refreshFromLocalSession);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshFromLocalSession);
      window.removeEventListener("storage", refreshFromLocalSession);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <>
      {snapshot ? (
        <div className="mt-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Current case
          </p>
          <Link
            href={snapshot.reviewed ? "/justice/plan" : "/justice/preview"}
            className={`${activeCardCls} text-left`}
          >
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {snapshot.intake.company_name.trim() || "Current case"}
            </span>
            <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
              {CATEGORY_LABEL[snapshot.intake.problem_category] ?? snapshot.intake.problem_category}
            </span>
            {snapshot.intake.purchase_or_signup.trim() ? (
              <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-500">
                {snapshot.intake.purchase_or_signup.trim()}
              </span>
            ) : null}
            <span className="mt-2 block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              {snapshot.reviewed ? "Submission draft reviewed" : "Submission draft not reviewed"}
            </span>
            <span className="mt-3 inline-flex text-sm font-semibold text-blue-600 dark:text-blue-400">
              {snapshot.reviewed ? "Continue to action plan" : "Continue to submission preview"}
            </span>
          </Link>
        </div>
      ) : null}

      <ul className="mt-8 space-y-3">
        <li>
          <Link href="/justice/chat" className={`${cardCls} text-left`}>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Start with chat intake</span>
            <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
              Answer step-by-step questions to build your case.
            </span>
          </Link>
        </li>
        {!snapshot ? (
          <li>
            <Link href="/justice/plan" className={`${cardCls} text-left`}>
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Continue current action plan
              </span>
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                Open your plan when you already have a case in this browser — or follow prompts there to start or
                resume.
              </span>
            </Link>
          </li>
        ) : null}
        <li>
          <Link href="/justice/intake" className={`${cardCls} text-left`}>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Start with form intake</span>
            <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
              Fill in the structured intake form.
            </span>
          </Link>
        </li>
        <li>
          <Link href="/justice/cases" className={`${cardCls} text-left`}>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Saved cases</span>
            <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
              Open a case you saved while signed in.
            </span>
          </Link>
        </li>
      </ul>
    </>
  );
}
