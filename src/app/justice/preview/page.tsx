"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/app/components/Header";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import { buildSubmissionDraftPreview } from "@/lib/justice/buildSubmissionDraftPreview";
import type { JusticeCaseEvidenceRow } from "@/lib/justice/evidence";
import {
  cfpbLikelyRelevant,
  computeJusticeDestinations,
  fccLikelyRelevant,
} from "@/lib/justice/rules";
import type { DestinationId, JusticeDestination } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK } from "@/lib/justice/types";
import { useJusticeActionPageHydration } from "@/lib/justice/useJusticeActionPageHydration";

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

function isPreviewSelectableDestination(d: JusticeDestination): boolean {
  return d.status === "recommended" || d.status === "available";
}

export default function JusticePreviewPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const { status: hydrationStatus, intake } = useJusticeActionPageHydration();
  const [caseId, setCaseId] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [manualFtc, setManualFtc] = useState(false);
  const [evidence, setEvidence] = useState<JusticeCaseEvidenceRow[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState(false);
  const [selectedId, setSelectedId] = useState<DestinationId | null>(null);
  const [reviewed, setReviewed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? "");
    setManualFtc(sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1");
    setSessionReady(true);
    const t0 = window.setTimeout(() => {
      setCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? "");
      setManualFtc(sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1");
    }, 0);
    const t1 = window.setTimeout(() => {
      setCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? "");
      setManualFtc(sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1");
    }, 200);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [hydrationStatus, intake]);

  const useCompanyContactLabels = useMemo(
    () => (intake ? cfpbLikelyRelevant(intake) || fccLikelyRelevant(intake) : false),
    [intake]
  );

  const destinations = useMemo((): JusticeDestination[] => {
    if (!intake) return [];
    return computeJusticeDestinations(intake, { manualFtc, useCompanyContactLabels });
  }, [intake, manualFtc, useCompanyContactLabels]);

  const selectableDestinations = useMemo(
    () => destinations.filter(isPreviewSelectableDestination),
    [destinations]
  );

  const previewOptions = useMemo((): JusticeDestination[] => {
    if (selectableDestinations.length > 0) return selectableDestinations;
    return destinations;
  }, [selectableDestinations, destinations]);

  const defaultDestination = useMemo(() => previewOptions[0] ?? null, [previewOptions]);

  useEffect(() => {
    if (!defaultDestination) return;
    if (selectedId === null || !previewOptions.some((d) => d.id === selectedId)) {
      setSelectedId(defaultDestination.id);
    }
  }, [defaultDestination, previewOptions, selectedId]);

  const loadEvidence = useCallback(async () => {
    const cid = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) ?? "" : "";
    if (!cid || !isLoaded || !isSignedIn) {
      setEvidence([]);
      return;
    }
    setEvidenceLoading(true);
    setEvidenceError(false);
    try {
      const res = await fetch(`/api/justice/evidence?case_id=${encodeURIComponent(cid)}`);
      if (!res.ok) {
        setEvidenceError(true);
        setEvidence([]);
        return;
      }
      const data = (await res.json()) as JusticeCaseEvidenceRow[];
      setEvidence(Array.isArray(data) ? data : []);
    } catch {
      setEvidenceError(true);
      setEvidence([]);
    } finally {
      setEvidenceLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (hydrationStatus !== "ready" || !intake || !isLoaded || !isSignedIn) return;
    const cid = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    if (!cid) return;
    void loadEvidence();
  }, [hydrationStatus, intake, isLoaded, isSignedIn, loadEvidence, caseId]);

  const selectedDestination = useMemo(() => {
    if (!selectedId || previewOptions.length === 0) return defaultDestination;
    return previewOptions.find((d) => d.id === selectedId) ?? defaultDestination;
  }, [selectedId, previewOptions, defaultDestination]);

  const draftText = useMemo(() => {
    if (!intake || !selectedDestination) return "";
    return buildSubmissionDraftPreview({
      intake,
      destinationId: selectedDestination.id,
      destinationLabel: selectedDestination.label,
      evidenceLines: evidence.map((e) => ({ title: e.title })),
    });
  }, [intake, selectedDestination, evidence]);

  useEffect(() => {
    setReviewed(false);
  }, [selectedId, intake]);

  if (hydrationStatus === "needs_sign_in") {
    return <JusticeActionResumeSignInPrompt />;
  }

  if (!sessionReady || hydrationStatus === "loading" || hydrationStatus === "redirecting") {
    return (
      <>
        <Header />
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
          Loading…
        </main>
      </>
    );
  }

  if (hydrationStatus !== "ready" || !intake) {
    return (
      <>
        <Header />
        <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            No active case to preview. Start with chat or form intake.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Link
              href="/justice/chat"
              className="inline-flex justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700"
            >
              Chat intake
            </Link>
            <Link
              href="/justice/intake"
              className="inline-flex justify-center rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Form intake
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/justice/plan" className="text-blue-600 hover:underline dark:text-blue-400">
            Back to action plan
          </Link>
          {" · "}
          <Link href="/justice/chat" className="text-blue-600 hover:underline dark:text-blue-400">
            Chat intake
          </Link>
          {" · "}
          <Link href="/justice/intake" className="text-blue-600 hover:underline dark:text-blue-400">
            Form intake
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Submission draft preview</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Review a plain-text draft built from your saved answers. Nothing here is filed automatically.
        </p>

        <div className={`mt-6 ${cardCls}`}>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300" htmlFor="preview-destination">
            Related action
          </label>
          <select
            id="preview-destination"
            className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value as DestinationId)}
          >
            {previewOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} ({d.status})
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            {selectableDestinations.length > 0
              ? "Showing destinations that are recommended or available for your case. If none apply, pick the closest match."
              : "No recommended or available destinations right now — showing all actions for reference."}
          </p>
        </div>

        {isSignedIn && evidenceLoading ? (
          <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">Loading evidence titles…</p>
        ) : null}
        {isSignedIn && evidenceError ? (
          <p className="mt-4 text-sm text-amber-800 dark:text-amber-200">Could not load evidence titles (draft still shown).</p>
        ) : null}

        <div className={`mt-6 ${cardCls}`}>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Draft for your review</h2>
          <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
            Not filed. Not legal advice. For your preparation only.
          </p>
          <pre className="mt-4 max-h-[min(480px,55vh)] overflow-auto whitespace-pre-wrap rounded-xl border border-neutral-100 bg-neutral-50 p-4 text-xs leading-relaxed text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950/60 dark:text-neutral-100">
            {draftText}
          </pre>
        </div>

        <div className={`mt-6 ${cardCls}`}>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-neutral-800 dark:text-neutral-200">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            <span>I reviewed this draft.</span>
          </label>
          <button
            type="button"
            disabled={!reviewed}
            onClick={() => router.push("/justice/plan")}
            className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue to action plan
          </button>
        </div>
      </main>
    </>
  );
}
