"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { validate as isUuid } from "uuid";
import Header from "@/app/components/Header";
import { ApprovedNextActionFollowUpTimingLine } from "@/lib/justice/approvedNextActionFollowUp";
import {
  APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER,
  APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER,
  APPROVED_NEXT_ACTION_HANDLING_REQUESTED_LABEL,
  ApprovedNextActionHandlingAcknowledgedReadOnly,
  ApprovedNextActionHandlingHandledOpenTriageNote,
  ApprovedNextActionHandlingQueueStatusReadOnly,
  ApprovedNextActionHandlingRequestNoteReadOnly,
  formatApprovedNextActionHandlingTimestamp,
  formatHandlingRecordedLine,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  acknowledgeHandlingRequestInApprovedNextAction,
  applyHandlingOperatorNoteToApprovedNextAction,
  approvedNextActionStatusLabel,
  clearFollowUpFromApprovedNextAction,
  hydrateApprovedNextActionForDisplay,
  isHandlingAwaitingTriageApprovedNextAction,
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithAcknowledgedHandling,
  mergeClientStateWithApprovedNextAction,
  mergeClientStateWithClearedFollowUp,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  parseApprovedNextAction,
  parseApprovedNextActionFromClientState,
  parseApprovedPacketActionWithoutHandlingRequest,
  parseJusticeCaseClientState,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import { parseJusticeCasesListEnvelope } from "@/lib/justice/caseApiValidation";
import { isBasicCaseInfoReadyForEscalation } from "@/lib/justice/caseReadiness";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import { computeJusticeDestinations, ftcUnlockedFromIntake } from "@/lib/justice/rules";
import type {
  JusticeApprovedNextAction,
  JusticeCaseClientState,
  JusticeIntake,
  TimelineEntry,
} from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import { replaceTimelineForCase, SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID } from "@/lib/justice/timeline";

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

function truncateAttentionNote(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen).trimEnd()}…`;
}

const HANDLING_FILING_NOTES_PREVIEW_MAX = 120;
const HANDLING_FILING_CONFIRM_PREVIEW_MAX = 48;
const HANDLING_HANDOFF_STORY_PREVIEW_MAX = 200;

function truncateHandlingFilingSnippet(text: string | null | undefined, max: number): string {
  if (!text?.trim()) return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function handlingFilingFiledAtLine(filedAt: string): string {
  const t = filedAt.trim();
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) {
    try {
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return t;
    }
  }
  return t;
}

function caseDraftReviewed(row: CaseRow): boolean {
  const tl = Array.isArray(row.timeline) ? (row.timeline as TimelineEntry[]) : [];
  return tl.some(
    (e) => e.id === SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID || e.type === "submission_draft_reviewed"
  );
}

function caseReadyForManualReview(caseRow: CaseRow): boolean {
  const packetApproved =
    parseJusticeCaseClientState(caseRow.client_state).prepared_packet_approved === true;
  return (
    isBasicCaseInfoReadyForEscalation(caseRow.intake) &&
    caseDraftReviewed(caseRow) &&
    packetApproved
  );
}

type AwaitingHandoffTier = "external" | "needs_proof" | "needs_prep" | "other";

function deriveAwaitingHandoffTier(
  item: HandlingWorkbenchItem,
  evidenceCount: number | undefined
): AwaitingHandoffTier {
  const readyForManualReview = caseReadyForManualReview(item.caseRow);
  const count = evidenceCount ?? 0;
  const readyForExternalManualAction = readyForManualReview && count > 0;
  if (readyForExternalManualAction) return "external";
  if (readyForManualReview && count === 0) return "needs_proof";
  if (!readyForManualReview) return "needs_prep";
  return "other";
}

function handlingCaseHasFilingRecord(savedFilings: JusticeCaseFilingRow[] | undefined): boolean {
  return (savedFilings?.length ?? 0) > 0;
}

function handlingCaseHasConfirmationOnFile(savedFilings: JusticeCaseFilingRow[] | undefined): boolean {
  return Boolean(savedFilings?.some((row) => row.confirmation_number?.trim()));
}

function isPostExternalConfirmationFollowUpItem(
  item: HandlingWorkbenchItem,
  savedFilings: JusticeCaseFilingRow[] | undefined,
  filingsReady: boolean
): boolean {
  if (!filingsReady) return false;
  const status = item.next.status;
  if (status !== "started" && status !== "completed") return false;
  const hasFilingRecord = handlingCaseHasFilingRecord(savedFilings);
  const hasConfirmationOnFile = handlingCaseHasConfirmationOnFile(savedFilings);
  return !hasFilingRecord || !hasConfirmationOnFile;
}

function isoToDateInputValue(iso?: string): string {
  if (!iso?.trim()) return "";
  const d = iso.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

function HandlingWorkbenchOutcomeTrackingForm({
  action,
  onSave,
}: {
  action: JusticeApprovedNextAction;
  onSave: (draft: {
    outcome_note: string;
    follow_up_needed: boolean;
    follow_up_at: string;
  }) => Promise<void>;
}) {
  const [outcomeNote, setOutcomeNote] = useState(action.outcome_note ?? "");
  const [followUpNeeded, setFollowUpNeeded] = useState(action.follow_up_needed === true);
  const [followUpAt, setFollowUpAt] = useState(() => isoToDateInputValue(action.follow_up_at));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOutcomeNote(action.outcome_note ?? "");
    setFollowUpNeeded(action.follow_up_needed === true);
    setFollowUpAt(isoToDateInputValue(action.follow_up_at));
  }, [action.outcome_note, action.follow_up_needed, action.follow_up_at, action.completed_at]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        outcome_note: outcomeNote,
        follow_up_needed: followUpNeeded,
        follow_up_at: followUpAt,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="mt-2 space-y-2 rounded-lg border border-emerald-400/50 bg-white/70 px-3 py-2.5 dark:border-emerald-600/40 dark:bg-emerald-950/40"
      aria-label="Outcome and follow-up tracking"
    >
      <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">Record outcome / follow-up</p>
      <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
        Outcome / note
        <textarea
          value={outcomeNote}
          onChange={(e) => setOutcomeNote(e.target.value)}
          rows={3}
          placeholder="What happened, or what should Surrenderless track next?"
          className="mt-1 w-full resize-y rounded-md border border-emerald-300/80 bg-white px-2 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 dark:border-emerald-700 dark:bg-neutral-950 dark:text-neutral-100"
        />
      </label>
      <label className="flex cursor-pointer items-start gap-2 text-[11px] text-emerald-900 dark:text-emerald-100">
        <input
          type="checkbox"
          checked={followUpNeeded}
          onChange={(e) => setFollowUpNeeded(e.target.checked)}
          className="mt-0.5"
        />
        Follow-up needed
      </label>
      {followUpNeeded ? (
        <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
          Follow-up date (optional, your pace)
          <input
            type="date"
            value={followUpAt}
            onChange={(e) => setFollowUpAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-emerald-300/80 bg-white px-2 py-1.5 text-xs text-neutral-900 dark:border-emerald-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
          <span className="mt-1 block font-normal text-emerald-800/80 dark:text-emerald-200/75">
            Optional reminder for you — not a deadline.
          </span>
        </label>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {saving ? "Saving…" : "Save tracking note"}
      </button>
      <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
        Tracking only — not automatic filing or submission.
      </p>
    </form>
  );
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

function buildApprovedPacketActionItems(caseList: CaseRow[]): HandlingWorkbenchItem[] {
  const items: HandlingWorkbenchItem[] = [];
  for (const c of caseList) {
    const next = parseApprovedPacketActionWithoutHandlingRequest(c.client_state);
    if (!next) continue;
    items.push({ caseRow: c, next });
  }
  return items;
}

function sortByApprovedAtDesc(items: HandlingWorkbenchItem[]): HandlingWorkbenchItem[] {
  return [...items].sort((a, b) => {
    const da = a.next.approved_at?.trim() ?? "";
    const db = b.next.approved_at?.trim() ?? "";
    if (!da && !db) return b.caseRow.updated_at.localeCompare(a.caseRow.updated_at);
    if (!da) return 1;
    if (!db) return -1;
    const cmp = db.localeCompare(da);
    if (cmp !== 0) return cmp;
    return b.caseRow.updated_at.localeCompare(a.caseRow.updated_at);
  });
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

function sortByFollowUpAtAsc(items: HandlingWorkbenchItem[]): HandlingWorkbenchItem[] {
  return [...items].sort((a, b) => {
    const da = a.next.follow_up_at?.trim() ?? "";
    const db = b.next.follow_up_at?.trim() ?? "";
    if (!da && !db) return b.caseRow.updated_at.localeCompare(a.caseRow.updated_at);
    if (!da) return 1;
    if (!db) return -1;
    const cmp = da.localeCompare(db);
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

function deriveManualActionNextStep(input: {
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
  return "Tracking complete for now.";
}

const HANDLING_TRACKING_COMPLETE_NEXT_STEP = "Tracking complete for now.";

function deriveHandlingManualActionNextStepForItem(
  item: HandlingWorkbenchItem,
  savedFilings: JusticeCaseFilingRow[] | undefined,
  evidenceCount: number | undefined
): string {
  const { caseRow, next } = item;
  const readyForManualReview = caseReadyForManualReview(caseRow);
  const readyForExternalManualAction =
    readyForManualReview && (evidenceCount ?? 0) > 0;
  const actionOpened = next.status === "started" || next.status === "completed";
  return deriveManualActionNextStep({
    readyForExternalManualAction,
    actionOpened,
    hasFilingRecord: handlingCaseHasFilingRecord(savedFilings),
    hasConfirmationOnFile: handlingCaseHasConfirmationOnFile(savedFilings),
    status: next.status,
    outcomeNote: next.outcome_note,
    handlingRequestedAt: next.handling_requested_at,
    handlingAcknowledgedAt: next.handling_acknowledged_at,
    followUpNeeded: next.follow_up_needed === true,
  });
}

function HandlingWorkbenchOperatorNoteSection({
  caseId,
  action,
  onSave,
}: {
  caseId: string;
  action: JusticeApprovedNextAction;
  onSave: (note: string) => Promise<void>;
}) {
  const savedNote = action.handling_operator_note?.trim() ?? "";
  const [editing, setEditing] = useState(!savedNote);
  const [draft, setDraft] = useState(savedNote);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(savedNote);
    if (savedNote) setEditing(false);
  }, [savedNote]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(draft);
      if (draft.trim()) setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-neutral-200/90 bg-neutral-50/90 px-2.5 py-2 dark:border-neutral-600 dark:bg-neutral-800/40">
      <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
        Internal operator note
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
        Internal triage only — not filed, submitted, or sent to the consumer. This is separate from
        the user&apos;s handling request note above.
      </p>
      {!editing && savedNote ? (
        <>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
            {savedNote}
          </p>
          <button
            type="button"
            onClick={() => {
              setDraft(savedNote);
              setEditing(true);
            }}
            className="mt-2 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Edit internal note
          </button>
        </>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-2 space-y-2">
          <label className="sr-only" htmlFor={`handling-operator-note-${caseId}`}>
            Internal operator note
          </label>
          <textarea
            id={`handling-operator-note-${caseId}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Internal triage context for operators (not visible to the consumer)."
            className="w-full resize-y rounded-md border border-neutral-300/80 bg-white px-2 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className={`${navButtonSecondaryCls} disabled:opacity-60`}
            >
              {saving ? "Saving…" : "Save internal note"}
            </button>
            {savedNote ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setDraft(savedNote);
                  setEditing(false);
                }}
                className="text-xs font-medium text-neutral-600 hover:underline dark:text-neutral-400"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}

function HandlingWorkbenchCaseCard({
  item,
  isActiveSessionCase,
  showMarkAcknowledged,
  compactNavigation,
  handledOpenTriageNoteVariant = "redirect",
  acknowledging,
  onOpenJusticeWorkspace,
  onOpenPacket,
  onOpenChat,
  onOpenApprovedStep,
  persistingOpen,
  onAcknowledge,
  markingHandled,
  onRecordActionHandled,
  onCaseClientStateUpdate,
  savedFilings,
  filingsReady,
  evidenceCount,
}: {
  item: HandlingWorkbenchItem;
  isActiveSessionCase: boolean;
  showMarkAcknowledged: boolean;
  /** Nested Handled — open handling request rows (compact nav). */
  compactNavigation?: boolean;
  handledOpenTriageNoteVariant?: "redirect" | "inlineAck";
  acknowledging: boolean;
  onOpenJusticeWorkspace: () => void;
  onOpenPacket: () => void;
  onOpenChat: () => void;
  onOpenApprovedStep?: () => void;
  persistingOpen?: boolean;
  onAcknowledge?: () => void;
  markingHandled?: boolean;
  onRecordActionHandled?: () => void;
  onCaseClientStateUpdate: (caseId: string, mergedClientState: JusticeCaseClientState) => void;
  savedFilings?: JusticeCaseFilingRow[];
  filingsReady?: boolean;
  evidenceCount?: number;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const [clearingFollowUp, setClearingFollowUp] = useState(false);
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
  const packetApproved =
    parseJusticeCaseClientState(caseRow.client_state).prepared_packet_approved === true;
  const draftReviewed = caseDraftReviewed(caseRow);
  const basicsReady = isBasicCaseInfoReadyForEscalation(caseRow.intake);
  const readyForManualReview = basicsReady && draftReviewed && packetApproved;
  const readyForExternalManualAction =
    readyForManualReview && (evidenceCount ?? 0) > 0;
  const recommendedDestinationLabels = useMemo(() => {
    return computeJusticeDestinations(caseRow.intake, {
      manualFtc: ftcUnlockedFromIntake(caseRow.intake),
      useCompanyContactLabels: true,
    })
      .filter((d) => d.status === "recommended")
      .slice(0, 3)
      .map((d) => d.label);
  }, [caseRow.intake]);
  const hasFilingRecord = (savedFilings?.length ?? 0) > 0;
  const hasConfirmationOnFile = Boolean(
    savedFilings?.some((row) => row.confirmation_number?.trim())
  );
  const showPostExternalFilingNudge =
    next.status === "started" || next.status === "completed";
  const actionOpened = next.status === "started" || next.status === "completed";
  const outcomeRecorded = Boolean(next.outcome_note?.trim());
  const handlingAcknowledged = Boolean(next.handling_acknowledged_at?.trim());
  const manualActionNextStep = filingsReady
    ? deriveManualActionNextStep({
        readyForExternalManualAction,
        actionOpened,
        hasFilingRecord,
        hasConfirmationOnFile,
        status: next.status,
        outcomeNote: next.outcome_note,
        handlingRequestedAt: handlingAt,
        handlingAcknowledgedAt: next.handling_acknowledged_at,
        followUpNeeded: next.follow_up_needed === true,
      })
    : null;
  const showApprovedStep =
    !compactNavigation && Boolean(onOpenApprovedStep) && next.status === "approved";
  const showApprovedOpenTrackingCopy = showApprovedStep;
  const showRecordHandled = next.status === "started";
  const showOutcomeTrackingForm = next.status === "completed";
  const companyName = caseRow.intake.company_name.trim();
  const showHandoffCompany = Boolean(companyName && companyName !== title);
  const categoryRaw = caseRow.intake.problem_category?.trim() ?? "";
  const handoffCategoryLine = categoryRaw ? categoryRaw.replace(/_/g, " ") : "";
  const storyTrimmed = caseRow.intake.story?.trim() ?? "";
  const handoffStorySnip = storyTrimmed
    ? truncateAttentionNote(storyTrimmed, HANDLING_HANDOFF_STORY_PREVIEW_MAX)
    : "";

  async function handleSaveOperatorNote(rawNote: string) {
    const updated = applyHandlingOperatorNoteToApprovedNextAction(next, rawNote);
    const base = parseApprovedNextActionFromClientState(caseRow.client_state);
    const withTracking = omitClearedHandlingRequestNoteFromApprovedNextAction(
      mergeApprovedNextActionTrackingFields(base, updated)
    );
    const mergedLocal = mergeClientStateWithApprovedNextAction(caseRow.client_state, withTracking);
    onCaseClientStateUpdate(caseRow.id, mergedLocal);

    if (isLoaded && isSignedIn && isUuid(caseRow.id)) {
      try {
        const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseRow.id)}`);
        if (!getRes.ok) {
          console.warn("justice handling: GET before operator note persist failed", getRes.status);
          return;
        }
        const existing = (await getRes.json()) as { client_state?: unknown };
        const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
        const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseRow.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_state: merged }),
        });
        if (patchRes.ok) {
          const data = (await patchRes.json()) as { client_state?: unknown };
          if (data.client_state !== undefined) {
            onCaseClientStateUpdate(caseRow.id, data.client_state as JusticeCaseClientState);
          }
        } else {
          console.warn("justice handling: PATCH operator note persist failed", patchRes.status);
        }
      } catch (e) {
        console.warn("justice handling: operator note persist error", e);
      }
    }
  }

  async function handleSaveOutcomeTracking(draft: {
    outcome_note: string;
    follow_up_needed: boolean;
    follow_up_at: string;
  }) {
    if (next.status !== "completed") return;
    const trimmedNote = draft.outcome_note.trim();
    const updated: JusticeApprovedNextAction = { ...next };
    if (trimmedNote) updated.outcome_note = trimmedNote;
    else delete updated.outcome_note;
    if (draft.follow_up_needed) {
      updated.follow_up_needed = true;
      if (draft.follow_up_at.trim()) {
        updated.follow_up_at = new Date(`${draft.follow_up_at}T12:00:00`).toISOString();
      } else {
        delete updated.follow_up_at;
      }
    } else {
      delete updated.follow_up_needed;
      delete updated.follow_up_at;
    }
    const base = parseApprovedNextActionFromClientState(caseRow.client_state);
    const withTracking = omitClearedHandlingRequestNoteFromApprovedNextAction(
      mergeApprovedNextActionTrackingFields(base, updated)
    );
    const mergedLocal = mergeClientStateWithApprovedNextAction(caseRow.client_state, withTracking);
    onCaseClientStateUpdate(caseRow.id, mergedLocal);

    if (isLoaded && isSignedIn && isUuid(caseRow.id)) {
      try {
        const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseRow.id)}`);
        if (!getRes.ok) {
          console.warn("justice handling: GET before outcome tracking persist failed", getRes.status);
          return;
        }
        const existing = (await getRes.json()) as { client_state?: unknown };
        const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
        const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseRow.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_state: merged }),
        });
        if (patchRes.ok) {
          const data = (await patchRes.json()) as { client_state?: unknown };
          if (data.client_state !== undefined) {
            onCaseClientStateUpdate(caseRow.id, data.client_state as JusticeCaseClientState);
          }
        } else {
          console.warn("justice handling: PATCH outcome tracking persist failed", patchRes.status);
        }
      } catch (e) {
        console.warn("justice handling: outcome tracking persist error", e);
      }
    }
  }

  async function handleClearFollowUp() {
    if (next.follow_up_needed !== true) return;
    const cleared = clearFollowUpFromApprovedNextAction(next);
    const mergedLocal = mergeClientStateWithClearedFollowUp(caseRow.client_state, cleared);
    setClearingFollowUp(true);
    onCaseClientStateUpdate(caseRow.id, mergedLocal);

    try {
      if (isLoaded && isSignedIn && isUuid(caseRow.id)) {
        const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseRow.id)}`);
        if (!getRes.ok) {
          console.warn("justice handling: GET before clear follow-up failed", getRes.status);
          return;
        }
        const existing = (await getRes.json()) as { client_state?: unknown };
        const merged = mergeClientStateWithClearedFollowUp(existing.client_state, cleared);
        const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseRow.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_state: merged }),
        });
        if (patchRes.ok) {
          const data = (await patchRes.json()) as { client_state?: unknown };
          if (data.client_state !== undefined) {
            onCaseClientStateUpdate(caseRow.id, data.client_state as JusticeCaseClientState);
          }
        } else {
          console.warn("justice handling: PATCH clear follow-up failed", patchRes.status);
        }
      }
    } catch (e) {
      console.warn("justice handling: clear follow-up error", e);
    } finally {
      setClearingFollowUp(false);
    }
  }

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
      {next.status === "completed" && next.completed_at?.trim() ? (
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          Handled for now{" "}
          {formatApprovedNextActionHandlingTimestamp(next.completed_at.trim())}
        </p>
      ) : null}
      <div className="mt-2">
        <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
          Manual review readiness (approval funnel)
        </p>
        <ul className="mt-1 space-y-0.5 text-xs text-neutral-600 dark:text-neutral-400">
          <li>Basic case info: {basicsReady ? "yes" : "not yet"}</li>
          <li>Submission draft reviewed: {draftReviewed ? "yes" : "not yet"}</li>
          <li>Prepared case packet approved: {packetApproved ? "yes" : "not yet"}</li>
          {filingsReady ? (
            <li>
              Evidence on case:{" "}
              {(evidenceCount ?? 0) > 0
                ? `yes (${evidenceCount} saved proof note${evidenceCount === 1 ? "" : "s"})`
                : "not yet"}
            </li>
          ) : null}
        </ul>
        <p
          className={`mt-1 text-xs font-medium ${
            readyForManualReview
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-800 dark:text-amber-200"
          }`}
        >
          {readyForManualReview ? "Ready for manual review" : "Needs more before manual review"}
        </p>
        <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-500">
          Read-only metadata only — not filed or submitted. Proof note titles and details are not
          shown here.
        </p>
      </div>
      {filingsReady && readyForManualReview && (evidenceCount ?? 0) === 0 ? (
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
          No saved proof on case yet. Review evidence on the case packet before external manual
          action.
        </p>
      ) : null}
      {filingsReady && savedFilings && savedFilings.length > 0 ? (
        <div className="mt-2 rounded-lg border border-neutral-200/90 bg-neutral-50/90 px-2.5 py-2 dark:border-neutral-600 dark:bg-neutral-800/40">
          <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
            Saved manual filings
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            Preview only (no filing URLs here). Add or edit full records on the case packet.
          </p>
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
              Show saved filings ({savedFilings.length})
            </summary>
            <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-lg border border-neutral-200/80 bg-white px-2.5 py-2 dark:border-neutral-600 dark:bg-neutral-900">
              {savedFilings.map((row) => {
                const confirmSnip = truncateHandlingFilingSnippet(
                  row.confirmation_number,
                  HANDLING_FILING_CONFIRM_PREVIEW_MAX
                );
                const notesSnip = truncateHandlingFilingSnippet(
                  row.notes,
                  HANDLING_FILING_NOTES_PREVIEW_MAX
                );
                return (
                  <li
                    key={row.id}
                    className="border-t border-neutral-100 pt-2 first:border-t-0 first:pt-0 dark:border-neutral-700/80"
                  >
                    <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                      {row.destination}
                    </p>
                    {row.filed_at?.trim() ? (
                      <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                        Filed: {handlingFilingFiledAtLine(row.filed_at)}
                      </p>
                    ) : null}
                    {confirmSnip ? (
                      <p className="mt-0.5 font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
                        Confirmation: {confirmSnip}
                      </p>
                    ) : null}
                    {notesSnip ? (
                      <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-neutral-700 dark:text-neutral-300">
                        Notes: {notesSnip}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </details>
        </div>
      ) : null}
      <div className="mt-2 rounded-lg border border-neutral-200/90 bg-neutral-50/90 px-2.5 py-2 dark:border-neutral-600 dark:bg-neutral-800/40">
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-neutral-700 dark:text-neutral-200">
            Case handoff summary
          </summary>
          <div className="mt-2 space-y-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            {showHandoffCompany ? (
              <p>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">Company:</span>{" "}
                {companyName}
              </p>
            ) : null}
            {handoffCategoryLine ? (
              <p>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  Issue category:
                </span>{" "}
                {handoffCategoryLine}
              </p>
            ) : null}
            {!product && caseRow.intake.purchase_or_signup.trim() ? (
              <p>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  Product / service:
                </span>{" "}
                {caseRow.intake.purchase_or_signup.trim()}
              </p>
            ) : null}
            {actionLabel ? (
              <p>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  Next step:
                </span>{" "}
                {actionLabel}
              </p>
            ) : null}
            {handoffStorySnip ? (
              <p className="whitespace-pre-wrap">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">Story:</span>{" "}
                {handoffStorySnip}
              </p>
            ) : null}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
            Read-only summary — not filed or submitted. Open case packet for the full bundle.
          </p>
        </details>
      </div>
      {filingsReady ? (
        <div className="mt-2 rounded-lg border border-neutral-200/90 bg-neutral-50/90 px-2.5 py-2 dark:border-neutral-600 dark:bg-neutral-800/40">
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              Ready for external manual action:
            </span>{" "}
            {readyForExternalManualAction ? "yes" : "not yet"}
          </p>
          {readyForExternalManualAction && recommendedDestinationLabels.length > 0 ? (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                Suggested manual channels
              </summary>
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-neutral-600 dark:text-neutral-400">
                {recommendedDestinationLabels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
            Read-only — Surrenderless does not file or submit automatically. Use Open case packet or
            Open approved step for prep surfaces.
          </p>
        </div>
      ) : null}
      {filingsReady ? (
        <div className="mt-2 rounded-lg border border-neutral-200/90 bg-neutral-50/90 px-2.5 py-2 dark:border-neutral-600 dark:bg-neutral-800/40">
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              Manual filing recorded:
            </span>{" "}
            {hasFilingRecord ? "yes" : "not yet"}
          </p>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              Confirmation on file:
            </span>{" "}
            {hasConfirmationOnFile ? "yes" : "not yet"}
          </p>
          {showPostExternalFilingNudge && !hasFilingRecord ? (
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
              Manual filing not recorded yet. Add filing records from the case packet after external
              submission.
            </p>
          ) : null}
          {showPostExternalFilingNudge && hasFilingRecord && !hasConfirmationOnFile ? (
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
              No confirmation number on file yet. Add or edit filing records from the case packet
              after external submission.
            </p>
          ) : null}
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
            Read-only tracking — not filed or submitted. Filing and confirmation writes stay on the
            case packet.
          </p>
        </div>
      ) : null}
      <div className="mt-2 rounded-lg border border-neutral-200/90 bg-neutral-50/90 px-2.5 py-2 dark:border-neutral-600 dark:bg-neutral-800/40">
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-neutral-700 dark:text-neutral-200">
            Manual action progress
          </summary>
          <ul className="mt-2 space-y-0.5 text-xs text-neutral-600 dark:text-neutral-400">
            <li>
              Ready for manual review: {readyForManualReview ? "yes" : "not yet"}
            </li>
            {filingsReady ? (
              <li>
                Ready for external manual action:{" "}
                {readyForExternalManualAction ? "yes" : "not yet"}
              </li>
            ) : null}
            <li>Action opened: {actionOpened ? "yes" : "not yet"}</li>
            {filingsReady ? (
              <>
                <li>Manual filing recorded: {hasFilingRecord ? "yes" : "not yet"}</li>
                <li>Confirmation on file: {hasConfirmationOnFile ? "yes" : "not yet"}</li>
              </>
            ) : null}
            {next.status === "completed" ? (
              <li>Outcome recorded: {outcomeRecorded ? "yes" : "not yet"}</li>
            ) : null}
            {handlingAt ? (
              <li>Handling acknowledged: {handlingAcknowledged ? "yes" : "not yet"}</li>
            ) : null}
            {next.follow_up_needed === true || next.status === "completed" ? (
              <li>Follow-up open: {next.follow_up_needed === true ? "yes" : "not yet"}</li>
            ) : null}
          </ul>
          {next.follow_up_needed === true ? (
            <ApprovedNextActionFollowUpTimingLine
              followUpAt={next.follow_up_at}
              className="mt-1 text-xs text-neutral-600 dark:text-neutral-400"
            />
          ) : null}
          {manualActionNextStep ? (
            <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300">
              <span className="font-medium">Next step:</span> {manualActionNextStep}
            </p>
          ) : null}
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
            Read-only progress — not filed or submitted. Writes stay on the case packet, approved
            step, and existing workbench actions.
          </p>
        </details>
      </div>
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
      <HandlingWorkbenchOperatorNoteSection
        caseId={caseRow.id}
        action={next}
        onSave={handleSaveOperatorNote}
      />
      <ApprovedNextActionHandlingQueueStatusReadOnly
        handlingRequestedAt={handlingAt}
        handlingAcknowledgedAt={next.handling_acknowledged_at}
      />
      {showHandledOpenHandlingTriageNote ? (
        <ApprovedNextActionHandlingHandledOpenTriageNote variant={handledOpenTriageNoteVariant} />
      ) : null}
      <ApprovedNextActionHandlingAcknowledgedReadOnly
        acknowledgedAt={next.handling_acknowledged_at}
        tone="neutral"
      />
      {showRecordHandled ? (
        <>
          <p className="mt-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
            Opened for next step.
          </p>
          {next.started_at?.trim() ? (
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
              Opened {formatApprovedNextActionHandlingTimestamp(next.started_at.trim())}
            </p>
          ) : null}
          <button
            type="button"
            disabled={markingHandled}
            onClick={() => onRecordActionHandled?.()}
            className={`${navButtonSecondaryCls} mt-2 disabled:opacity-60`}
          >
            {markingHandled ? "Saving…" : "Record action handled for now"}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
            Tracking only — not automatic filing or submission.
          </p>
        </>
      ) : null}
      {showOutcomeTrackingForm ? (
        <HandlingWorkbenchOutcomeTrackingForm action={next} onSave={handleSaveOutcomeTracking} />
      ) : (
        <>
          {next.outcome_note?.trim() ? (
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
              {truncateAttentionNote(next.outcome_note.trim(), 200)}
            </p>
          ) : null}
          {next.follow_up_needed === true ? (
            <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
              Follow-up needed
            </p>
          ) : null}
          {next.follow_up_at?.trim() ? (
            <ApprovedNextActionFollowUpTimingLine
              followUpAt={next.follow_up_at}
              className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400"
            />
          ) : null}
        </>
      )}
      {next.follow_up_needed === true ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="button"
            disabled={clearingFollowUp}
            onClick={() => void handleClearFollowUp()}
            className={`${navButtonSecondaryCls} disabled:opacity-60`}
          >
            {clearingFollowUp ? "Saving…" : "Mark follow-up handled"}
          </button>
          <p className="text-[11px] text-neutral-600 dark:text-neutral-400 sm:max-w-[18rem]">
            Clears this from Saved cases Needs attention. Outcome notes and dates stay saved.
            Tracking only — not automatic filing or submission.
          </p>
        </div>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
        {APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" onClick={onOpenChat} className={navButtonPrimaryCls}>
          Update in chat
        </button>
        <button type="button" onClick={onOpenJusticeWorkspace} className={navButtonSecondaryCls}>
          Justice workspace
        </button>
        {!compactNavigation ? (
          <button type="button" onClick={onOpenPacket} className={navButtonSecondaryCls}>
            Open case packet
          </button>
        ) : null}
        {!compactNavigation ? (
          <p className="w-full text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500 sm:w-auto sm:basis-full">
            Manual filing records are added on the packet. Surrenderless does not file or submit
            automatically.
          </p>
        ) : null}
        {showApprovedStep ? (
          <button
            type="button"
            disabled={persistingOpen}
            onClick={() => onOpenApprovedStep?.()}
            className={`${navButtonSecondaryCls} disabled:opacity-60`}
          >
            {persistingOpen ? "Saving…" : "Open approved step"}
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
      {showApprovedOpenTrackingCopy ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
          Tracking only — not automatic filing or submission.
        </p>
      ) : null}
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

function ApprovedPacketActionCaseCard({
  item,
  isActiveSessionCase,
  persistingOpen,
  markingHandled,
  onOpenJusticeWorkspace,
  onOpenPacket,
  onOpenChat,
  onOpenApprovedStep,
  onRecordActionHandled,
}: {
  item: HandlingWorkbenchItem;
  isActiveSessionCase: boolean;
  persistingOpen: boolean;
  markingHandled: boolean;
  onOpenJusticeWorkspace: () => void;
  onOpenPacket: () => void;
  onOpenChat: () => void;
  onOpenApprovedStep?: () => void;
  onRecordActionHandled?: () => void;
}) {
  const { caseRow, next } = item;
  const title = caseDisplayTitle(caseRow);
  const product = caseRow.intake.purchase_or_signup.trim();
  const statusLabel = approvedNextActionStatusLabel(next.status);
  const actionLabel = next.label?.trim();
  const approvedAt = next.approved_at?.trim();
  const showRecordHandled = next.status === "started";

  return (
    <li
      className={`${cardCls} border-blue-200/80 ring-blue-950/[0.06] dark:border-blue-900/40 dark:ring-blue-500/10`}
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
      {actionLabel ? (
        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">Next step:</span>{" "}
          <span className="text-neutral-800 dark:text-neutral-200">{actionLabel}</span>
        </p>
      ) : null}
      {statusLabel ? (
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">Status:</span>{" "}
          {statusLabel}
        </p>
      ) : null}
      {approvedAt ? (
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          Approved {formatApprovedNextActionHandlingTimestamp(approvedAt)}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
        Approved case packet and next in-app step — not a Surrenderless handling request. Request
        Surrenderless handling from chat intake when you want internal triage tracking.
      </p>
      {showRecordHandled ? (
        <>
          <p className="mt-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
            Opened for next step.
          </p>
          {next.started_at?.trim() ? (
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
              Opened {formatApprovedNextActionHandlingTimestamp(next.started_at.trim())}
            </p>
          ) : null}
          <button
            type="button"
            disabled={markingHandled}
            onClick={() => onRecordActionHandled?.()}
            className={`${navButtonSecondaryCls} mt-2 disabled:opacity-60`}
          >
            {markingHandled ? "Saving…" : "Record action handled for now"}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
            Tracking only — not automatic filing or submission.
          </p>
        </>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" onClick={onOpenChat} className={navButtonPrimaryCls}>
          Update in chat
        </button>
        <button type="button" onClick={onOpenJusticeWorkspace} className={navButtonSecondaryCls}>
          Justice workspace
        </button>
        <button type="button" onClick={onOpenPacket} className={navButtonSecondaryCls}>
          Open case packet
        </button>
        {onOpenApprovedStep ? (
          <button
            type="button"
            disabled={persistingOpen}
            onClick={onOpenApprovedStep}
            className={`${navButtonSecondaryCls} disabled:opacity-60`}
          >
            {persistingOpen ? "Saving…" : "Open approved step"}
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
        Opens this case in your browser session first.
      </p>
    </li>
  );
}

export default function JusticeHandlingWorkbenchPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acknowledgingHandlingCaseId, setAcknowledgingHandlingCaseId] = useState<string | null>(null);
  const [persistingApprovedPacketOpenCaseId, setPersistingApprovedPacketOpenCaseId] = useState<
    string | null
  >(null);
  const [markingApprovedPacketHandledCaseId, setMarkingApprovedPacketHandledCaseId] = useState<
    string | null
  >(null);
  const [sessionCaseId, setSessionCaseId] = useState<string | null>(null);
  const [filingsByCaseId, setFilingsByCaseId] = useState<
    Record<string, JusticeCaseFilingRow[]>
  >({});
  const [evidenceCountByCaseId, setEvidenceCountByCaseId] = useState<Record<string, number>>(
    {}
  );
  const [filingsLoading, setFilingsLoading] = useState(false);
  const refetchAbortRef = useRef<AbortController | null>(null);
  const filingsAbortRef = useRef<AbortController | null>(null);

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

  const approvedPacketActionItems = useMemo(
    () => sortByApprovedAtDesc(buildApprovedPacketActionItems(cases ?? [])),
    [cases]
  );

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

  const followUpHandlingItems = useMemo(() => {
    const items = allHandlingItems.filter((item) => item.next.follow_up_needed === true);
    return sortByFollowUpAtAsc(items);
  }, [allHandlingItems]);

  const handlingCaseIdsKey = useMemo(() => {
    const ids = [...new Set(allHandlingItems.map((item) => item.caseRow.id))];
    return ids.sort().join(",");
  }, [allHandlingItems]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || cases === null) {
      setFilingsByCaseId({});
      setEvidenceCountByCaseId({});
      setFilingsLoading(false);
      return;
    }
    if (!handlingCaseIdsKey) {
      setFilingsByCaseId({});
      setEvidenceCountByCaseId({});
      setFilingsLoading(false);
      return;
    }

    const ids = handlingCaseIdsKey.split(",").filter(Boolean);
    filingsAbortRef.current?.abort();
    const ac = new AbortController();
    filingsAbortRef.current = ac;
    setFilingsLoading(true);

    void (async () => {
      try {
        const entries = await Promise.all(
          ids.map(async (id) => {
            try {
              const [filRes, evRes] = await Promise.all([
                fetch(`/api/justice/filings?case_id=${encodeURIComponent(id)}`, {
                  signal: ac.signal,
                }),
                fetch(`/api/justice/evidence?case_id=${encodeURIComponent(id)}`, {
                  signal: ac.signal,
                }),
              ]);
              if (ac.signal.aborted) {
                return [id, [] as JusticeCaseFilingRow[], 0] as const;
              }
              const filJson: unknown = filRes.ok ? await filRes.json() : [];
              const evJson: unknown = evRes.ok ? await evRes.json() : [];
              const rows = Array.isArray(filJson) ? (filJson as JusticeCaseFilingRow[]) : [];
              const evidenceCount = Array.isArray(evJson) ? evJson.length : 0;
              return [id, rows, evidenceCount] as const;
            } catch {
              if (ac.signal.aborted) {
                return [id, [] as JusticeCaseFilingRow[], 0] as const;
              }
              return [id, [] as JusticeCaseFilingRow[], 0] as const;
            }
          })
        );
        if (ac.signal.aborted) return;
        const nextFilings: Record<string, JusticeCaseFilingRow[]> = {};
        const nextEvidenceCounts: Record<string, number> = {};
        for (const [id, rows, evidenceCount] of entries) {
          nextFilings[id] = rows;
          nextEvidenceCounts[id] = evidenceCount;
        }
        setFilingsByCaseId(nextFilings);
        setEvidenceCountByCaseId(nextEvidenceCounts);
      } finally {
        if (!ac.signal.aborted) setFilingsLoading(false);
      }
    })();

    return () => ac.abort();
  }, [isLoaded, isSignedIn, handlingCaseIdsKey, cases]);

  const filingsReady = !filingsLoading && cases !== null;

  const awaitingHandoffTiers = useMemo(() => {
    if (!filingsReady) return null;
    const external: HandlingWorkbenchItem[] = [];
    const needsProof: HandlingWorkbenchItem[] = [];
    const needsPrep: HandlingWorkbenchItem[] = [];
    const other: HandlingWorkbenchItem[] = [];
    for (const item of awaitingItems) {
      const tier = deriveAwaitingHandoffTier(
        item,
        evidenceCountByCaseId[item.caseRow.id]
      );
      switch (tier) {
        case "external":
          external.push(item);
          break;
        case "needs_proof":
          needsProof.push(item);
          break;
        case "needs_prep":
          needsPrep.push(item);
          break;
        default:
          other.push(item);
          break;
      }
    }
    return {
      externalReady: sortByHandlingRequestedAtDesc(external),
      needsProof: sortByHandlingRequestedAtDesc(needsProof),
      needsPrep: sortByHandlingRequestedAtDesc(needsPrep),
      other: sortByHandlingRequestedAtDesc(other),
    };
  }, [awaitingItems, filingsReady, evidenceCountByCaseId]);

  const postExternalConfirmationTiers = useMemo(() => {
    if (!filingsReady) return null;
    const noFilingRecorded: HandlingWorkbenchItem[] = [];
    const noConfirmationOnFile: HandlingWorkbenchItem[] = [];
    for (const item of allHandlingItems) {
      const savedFilings = filingsByCaseId[item.caseRow.id];
      if (!isPostExternalConfirmationFollowUpItem(item, savedFilings, filingsReady)) {
        continue;
      }
      if (!handlingCaseHasFilingRecord(savedFilings)) {
        noFilingRecorded.push(item);
      } else {
        noConfirmationOnFile.push(item);
      }
    }
    return {
      noFilingRecorded: sortByHandlingRequestedAtDesc(noFilingRecorded),
      noConfirmationOnFile: sortByHandlingRequestedAtDesc(noConfirmationOnFile),
    };
  }, [allHandlingItems, filingsReady, filingsByCaseId]);

  const postExternalConfirmationCount = useMemo(() => {
    if (!postExternalConfirmationTiers) return 0;
    return (
      postExternalConfirmationTiers.noFilingRecorded.length +
      postExternalConfirmationTiers.noConfirmationOnFile.length
    );
  }, [postExternalConfirmationTiers]);

  const outcomeClosureTiers = useMemo(() => {
    const outcomeNotRecorded: HandlingWorkbenchItem[] = [];
    const handlingNotAcknowledged: HandlingWorkbenchItem[] = [];
    for (const item of allHandlingItems) {
      if (item.next.status !== "completed") continue;
      const outcomeNote = item.next.outcome_note?.trim() ?? "";
      const handlingRequestedAt = item.next.handling_requested_at?.trim() ?? "";
      const handlingAcknowledgedAt = item.next.handling_acknowledged_at?.trim() ?? "";
      if (!outcomeNote) {
        outcomeNotRecorded.push(item);
      } else if (handlingRequestedAt && !handlingAcknowledgedAt) {
        handlingNotAcknowledged.push(item);
      }
    }
    return {
      outcomeNotRecorded: sortByHandlingRequestedAtDesc(outcomeNotRecorded),
      handlingNotAcknowledged: sortByHandlingRequestedAtDesc(handlingNotAcknowledged),
    };
  }, [allHandlingItems]);

  const outcomeClosureCount = useMemo(() => {
    return (
      outcomeClosureTiers.outcomeNotRecorded.length +
      outcomeClosureTiers.handlingNotAcknowledged.length
    );
  }, [outcomeClosureTiers]);

  const trackingCompleteHandlingItems = useMemo(() => {
    if (!filingsReady) return null;
    const complete: HandlingWorkbenchItem[] = [];
    for (const item of allHandlingItems) {
      const nextStep = deriveHandlingManualActionNextStepForItem(
        item,
        filingsByCaseId[item.caseRow.id],
        evidenceCountByCaseId[item.caseRow.id]
      );
      if (nextStep === HANDLING_TRACKING_COMPLETE_NEXT_STEP) {
        complete.push(item);
      }
    }
    return sortByHandlingRequestedAtDesc(complete);
  }, [allHandlingItems, filingsReady, filingsByCaseId, evidenceCountByCaseId]);

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

  function openJusticeWorkspace(row: CaseRow) {
    navigateWithCase(row, "/justice");
  }

  function openPacket(row: CaseRow) {
    navigateWithCase(row, "/justice/packet");
  }

  function openChat(row: CaseRow) {
    navigateWithCase(row, "/justice/chat-ai");
  }

  function applyApprovedNextActionToCaseRow(caseId: string, mergedClientState: JusticeCaseClientState) {
    const parsed = parseApprovedNextAction(mergedClientState.approved_next_action);
    setCases(
      (prev) =>
        prev?.map((c) => (c.id === caseId ? { ...c, client_state: mergedClientState } : c)) ?? prev
    );
    if (parsed) writeSessionApprovedNextAction(caseId, parsed);
  }

  function applyAcknowledgedHandlingToCaseRow(caseId: string, mergedClientState: JusticeCaseClientState) {
    applyApprovedNextActionToCaseRow(caseId, mergedClientState);
  }

  async function persistApprovedPacketNextActionToServer(
    caseRow: CaseRow,
    withTracking: JusticeApprovedNextAction
  ): Promise<JusticeCaseClientState | undefined> {
    if (!isLoaded || !isSignedIn || !isUuid(caseRow.id)) return undefined;
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseRow.id)}`);
      if (!getRes.ok) {
        console.warn(
          "justice handling: GET before approved packet action persist failed",
          getRes.status
        );
        return undefined;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseRow.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (patchRes.ok) {
        const data = (await patchRes.json()) as { client_state?: unknown };
        if (data.client_state !== undefined) {
          return data.client_state as JusticeCaseClientState;
        }
      } else {
        console.warn(
          "justice handling: PATCH approved packet action persist failed",
          patchRes.status
        );
      }
    } catch (e) {
      console.warn("justice handling: approved packet action persist error", e);
    }
    return undefined;
  }

  async function persistApprovedPacketNextAction(
    caseRow: CaseRow,
    incoming: JusticeApprovedNextAction
  ): Promise<JusticeCaseClientState> {
    const base = parseApprovedNextActionFromClientState(caseRow.client_state);
    const withTracking = omitClearedHandlingRequestNoteFromApprovedNextAction(
      mergeApprovedNextActionTrackingFields(base, incoming)
    );
    const mergedLocal = mergeClientStateWithApprovedNextAction(caseRow.client_state, withTracking);
    applyApprovedNextActionToCaseRow(caseRow.id, mergedLocal);

    const serverMerged = await persistApprovedPacketNextActionToServer(caseRow, withTracking);
    if (serverMerged) {
      applyApprovedNextActionToCaseRow(caseRow.id, serverMerged);
      return serverMerged;
    }
    return mergedLocal;
  }

  async function openApprovedPacketStep(caseRow: CaseRow, next: JusticeApprovedNextAction) {
    const href = resolveWorkbenchApprovedStepHref(next);
    if (!href) return;

    let clientStateForNav = caseRow.client_state;

    if (next.status === "approved") {
      setPersistingApprovedPacketOpenCaseId(caseRow.id);
      try {
        const label = next.label?.trim();
        const updated: JusticeApprovedNextAction = {
          ...next,
          ...(label ? { label } : {}),
          href: next.href ?? href,
          status: "started",
          started_at: next.started_at ?? new Date().toISOString(),
          ...(next.approved_at ? { approved_at: next.approved_at } : {}),
        };
        const merged = await persistApprovedPacketNextAction(caseRow, updated);
        clientStateForNav = merged;
      } finally {
        setPersistingApprovedPacketOpenCaseId(null);
      }
    }

    sessionStorage.setItem(STORAGE_CASE_ID, caseRow.id);
    setSessionCaseId(caseRow.id);
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(caseRow.intake));
    const tl = Array.isArray(caseRow.timeline) ? (caseRow.timeline as TimelineEntry[]) : [];
    replaceTimelineForCase(caseRow.id, tl);
    const hydrated = hydrateApprovedNextActionForDisplay(caseRow.id, clientStateForNav);
    if (hydrated) writeSessionApprovedNextAction(caseRow.id, hydrated);
    router.push(href);
  }

  async function markApprovedPacketActionHandled(
    caseRow: CaseRow,
    next: JusticeApprovedNextAction
  ) {
    if (next.status !== "started") return;
    setMarkingApprovedPacketHandledCaseId(caseRow.id);
    try {
      const updated: JusticeApprovedNextAction = {
        ...next,
        status: "completed",
        completed_at: new Date().toISOString(),
      };
      await persistApprovedPacketNextAction(caseRow, updated);
    } finally {
      setMarkingApprovedPacketHandledCaseId(null);
    }
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

  function renderAwaitingHandlingCaseCard(item: HandlingWorkbenchItem) {
    const approvedStepHref = resolveWorkbenchApprovedStepHref(item.next);
    return (
      <HandlingWorkbenchCaseCard
        key={item.caseRow.id}
        item={item}
        isActiveSessionCase={Boolean(sessionCaseId) && sessionCaseId === item.caseRow.id}
        showMarkAcknowledged
        acknowledging={acknowledgingHandlingCaseId === item.caseRow.id}
        onOpenJusticeWorkspace={() => openJusticeWorkspace(item.caseRow)}
        onOpenPacket={() => openPacket(item.caseRow)}
        onOpenChat={() => openChat(item.caseRow)}
        onOpenApprovedStep={
          approvedStepHref
            ? () => void openApprovedPacketStep(item.caseRow, item.next)
            : undefined
        }
        persistingOpen={persistingApprovedPacketOpenCaseId === item.caseRow.id}
        onAcknowledge={() => void acknowledgeHandlingRequest(item.caseRow, item.next)}
        markingHandled={markingApprovedPacketHandledCaseId === item.caseRow.id}
        onRecordActionHandled={() =>
          void markApprovedPacketActionHandled(item.caseRow, item.next)
        }
        onCaseClientStateUpdate={applyApprovedNextActionToCaseRow}
        savedFilings={filingsByCaseId[item.caseRow.id]}
        filingsReady={filingsReady}
        evidenceCount={evidenceCountByCaseId[item.caseRow.id]}
      />
    );
  }

  function renderHandlingWorkbenchCaseCard(item: HandlingWorkbenchItem, keyPrefix: string) {
    const approvedStepHref = resolveWorkbenchApprovedStepHref(item.next);
    const showMarkAcknowledged = !item.next.handling_acknowledged_at?.trim();
    return (
      <HandlingWorkbenchCaseCard
        key={`${keyPrefix}-${item.caseRow.id}`}
        item={item}
        isActiveSessionCase={Boolean(sessionCaseId) && sessionCaseId === item.caseRow.id}
        showMarkAcknowledged={showMarkAcknowledged}
        acknowledging={acknowledgingHandlingCaseId === item.caseRow.id}
        onOpenJusticeWorkspace={() => openJusticeWorkspace(item.caseRow)}
        onOpenPacket={() => openPacket(item.caseRow)}
        onOpenChat={() => openChat(item.caseRow)}
        onOpenApprovedStep={
          approvedStepHref
            ? () => void openApprovedPacketStep(item.caseRow, item.next)
            : undefined
        }
        persistingOpen={persistingApprovedPacketOpenCaseId === item.caseRow.id}
        onAcknowledge={
          showMarkAcknowledged
            ? () => void acknowledgeHandlingRequest(item.caseRow, item.next)
            : undefined
        }
        markingHandled={markingApprovedPacketHandledCaseId === item.caseRow.id}
        onRecordActionHandled={() =>
          void markApprovedPacketActionHandled(item.caseRow, item.next)
        }
        onCaseClientStateUpdate={applyApprovedNextActionToCaseRow}
        savedFilings={filingsByCaseId[item.caseRow.id]}
        filingsReady={filingsReady}
        evidenceCount={evidenceCountByCaseId[item.caseRow.id]}
      />
    );
  }

  const hasAnyHandling = allHandlingItems.length > 0;
  const hasApprovedPacketActions = approvedPacketActionItems.length > 0;
  const hasAnyWorkbenchContent = hasApprovedPacketActions || hasAnyHandling;

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/justice/cases" className="text-blue-600 hover:underline dark:text-blue-400">
            Saved cases
          </Link>
          {" · "}
          <Link href="/justice/chat-ai" className="text-blue-600 hover:underline dark:text-blue-400">
            Update in chat
          </Link>
          {" · "}
          <Link href="/justice" className="text-blue-600 hover:underline dark:text-blue-400">
            Justice workspace
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
        ) : !hasAnyWorkbenchContent ? (
          <p className="mt-8 text-sm text-neutral-600 dark:text-neutral-400">
            No approved packet actions or handling requests yet. Approve your prepared case packet from
            chat intake or on the case packet, or request Surrenderless handling when an approved next
            action is active.
          </p>
        ) : (
          <div className="mt-8 space-y-10">
            {hasApprovedPacketActions ? (
              <section aria-labelledby="approved-packet-actions-heading">
                <h2
                  id="approved-packet-actions-heading"
                  className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
                >
                  Approved packet actions
                  <span className="ml-2 text-base font-normal text-neutral-500 dark:text-neutral-400">
                    ({approvedPacketActionItems.length})
                  </span>
                </h2>
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                  Cases where you approved your prepared case packet and next in-app step. This is not
                  a Surrenderless handling request — request Surrenderless handling from chat intake when you
                  want internal triage tracking.
                </p>
                <ul className="mt-3 space-y-3">
                  {approvedPacketActionItems.map((item) => {
                    const approvedStepHref = resolveWorkbenchApprovedStepHref(item.next);
                    return (
                      <ApprovedPacketActionCaseCard
                        key={item.caseRow.id}
                        item={item}
                        isActiveSessionCase={
                          Boolean(sessionCaseId) && sessionCaseId === item.caseRow.id
                        }
                        persistingOpen={
                          persistingApprovedPacketOpenCaseId === item.caseRow.id
                        }
                        markingHandled={
                          markingApprovedPacketHandledCaseId === item.caseRow.id
                        }
                        onOpenJusticeWorkspace={() => openJusticeWorkspace(item.caseRow)}
                        onOpenPacket={() => openPacket(item.caseRow)}
                        onOpenChat={() => openChat(item.caseRow)}
                        onOpenApprovedStep={
                          approvedStepHref
                            ? () => void openApprovedPacketStep(item.caseRow, item.next)
                            : undefined
                        }
                        onRecordActionHandled={() =>
                          void markApprovedPacketActionHandled(item.caseRow, item.next)
                        }
                      />
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {hasAnyHandling ? (
            <>
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
                marked handled, use <strong>Handled — open handling request</strong> below and{" "}
                <strong>Mark acknowledged</strong> on each card — or acknowledge from chat intake.
              </p>
              {completedUnacknowledgedCount > 0 ? (
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                  {completedUnacknowledgedCount} handled approved action
                  {completedUnacknowledgedCount === 1 ? "" : "s"} still have an open handling request —
                  see <strong>Handled — open handling request</strong> below.
                </p>
              ) : null}
              {awaitingItems.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  No cases awaiting internal triage.
                </p>
              ) : !filingsReady ? (
                <>
                  <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                    Loading proof and filing context for handoff prioritization…
                  </p>
                  <ul className="mt-3 space-y-3">
                    {sortByHandlingRequestedAtDesc(awaitingItems).map((item) =>
                      renderAwaitingHandlingCaseCard(item)
                    )}
                  </ul>
                </>
              ) : (
                <>
                  <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                    Read-only prioritization for operator handoff — not automatic filing,
                    submission, or contact.
                  </p>
                  <div className="mt-3 space-y-5">
                    {awaitingHandoffTiers!.externalReady.length > 0 ? (
                      <div>
                        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                          Ready for external manual action
                          <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                            ({awaitingHandoffTiers!.externalReady.length})
                          </span>
                        </h3>
                        <ul className="mt-2 space-y-3">
                          {awaitingHandoffTiers!.externalReady.map((item) =>
                            renderAwaitingHandlingCaseCard(item)
                          )}
                        </ul>
                      </div>
                    ) : null}
                    {awaitingHandoffTiers!.needsProof.length > 0 ? (
                      <div>
                        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                          Needs saved proof before external action
                          <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                            ({awaitingHandoffTiers!.needsProof.length})
                          </span>
                        </h3>
                        <ul className="mt-2 space-y-3">
                          {awaitingHandoffTiers!.needsProof.map((item) =>
                            renderAwaitingHandlingCaseCard(item)
                          )}
                        </ul>
                      </div>
                    ) : null}
                    {awaitingHandoffTiers!.needsPrep.length > 0 ? (
                      <div>
                        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                          Needs prep before manual review
                          <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                            ({awaitingHandoffTiers!.needsPrep.length})
                          </span>
                        </h3>
                        <ul className="mt-2 space-y-3">
                          {awaitingHandoffTiers!.needsPrep.map((item) =>
                            renderAwaitingHandlingCaseCard(item)
                          )}
                        </ul>
                      </div>
                    ) : null}
                    {awaitingHandoffTiers!.other.length > 0 ? (
                      <div>
                        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                          Other awaiting handling requests
                          <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                            ({awaitingHandoffTiers!.other.length})
                          </span>
                        </h3>
                        <ul className="mt-2 space-y-3">
                          {awaitingHandoffTiers!.other.map((item) =>
                            renderAwaitingHandlingCaseCard(item)
                          )}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
              {completedUnacknowledgedItems.length > 0 ? (
                <div className="mt-6 border-t border-neutral-200/90 pt-5 dark:border-neutral-700">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Handled — open handling request
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                    These cases are not in Awaiting or Saved cases Needs attention. Use Mark
                    acknowledged on each card for internal tracking triage only. Surrenderless has
                    not filed, submitted, or queued anything externally.
                  </p>
                  <ul className="mt-3 space-y-3">
                    {completedUnacknowledgedItems.map((item) => (
                      <HandlingWorkbenchCaseCard
                        key={item.caseRow.id}
                        item={item}
                        isActiveSessionCase={
                          Boolean(sessionCaseId) && sessionCaseId === item.caseRow.id
                        }
                        showMarkAcknowledged
                        compactNavigation
                        handledOpenTriageNoteVariant="inlineAck"
                        acknowledging={acknowledgingHandlingCaseId === item.caseRow.id}
                        onOpenJusticeWorkspace={() => openJusticeWorkspace(item.caseRow)}
                        onOpenPacket={() => openPacket(item.caseRow)}
                        onOpenChat={() => openChat(item.caseRow)}
                        onAcknowledge={() =>
                          void acknowledgeHandlingRequest(item.caseRow, item.next)
                        }
                        markingHandled={
                          markingApprovedPacketHandledCaseId === item.caseRow.id
                        }
                        onRecordActionHandled={() =>
                          void markApprovedPacketActionHandled(item.caseRow, item.next)
                        }
                        onCaseClientStateUpdate={applyApprovedNextActionToCaseRow}
                        savedFilings={filingsByCaseId[item.caseRow.id]}
                        filingsReady={filingsReady}
                        evidenceCount={evidenceCountByCaseId[item.caseRow.id]}
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
                        onOpenJusticeWorkspace={() => openJusticeWorkspace(item.caseRow)}
                        onOpenPacket={() => openPacket(item.caseRow)}
                        onOpenChat={() => openChat(item.caseRow)}
                        onOpenApprovedStep={
                          approvedStepHref
                            ? () => void openApprovedPacketStep(item.caseRow, item.next)
                            : undefined
                        }
                        persistingOpen={
                          persistingApprovedPacketOpenCaseId === item.caseRow.id
                        }
                        markingHandled={
                          markingApprovedPacketHandledCaseId === item.caseRow.id
                        }
                        onRecordActionHandled={() =>
                          void markApprovedPacketActionHandled(item.caseRow, item.next)
                        }
                        onCaseClientStateUpdate={applyApprovedNextActionToCaseRow}
                        savedFilings={filingsByCaseId[item.caseRow.id]}
                        filingsReady={filingsReady}
                        evidenceCount={evidenceCountByCaseId[item.caseRow.id]}
                      />
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="handling-confirmation-follow-up-heading">
              <h2
                id="handling-confirmation-follow-up-heading"
                className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Confirmation follow-up
                {postExternalConfirmationCount > 0 ? (
                  <span className="ml-2 text-base font-normal text-neutral-500 dark:text-neutral-400">
                    ({postExternalConfirmationCount})
                  </span>
                ) : null}
              </h2>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                Read-only tracking after external manual action — not filed or submitted. Filing and
                confirmation writes stay on the case packet.
              </p>
              {!filingsReady ? (
                <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                  Loading filing context for confirmation follow-up…
                </p>
              ) : postExternalConfirmationCount === 0 ? (
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  No handling requests missing manual filing or confirmation after external action yet.
                </p>
              ) : (
                <div className="mt-3 space-y-5">
                  {postExternalConfirmationTiers!.noFilingRecorded.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        Manual filing not recorded yet
                        <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                          ({postExternalConfirmationTiers!.noFilingRecorded.length})
                        </span>
                      </h3>
                      <ul className="mt-2 space-y-3">
                        {postExternalConfirmationTiers!.noFilingRecorded.map((item) =>
                          renderHandlingWorkbenchCaseCard(item, "confirmation-no-filing")
                        )}
                      </ul>
                    </div>
                  ) : null}
                  {postExternalConfirmationTiers!.noConfirmationOnFile.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        Confirmation not on file yet
                        <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                          ({postExternalConfirmationTiers!.noConfirmationOnFile.length})
                        </span>
                      </h3>
                      <ul className="mt-2 space-y-3">
                        {postExternalConfirmationTiers!.noConfirmationOnFile.map((item) =>
                          renderHandlingWorkbenchCaseCard(item, "confirmation-no-confirm")
                        )}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            <section aria-labelledby="handling-outcome-closure-heading">
              <h2
                id="handling-outcome-closure-heading"
                className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Outcome closure
                {outcomeClosureCount > 0 ? (
                  <span className="ml-2 text-base font-normal text-neutral-500 dark:text-neutral-400">
                    ({outcomeClosureCount})
                  </span>
                ) : null}
              </h2>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                Read-only closure tracking — not filed or submitted. Outcome and acknowledgement
                writes stay on existing workbench actions.
              </p>
              {outcomeClosureCount === 0 ? (
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  No handling requests missing outcome recording or acknowledgement yet.
                </p>
              ) : (
                <div className="mt-3 space-y-5">
                  {outcomeClosureTiers.outcomeNotRecorded.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        Outcome not recorded yet
                        <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                          ({outcomeClosureTiers.outcomeNotRecorded.length})
                        </span>
                      </h3>
                      <ul className="mt-2 space-y-3">
                        {outcomeClosureTiers.outcomeNotRecorded.map((item) =>
                          renderHandlingWorkbenchCaseCard(item, "closure-no-outcome")
                        )}
                      </ul>
                    </div>
                  ) : null}
                  {outcomeClosureTiers.handlingNotAcknowledged.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        Handling request not acknowledged yet
                        <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                          ({outcomeClosureTiers.handlingNotAcknowledged.length})
                        </span>
                      </h3>
                      <ul className="mt-2 space-y-3">
                        {outcomeClosureTiers.handlingNotAcknowledged.map((item) =>
                          renderHandlingWorkbenchCaseCard(item, "closure-no-ack")
                        )}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            <section aria-labelledby="handling-follow-up-heading">
              <h2
                id="handling-follow-up-heading"
                className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Follow-up tracking
                {followUpHandlingItems.length > 0 ? (
                  <span className="ml-2 text-base font-normal text-neutral-500 dark:text-neutral-400">
                    ({followUpHandlingItems.length})
                  </span>
                ) : null}
              </h2>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                User-paced follow-up tracking only — not automatic contact.
              </p>
              {followUpHandlingItems.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  No open follow-ups on handling requests yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {followUpHandlingItems.map((item) => {
                    const approvedStepHref = resolveWorkbenchApprovedStepHref(item.next);
                    const showMarkAcknowledgedOnFollowUp =
                      !item.next.handling_acknowledged_at?.trim();
                    return (
                      <HandlingWorkbenchCaseCard
                        key={`follow-up-${item.caseRow.id}`}
                        item={item}
                        isActiveSessionCase={
                          Boolean(sessionCaseId) && sessionCaseId === item.caseRow.id
                        }
                        showMarkAcknowledged={showMarkAcknowledgedOnFollowUp}
                        acknowledging={acknowledgingHandlingCaseId === item.caseRow.id}
                        onOpenJusticeWorkspace={() => openJusticeWorkspace(item.caseRow)}
                        onOpenPacket={() => openPacket(item.caseRow)}
                        onOpenChat={() => openChat(item.caseRow)}
                        onOpenApprovedStep={
                          approvedStepHref
                            ? () => void openApprovedPacketStep(item.caseRow, item.next)
                            : undefined
                        }
                        persistingOpen={
                          persistingApprovedPacketOpenCaseId === item.caseRow.id
                        }
                        onAcknowledge={
                          showMarkAcknowledgedOnFollowUp
                            ? () => void acknowledgeHandlingRequest(item.caseRow, item.next)
                            : undefined
                        }
                        markingHandled={
                          markingApprovedPacketHandledCaseId === item.caseRow.id
                        }
                        onRecordActionHandled={() =>
                          void markApprovedPacketActionHandled(item.caseRow, item.next)
                        }
                        onCaseClientStateUpdate={applyApprovedNextActionToCaseRow}
                        savedFilings={filingsByCaseId[item.caseRow.id]}
                        filingsReady={filingsReady}
                        evidenceCount={evidenceCountByCaseId[item.caseRow.id]}
                      />
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="handling-tracking-complete-heading">
              <h2
                id="handling-tracking-complete-heading"
                className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Tracking complete
                {trackingCompleteHandlingItems && trackingCompleteHandlingItems.length > 0 ? (
                  <span className="ml-2 text-base font-normal text-neutral-500 dark:text-neutral-400">
                    ({trackingCompleteHandlingItems.length})
                  </span>
                ) : null}
              </h2>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
                Read-only — in-app handling tracking caught up for now; not filed or submitted.
                Reopen a case if external follow-up or new action is needed.
              </p>
              {!filingsReady ? (
                <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                  Loading proof and filing context for tracking-complete list…
                </p>
              ) : trackingCompleteHandlingItems!.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  No handling requests with all in-app lifecycle gates satisfied yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {trackingCompleteHandlingItems!.map((item) =>
                    renderHandlingWorkbenchCaseCard(item, "tracking-complete")
                  )}
                </ul>
              )}
            </section>
            </>
            ) : null}
          </div>
        )}
      </main>
    </>
  );
}
