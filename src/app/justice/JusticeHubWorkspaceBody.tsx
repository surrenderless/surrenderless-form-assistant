"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { validate as isUuid } from "uuid";
import {
  acknowledgeHandlingRequestInApprovedNextAction,
  applyHandlingRequestNoteToApprovedNextAction,
  approvedNextActionStatusLabel,
  hydrateApprovedNextActionForDisplay,
  isApprovedPacketActionWithoutHandlingRequest,
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithAcknowledgedHandling,
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  readSessionApprovedNextAction,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import {
  APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER,
  APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER,
  ApprovedNextActionHandlingAcknowledgedReadOnly,
  ApprovedNextActionHandlingHandledOpenTriageNote,
  ApprovedNextActionHandlingQueueStatusReadOnly,
  ApprovedNextActionHandlingRequestBlock,
  ApprovedNextActionHandlingRequestedReadOnly,
  ApprovedNextActionHandlingRequestNoteReadOnly,
  ApprovedNextActionHandlingTrackingContextualLink,
  formatApprovedNextActionHandlingTimestamp,
  formatHubHandlingRequestedLine,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import { ApprovedNextActionFollowUpTimingLine } from "@/lib/justice/approvedNextActionFollowUp";
import { isBasicCaseInfoReadyForEscalation } from "@/lib/justice/caseReadiness";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
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

function truncateAttentionNote(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen).trimEnd()}…`;
}

const HUB_HANDLING_TRACKING_COMPLETE = "Tracking complete for now.";

function hubReadyForManualReview(input: {
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
}): boolean {
  return input.basicsReady && input.draftReviewed && input.preparedPacketApproved;
}

function deriveHubManualActionNextStep(input: {
  readyForExternalManualAction: boolean;
  actionOpened: boolean;
  hasFilingRecord: boolean;
  hasConfirmationOnFile: boolean;
  status: JusticeApprovedNextAction["status"];
  outcomeNote?: string;
  handlingRequestedAt?: string;
  handlingAcknowledgedAt?: string;
  followUpNeeded?: boolean;
}): string {
  if (!input.readyForExternalManualAction) {
    return "Review packet and saved proof before external manual action.";
  }
  if (!input.actionOpened) {
    return "Open the approved step and prepare the manual action.";
  }
  if (!input.hasFilingRecord) {
    return "Add filing records from the case packet after external submission.";
  }
  if (!input.hasConfirmationOnFile) {
    return "Add or edit the filing confirmation from the case packet after external submission.";
  }
  if (input.status === "completed" && !input.outcomeNote?.trim()) {
    return "Record the handling outcome.";
  }
  if (
    input.status === "completed" &&
    input.outcomeNote?.trim() &&
    input.handlingRequestedAt?.trim() &&
    !input.handlingAcknowledgedAt?.trim()
  ) {
    return "Mark the handling request acknowledged.";
  }
  if (input.followUpNeeded === true) {
    return "Review follow-up timing and mark follow-up handled when complete.";
  }
  return HUB_HANDLING_TRACKING_COMPLETE;
}

function deriveHubHandlingTrackingLine(input: {
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
  evidenceCount: number;
  filings: JusticeCaseFilingRow[];
  next: JusticeApprovedNextAction;
}): string {
  const readyForManualReview = hubReadyForManualReview({
    basicsReady: input.basicsReady,
    draftReviewed: input.draftReviewed,
    preparedPacketApproved: input.preparedPacketApproved,
  });
  const readyForExternalManualAction =
    readyForManualReview && input.evidenceCount > 0;
  const actionOpened = input.next.status === "started" || input.next.status === "completed";
  const hasFilingRecord = input.filings.length > 0;
  const hasConfirmationOnFile = input.filings.some((f) => f.confirmation_number?.trim());
  return deriveHubManualActionNextStep({
    readyForExternalManualAction,
    actionOpened,
    hasFilingRecord,
    hasConfirmationOnFile,
    status: input.next.status,
    outcomeNote: input.next.outcome_note,
    handlingRequestedAt: input.next.handling_requested_at,
    handlingAcknowledgedAt: input.next.handling_acknowledged_at,
    followUpNeeded: input.next.follow_up_needed === true,
  });
}

function HubHandlingTrackingStatusReadOnly({
  readinessLoading,
  approvedNextAction,
  basicsReady,
  draftReviewed,
  preparedPacketApproved,
  evidenceCount,
  filings,
  markAcknowledgedOnScreen = false,
}: {
  readinessLoading: boolean;
  approvedNextAction: JusticeApprovedNextAction;
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
  evidenceCount: number;
  filings: JusticeCaseFilingRow[];
  markAcknowledgedOnScreen?: boolean;
}) {
  const handlingRequested = Boolean(approvedNextAction.handling_requested_at?.trim());
  const showApprovedPacketActionPath = preparedPacketApproved && !handlingRequested;
  if (!handlingRequested && !showApprovedPacketActionPath) return null;
  if (readinessLoading) {
    return (
      <p className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90">
        <span className="font-medium text-emerald-900 dark:text-emerald-100">Handling tracking:</span>{" "}
        Loading handling tracking context...
      </p>
    );
  }
  const derivedStep = deriveHubHandlingTrackingLine({
    basicsReady,
    draftReviewed,
    preparedPacketApproved,
    evidenceCount,
    filings,
    next: approvedNextAction,
  });
  return (
    <>
      <p className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90">
        <span className="font-medium text-emerald-900 dark:text-emerald-100">Handling tracking:</span>{" "}
        {derivedStep}
      </p>
      <p className="mt-0.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
        In-app tracking only — not filed or submitted.
      </p>
      <ApprovedNextActionHandlingTrackingContextualLink
        derivedStep={derivedStep}
        approvedNextAction={approvedNextAction}
        surface="hub"
        basicsReady={basicsReady}
        evidenceCount={evidenceCount}
        markAcknowledgedOnScreen={markAcknowledgedOnScreen}
      />
    </>
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
  const [filings, setFilings] = useState<JusticeCaseFilingRow[]>([]);
  const [hubReadinessLoading, setHubReadinessLoading] = useState(false);
  const [requestingHandling, setRequestingHandling] = useState(false);
  const [updatingHandlingNote, setUpdatingHandlingNote] = useState(false);
  const [acknowledgingHandling, setAcknowledgingHandling] = useState(false);

  const refreshHubState = useCallback(
    async (signal?: AbortSignal) => {
      const nextSnapshot = readSnapshotFromLocalSession();
      setSnapshot(nextSnapshot);

      if (!isLoaded) return;

      const caseId = nextSnapshot?.caseId ?? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
      if (!isSignedIn || !caseId || !isUuid(caseId)) {
        setEvidenceCount(null);
        setFilings([]);
        setHubReadinessLoading(false);
        return;
      }

      const sessionFallback =
        nextSnapshot?.approvedNextAction ?? hydrateApprovedNextActionForDisplay(caseId);

      if (nextSnapshot) {
        try {
          const caseRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
            signal,
          });
          if (!signal?.aborted && caseRes.ok) {
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

      setHubReadinessLoading(true);
      try {
        const [evRes, filRes] = await Promise.all([
          fetch(`/api/justice/evidence?case_id=${encodeURIComponent(caseId)}`, { signal }),
          fetch(`/api/justice/filings?case_id=${encodeURIComponent(caseId)}`, { signal }),
        ]);
        if (signal?.aborted) return;
        const evJson: unknown = evRes.ok ? await evRes.json() : [];
        const filJson: unknown = filRes.ok ? await filRes.json() : [];
        setEvidenceCount(Array.isArray(evJson) ? evJson.length : 0);
        setFilings(Array.isArray(filJson) ? (filJson as JusticeCaseFilingRow[]) : []);
      } catch {
        if (!signal?.aborted) {
          setEvidenceCount(0);
          setFilings([]);
        }
      } finally {
        if (!signal?.aborted) setHubReadinessLoading(false);
      }
    },
    [isLoaded, isSignedIn]
  );

  useEffect(() => {
    const ac = new AbortController();

    void refreshHubState(ac.signal);

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
  }, [refreshHubState]);

  function canWriteHubHandling(
    current: CurrentCaseSnapshot | null
  ): current is CurrentCaseSnapshot & { approvedNextAction: JusticeApprovedNextAction } {
    if (!current?.packetApproved || !current.approvedNextAction) return false;
    const sessionCaseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    return Boolean(sessionCaseId && sessionCaseId === current.caseId);
  }

  function applyHydratedApprovedNext(
    caseId: string,
    intake: JusticeIntake,
    action: JusticeApprovedNextAction
  ) {
    writeSessionApprovedNextAction(caseId, action);
    setSnapshot(buildCurrentCaseSnapshot(caseId, intake, action));
  }

  async function handleRequestSurrenderlessHandling(note?: string) {
    if (!canWriteHubHandling(snapshot)) return;
    const approvedNextAction = snapshot.approvedNextAction;
    if (approvedNextAction.status === "completed") return;
    if (approvedNextAction.handling_requested_at?.trim()) return;

    const next: JusticeApprovedNextAction = {
      ...approvedNextAction,
      handling_requested_at: new Date().toISOString(),
      ...(note ? { handling_request_note: note } : {}),
    };
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, next);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    applyHydratedApprovedNext(snapshot.caseId, snapshot.intake, local);

    if (!isLoaded || !isSignedIn || !isUuid(snapshot.caseId)) return;

    setRequestingHandling(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(snapshot.caseId)}`);
      if (!getRes.ok) {
        console.warn("justice hub: GET before handling request failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(snapshot.caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (patchRes.ok) {
        const data = (await patchRes.json()) as { client_state?: unknown };
        const hydrated =
          hydrateApprovedNextActionForDisplay(snapshot.caseId, data.client_state) ?? local;
        applyHydratedApprovedNext(snapshot.caseId, snapshot.intake, hydrated);
      } else {
        console.warn("justice hub: PATCH handling request failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice hub: handling request error", e);
    } finally {
      setRequestingHandling(false);
    }
  }

  async function handleUpdateHandlingRequestNote(note?: string) {
    if (!canWriteHubHandling(snapshot)) return;
    const approvedNextAction = snapshot.approvedNextAction;
    if (!approvedNextAction.handling_requested_at?.trim()) return;

    const withNoteUpdate = applyHandlingRequestNoteToApprovedNextAction(
      approvedNextAction,
      note ?? ""
    );
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, withNoteUpdate);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    applyHydratedApprovedNext(snapshot.caseId, snapshot.intake, local);

    if (!isLoaded || !isSignedIn || !isUuid(snapshot.caseId)) return;

    setUpdatingHandlingNote(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(snapshot.caseId)}`);
      if (!getRes.ok) {
        console.warn("justice hub: GET before handling note update failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(snapshot.caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (patchRes.ok) {
        const data = (await patchRes.json()) as { client_state?: unknown };
        const hydrated =
          hydrateApprovedNextActionForDisplay(snapshot.caseId, data.client_state) ?? local;
        applyHydratedApprovedNext(snapshot.caseId, snapshot.intake, hydrated);
      } else {
        console.warn("justice hub: PATCH handling note update failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice hub: handling note update error", e);
    } finally {
      setUpdatingHandlingNote(false);
    }
  }

  async function handleAcknowledgeHandlingRequest() {
    if (!canWriteHubHandling(snapshot)) return;
    const approvedNextAction = snapshot.approvedNextAction;
    if (!approvedNextAction.handling_requested_at?.trim()) return;
    if (approvedNextAction.handling_acknowledged_at?.trim()) return;

    const acknowledged = acknowledgeHandlingRequestInApprovedNextAction(approvedNextAction);
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, acknowledged);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    applyHydratedApprovedNext(snapshot.caseId, snapshot.intake, local);

    if (!isLoaded || !isSignedIn || !isUuid(snapshot.caseId)) return;

    setAcknowledgingHandling(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(snapshot.caseId)}`);
      if (!getRes.ok) {
        console.warn("justice hub: GET before acknowledge handling failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithAcknowledgedHandling(existing.client_state, acknowledged);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(snapshot.caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (patchRes.ok) {
        const data = (await patchRes.json()) as { client_state?: unknown };
        const hydrated =
          hydrateApprovedNextActionForDisplay(snapshot.caseId, data.client_state) ?? local;
        applyHydratedApprovedNext(snapshot.caseId, snapshot.intake, hydrated);
      } else {
        console.warn("justice hub: PATCH acknowledge handling failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice hub: acknowledge handling error", e);
    } finally {
      setAcknowledgingHandling(false);
    }
  }

  const basicsReady = snapshot ? isBasicCaseInfoReadyForEscalation(snapshot.intake) : false;
  const showUpdateInChat = snapshot !== null && !basicsReady;
  const showAddProofInChat =
    snapshot !== null &&
    basicsReady &&
    !hubReadinessLoading &&
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
            {snapshot.approvedNextAction?.status === "started" &&
            snapshot.approvedNextAction.started_at?.trim() ? (
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                Opened{" "}
                {formatApprovedNextActionHandlingTimestamp(
                  snapshot.approvedNextAction.started_at.trim()
                )}
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
            {snapshot.approvedNextAction?.outcome_note?.trim() ? (
              <span className="mt-1 block whitespace-pre-wrap text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                {truncateAttentionNote(snapshot.approvedNextAction.outcome_note.trim(), 200)}
              </span>
            ) : null}
            {snapshot.handlingRequestedAt &&
            !(snapshot.packetApproved && snapshot.approvedNextAction) ? (
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
            {snapshot.approvedNextAction?.follow_up_needed === true ? (
              <span className="mt-1 block text-xs font-medium text-amber-800 dark:text-amber-200">
                Follow-up needed
              </span>
            ) : null}
            {snapshot.approvedNextAction?.follow_up_at?.trim() ? (
              <ApprovedNextActionFollowUpTimingLine
                followUpAt={snapshot.approvedNextAction.follow_up_at}
                className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400"
              />
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
              {hubReadinessLoading ? (
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
          {snapshot.packetApproved && snapshot.approvedNextAction ? (
            <>
              {isApprovedPacketActionWithoutHandlingRequest({
                prepared_packet_approved: snapshot.packetApproved,
                approved_next_action: snapshot.approvedNextAction,
              }) ? (
                <>
                  <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80 dark:text-emerald-200/80">
                    Approved case packet and next in-app step — not a Surrenderless handling request.
                    Request Surrenderless handling from your action plan, case packet, or here on the hub when
                    you want internal triage tracking.
                  </p>
                  <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">
                    <Link
                      href="/justice/handling"
                      className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                    >
                      View on handling workbench
                    </Link>
                  </p>
                  <HubHandlingTrackingStatusReadOnly
                    readinessLoading={hubReadinessLoading}
                    approvedNextAction={snapshot.approvedNextAction}
                    basicsReady={basicsReady}
                    draftReviewed={snapshot.reviewed}
                    preparedPacketApproved={snapshot.packetApproved}
                    evidenceCount={evidenceCount ?? 0}
                    filings={filings}
                    markAcknowledgedOnScreen={false}
                  />
                </>
              ) : null}
              {snapshot.approvedNextAction.handling_requested_at?.trim() ? (
                snapshot.approvedNextAction.status === "completed" ? (
                  <ApprovedNextActionHandlingRequestedReadOnly
                    requestedAt={snapshot.approvedNextAction.handling_requested_at.trim()}
                    requestNote={snapshot.approvedNextAction.handling_request_note}
                    acknowledgedAt={snapshot.approvedNextAction.handling_acknowledged_at}
                    wrapperClassName="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-2.5 py-2 dark:border-emerald-600/40 dark:bg-emerald-950/40"
                    recordedClassName="mt-0.5"
                  />
                ) : (
                  <ApprovedNextActionHandlingRequestBlock
                    action={snapshot.approvedNextAction}
                    acknowledgedAt={snapshot.approvedNextAction.handling_acknowledged_at}
                    onRequest={handleRequestSurrenderlessHandling}
                    onUpdateNote={handleUpdateHandlingRequestNote}
                    allowEditNote
                    requesting={requestingHandling}
                    updatingNote={updatingHandlingNote}
                    wrapperClassName="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-2.5 py-2 dark:border-emerald-600/40 dark:bg-emerald-950/40"
                    recordedClassName="mt-0.5"
                  />
                )
              ) : snapshot.approvedNextAction.status !== "completed" ? (
                <ApprovedNextActionHandlingRequestBlock
                  action={snapshot.approvedNextAction}
                  onRequest={handleRequestSurrenderlessHandling}
                  onUpdateNote={handleUpdateHandlingRequestNote}
                  allowEditNote
                  requesting={requestingHandling}
                  updatingNote={updatingHandlingNote}
                  wrapperClassName="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-2.5 py-2 dark:border-emerald-600/40 dark:bg-emerald-950/40"
                  recordedClassName="mt-0.5"
                />
              ) : null}
              {snapshot.approvedNextAction.handling_requested_at?.trim() ? (
                <>
                  <ApprovedNextActionHandlingQueueStatusReadOnly
                    handlingRequestedAt={snapshot.approvedNextAction.handling_requested_at.trim()}
                    handlingAcknowledgedAt={snapshot.approvedNextAction.handling_acknowledged_at}
                    className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90"
                  />
                  <HubHandlingTrackingStatusReadOnly
                    readinessLoading={hubReadinessLoading}
                    approvedNextAction={snapshot.approvedNextAction}
                    basicsReady={basicsReady}
                    draftReviewed={snapshot.reviewed}
                    preparedPacketApproved={snapshot.packetApproved}
                    evidenceCount={evidenceCount ?? 0}
                    filings={filings}
                    markAcknowledgedOnScreen={!snapshot.approvedNextAction.handling_acknowledged_at?.trim()}
                  />
                  {snapshot.approvedNextAction.status === "completed" &&
                  !snapshot.approvedNextAction.handling_acknowledged_at?.trim() ? (
                    <ApprovedNextActionHandlingHandledOpenTriageNote variant="inlineAck" />
                  ) : null}
                  <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">
                    <Link
                      href="/justice/handling"
                      className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                    >
                      View in handling workbench
                    </Link>
                  </p>
                  {!snapshot.approvedNextAction.handling_acknowledged_at?.trim() ? (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                      <button
                        type="button"
                        disabled={acknowledgingHandling}
                        onClick={() => void handleAcknowledgeHandlingRequest()}
                        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        {acknowledgingHandling ? "Saving…" : "Mark acknowledged"}
                      </button>
                      <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80 sm:max-w-[14rem]">
                        {APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <>
              {snapshot.handlingRequestedAt ? (
                <>
                  <ApprovedNextActionHandlingQueueStatusReadOnly
                    handlingRequestedAt={snapshot.handlingRequestedAt}
                    handlingAcknowledgedAt={snapshot.handlingAcknowledgedAt ?? undefined}
                    className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90"
                  />
                  {snapshot.approvedNextAction ? (
                    <HubHandlingTrackingStatusReadOnly
                      readinessLoading={hubReadinessLoading}
                      approvedNextAction={snapshot.approvedNextAction}
                      basicsReady={basicsReady}
                      draftReviewed={snapshot.reviewed}
                      preparedPacketApproved={snapshot.packetApproved}
                      evidenceCount={evidenceCount ?? 0}
                      filings={filings}
                    />
                  ) : null}
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
                    Request Surrenderless handling from your action plan, case packet, or here on the hub when
                    you want internal triage tracking.
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
            </>
          )}
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
