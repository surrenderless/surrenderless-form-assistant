"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignedIn, SignedOut, SignInButton, useAuth } from "@clerk/nextjs";
import Header from "@/app/components/Header";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import JusticeFilingRecords from "@/app/components/JusticeFilingRecords";
import JusticeSavedEvidenceList from "@/app/components/JusticeSavedEvidenceList";
import { computeFtcUnlocked } from "@/lib/justice/rules";
import { recordFtcPracticeFiling } from "@/lib/justice/recordFtcPracticeFiling";
import { buildFtcPracticeSummaryLines, runFtcPractice } from "@/lib/justice/runFtcPractice";
import { applyServerTimelineFromResponse } from "@/lib/justice/timeline";
import type { JusticeIntake } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK } from "@/lib/justice/types";
import { useJusticeActionPageHydration } from "@/lib/justice/useJusticeActionPageHydration";
import { useRedirectConsumerActiveCaseOffOptionalHubEscapePage } from "@/lib/justice/useRedirectConsumerActiveCaseOffOptionalHubEscapePage";
import { validate as isUuid } from "uuid";

export default function JusticeFtcReviewPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const { status: hydrationStatus, intake: hydratedIntake } = useJusticeActionPageHydration();
  const [intake, setIntake] = useState<JusticeIntake | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [practiceSuccess, setPracticeSuccess] = useState(false);
  const [storageSkipped, setStorageSkipped] = useState(false);
  const [technicalDetails, setTechnicalDetails] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hydrationStatus !== "ready" || !hydratedIntake) return;
    const manual = sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
    if (!computeFtcUnlocked(hydratedIntake, manual)) {
      router.replace("/justice/chat-ai");
      return;
    }
    setIntake(hydratedIntake);
  }, [hydrationStatus, hydratedIntake, router]);


  const [optionalHubEscapeCaseId, setOptionalHubEscapeCaseId] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    setOptionalHubEscapeCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? "");
  }, [hydrationStatus]);
  const redirectOffOptionalHub = useRedirectConsumerActiveCaseOffOptionalHubEscapePage({
    escapePageHref: "/justice/ftc-review",
    caseId: optionalHubEscapeCaseId,
    hasResumableCase: hydrationStatus === "ready" && Boolean(hydratedIntake),
  });

  if (hydrationStatus === "needs_sign_in") {
    return <JusticeActionResumeSignInPrompt />;
  }

  if (hydrationStatus !== "ready" || !intake || redirectOffOptionalHub) {
    return (
      <>
        <Header />
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
          Loading…
        </main>
      </>
    );
  }

  const summaryLines = buildFtcPracticeSummaryLines(intake);

  async function handleRunPractice() {
    if (!confirmed || !isSignedIn || !intake) return;
    setRunning(true);
    setError(null);
    setPracticeSuccess(false);
    setStorageSkipped(false);
    setTechnicalDetails(null);
    const caseId = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";

    const result = await runFtcPractice({
      intake,
      caseId: caseId || null,
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
    });

    if (result.ok) {
      setStorageSkipped(result.storageSkipped);
      setTechnicalDetails(result.technicalDetails);
      setPracticeSuccess(true);
      if (isSignedIn && caseId && isUuid(caseId)) {
        const filing = await recordFtcPracticeFiling(caseId, result);
        if (filing.ok) {
          applyServerTimelineFromResponse(caseId, filing.payload);
        } else {
          console.warn("justice ftc-review: FTC practice filing record failed", filing.error);
        }
      }
    } else {
      setError(result.error);
    }
    setRunning(false);
  }

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
        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Review your practice FTC form</h1>
        <div className="mt-3 rounded-2xl border border-amber-200/90 bg-amber-50/95 p-4 text-sm text-amber-950 shadow-md shadow-amber-900/10 ring-1 ring-amber-950/[0.06] dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100 dark:shadow-black/30 dark:ring-amber-500/10">
          This runs the <strong>internal practice form</strong> only (<code className="text-xs">/mock/ftc-complaint</code>). It is{" "}
          <strong>not</strong> a real government submission.
        </div>

        <ul className="mt-6 space-y-0 rounded-2xl border border-neutral-200/90 bg-white p-4 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-5">
          {summaryLines.map((line, i) => (
            <li
              key={`${i}-${line.slice(0, 48)}`}
              className={`text-sm leading-relaxed text-neutral-800 dark:text-neutral-200 ${i > 0 ? "mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-700/80" : ""}`}
            >
              {line}
            </li>
          ))}
        </ul>

        <JusticeSavedEvidenceList />

        <label className="mt-6 flex items-start gap-3 rounded-2xl border border-neutral-200/90 bg-white p-4 text-sm text-neutral-800 shadow-md shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:shadow-black/40 dark:ring-white/[0.06]">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
          <span>I confirm this information is accurate to the best of my knowledge.</span>
        </label>

        <SignedOut>
          <div className="mt-6 rounded-2xl border border-neutral-200/90 bg-white p-4 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06]">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Sign in to run the practice autofill (required by the app).</p>
            <SignInButton mode="modal">
              <button type="button" className="mt-3 rounded-xl bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-neutral-900">
                Sign in
              </button>
            </SignInButton>
          </div>
        </SignedOut>

        <SignedIn>
          <button
            type="button"
            disabled={!confirmed || running}
            onClick={() => void handleRunPractice()}
            className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3.5 font-semibold text-white shadow-lg shadow-blue-900/25 transition hover:bg-blue-700 hover:shadow-xl disabled:opacity-50"
          >
            {running ? "Running practice autofill…" : "Run practice autofill"}
          </button>
        </SignedIn>

        {error && (
          <pre className="mt-4 overflow-auto rounded-2xl border border-red-200/90 bg-red-50 p-4 text-xs text-red-900 shadow-md shadow-red-900/10 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
            {error}
          </pre>
        )}
        {practiceSuccess && (
          <div className="mt-6 rounded-2xl border border-emerald-200/90 bg-emerald-50/95 p-5 text-neutral-900 shadow-lg shadow-emerald-900/10 ring-1 ring-emerald-950/[0.05] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-50 dark:shadow-black/30 dark:ring-emerald-500/10">
            <p className="font-semibold text-emerald-950 dark:text-emerald-100">Practice autofill completed.</p>
            <p className="mt-2 text-sm text-emerald-900 dark:text-emerald-200">
              The internal mock FTC form was filled successfully.
            </p>
            {storageSkipped && (
              <p className="mt-3 text-sm text-emerald-800/90 dark:text-emerald-300/90">
                Screenshot storage is not configured locally, so no screenshot was saved.
              </p>
            )}
            <Link
              href="/justice/chat-ai"
              className="mt-4 inline-flex rounded-xl border border-emerald-700 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900 shadow-md transition hover:bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-100 dark:hover:bg-emerald-900"
            >
              Continue in chat
            </Link>
            {technicalDetails && (
              <details className="mt-4 rounded-xl border border-emerald-200/80 bg-white/70 p-3 text-sm shadow-inner dark:border-emerald-800 dark:bg-emerald-950/40">
                <summary className="cursor-pointer font-medium text-emerald-900 dark:text-emerald-200">
                  Technical details
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-neutral-100 p-3 text-xs text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
                  {technicalDetails}
                </pre>
              </details>
            )}
          </div>
        )}

        <JusticeFilingRecords />
      </main>
    </>
  );
}
