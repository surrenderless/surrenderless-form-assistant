"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import Header from "@/app/components/Header";
import type { JusticeIntake } from "@/lib/justice/types";
import { parseJusticeCasesListEnvelope } from "@/lib/justice/caseApiValidation";

type CaseRow = {
  id: string;
  intake: JusticeIntake;
  timeline: unknown;
  updated_at: string;
  case_label: string | null;
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

export default function JusticeArchivedCasesPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/justice/cases?archived=1&limit=10&offset=0`, { signal: ac.signal });
        if (!res.ok) {
          setLoadError("Could not load archived cases.");
          setCases([]);
          return;
        }
        const body = (await res.json()) as unknown;
        const env = parseJusticeCasesListEnvelope(body);
        if (!env) {
          setLoadError("Could not load archived cases.");
          setCases([]);
          return;
        }
        if (!ac.signal.aborted) {
          setLoadError(null);
          setCases(env.cases as CaseRow[]);
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        setLoadError("Could not load archived cases.");
        setCases([]);
      }
    })();

    return () => ac.abort();
  }, [isLoaded, isSignedIn]);

  async function restoreCase(id: string) {
    setRestoringId(id);
    try {
      const res = await fetch(`/api/justice/cases/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived_at: null }),
      });
      if (res.ok) {
        setCases((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
      } else {
        console.warn("justice archived cases: restore failed", res.status);
      }
    } catch (e) {
      console.warn("justice archived cases: restore error", e);
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/justice/cases" className="text-blue-600 hover:underline">
            Back to saved cases
          </Link>
          {" · "}
          <Link href="/" className="text-blue-600 hover:underline">
            Home
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Archived cases</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Restore a case to return it to your saved cases list.
        </p>

        {!isLoaded ? (
          <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
        ) : !isSignedIn ? (
          <p className="mt-8 text-sm text-neutral-600 dark:text-neutral-400">Sign in to view archived cases.</p>
        ) : cases === null ? (
          <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">Loading cases…</p>
        ) : loadError ? (
          <p className="mt-8 text-sm text-red-600 dark:text-red-400">{loadError}</p>
        ) : cases.length === 0 ? (
          <p className="mt-8 text-sm text-neutral-600 dark:text-neutral-400">No archived cases.</p>
        ) : (
          <ul className="mt-8 space-y-4">
            {cases.map((row) => {
              const customLabel = row.case_label?.trim();
              const mainTitle = customLabel || row.intake.company_name;
              return (
                <li key={row.id} className={cardCls}>
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">{mainTitle}</p>
                  {customLabel ? (
                    <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{row.intake.company_name}</p>
                  ) : null}
                  <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                    {row.intake.purchase_or_signup.trim() || "—"}
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    {problemCategoryLabel(row.intake.problem_category)}
                  </p>
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    Updated {formatUpdatedAt(row.updated_at)}
                  </p>
                  <div className="mt-4">
                    <button
                      type="button"
                      disabled={restoringId === row.id}
                      onClick={() => void restoreCase(row.id)}
                      className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg disabled:opacity-50 sm:w-auto"
                    >
                      {restoringId === row.id ? "Restoring…" : "Restore"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
