"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Header from "@/app/components/Header";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { clearLocalJusticeSession } from "@/lib/justice/clearLocalJusticeSession";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import { replaceTimelineForCase } from "@/lib/justice/timeline";

type CaseRow = {
  id: string;
  intake: JusticeIntake;
  timeline: unknown;
  updated_at: string;
};

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function problemCategoryLabel(category: string): string {
  return category.replace(/_/g, " ");
}

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06]";

export default function JusticeCasesPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/justice/cases", { signal: ac.signal });
        if (!res.ok) {
          setLoadError("Could not load cases.");
          setCases([]);
          return;
        }
        const data = (await res.json()) as CaseRow[];
        if (!ac.signal.aborted) {
          setLoadError(null);
          setCases(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        setLoadError("Could not load cases.");
        setCases([]);
      }
    })();

    return () => ac.abort();
  }, [isLoaded, isSignedIn]);

  function openCase(row: CaseRow) {
    sessionStorage.setItem(STORAGE_CASE_ID, row.id);
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(row.intake));
    const tl = Array.isArray(row.timeline) ? (row.timeline as TimelineEntry[]) : [];
    replaceTimelineForCase(row.id, tl);
    router.push("/justice/plan");
  }

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/justice/plan" className="text-blue-600 hover:underline">
            Back to action plan
          </Link>
          {" · "}
          <Link href="/" className="text-blue-600 hover:underline">
            Home
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Saved cases</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Open a case you saved while signed in to continue your action plan.
        </p>
        <p className="mt-3">
          <Link
            href="/justice/intake"
            onClick={() => clearLocalJusticeSession()}
            className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Start new case
          </Link>
        </p>

        {!isLoaded ? (
          <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
        ) : !isSignedIn ? (
          <p className="mt-8 text-sm text-neutral-600 dark:text-neutral-400">Sign in to view saved cases.</p>
        ) : cases === null ? (
          <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">Loading cases…</p>
        ) : loadError ? (
          <p className="mt-8 text-sm text-red-600 dark:text-red-400">{loadError}</p>
        ) : cases.length === 0 ? (
          <p className="mt-8 text-sm text-neutral-600 dark:text-neutral-400">
            No saved cases yet. Complete intake while signed in to create one.
          </p>
        ) : (
          <ul className="mt-8 space-y-4">
            {cases.map((row) => (
              <li key={row.id} className={cardCls}>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">{row.intake.company_name}</p>
                <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                  {row.intake.purchase_or_signup.trim() || "—"}
                </p>
                <p className="mt-2 text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {problemCategoryLabel(row.intake.problem_category)}
                </p>
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                  Updated {formatUpdatedAt(row.updated_at)}
                </p>
                <button
                  type="button"
                  onClick={() => openCase(row)}
                  className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg sm:w-auto"
                >
                  Open case
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
