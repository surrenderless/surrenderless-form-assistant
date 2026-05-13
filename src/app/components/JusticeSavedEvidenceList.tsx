"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  JUSTICE_EVIDENCE_TYPE_LABELS,
  type JusticeCaseEvidenceRow,
  type JusticeEvidenceType,
} from "@/lib/justice/evidence";
import { STORAGE_CASE_ID } from "@/lib/justice/types";

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-4 shadow-md shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/30 dark:ring-white/[0.06]";

function typeLabel(t: string): string {
  return JUSTICE_EVIDENCE_TYPE_LABELS[t as JusticeEvidenceType] ?? t.replace(/_/g, " ");
}

function readCaseId(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
}

export default function JusticeSavedEvidenceList() {
  const { isLoaded, isSignedIn } = useAuth();
  const [caseId, setCaseId] = useState("");
  const [items, setItems] = useState<JusticeCaseEvidenceRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

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

  useEffect(() => {
    if (!isLoaded) return;

    if (!caseId) {
      setItems(null);
      setLoading(false);
      setFetchError(false);
      return;
    }

    if (!isSignedIn) {
      setItems(null);
      setLoading(false);
      setFetchError(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setFetchError(false);

    void (async () => {
      try {
        const res = await fetch(`/api/justice/evidence?case_id=${encodeURIComponent(caseId)}`, {
          signal: ac.signal,
        });
        if (!res.ok) {
          if (!ac.signal.aborted) {
            setFetchError(true);
            setItems([]);
          }
          return;
        }
        const data = (await res.json()) as JusticeCaseEvidenceRow[];
        if (!ac.signal.aborted) {
          setItems(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!ac.signal.aborted) {
          setFetchError(true);
          setItems([]);
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [caseId, isLoaded, isSignedIn]);

  const addEvidence = (
    <Link
      href="/justice/evidence"
      className="mt-3 inline-flex text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
    >
      Add evidence
    </Link>
  );

  return (
    <div className={`mt-5 ${cardCls}`}>
      <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Saved evidence</p>

      {!caseId ? (
        <div className="mt-2">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            No active case in this browser. Open a saved case to see evidence here.
          </p>
          <Link href="/justice/cases" className="mt-2 inline-flex text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
            Saved cases
          </Link>
          {addEvidence}
        </div>
      ) : !isLoaded ? (
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
      ) : !isSignedIn ? (
        <div className="mt-2">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Sign in to view saved evidence for this case.</p>
          {addEvidence}
        </div>
      ) : loading ? (
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Loading evidence…</p>
      ) : fetchError ? (
        <div className="mt-2">
          <p className="text-sm text-red-600 dark:text-red-400">Could not load evidence.</p>
          {addEvidence}
        </div>
      ) : !items?.length ? (
        <div className="mt-2">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">No evidence saved yet.</p>
          {addEvidence}
        </div>
      ) : (
        <div className="mt-3">
          <ul className="space-y-3">
            {items.map((row) => (
              <li
                key={row.id}
                className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0 dark:border-neutral-700/80"
              >
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{row.title}</p>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{typeLabel(row.evidence_type)}</p>
                {row.evidence_date ? (
                  <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{row.evidence_date}</p>
                ) : null}
                {row.description ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-700 dark:text-neutral-300">{row.description}</p>
                ) : null}
                {row.source_url?.trim() ? (
                  <p className="mt-1 text-xs break-all text-blue-600 dark:text-blue-400">
                    <a href={row.source_url.trim()} target="_blank" rel="noopener noreferrer" className="underline">
                      {row.source_url.trim()}
                    </a>
                  </p>
                ) : null}
                {row.storage_note?.trim() ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-600 dark:text-neutral-400">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">Stored: </span>
                    {row.storage_note.trim()}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {addEvidence}
        </div>
      )}
    </div>
  );
}
