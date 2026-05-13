"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Header from "@/app/components/Header";
import {
  JUSTICE_EVIDENCE_TYPE_LABELS,
  JUSTICE_EVIDENCE_TYPES,
  type JusticeCaseEvidenceRow,
  type JusticeEvidenceType,
} from "@/lib/justice/evidence";
import { applyServerTimelineFromResponse } from "@/lib/justice/timeline";
import { STORAGE_CASE_ID } from "@/lib/justice/types";

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

const inputCls =
  "mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]";

const labelCls = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

function formatEvidenceTime(iso: string): string {
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

function typeLabel(t: string): string {
  return JUSTICE_EVIDENCE_TYPE_LABELS[t as JusticeEvidenceType] ?? t.replace(/_/g, " ");
}

export default function JusticeEvidencePage() {
  const { isSignedIn, isLoaded } = useAuth();
  const [caseId, setCaseId] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [items, setItems] = useState<JusticeCaseEvidenceRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [title, setTitle] = useState("");
  const [evidenceType, setEvidenceType] = useState<JusticeEvidenceType>("screenshot");
  const [evidenceDate, setEvidenceDate] = useState("");
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [storageNote, setStorageNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? "");
    setSessionReady(true);
  }, []);

  const refreshList = useCallback(async () => {
    const cid = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) ?? "" : "";
    if (!cid || !isLoaded || !isSignedIn) {
      setItems([]);
      return;
    }
    setLoadingList(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/justice/evidence?case_id=${encodeURIComponent(cid)}`);
      if (!res.ok) {
        setLoadError("Could not load evidence.");
        setItems([]);
        return;
      }
      const data = (await res.json()) as JusticeCaseEvidenceRow[];
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setLoadError("Could not load evidence.");
      setItems([]);
    } finally {
      setLoadingList(false);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const cid = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) ?? "" : "";
    if (!cid) return;
    void refreshList();
  }, [isLoaded, isSignedIn, refreshList, caseId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const cid = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    if (!cid || !isSignedIn) return;
    setAdding(true);
    setAddError(null);
    try {
      const body: Record<string, unknown> = {
        case_id: cid,
        title: title.trim(),
        evidence_type: evidenceType,
      };
      const d = evidenceDate.trim();
      if (d) body.evidence_date = d;
      const desc = description.trim();
      if (desc) body.description = desc;
      const su = sourceUrl.trim();
      if (su) body.source_url = su;
      const sn = storageNote.trim();
      if (sn) body.storage_note = sn;

      const res = await fetch("/api/justice/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as {
          error?: string;
        };
        setAddError(err.error ?? "Could not save evidence.");
        return;
      }
      applyServerTimelineFromResponse(cid, payload);
      setTitle("");
      setEvidenceDate("");
      setDescription("");
      setSourceUrl("");
      setStorageNote("");
      setEvidenceType("screenshot");
      await refreshList();
    } catch {
      setAddError("Could not save evidence.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this evidence record?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/justice/evidence/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((row) => row.id !== id));
      } else {
        console.warn("justice evidence: delete failed", res.status);
      }
    } catch {
      console.warn("justice evidence: delete error");
    } finally {
      setDeletingId(null);
    }
  }

  const noCase = !caseId;

  if (!sessionReady) {
    return (
      <>
        <Header />
        <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
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
          <Link href="/justice/cases" className="text-blue-600 hover:underline dark:text-blue-400">
            Saved cases
          </Link>
          {" · "}
          <Link href="/" className="text-blue-600 hover:underline dark:text-blue-400">
            Home
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Evidence / proof</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Add notes about what you have on file (screenshots, receipts, emails, and so on). File uploads are not available
          yet.
        </p>

        {noCase ? (
          <div className={`mt-8 ${cardCls}`}>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              No active case in this browser. Open a saved case first, then return here.
            </p>
            <Link
              href="/justice/cases"
              className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700"
            >
              Saved cases
            </Link>
          </div>
        ) : !isLoaded ? (
          <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
        ) : !isSignedIn ? (
          <div className={`mt-8 ${cardCls}`}>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              Sign in to add and view evidence for your saved cases.
            </p>
            <Link
              href="/justice/cases"
              className="mt-4 inline-flex text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Saved cases
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={(e) => void handleAdd(e)} className={`mt-8 ${cardCls}`}>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Add evidence</h2>
              <div className="mt-4">
                <label className={labelCls} htmlFor="evidence-title">
                  Title
                </label>
                <input
                  id="evidence-title"
                  className={inputCls}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={500}
                  autoComplete="off"
                  placeholder="e.g. Chat transcript with support"
                />
              </div>
              <div className="mt-4">
                <label className={labelCls} htmlFor="evidence-type">
                  Evidence type
                </label>
                <select
                  id="evidence-type"
                  className={inputCls}
                  value={evidenceType}
                  onChange={(e) => setEvidenceType(e.target.value as JusticeEvidenceType)}
                >
                  {JUSTICE_EVIDENCE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {JUSTICE_EVIDENCE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-4">
                <label className={labelCls} htmlFor="evidence-date">
                  Evidence date <span className="font-normal text-neutral-500">(optional)</span>
                </label>
                <input
                  id="evidence-date"
                  className={inputCls}
                  value={evidenceDate}
                  onChange={(e) => setEvidenceDate(e.target.value)}
                  placeholder="e.g. 2026-01-15 or “March phone call”"
                  maxLength={200}
                  autoComplete="off"
                />
              </div>
              <div className="mt-4">
                <label className={labelCls} htmlFor="evidence-desc">
                  Description <span className="font-normal text-neutral-500">(optional)</span>
                </label>
                <textarea
                  id="evidence-desc"
                  className={`${inputCls} min-h-[100px] resize-y`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={8000}
                  placeholder="What this shows, ticket numbers, etc."
                />
              </div>
              <div className="mt-4">
                <label className={labelCls} htmlFor="evidence-source-url">
                  Source URL <span className="font-normal text-neutral-500">(optional)</span>
                </label>
                <input
                  id="evidence-source-url"
                  className={inputCls}
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  maxLength={2000}
                  placeholder="https://..."
                  autoComplete="off"
                />
              </div>
              <div className="mt-4">
                <label className={labelCls} htmlFor="evidence-storage-note">
                  Storage note <span className="font-normal text-neutral-500">(optional)</span>
                </label>
                <textarea
                  id="evidence-storage-note"
                  className={`${inputCls} min-h-[72px] resize-y`}
                  value={storageNote}
                  onChange={(e) => setStorageNote(e.target.value)}
                  maxLength={8000}
                  placeholder="Where this file is saved, e.g. Gmail, Drive folder, desktop"
                />
              </div>
              {addError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{addError}</p> : null}
              <button
                type="submit"
                disabled={adding || !title.trim()}
                className="mt-5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:opacity-50"
              >
                {adding ? "Adding…" : "Add evidence"}
              </button>
            </form>

            <section className="mt-10" aria-labelledby="evidence-list-heading">
              <h2 id="evidence-list-heading" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Your evidence for this case
              </h2>
              {loadingList ? (
                <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
              ) : loadError ? (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400">{loadError}</p>
              ) : items.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">No evidence added yet.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {items.map((row) => (
                    <li key={row.id} className={cardCls}>
                      <p className="font-medium text-neutral-900 dark:text-neutral-100">{row.title}</p>
                      <p className="mt-1 text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                        {typeLabel(row.evidence_type)}
                      </p>
                      {row.evidence_date ? (
                        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">{row.evidence_date}</p>
                      ) : null}
                      {row.description ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                          {row.description}
                        </p>
                      ) : null}
                      {row.source_url?.trim() ? (
                        <p className="mt-2 text-xs break-all text-blue-600 dark:text-blue-400">
                          <a href={row.source_url.trim()} target="_blank" rel="noopener noreferrer" className="underline">
                            {row.source_url.trim()}
                          </a>
                        </p>
                      ) : null}
                      {row.storage_note?.trim() ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">
                          <span className="font-medium text-neutral-700 dark:text-neutral-300">Stored: </span>
                          {row.storage_note.trim()}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                        Added {formatEvidenceTime(row.created_at)}
                      </p>
                      <button
                        type="button"
                        disabled={deletingId === row.id}
                        onClick={() => void handleDelete(row.id)}
                        className="mt-4 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-neutral-900 dark:text-red-200 dark:hover:bg-red-950/40"
                      >
                        {deletingId === row.id ? "Deleting…" : "Delete"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
