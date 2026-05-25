"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validate as isUuid } from "uuid";
import Header from "@/app/components/Header";
import {
  APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER,
  APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER,
  APPROVED_NEXT_ACTION_HANDLING_REQUESTED_LABEL,
  ApprovedNextActionHandlingAcknowledgedReadOnly,
  ApprovedNextActionHandlingHandledOpenTriageNote,
  ApprovedNextActionHandlingQueueStatusReadOnly,
  ApprovedNextActionHandlingRequestNoteReadOnly,
  formatHandlingRecordedLine,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  acknowledgeHandlingRequestInApprovedNextAction,
  approvedNextActionStatusLabel,
  hydrateApprovedNextActionForDisplay,
  isHandlingAwaitingTriageApprovedNextAction,
  mergeClientStateWithAcknowledgedHandling,
  parseApprovedNextAction,
  parseApprovedNextActionFromClientState,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import { parseJusticeCasesListEnvelope } from "@/lib/justice/caseApiValidation";
import type {
  JusticeApprovedNextAction,
  JusticeCaseClientState,
  JusticeIntake,
  TimelineEntry,
} from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import { replaceTimelineForCase } from "@/lib/justice/timeline";

/** Must stay within `GET /api/justice/cases` `MAX_LIST_LIMIT`. */
const CASES_FETCH_LIMIT = 50;

type CaseRow = {
  id: string;
  intake: JusticeIntake;
  timeline: unknown;
  updated_at: string;
  case_label: string | null;
  client_state?: unknown;
};

type HandlingWorkbenchItem = {
  caseRow: CaseRow;
  next: JusticeApprovedNextAction;
};

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06]";

function caseDisplayTitle(row: CaseRow): string {
  return row.case_label?.trim() || row.intake.company_name;
}

function buildHandlingWorkbenchItems(caseList: CaseRow[]): HandlingWorkbenchItem[] {
  const items: HandlingWorkbenchItem[] = [];
  for (const c of caseList) {
    const next = parseApprovedNextActionFromClientState(c.client_state);
    if (!next?.handling_requested_at?.trim()) continue;
    items.push({ caseRow: c, next });
  }
  return items;
}

function sortByHandlingRequestedAtDesc(items: HandlingWorkbenchItem[]): HandlingWorkbenchItem[] {
  return [...items].sort((a, b) => {
    const da = a.next.handling_requested_at?.trim() ?? "";
    const db = b.next.handling_requested_at?.trim() ?? "";
    if (!da && !db) return b.caseRow.updated_at.localeCompare(a.caseRow.updated_at);
    if (!da) return 1;
    if (!db) return -1;
    const cmp = db.localeCompare(da);
    if (cmp !== 0) return cmp;
    return b.caseRow.updated_at.localeCompare(a.caseRow.updated_at);
  });
}

async function fetchAllActiveCases(signal: AbortSignal): Promise<CaseRow[]> {
  const all: CaseRow[] = [];
  let offset = 0;
  while (true) {
    const res = await fetch(
      `/api/justice/cases?limit=${CASES_FETCH_LIMIT}&offset=${offset}`,
      { signal }
    );
    if (!res.ok) return all;
    const body = (await res.json()) as unknown;
    const env = parseJusticeCasesListEnvelope(body);
    if (!env) return all;
    all.push(...(env.cases as CaseRow[]));
    if (!env.has_more) break;
    offset += CASES_FETCH_LIMIT;
    if (offset > 50_000) break;
  }
  return all;
}

function isInternalJusticeHref(href: string): boolean {
  const t = href.trim();
  return t.startsWith("/justice/") && !t.startsWith("//");
}

/** Internal approved-step route for workbench (not plan-only duplicate). */
function resolveWorkbenchApprovedStepHref(next: JusticeApprovedNextAction): string | undefined {
  const href = next.href?.trim();
  if (!href || !isInternalJusticeHref(href)) return undefined;
  if (href === "/justice/plan") return undefined;
  return href;
}

const navButtonPrimaryCls =
  "w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg sm:w-auto";

const navButtonSecondaryCls =
  "w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 sm:w-auto";

function HandlingWorkbenchCaseCard({
  item,
  isActiveSessionCase,
  showMarkAcknowledged,
  compactNavigation,
  acknowledging,
  onOpenActionPlan,
  onOpenPacket,
  onOpenChat,
  onOpenApprovedStep,
  onAcknowledge,
}: {
  item: HandlingWorkbenchItem;
  isActiveSessionCase: boolean;
  showMarkAcknowledged: boolean;
  /** Plan + chat only (handled approved action with open handling request). */
  compactNavigation?: boolean;
  acknowledging: boolean;
  onOpenActionPlan: () => void;
  onOpenPacket: () => void;
  onOpenChat: () => void;
  onOpenApprovedStep?: () => void;
  onAcknowledge?: () => void;
}) {
  const { caseRow, next } = item;
  const title = caseDisplayTitle(caseRow);
  const product = caseRow.intake.purchase_or_signup.trim();
  const statusLabel = approvedNextActionStatusLabel(next.status);
  const actionLabel = next.label?.trim();
  const handlingAt = next.handling_requested_at?.trim();
  const showHandledOpenHandlingTriageNote = Boolean(
    handlingAt &&
      !next.handling_acknowledged_at?.trim() &&
      next.status === "completed"
  );
  const showApprovedStep = !compactNavigation && Boolean(onOpenApprovedStep);

  return (
    <li
      className={`${cardCls} border-emerald-200/80 ring-emerald-950/[0.06] dark:border-emerald-900/40 dark:ring-emerald-500/10`}
    >
      <p className="font-medium text-neutral-900 dark:text-neutral-100">{title}</p>
      {isActiveSessionCase ? (
        <p className="mt-1 text-xs font-medium text-neutral-600 dark:text-neutral-400">
          Current case in this browser
        </p>
      ) : null}
      {product ? (
        <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{product}</p>
      ) : null}
      {statusLabel || actionLabel ? (
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">Approved next action:</span>{" "}
          {statusLabel ?? "—"}
          {actionLabel ? (
            <>
              {" "}
              — <span className="text-neutral-800 dark:text-neutral-200">{actionLabel}</span>
            </>
          ) : null}
        </p>
      ) : null}
      {handlingAt ? (
        <p className="mt-2 text-xs font-medium text-emerald-800 dark:text-emerald-200">
          {APPROVED_NEXT_ACTION_HANDLING_REQUESTED_LABEL}
        </p>
      ) : null}
      {handlingAt ? (
        <p className="mt-0.5 text-xs text-emerald-800/90 dark:text-emerald-200/90">
          {formatHandlingRecordedLine(handlingAt)}
        </p>
      ) : null}
      <ApprovedNextActionHandlingRequestNoteReadOnly note={next.handling_request_note} tone="neutral" />
      <ApprovedNextActionHandlingQueueStatusReadOnly
        handlingRequestedAt={handlingAt}
        handlingAcknowledgedAt={next.handling_acknowledged_at}
      />
      {showHandledOpenHandlingTriageNote ? (
        <ApprovedNextActionHandlingHandledOpenTriageNote variant="redirect" />
      ) : null}
      <ApprovedNextActionHandlingAcknowledgedReadOnly
        acknowledgedAt={next.handling_acknowledged_at}
        tone="neutral"
      />
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
        {APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" onClick={onOpenActionPlan} className={navButtonPrimaryCls}>
          Open action plan
        </button>
        {!compactNavigation ? (
          <button type="button" onClick={onOpenPacket} className={navButtonSecondaryCls}>
            Open case packet
          </button>
        ) : null}
        <button type="button" onClick={onOpenChat} className={navButtonSecondaryCls}>
          Update in chat
        </button>
        {showApprovedStep ? (
          <button type="button" onClick={onOpenApprovedStep} className={navButtonSecondaryCls}>
            Open approved step
          </button>
        ) : null}
        {showMarkAcknowledged ? (
          <button
            type="button"
            disabled={acknowledging}
            onClick={() => onAcknowledge?.()}
            className={`${navButtonSecondaryCls} disabled:opacity-60`}
          >
            {acknowledging ? "Saving…" : "Mark acknowledged"}
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
        Opens this case in your browser session first.
      </p>
      {showMarkAcknowledged ? (
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
          {APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER}
        </p>
      ) : null}
    </li>
  );
}

export default function JusticeHandlingWorkbenchPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acknowledgingHandlingCaseId, setAcknowledgingHandlingCaseId] = useState<string | null>(null);
  const [sessionCaseId, setSessionCaseId] = useState<string | null>(null);
  const refetchAbortRef = useRef<AbortController | null>(null);

  function refreshSessionCaseIdFromStorage() {
    if (typeof window === "undefined") return;
    const id = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
    setSessionCaseId(id || null);
  }

  const loadCases = useCallback(async (signal: AbortSignal) => {
    try {
      const rows = await fetchAllActiveCases(signal);
      if (!signal.aborted) {
        setLoadError(null);
        setCases(rows);
      }
    } catch {
      if (signal.aborted) return;
      setLoadError("Could not load cases.");
      setCases([]);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    function refetchCases() {
      refetchAbortRef.current?.abort();
      const ac = new AbortController();
      refetchAbortRef.current = ac;
      void loadCases(ac.signal);
    }

    function onFocus() {
      refreshSessionCaseIdFromStorage();
      refetchCases();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshSessionCaseIdFromStorage();
        refetchCases();
      }
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      refetchAbortRef.current?.abort();
    };
  }, [isLoaded, isSignedIn, loadCases]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    refreshSessionCaseIdFromStorage();
  }, [cases]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    const ac = new AbortController();
    void loadCases(ac.signal);

    return () => ac.abort();
  }, [isLoaded, isSignedIn, loadCases]);

  const {
    awaitingItems,
    acknowledgedItems,
    allHandlingItems,
    completedUnacknowledgedItems,
    completedUnacknowledgedCount,
  } = useMemo(() => {
    const all = sortByHandlingRequestedAtDesc(buildHandlingWorkbenchItems(cases ?? []));
    const awaiting: HandlingWorkbenchItem[] = [];
    const acknowledged: HandlingWorkbenchItem[] = [];
    const completedUnacknowledged: HandlingWorkbenchItem[] = [];
    for (const item of all) {
      if (item.next.handling_acknowledged_at?.trim()) {
        acknowledged.push(item);
      } else if (isHandlingAwaitingTriageApprovedNextAction(item.next)) {
        awaiting.push(item);
      } else {
        completedUnacknowledged.push(item);
      }
    }
    return {
      awaitingItems: awaiting,
      acknowledgedItems: acknowledged,
      allHandlingItems: all,
      completedUnacknowledgedItems: completedUnacknowledged,
      completedUnacknowledgedCount: completedUnacknowledged.length,
    };
  }, [cases]);

  function activateCaseInSession(row: CaseRow) {
    sessionStorage.setItem(STORAGE_CASE_ID, row.id);
    setSessionCaseId(row.id);
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(row.intake));
    const tl = Array.isArray(row.timeline) ? (row.timeline as TimelineEntry[]) : [];
    replaceTimelineForCase(row.id, tl);
    const hydrated = hydrateApprovedNextActionForDisplay(row.id, row.client_state);
    if (hydrated) writeSessionApprovedNextAction(row.id, hydrated);
  }

  function navigateWithCase(row: CaseRow, path: string) {
    activateCaseInSession(row);
    router.push(path);
  }

  function openActionPlan(row: CaseRow) {
    navigateWithCase(row, "/justice/plan");
  }

  function openPacket(row: CaseRow) {
    navigateWithCase(row, "/justice/packet");
  }

  function openChat(row: CaseRow) {
    navigateWithCase(row, "/justice/chat-ai");
  }

  function openApprovedStep(row: CaseRow, next: JusticeApprovedNextAction) {
    const href = resolveWorkbenchApprovedStepHref(next);
    if (!href) return;
    navigateWithCase(row, href);
  }

  function applyAcknowledgedHandlingToCaseRow(caseId: string, mergedClientState: JusticeCaseClientState) {
    const acknowledged = parseApprovedNextAction(mergedClientState.approved_next_action);
    setCases(
      (prev) =>
        prev?.map((c) => (c.id === caseId ? { ...c, client_state: mergedClientState } : c)) ?? prev
    );
    if (acknowledged) writeSessionApprovedNextAction(caseId, acknowledged);
  }

  async function acknowledgeHandlingRequest(caseRow: CaseRow, next: JusticeApprovedNextAction) {
    const acknowledged = acknowledgeHandlingRequestInApprovedNextAction(next);
    const mergedLocal = mergeClientStateWithAcknowledgedHandling(caseRow.client_state, acknowledged);
    setAcknowledgingHandlingCaseId(caseRow.id);
    applyAcknowledgedHandlingToCaseRow(caseRow.id, mergedLocal);

    if (isLoaded && isSignedIn && isUuid(caseRow.id)) {
      try {
        const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseRow.id)}`);
        if (!getRes.ok) {
          console.warn("justice handling: GET before acknowledge failed", getRes.status);
          return;
        }
        const existing = (await getRes.json()) as { client_state?: unknown };
        const merged = mergeClientStateWithAcknowledgedHandling(existing.client_state, acknowledged);
        const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseRow.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_state: merged }),
        });
        if (patchRes.ok) {
          const data = (await patchRes.json()) as { client_state?: unknown };
          if (data.client_state !== undefined) {
            applyAcknowledgedHandlingToCaseRow(caseRow.id, data.client_state as JusticeCaseClientState);
          }
        } else {
          console.warn("justice handling: PATCH acknowledge failed", patchRes.status);
        }
      } catch (e) {
        console.warn("justice handling: acknowledge error", e);
      }
    }

    setAcknowledgingHandlingCaseId(null);
  }

  const hasAnyHandling = allHandlingItems.length > 0;

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/justice/cases" className="text-blue-600 hover:underline dark:text-blue-400">
            Saved cases
          </Link>
          {" · "}
          <Link href="/justice/plan" className="text-blue-600 hover:underline dark:text-blue-400">
            Action plan
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Handling workbench
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Cases where you asked Surrenderless to handle an approved next step. This is in-app tracking
          only — Surrenderless has not filed, submitted, sent, queued externally, or contacted anyone.
        </p>

        {!isLoaded ? (
          <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>
        ) : !isSignedIn ? (
          <p className="mt-8 text-sm text-neutral-600 dark:text-neutral-400">Sign in to view handling requests.</p>
        ) : cases === null ? (
          <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">Loading cases…</p>
        ) : loadError ? (
          <p className="mt-8 text-sm text-red-600 dark:text-red-400">{loadError}</p>
        ) : !hasAnyHandling ? (
          <p className="mt-8 text-sm text-neutral-600 dark:text-neutral-400">
            No handling requests yet. Request Surrenderless handling from your action plan or chat intake
            when an approved next action is active.
          </p>
        ) : (
          <div className="mt-8 space-y-10">
            <section aria-labelledby="handling-awaiting-heading">
              <h2
                id="handling-awaiting-heading"
                className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Awaiting internal triage
                {awaitingItems.length > 0 ? (
                  <span className="ml-2 text-base font-normal text-neutral-500 dark:text-neutral-400">
                    ({awaitingItems.length})
                  </span>
                ) : null}
              </h2>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                Same active-case rule as Saved cases Needs attention. If the approved action is already
                marked handled, acknowledge the handling request from your action plan or chat intake —
                not in this inbox.
              </p>
              {completedUnacknowledgedCount > 0 ? (
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                  {completedUnacknowledgedCount} handled approved action
                  {completedUnacknowledgedCount === 1 ? "" : "s"} still have an open handling request —
                  acknowledge from your action plan or chat intake.
                </p>
              ) : null}
              {awaitingItems.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  No cases awaiting internal triage.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {awaitingItems.map((item) => {
                    const approvedStepHref = resolveWorkbenchApprovedStepHref(item.next);
                    return (
                      <HandlingWorkbenchCaseCard
                        key={item.caseRow.id}
                        item={item}
                        isActiveSessionCase={
                          Boolean(sessionCaseId) && sessionCaseId === item.caseRow.id
                        }
                        showMarkAcknowledged
                        acknowledging={acknowledgingHandlingCaseId === item.caseRow.id}
                        onOpenActionPlan={() => openActionPlan(item.caseRow)}
                        onOpenPacket={() => openPacket(item.caseRow)}
                        onOpenChat={() => openChat(item.caseRow)}
                        onOpenApprovedStep={
                          approvedStepHref
                            ? () => openApprovedStep(item.caseRow, item.next)
                            : undefined
                        }
                        onAcknowledge={() =>
                          void acknowledgeHandlingRequest(item.caseRow, item.next)
                        }
                      />
                    );
                  })}
                </ul>
              )}
              {completedUnacknowledgedItems.length > 0 ? (
                <div className="mt-6 border-t border-neutral-200/90 pt-5 dark:border-neutral-700">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Handled — open handling request
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                    These cases are not in Awaiting or Saved cases Needs attention. Mark acknowledged
                    from the action plan or chat intake. Surrenderless has not filed, submitted, or
                    queued anything externally.
                  </p>
                  <ul className="mt-3 space-y-3">
                    {completedUnacknowledgedItems.map((item) => (
                      <HandlingWorkbenchCaseCard
                        key={item.caseRow.id}
                        item={item}
                        isActiveSessionCase={
                          Boolean(sessionCaseId) && sessionCaseId === item.caseRow.id
                        }
                        showMarkAcknowledged={false}
                        compactNavigation
                        acknowledging={false}
                        onOpenActionPlan={() => openActionPlan(item.caseRow)}
                        onOpenPacket={() => openPacket(item.caseRow)}
                        onOpenChat={() => openChat(item.caseRow)}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section aria-labelledby="handling-acknowledged-heading">
              <h2
                id="handling-acknowledged-heading"
                className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Acknowledged
                {acknowledgedItems.length > 0 ? (
                  <span className="ml-2 text-base font-normal text-neutral-500 dark:text-neutral-400">
                    ({acknowledgedItems.length})
                  </span>
                ) : null}
              </h2>
              {acknowledgedItems.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  No acknowledged handling requests yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {acknowledgedItems.map((item) => {
                    const approvedStepHref = resolveWorkbenchApprovedStepHref(item.next);
                    return (
                      <HandlingWorkbenchCaseCard
                        key={item.caseRow.id}
                        item={item}
                        isActiveSessionCase={
                          Boolean(sessionCaseId) && sessionCaseId === item.caseRow.id
                        }
                        showMarkAcknowledged={false}
                        acknowledging={false}
                        onOpenActionPlan={() => openActionPlan(item.caseRow)}
                        onOpenPacket={() => openPacket(item.caseRow)}
                        onOpenChat={() => openChat(item.caseRow)}
                        onOpenApprovedStep={
                          approvedStepHref
                            ? () => openApprovedStep(item.caseRow, item.next)
                            : undefined
                        }
                      />
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </>
  );
}
