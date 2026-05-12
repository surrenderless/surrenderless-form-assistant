"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
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

export type JusticeFilingRecordsProps = {
  /** Called after list load or successful add/delete so parents (e.g. packet) can refresh bundle text. */
  onFilingsChange?: () => void;
};

export default function JusticeFilingRecords({ onFilingsChange }: JusticeFilingRecordsProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const [caseId, setCaseId] = useState("");
  const [items, setItems] = useState<JusticeCaseFilingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [destination, setDestination] = useState("");
  const [filedAt, setFiledAt] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [filingUrl, setFilingUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      const res = await fetch(`/api/justice/filings?case_id=${encodeURIComponent(cid)}`);
      if (!res.ok) {
        setLoadError(true);
        setItems([]);
        return;
      }
      const data = (await res.json()) as JusticeCaseFilingRow[];
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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const cid = readCaseId();
    if (!cid || !isSignedIn) return;
    setAdding(true);
    setAddError(null);
    try {
      const body: Record<string, unknown> = {
        case_id: cid,
        destination: destination.trim(),
      };
      const fa = filedAt.trim();
      if (fa) body.filed_at = fa;
      const cn = confirmationNumber.trim();
      if (cn) body.confirmation_number = cn;
      const fu = filingUrl.trim();
      if (fu) body.filing_url = fu;
      const n = notes.trim();
      if (n) body.notes = n;

      const res = await fetch("/api/justice/filings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as {
          error?: string;
        };
        setAddError(err.error ?? "Could not save filing.");
        return;
      }
      applyServerTimelineFromResponse(cid, payload);
      setDestination("");
      setFiledAt("");
      setConfirmationNumber("");
      setFilingUrl("");
      setNotes("");
      await refreshList();
      onFilingsChange?.();
    } catch {
      setAddError("Could not save filing.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this filing record?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/justice/filings/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((r) => r.id !== id));
        onFilingsChange?.();
      } else {
        console.warn("justice filings: delete failed", res.status);
      }
    } catch {
      console.warn("justice filings: delete error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={`mt-5 ${cardCls}`}>
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Filing records</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Track where you filed (CFPB, BBB, state AG, etc.), dates, and confirmation details.
      </p>

      {!caseId ? (
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">No active case in this browser.</p>
      ) : !isLoaded ? (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
      ) : !isSignedIn ? (
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">Sign in to manage filing records.</p>
      ) : (
        <>
          <form onSubmit={(e) => void handleAdd(e)} className="mt-5 space-y-3 border-t border-neutral-100 pt-5 dark:border-neutral-700/80">
            <div>
              <label className={labelCls} htmlFor="filing-destination">
                Destination <span className="text-red-600">*</span>
              </label>
              <input
                id="filing-destination"
                className={inputCls}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                required
                maxLength={500}
                placeholder="e.g. CFPB, BBB, State AG — California"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="filing-date">
                Filed at <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <input
                id="filing-date"
                className={inputCls}
                value={filedAt}
                onChange={(e) => setFiledAt(e.target.value)}
                maxLength={200}
                placeholder="e.g. 2026-05-10"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="filing-confirmation">
                Confirmation number <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <input
                id="filing-confirmation"
                className={inputCls}
                value={confirmationNumber}
                onChange={(e) => setConfirmationNumber(e.target.value)}
                maxLength={200}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="filing-url">
                Filing URL <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <input
                id="filing-url"
                className={inputCls}
                type="url"
                value={filingUrl}
                onChange={(e) => setFilingUrl(e.target.value)}
                maxLength={2000}
                placeholder="https://…"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="filing-notes">
                Notes <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <textarea
                id="filing-notes"
                className={`${inputCls} min-h-[80px] resize-y`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={8000}
                placeholder="Reference numbers, portal name, etc."
              />
            </div>
            {addError ? <p className="text-sm text-red-600 dark:text-red-400">{addError}</p> : null}
            <button
              type="submit"
              disabled={adding || !destination.trim()}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add filing record"}
            </button>
          </form>

          <div className="mt-6 border-t border-neutral-100 pt-5 dark:border-neutral-700/80">
            <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Saved filings</p>
            {loading ? (
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
            ) : loadError ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">Could not load filing records.</p>
            ) : items.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">No filing records yet.</p>
            ) : (
              <ul className="mt-3 space-y-4">
                {items.map((row) => (
                  <li
                    key={row.id}
                    className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0 dark:border-neutral-700/80"
                  >
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{row.destination}</p>
                    {row.filed_at ? (
                      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">Filed: {row.filed_at}</p>
                    ) : null}
                    {row.confirmation_number ? (
                      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                        Confirmation: {row.confirmation_number}
                      </p>
                    ) : null}
                    {row.filing_url ? (
                      <p className="mt-1 text-xs break-all text-blue-600 dark:text-blue-400">
                        <a href={row.filing_url} target="_blank" rel="noopener noreferrer" className="underline">
                          {row.filing_url}
                        </a>
                      </p>
                    ) : null}
                    {row.notes?.trim() ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                        {row.notes.trim()}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={deletingId === row.id}
                      onClick={() => void handleDelete(row.id)}
                      className="mt-3 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-neutral-900 dark:text-red-200 dark:hover:bg-red-950/40"
                    >
                      {deletingId === row.id ? "Deleting…" : "Delete"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
