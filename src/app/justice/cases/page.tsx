"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Header from "@/app/components/Header";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { clearLocalJusticeSession } from "@/lib/justice/clearLocalJusticeSession";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import { replaceTimelineForCase } from "@/lib/justice/timeline";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

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

type CaseProgressSummary = {
  evidenceCount: number;
  filingsCount: number;
  openTasksCount: number;
  nextDue: string | null;
};

function soonestOpenTaskDueDate(tasks: JusticeCaseTaskRow[]): string | null {
  const open = tasks.filter((t) => !t.completed_at);
  const dates = open
    .map((t) => t.due_date?.trim())
    .filter((d): d is string => Boolean(d));
  if (dates.length === 0) return null;
  return [...dates].sort((a, b) => a.localeCompare(b))[0];
}

type ProgressFetchRow = CaseProgressSummary & { id: string; tasks: JusticeCaseTaskRow[] };

function buildAttentionItems(
  caseList: CaseRow[],
  tasksByCaseId: Record<string, JusticeCaseTaskRow[]>
): { task: JusticeCaseTaskRow; caseRow: CaseRow }[] {
  const items: { task: JusticeCaseTaskRow; caseRow: CaseRow }[] = [];
  for (const c of caseList) {
    const tasks = tasksByCaseId[c.id] ?? [];
    for (const task of tasks) {
      if (task.completed_at) continue;
      items.push({ task, caseRow: c });
    }
  }
  items.sort((a, b) => {
    const da = a.task.due_date?.trim() ?? "";
    const db = b.task.due_date?.trim() ?? "";
    if (!da && !db) return a.task.created_at.localeCompare(b.task.created_at);
    if (!da) return 1;
    if (!db) return -1;
    const cmp = da.localeCompare(db);
    if (cmp !== 0) return cmp;
    return a.task.created_at.localeCompare(b.task.created_at);
  });
  return items;
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
  const [progressById, setProgressById] = useState<Record<string, CaseProgressSummary>>({});
  const [tasksByCaseId, setTasksByCaseId] = useState<Record<string, JusticeCaseTaskRow[]>>({});
  const [progressLoading, setProgressLoading] = useState(false);

  const caseIdsKey = useMemo(() => (cases ?? []).map((c) => c.id).sort().join(","), [cases]);

  const attentionItems = useMemo(
    () => (cases?.length ? buildAttentionItems(cases, tasksByCaseId) : []),
    [cases, tasksByCaseId]
  );

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
    if (!isLoaded || !isSignedIn || !caseIdsKey) {
      setProgressById({});
      setTasksByCaseId({});
      setProgressLoading(false);
      return;
    }

    const ids = caseIdsKey.split(",").filter(Boolean);
    const ac = new AbortController();
    setProgressLoading(true);

    void (async () => {
      try {
        const rows = await Promise.all(
          ids.map(async (id) => {
            try {
              const [evRes, filRes, taskRes] = await Promise.all([
                fetch(`/api/justice/evidence?case_id=${encodeURIComponent(id)}`, { signal: ac.signal }),
                fetch(`/api/justice/filings?case_id=${encodeURIComponent(id)}`, { signal: ac.signal }),
                fetch(`/api/justice/tasks?case_id=${encodeURIComponent(id)}`, { signal: ac.signal }),
              ]);
              if (ac.signal.aborted) return null;
              const evJson: unknown = evRes.ok ? await evRes.json() : [];
              const filJson: unknown = filRes.ok ? await filRes.json() : [];
              const taskJson: unknown = taskRes.ok ? await taskRes.json() : [];
              const evidenceCount = Array.isArray(evJson) ? evJson.length : 0;
              const filingsCount = Array.isArray(filJson) ? filJson.length : 0;
              const tasks = Array.isArray(taskJson) ? (taskJson as JusticeCaseTaskRow[]) : [];
              const openTasksCount = tasks.filter((t) => !t.completed_at).length;
              const nextDue = soonestOpenTaskDueDate(tasks);
              const row: ProgressFetchRow = {
                id,
                evidenceCount,
                filingsCount,
                openTasksCount,
                nextDue,
                tasks,
              };
              return row;
            } catch {
              if (ac.signal.aborted) return null;
              const row: ProgressFetchRow = {
                id,
                evidenceCount: 0,
                filingsCount: 0,
                openTasksCount: 0,
                nextDue: null,
                tasks: [],
              };
              return row;
            }
          })
        );
        if (ac.signal.aborted) return;
        const next: Record<string, CaseProgressSummary> = {};
        const nextTasks: Record<string, JusticeCaseTaskRow[]> = {};
        for (const r of rows) {
          if (!r) continue;
          const { id, tasks, ...summary } = r;
          next[id] = summary;
          nextTasks[id] = tasks;
        }
        setProgressById(next);
        setTasksByCaseId(nextTasks);
      } finally {
        if (!ac.signal.aborted) setProgressLoading(false);
      }
    })();

    return () => ac.abort();
  }, [isLoaded, isSignedIn, caseIdsKey]);

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
        <p className="mt-3 text-sm">
          <Link
            href="/justice/intake"
            onClick={() => clearLocalJusticeSession()}
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Start new case
          </Link>
          {" · "}
          <Link href="/justice/cases/archived" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            Archived cases
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
          <>
            <section className="mt-8" aria-labelledby="needs-attention-heading">
              <h2
                id="needs-attention-heading"
                className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Needs attention
              </h2>
              {progressLoading && Object.keys(tasksByCaseId).length === 0 ? (
                <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Loading follow-ups…</p>
              ) : attentionItems.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">No open follow-up tasks.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {attentionItems.map(({ task, caseRow }) => (
                    <li
                      key={`${caseRow.id}-${task.id}`}
                      className={`${cardCls} border-amber-200/80 ring-amber-950/[0.06] dark:border-amber-900/40 dark:ring-amber-500/10`}
                    >
                      <p className="font-medium text-neutral-900 dark:text-neutral-100">{task.title}</p>
                      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                        Due: {task.due_date?.trim() ? task.due_date.trim() : "No due date"}
                      </p>
                      <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                        Case: {caseRow.intake.company_name}
                      </p>
                      {task.notes?.trim() ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">
                          {task.notes.trim()}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openCase(caseRow)}
                        className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg sm:w-auto"
                      >
                        Open case
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

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
                {progressLoading && progressById[row.id] === undefined ? (
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Loading progress…</p>
                ) : (
                  <ul className="mt-2 space-y-0.5 text-xs text-neutral-600 dark:text-neutral-400">
                    <li>Evidence: {progressById[row.id]?.evidenceCount ?? "—"}</li>
                    <li>Filings: {progressById[row.id]?.filingsCount ?? "—"}</li>
                    <li>Open tasks: {progressById[row.id]?.openTasksCount ?? "—"}</li>
                    <li>
                      Next due: {progressById[row.id]?.nextDue?.trim() || "None"}
                    </li>
                  </ul>
                )}
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
          </>
        )}
      </main>
    </>
  );
}
