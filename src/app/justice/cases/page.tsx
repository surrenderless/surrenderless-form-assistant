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

const labelInputCls =
  "mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]";

export default function JusticeCasesPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionCaseId, setSessionCaseId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [labelDraftById, setLabelDraftById] = useState<Record<string, string>>({});
  const [savingLabelId, setSavingLabelId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!cases) return;
    setLabelDraftById((prev) => {
      const next = { ...prev };
      for (const c of cases) {
        if (!(c.id in next)) {
          next[c.id] = c.case_label ?? "";
        }
      }
      return next;
    });
  }, [cases]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSessionCaseId(sessionStorage.getItem(STORAGE_CASE_ID));
  }, [cases]);

  async function saveLabel(id: string) {
    setSavingLabelId(id);
    try {
      const trimmed = (labelDraftById[id] ?? "").trim();
      const res = await fetch(`/api/justice/cases/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_label: trimmed.length > 0 ? trimmed : null }),
      });
      if (res.ok) {
        const data = (await res.json()) as { case_label?: string | null };
        const nextLabel = data.case_label ?? null;
        setCases((prev) => prev?.map((c) => (c.id === id ? { ...c, case_label: nextLabel } : c)) ?? prev);
        setLabelDraftById((d) => ({ ...d, [id]: nextLabel?.trim() ? nextLabel : "" }));
      } else {
        console.warn("justice cases: save label failed", res.status);
      }
    } catch (e) {
      console.warn("justice cases: save label error", e);
    } finally {
      setSavingLabelId(null);
    }
  }

  async function archiveCase(id: string) {
    setArchivingId(id);
    try {
      const res = await fetch(`/api/justice/cases/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived_at: new Date().toISOString() }),
      });
      if (res.ok) {
        setCases((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
      } else {
        console.warn("justice cases: archive failed", res.status);
      }
    } catch (e) {
      console.warn("justice cases: archive error", e);
    } finally {
      setArchivingId(null);
    }
  }

  function openCase(row: CaseRow) {
    sessionStorage.setItem(STORAGE_CASE_ID, row.id);
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(row.intake));
    const tl = Array.isArray(row.timeline) ? (row.timeline as TimelineEntry[]) : [];
    replaceTimelineForCase(row.id, tl);
    setSessionCaseId(row.id);
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
                  <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">
                    Case label
                  </label>
                  <input
                    type="text"
                    className={labelInputCls}
                    value={labelDraftById[row.id] ?? ""}
                    onChange={(e) =>
                      setLabelDraftById((d) => ({
                        ...d,
                        [row.id]: e.target.value,
                      }))
                    }
                    placeholder="Optional short name"
                    maxLength={500}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    disabled={savingLabelId === row.id}
                    onClick={() => void saveLabel(row.id)}
                    className="mt-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    {savingLabelId === row.id ? "Saving…" : "Save label"}
                  </button>
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <button
                    type="button"
                    onClick={() => openCase(row)}
                    className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg sm:w-auto"
                  >
                    Open case
                  </button>
                  {sessionCaseId === row.id ? (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      This case is open in your browser — open another case or start new to archive this one.
                    </p>
                  ) : (
                    <button
                      type="button"
                      disabled={archivingId === row.id}
                      onClick={() => void archiveCase(row.id)}
                      className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 sm:w-auto"
                    >
                      {archivingId === row.id ? "Archiving…" : "Archive"}
                    </button>
                  )}
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
