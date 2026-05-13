"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import {
  getJusticeTaskDueKind,
  justiceTaskDueBadgeClass,
  justiceTaskDueKindLabel,
} from "@/lib/justice/taskDueStatus";
import { applyServerTimelineFromResponse } from "@/lib/justice/timeline";
import { STORAGE_CASE_ID } from "@/lib/justice/types";

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

const inputCls =
  "mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]";

const labelCls = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

function readCaseId(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
}

function sortTasks(rows: JusticeCaseTaskRow[]): JusticeCaseTaskRow[] {
  return [...rows].sort((a, b) => {
    const aDone = Boolean(a.completed_at);
    const bDone = Boolean(b.completed_at);
    if (aDone !== bDone) return aDone ? 1 : -1;
    const ad = a.due_date?.trim() ?? "";
    const bd = b.due_date?.trim() ?? "";
    if (ad && bd && ad !== bd) return ad.localeCompare(bd);
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

export type JusticeCaseTasksProps = {
  onTasksChange?: () => void;
  /** After task APIs update the server timeline and session storage, refresh parent UI (e.g. action plan `readTimeline`). */
  onCaseTimelineSynced?: () => void;
};

export default function JusticeCaseTasks({ onTasksChange, onCaseTimelineSynced }: JusticeCaseTasksProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const [caseId, setCaseId] = useState("");
  const [items, setItems] = useState<JusticeCaseTaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const syncCaseId = useCallback(() => {
    setCaseId(readCaseId());
  }, []);

  useEffect(() => {
    syncCaseId();
    const t0 = window.setTimeout(syncCaseId, 0);
    const t1 = window.setTimeout(syncCaseId, 150);
    const t2 = window.setTimeout(syncCaseId, 600);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [syncCaseId]);

  const refreshList = useCallback(async () => {
    const cid = readCaseId();
    if (!cid || !isLoaded || !isSignedIn) {
      setItems([]);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/justice/tasks?case_id=${encodeURIComponent(cid)}`);
      if (!res.ok) {
        setLoadError(true);
        setItems([]);
        return;
      }
      const data = (await res.json()) as JusticeCaseTaskRow[];
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (!caseId) return;
    void refreshList();
  }, [caseId, isLoaded, isSignedIn, refreshList]);

  const sortedItems = useMemo(() => sortTasks(items), [items]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const cid = readCaseId();
    if (!cid || !isSignedIn) return;
    setAdding(true);
    setAddError(null);
    try {
      const body: Record<string, unknown> = {
        case_id: cid,
        title: title.trim(),
      };
      const dd = dueDate.trim();
      if (dd) body.due_date = dd;
      const n = notes.trim();
      if (n) body.notes = n;

      const res = await fetch("/api/justice/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as {
          error?: string;
        };
        setAddError(err.error ?? "Could not save task.");
        return;
      }
      applyServerTimelineFromResponse(cid, payload);
      onCaseTimelineSynced?.();
      setTitle("");
      setDueDate("");
      setNotes("");
      await refreshList();
      onTasksChange?.();
    } catch {
      setAddError("Could not save task.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this task?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/justice/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((r) => r.id !== id));
        if (editingId === id) {
          setEditingId(null);
          setEditError(null);
        }
        onTasksChange?.();
      } else {
        console.warn("justice tasks: delete failed", res.status);
      }
    } catch {
      console.warn("justice tasks: delete error");
    } finally {
      setDeletingId(null);
    }
  }

  function startEdit(row: JusticeCaseTaskRow) {
    setEditingId(row.id);
    setEditError(null);
    setEditTitle(row.title);
    setEditDueDate(row.due_date ?? "");
    setEditNotes(row.notes ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleSaveEdit(e: React.FormEvent, id: string) {
    e.preventDefault();
    if (!isSignedIn) return;
    const t = editTitle.trim();
    if (!t) {
      setEditError("Title is required.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const body = {
        title: t,
        due_date: editDueDate.trim() ? editDueDate.trim() : null,
        notes: editNotes.trim() ? editNotes.trim() : null,
      };
      const res = await fetch(`/api/justice/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as {
          error?: string;
        };
        setEditError(err.error ?? "Could not update task.");
        return;
      }
      const cid = readCaseId();
      if (cid) applyServerTimelineFromResponse(cid, payload);
      if (
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        "timeline" in payload &&
        Array.isArray((payload as Record<string, unknown>).timeline)
      ) {
        onCaseTimelineSynced?.();
      }
      setEditingId(null);
      await refreshList();
      onTasksChange?.();
    } catch {
      setEditError("Could not update task.");
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleComplete(row: JusticeCaseTaskRow) {
    setTogglingId(row.id);
    try {
      const nextCompleted = row.completed_at ? null : new Date().toISOString();
      const res = await fetch(`/api/justice/tasks/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed_at: nextCompleted }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        console.warn("justice tasks: patch failed", res.status);
        return;
      }
      const cid = readCaseId();
      if (cid) applyServerTimelineFromResponse(cid, payload);
      onCaseTimelineSynced?.();
      const raw = payload as (JusticeCaseTaskRow & { timeline?: unknown }) | null;
      if (!raw) return;
      const { timeline: _tl, ...updated } = raw;
      setItems((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      onTasksChange?.();
    } catch {
      console.warn("justice tasks: patch error");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className={`mt-6 ${cardCls}`}>
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Follow-up tasks</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Track next steps and deadlines for this case.
      </p>

      {!caseId ? (
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">No active case in this browser.</p>
      ) : !isLoaded ? (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
      ) : !isSignedIn ? (
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">Sign in to manage tasks.</p>
      ) : (
        <>
          <form onSubmit={(e) => void handleAdd(e)} className="mt-5 space-y-3 border-t border-neutral-100 pt-5 dark:border-neutral-700/80">
            <div>
              <label className={labelCls} htmlFor="justice-task-title">
                Title <span className="text-red-600">*</span>
              </label>
              <input
                id="justice-task-title"
                className={inputCls}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={500}
                placeholder="e.g. Call bank dispute line"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="justice-task-due">
                Due date <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <input
                id="justice-task-due"
                className={inputCls}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                maxLength={200}
                placeholder="e.g. 2026-05-20"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="justice-task-notes">
                Notes <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <textarea
                id="justice-task-notes"
                className={`${inputCls} min-h-[72px] resize-y`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={8000}
                placeholder="Context or links"
              />
            </div>
            {addError ? <p className="text-sm text-red-600 dark:text-red-400">{addError}</p> : null}
            <button
              type="submit"
              disabled={adding || !title.trim()}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add task"}
            </button>
          </form>

          <div className="mt-6 border-t border-neutral-100 pt-5 dark:border-neutral-700/80">
            <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Your tasks</p>
            {loading ? (
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
            ) : loadError ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">Could not load tasks.</p>
            ) : sortedItems.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">No tasks yet.</p>
            ) : (
              <ul className="mt-3 space-y-4">
                {sortedItems.map((row) => {
                  const done = Boolean(row.completed_at);
                  const dueKind = getJusticeTaskDueKind(row);
                  return (
                    <li
                      key={row.id}
                      className={`border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0 dark:border-neutral-700/80 ${done ? "opacity-80" : ""}`}
                    >
                      {editingId === row.id ? (
                        <form onSubmit={(e) => void handleSaveEdit(e, row.id)}>
                          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                            Edit task
                          </p>
                          <div className="mt-3">
                            <label className={labelCls} htmlFor={`task-edit-title-${row.id}`}>
                              Title <span className="text-red-600">*</span>
                            </label>
                            <input
                              id={`task-edit-title-${row.id}`}
                              className={inputCls}
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              required
                              maxLength={500}
                              autoComplete="off"
                            />
                          </div>
                          <div className="mt-3">
                            <label className={labelCls} htmlFor={`task-edit-due-${row.id}`}>
                              Due date <span className="font-normal text-neutral-500">(optional)</span>
                            </label>
                            <input
                              id={`task-edit-due-${row.id}`}
                              className={inputCls}
                              value={editDueDate}
                              onChange={(e) => setEditDueDate(e.target.value)}
                              maxLength={200}
                              placeholder="e.g. 2026-05-20"
                              autoComplete="off"
                            />
                          </div>
                          <div className="mt-3">
                            <label className={labelCls} htmlFor={`task-edit-notes-${row.id}`}>
                              Notes <span className="font-normal text-neutral-500">(optional)</span>
                            </label>
                            <textarea
                              id={`task-edit-notes-${row.id}`}
                              className={`${inputCls} min-h-[72px] resize-y`}
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              maxLength={8000}
                              placeholder="Context or links"
                            />
                          </div>
                          {editError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{editError}</p> : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="submit"
                              disabled={editSaving || !editTitle.trim()}
                              className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:opacity-50"
                            >
                              {editSaving ? "Saving…" : "Save changes"}
                            </button>
                            <button
                              type="button"
                              disabled={editSaving}
                              onClick={cancelEdit}
                              className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <p className={`font-medium text-neutral-900 dark:text-neutral-100 ${done ? "line-through" : ""}`}>
                            {row.title}
                          </p>
                          <p className="mt-1 flex flex-wrap items-center gap-2">
                            <span className={justiceTaskDueBadgeClass(dueKind)}>
                              {justiceTaskDueKindLabel(dueKind)}
                            </span>
                            {row.due_date?.trim() ? (
                              <span className="text-xs text-neutral-600 dark:text-neutral-400">
                                Due: {row.due_date.trim()}
                              </span>
                            ) : null}
                          </p>
                          {row.notes?.trim() ? (
                            <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                              {row.notes.trim()}
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={Boolean(editingId) && editingId !== row.id}
                              onClick={() => startEdit(row)}
                              className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={togglingId === row.id}
                              onClick={() => void toggleComplete(row)}
                              className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                            >
                              {togglingId === row.id ? "Saving…" : done ? "Reopen" : "Mark complete"}
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === row.id}
                              onClick={() => void handleDelete(row.id)}
                              className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-neutral-900 dark:text-red-200 dark:hover:bg-red-950/40"
                            >
                              {deletingId === row.id ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
