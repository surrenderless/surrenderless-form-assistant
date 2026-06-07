"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { validate as isUuid } from "uuid";
import {
  approvedNextActionStatusLabel,
  hydrateApprovedNextActionForDisplay,
  isApprovedPacketActionWithoutHandlingRequest,
  readSessionApprovedNextAction,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import {
  APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER,
  ApprovedNextActionHandlingAcknowledgedReadOnly,
  ApprovedNextActionHandlingHandledOpenTriageNote,
  ApprovedNextActionHandlingQueueStatusReadOnly,
  ApprovedNextActionHandlingRequestNoteReadOnly,
  formatApprovedNextActionHandlingTimestamp,
  formatHubHandlingRequestedLine,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import { isBasicCaseInfoReadyForEscalation } from "@/lib/justice/caseReadiness";
import { readValidLocalJusticeIntake } from "@/lib/justice/hydrateActiveCaseFromServer";
import { readTimeline, SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID } from "@/lib/justice/timeline";
import type { JusticeApprovedNextAction, JusticeIntake, ProblemCategory } from "@/lib/justice/types";
import { STORAGE_CASE_ID } from "@/lib/justice/types";

const CATEGORY_LABEL: Record<ProblemCategory, string> = {
  online_purchase: "Something I bought online",
  financial_account_issue: "Bank, credit, loan, payment, or billing issue",
  subscription: "Subscription or recurring charge",
  service_failed: "Service didn’t work as promised",
  charge_dispute: "Charge dispute",
  something_else: "Something else",
};

const cardCls =
  "block rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-md shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] transition hover:border-blue-200/80 hover:shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:ring-white/[0.06] dark:hover:border-blue-800/50";

const activeCardCls =
  "block rounded-2xl border border-blue-200/90 bg-white p-5 shadow-md shadow-neutral-900/5 ring-1 ring-blue-950/[0.06] transition hover:border-blue-300 hover:shadow-lg dark:border-blue-900/50 dark:bg-neutral-900 dark:ring-blue-500/10 dark:hover:border-blue-800";

const hubSecondaryBtnCls =
  "mt-2 inline-flex rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800";

const hubChecklistLinkCls =
  "inline-flex text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400";

const STORAGE_PREPARED_PACKET_APPROVED_V1 = "justice_prepared_packet_approved_v1";

function readSessionPreparedPacketApproved(caseId: string): boolean {
  if (typeof window === "undefined" || !caseId) return false;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREPARED_PACKET_APPROVED_V1);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return map[caseId] === true;
  } catch {
    return false;
  }
}

function submissionDraftReviewedInTimeline(caseId: string): boolean {
  const entries = caseId ? readTimeline(caseId) : [];
  return entries.some(
    (e) => e.id === SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID || e.type === "submission_draft_reviewed"
  );
}

type CurrentCaseSnapshot = {
  caseId: string;
  intake: JusticeIntake;
  reviewed: boolean;
  packetApproved: boolean;
  approvedNextAction: JusticeApprovedNextAction | undefined;
  stepLabel: string | null;
  statusLabel: string | null;
  handlingRequestedAt: string | null;
  handlingRequestNote: string | null;
  handlingAcknowledgedAt: string | null;
  /** Handled approved action with open, unacknowledged handling request. */
  showHandledOpenHandlingTriageNote: boolean;
};

function buildCurrentCaseSnapshot(
  caseId: string,
  intake: JusticeIntake,
  approvedNext: JusticeApprovedNextAction | undefined
): CurrentCaseSnapshot {
  const handlingAt = approvedNext?.handling_requested_at?.trim();
  const handlingNote = approvedNext?.handling_request_note?.trim();
  const handlingAck = approvedNext?.handling_acknowledged_at?.trim();
  const showHandledOpenHandlingTriageNote = Boolean(
    handlingAt &&
      !handlingAck &&
      approvedNext?.status === "completed"
  );
  const stepLabel = approvedNext?.label?.trim() || null;
  const statusLabel = approvedNextActionStatusLabel(approvedNext?.status);
  return {
    caseId,
    intake,
    reviewed: submissionDraftReviewedInTimeline(caseId),
    packetApproved: caseId ? readSessionPreparedPacketApproved(caseId) : false,
    approvedNextAction: approvedNext,
    stepLabel,
    statusLabel,
    handlingRequestedAt: handlingAt || null,
    handlingRequestNote: handlingNote || null,
    handlingAcknowledgedAt: handlingAck || null,
    showHandledOpenHandlingTriageNote,
  };
}

/** Client-only snapshot of active case card state from session/timeline helpers. */
function readSnapshotFromLocalSession(): CurrentCaseSnapshot | null {
  const intake = readValidLocalJusticeIntake();
  if (!intake) return null;
  const caseId = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
  const approvedNext = caseId ? readSessionApprovedNextAction(caseId) : undefined;
  return buildCurrentCaseSnapshot(caseId, intake, approvedNext);
}

export default function JusticeHubWorkspaceBody() {
  const { isLoaded, isSignedIn } = useAuth();
  const [snapshot, setSnapshot] = useState<CurrentCaseSnapshot | null>(null);
  const [evidenceCount, setEvidenceCount] = useState<number | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  useEffect(() => {
    const ac = new AbortController();

    async function refreshHubState() {
      const nextSnapshot = readSnapshotFromLocalSession();
      setSnapshot(nextSnapshot);

      if (!isLoaded) return;

      const caseId = nextSnapshot?.caseId ?? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
      if (!isSignedIn || !caseId || !isUuid(caseId)) {
        setEvidenceCount(null);
        setEvidenceLoading(false);
        return;
      }

      const sessionFallback =
        nextSnapshot?.approvedNextAction ?? hydrateApprovedNextActionForDisplay(caseId);

      if (nextSnapshot) {
        try {
          const caseRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
            signal: ac.signal,
          });
          if (!ac.signal.aborted && caseRes.ok) {
            const data = (await caseRes.json()) as { client_state?: unknown };
            const hydrated =
              hydrateApprovedNextActionForDisplay(caseId, data.client_state) ?? sessionFallback;
            if (hydrated) writeSessionApprovedNextAction(caseId, hydrated);
            setSnapshot(buildCurrentCaseSnapshot(caseId, nextSnapshot.intake, hydrated));
          }
        } catch {
          // keep session snapshot
        }
      }

      setEvidenceLoading(true);
      try {
        const res = await fetch(`/api/justice/evidence?case_id=${encodeURIComponent(caseId)}`, {
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        const json: unknown = res.ok ? await res.json() : [];
        setEvidenceCount(Array.isArray(json) ? json.length : 0);
      } catch {
        if (!ac.signal.aborted) setEvidenceCount(0);
      } finally {
        if (!ac.signal.aborted) setEvidenceLoading(false);
      }
    }

    void refreshHubState();

    function onHubRefresh() {
      void refreshHubState();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshHubState();
      }
    }

    window.addEventListener("focus", onHubRefresh);
    window.addEventListener("storage", onHubRefresh);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      ac.abort();
      window.removeEventListener("focus", onHubRefresh);
      window.removeEventListener("storage", onHubRefresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isLoaded, isSignedIn]);

  const basicsReady = snapshot ? isBasicCaseInfoReadyForEscalation(snapshot.intake) : false;
  const showUpdateInChat = snapshot !== null && !basicsReady;
  const showAddProofInChat =
    snapshot !== null &&
    basicsReady &&
    !evidenceLoading &&
    evidenceCount !== null &&
    evidenceCount < 1;

  const primaryHref = !snapshot?.reviewed
    ? "/justice/preview"
    : snapshot.packetApproved
      ? "/justice/plan"
      : "/justice/packet";
  const primaryLabel = !snapshot?.reviewed
    ? "Continue to submission preview"
    : snapshot.packetApproved
      ? "Continue to action plan"
      : "Review prepared case packet";

  return (
    <>
      {snapshot ? (
        <div className="mt-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Current case
          </p>
          <Link href={primaryHref} className={`${activeCardCls} text-left`}>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {snapshot.intake.company_name.trim() || "Current case"}
            </span>
            <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
              {CATEGORY_LABEL[snapshot.intake.problem_category] ?? snapshot.intake.problem_category}
            </span>
            {snapshot.intake.purchase_or_signup.trim() ? (
              <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-500">
                {snapshot.intake.purchase_or_signup.trim()}
              </span>
            ) : null}
            <span className="mt-2 block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              {snapshot.reviewed ? "Submission draft reviewed" : "Submission draft not reviewed"}
            </span>
            {snapshot.stepLabel ? (
              <span className="mt-2 block text-xs text-neutral-600 dark:text-neutral-400">
                Next step: <strong className="text-neutral-800 dark:text-neutral-200">{snapshot.stepLabel}</strong>
              </span>
            ) : null}
            {snapshot.statusLabel ? (
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">Approved next action:</span>{" "}
                {snapshot.statusLabel}
              </span>
            ) : null}
            {snapshot.approvedNextAction?.status === "completed" &&
            snapshot.approvedNextAction.completed_at?.trim() ? (
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                Handled for now{" "}
                {formatApprovedNextActionHandlingTimestamp(
                  snapshot.approvedNextAction.completed_at.trim()
                )}
              </span>
            ) : null}
            {snapshot.handlingRequestedAt ? (
              <>
                <span className="mt-2 block text-xs font-medium text-emerald-800 dark:text-emerald-200">
                  {formatHubHandlingRequestedLine(snapshot.handlingRequestedAt)}
                </span>
                <ApprovedNextActionHandlingRequestNoteReadOnly
                  note={snapshot.handlingRequestNote ?? undefined}
                  tone="neutral"
                  className="mt-1"
                />
                <ApprovedNextActionHandlingAcknowledgedReadOnly
                  acknowledgedAt={snapshot.handlingAcknowledgedAt ?? undefined}
                  tone="neutral"
                />
                <span className="mt-1 block text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                  {APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER}
                </span>
              </>
            ) : null}
            <span className="mt-3 inline-flex text-sm font-semibold text-blue-600 dark:text-blue-400">
              {primaryLabel}
            </span>
          </Link>
          <ul className="mt-2 space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
            <li>
              Basic case info: {basicsReady ? "yes" : "not yet"}
              {snapshot && !basicsReady ? (
                <>
                  {" · "}
                  <Link href="/justice/chat-ai" className={hubChecklistLinkCls}>
                    Update in chat
                  </Link>
                </>
              ) : null}
            </li>
            <li>
              {evidenceLoading ? (
                "Evidence: loading..."
              ) : (
                <>
                  Evidence: {(evidenceCount ?? 0) >= 1 ? "yes" : "not yet"}
                  {(evidenceCount ?? 0) < 1 ? (
                    <>
                      {" · "}
                      <Link href="/justice/chat-ai" className={hubChecklistLinkCls}>
                        Add proof in chat
                      </Link>
                    </>
                  ) : null}
                </>
              )}
            </li>
            <li>
              Submission draft reviewed: {snapshot.reviewed ? "yes" : "not yet"}
              {snapshot && !snapshot.reviewed ? (
                <>
                  {" · "}
                  <Link href="/justice/preview" className={hubChecklistLinkCls}>
                    Review submission draft
                  </Link>
                </>
              ) : null}
            </li>
            {snapshot.reviewed ? (
              <li>
                Prepared case packet reviewed: {snapshot.packetApproved ? "yes" : "not yet"}
                {!snapshot.packetApproved ? (
                  <>
                    {" · "}
                    <Link href="/justice/packet" className={hubChecklistLinkCls}>
                      Review prepared case packet
                    </Link>
                  </>
                ) : null}
              </li>
            ) : null}
          </ul>
          {showUpdateInChat ? (
            <Link href="/justice/chat-ai" className={hubSecondaryBtnCls}>
              Update in chat
            </Link>
          ) : showAddProofInChat ? (
            <Link href="/justice/chat-ai" className={hubSecondaryBtnCls}>
              Add proof in chat
            </Link>
          ) : null}
          {snapshot.handlingRequestedAt ? (
            <>
              <ApprovedNextActionHandlingQueueStatusReadOnly
                handlingRequestedAt={snapshot.handlingRequestedAt}
                handlingAcknowledgedAt={snapshot.handlingAcknowledgedAt ?? undefined}
                className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90"
              />
              {snapshot.showHandledOpenHandlingTriageNote ? (
                <ApprovedNextActionHandlingHandledOpenTriageNote variant="redirect" />
              ) : null}
              <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">
                <Link
                  href="/justice/handling"
                  className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                >
                  View in handling workbench
                </Link>
              </p>
            </>
          ) : null}
          {isApprovedPacketActionWithoutHandlingRequest({
            prepared_packet_approved: snapshot.packetApproved,
            approved_next_action: snapshot.approvedNextAction,
          }) ? (
            <>
              <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80 dark:text-emerald-200/80">
                Approved case packet and next in-app step — not a Surrenderless handling request.
                Request Surrenderless handling from your action plan when you want internal triage tracking.
              </p>
              <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">
                <Link
                  href="/justice/handling"
                  className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                >
                  View on handling workbench
                </Link>
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      <ul className="mt-8 space-y-3">
        <li>
          <Link href="/justice/chat-ai" className={`${cardCls} text-left`}>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Start with chat intake</span>
            <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
              Describe your issue in a conversation; we&apos;ll collect your case details.
            </span>
          </Link>
        </li>
        <li>
          <Link href="/justice/chat" className={`${cardCls} text-left`}>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Use step-by-step chat
            </span>
            <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
              Answer scripted questions one at a time instead.
            </span>
          </Link>
        </li>
        {!snapshot ? (
          <li>
            <Link href="/justice/plan" className={`${cardCls} text-left`}>
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Continue current action plan
              </span>
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                Open your plan when you already have a case in this browser — or follow prompts there to start or
                resume.
              </span>
            </Link>
          </li>
        ) : null}
        <li>
          <Link href="/justice/intake" className={`${cardCls} text-left`}>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Start with form intake</span>
            <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
              Fill in the structured intake form.
            </span>
          </Link>
        </li>
        <li>
          <Link href="/justice/cases" className={`${cardCls} text-left`}>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Saved cases</span>
            <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
              Open a case you saved while signed in.
            </span>
          </Link>
        </li>
      </ul>
    </>
  );
}
