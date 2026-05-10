"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignedIn, SignedOut, SignInButton, useAuth } from "@clerk/nextjs";
import Header from "@/app/components/Header";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK, STORAGE_INTAKE } from "@/lib/justice/types";
import { computeFtcUnlocked } from "@/lib/justice/rules";
import { intakeToMockFtcUserData } from "@/lib/justice/ftc-user-data";
import { appendTimelineEvent, readTimeline, replaceTimelineForCase } from "@/lib/justice/timeline";

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

export default function JusticeFtcReviewPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const [intake, setIntake] = useState<JusticeIntake | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [practiceSuccess, setPracticeSuccess] = useState(false);
  const [storageSkipped, setStorageSkipped] = useState(false);
  const [technicalDetails, setTechnicalDetails] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_INTAKE);
    if (!raw) {
      router.replace("/justice/intake");
      return;
    }
    try {
      const data = JSON.parse(raw) as JusticeIntake;
      const manual = sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
      if (!computeFtcUnlocked(data, manual)) {
        router.replace("/justice/plan");
        return;
      }
      setIntake(data);
    } catch {
      router.replace("/justice/intake");
    }
  }, [router]);

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

  async function syncTimelineToSupabase(caseId: string | null) {
    if (!caseId || !isLoaded || !isSignedIn) return;
    try {
      const timeline = readTimeline(caseId);
      const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeline }),
      });
      if (res.ok) {
        const payload = (await res.json()) as { timeline?: unknown };
        if (Array.isArray(payload.timeline)) {
          replaceTimelineForCase(caseId, payload.timeline as TimelineEntry[]);
        }
      } else {
        console.warn("justice ftc-review: PATCH /api/justice/cases/[id] failed", res.status);
      }
    } catch (e) {
      console.warn("justice ftc-review: PATCH /api/justice/cases/[id] error", e);
    }
  }

  const summaryLines = [
    `Company: ${intake.company_name}`,
    `Issue: ${intake.problem_category.replace(/_/g, " ")}`,
    `Story: ${intake.story.slice(0, 200)}${intake.story.length > 200 ? "…" : ""}`,
    `Money: ${intake.money_involved}`,
    `Order/pay date: ${intake.pay_or_order_date}`,
    `Your email: ${intake.reply_email}`,
  ];

  async function runPractice() {
    if (!confirmed || !isSignedIn || !intake) return;
    setRunning(true);
    setError(null);
    setPracticeSuccess(false);
    setStorageSkipped(false);
    setTechnicalDetails(null);
    const caseId = sessionStorage.getItem(STORAGE_CASE_ID);
    const mockUrl = `${window.location.origin}/mock/ftc-complaint`;
    const userData = intakeToMockFtcUserData(intake);

    if (caseId) {
      appendTimelineEvent(caseId, { type: "ftc_practice_started", label: "FTC practice started" });
    }
    await syncTimelineToSupabase(caseId);

    await logEvent("ftc_mock_lane_started", { case_id: caseId, mock_path: "/mock/ftc-complaint" });

    try {
      const res = await fetch("/api/submit-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url: mockUrl, userData }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Request failed");
      }
      await logEvent("ftc_mock_lane_completed", { case_id: caseId, outcome: "success" });
      sessionStorage.setItem("justice_ftc_mock_completed", "1");
      const fillResult = (data as { fillResult?: { storageSkipped?: boolean } }).fillResult;
      if (caseId) {
        appendTimelineEvent(caseId, {
          type: "ftc_practice_completed",
          label: "FTC practice completed",
          detail: fillResult?.storageSkipped ? "Screenshot storage skipped locally" : undefined,
        });
      }
      await syncTimelineToSupabase(caseId);
      setStorageSkipped(fillResult?.storageSkipped === true);
      setTechnicalDetails(JSON.stringify(data, null, 2));
      setPracticeSuccess(true);
    } catch (e: any) {
      await logEvent("ftc_mock_lane_completed", {
        case_id: caseId,
        outcome: "failed",
        error: (e?.message || "error").slice(0, 200),
      });
      if (caseId) {
        appendTimelineEvent(caseId, {
          type: "ftc_practice_completed",
          label: "FTC practice completed",
          detail: "Did not complete",
        });
      }
      await syncTimelineToSupabase(caseId);
      setError(e?.message || "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <Link href="/justice/plan" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
          Back to action plan
        </Link>
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
            onClick={() => void runPractice()}
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
              href="/justice/plan"
              className="mt-4 inline-flex rounded-xl border border-emerald-700 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900 shadow-md transition hover:bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-100 dark:hover:bg-emerald-900"
            >
              Back to action plan
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
      </main>
    </>
  );
}
