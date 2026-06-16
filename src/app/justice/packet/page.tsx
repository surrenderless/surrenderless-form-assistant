"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { validate as isUuid } from "uuid";
import Header from "@/app/components/Header";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import JusticeCaseTasks from "@/app/components/JusticeCaseTasks";
import JusticeFilingRecords from "@/app/components/JusticeFilingRecords";
import {
  JUSTICE_EVIDENCE_TYPE_LABELS,
  type JusticeCaseEvidenceRow,
  type JusticeEvidenceType,
} from "@/lib/justice/evidence";
import { ApprovedNextActionFollowUpTimingLine } from "@/lib/justice/approvedNextActionFollowUp";
import {
  APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER,
  ApprovedNextActionHandlingHandledOpenTriageNote,
  ApprovedNextActionHandlingQueueStatusReadOnly,
  ApprovedNextActionHandlingRequestBlock,
  ApprovedNextActionHandlingRequestedReadOnly,
  ApprovedNextActionHandlingTrackingContextualLink,
  formatApprovedNextActionHandlingTimestamp,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  acknowledgeHandlingRequestInApprovedNextAction,
  applyHandlingRequestNoteToApprovedNextAction,
  clearFollowUpFromApprovedNextAction,
  hydrateApprovedNextActionForDisplay,
  isApprovedPacketActionWithoutHandlingRequest,
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  parseJusticeCaseClientState,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import {
  buildApprovedNextActionTarget,
  pickPreparedNextAction,
} from "@/lib/justice/preparedNextAction";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import {
  cfpbLikelyRelevant,
  computeJusticeDestinations,
  dotLikelyRelevant,
  fccLikelyRelevant,
  isMerchantResolved,
} from "@/lib/justice/rules";
import type {
  JusticeApprovedNextAction,
  JusticeCaseClientState,
  JusticeIntake,
  TimelineEntry,
  TimelineEntryType,
} from "@/lib/justice/types";
import { STORAGE_FTC_MANUAL_UNLOCK } from "@/lib/justice/types";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import { isBasicCaseInfoReadyForEscalation } from "@/lib/justice/caseReadiness";
import { readTimeline } from "@/lib/justice/timeline";
import { useJusticeActionPageHydration } from "@/lib/justice/useJusticeActionPageHydration";

/** Post-review prepared-packet framing gates (page-local; does not change rules). */
const PREP_OPENED_TYPES: TimelineEntryType[] = [
  "state_ag_prep_opened",
  "bbb_prep_opened",
  "cfpb_prep_opened",
  "fcc_prep_opened",
];

const FILED_COMPLAINT_TYPES: TimelineEntryType[] = [
  "state_ag_complaint_filed",
  "bbb_complaint_filed",
  "cfpb_complaint_filed",
  "fcc_complaint_filed",
];

const packetChecklistLinkCls =
  "inline-flex text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400";

type PreparedPacketReviewExplainerInput = {
  stepLabel: string;
};

function getPreparedPacketReviewExplainer(input: PreparedPacketReviewExplainerInput): string {
  return `When you approve below, Surrenderless marks this packet ready for ${input.stepLabel} — the next in-app step from your reviewed draft. Surrenderless does not file or submit for you.`;
}

type ApprovedPacketNextStepExplainerInput = {
  stepLabel: string;
  started: boolean;
  completed: boolean;
};

function getApprovedPacketNextStepExplainer(input: ApprovedPacketNextStepExplainerInput): string {
  if (input.completed) {
    return `You recorded that your approved next step was handled for now (${input.stepLabel}). This is in-app tracking only — Surrenderless has not filed, submitted, sent, or contacted anyone on your behalf.`;
  }
  if (input.started) {
    return `You opened your approved next in-app step (${input.stepLabel}). Surrenderless has not filed, submitted, sent, or contacted anyone on your behalf. Record handled status with Record action handled for now on the approved next action card below, from chat intake when ready.`;
  }
  return `Your approved in-app step is ${input.stepLabel} — open it below or continue in chat. Nothing is sent automatically.`;
}

async function persistApprovedNextActionClientState(
  caseId: string,
  approvedNext: JusticeApprovedNextAction
): Promise<void> {
  try {
    const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
    if (!getRes.ok) {
      console.warn("justice packet: GET /api/justice/cases/[id] (client_state) failed", getRes.status);
      return;
    }
    const existing = (await getRes.json()) as { client_state?: unknown };
    const merged = mergeClientStateWithApprovedNextAction(existing.client_state, approvedNext);
    const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_state: merged }),
    });
    if (!patchRes.ok) {
      console.warn("justice packet: PATCH /api/justice/cases/[id] (client_state) failed", patchRes.status);
    }
  } catch (e) {
    console.warn("justice packet: PATCH /api/justice/cases/[id] (client_state) error", e);
  }
}

const PACKET_HANDLING_TRACKING_COMPLETE = "Tracking complete for now.";

function packetReadyForManualReview(input: {
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
}): boolean {
  return input.basicsReady && input.draftReviewed && input.preparedPacketApproved;
}

function derivePacketManualActionNextStep(input: {
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
  return PACKET_HANDLING_TRACKING_COMPLETE;
}

function derivePacketHandlingTrackingLine(input: {
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
  evidenceCount: number;
  filings: JusticeCaseFilingRow[];
  next: JusticeApprovedNextAction;
}): string {
  const readyForManualReview = packetReadyForManualReview({
    basicsReady: input.basicsReady,
    draftReviewed: input.draftReviewed,
    preparedPacketApproved: input.preparedPacketApproved,
  });
  const readyForExternalManualAction =
    readyForManualReview && input.evidenceCount > 0;
  const actionOpened = input.next.status === "started" || input.next.status === "completed";
  const hasFilingRecord = input.filings.length > 0;
  const hasConfirmationOnFile = input.filings.some((f) => f.confirmation_number?.trim());
  return derivePacketManualActionNextStep({
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

function PacketHandlingTrackingStatusReadOnly({
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
  const derivedStep = derivePacketHandlingTrackingLine({
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
        surface="packet"
        basicsReady={basicsReady}
        evidenceCount={evidenceCount}
        markAcknowledgedOnScreen={markAcknowledgedOnScreen}
      />
    </>
  );
}

function hasApprovedNextActionTrackingSummary(action: JusticeApprovedNextAction): boolean {
  return Boolean(action.outcome_note?.trim()) || action.follow_up_needed === true;
}

function isoToDateInputValue(iso?: string): string {
  if (!iso?.trim()) return "";
  const d = iso.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

function ApprovedNextActionTrackingSummary({ action }: { action: JusticeApprovedNextAction }) {
  if (!hasApprovedNextActionTrackingSummary(action)) return null;
  return (
    <div className="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-3 py-2 text-xs text-emerald-950 dark:border-emerald-600/40 dark:bg-emerald-950/30 dark:text-emerald-100">
      <p className="font-medium text-emerald-900 dark:text-emerald-50">Tracking note saved</p>
      {action.outcome_note?.trim() ? (
        <p className="mt-1 whitespace-pre-wrap leading-relaxed">{action.outcome_note.trim()}</p>
      ) : null}
      {action.follow_up_needed === true ? (
        <p className="mt-1 text-emerald-800 dark:text-emerald-200">Follow-up needed</p>
      ) : null}
      <ApprovedNextActionFollowUpTimingLine
        followUpAt={action.follow_up_at}
        className="mt-1 text-emerald-800 dark:text-emerald-200"
      />
      {action.follow_up_at?.trim() ? (
        <p className="mt-0.5 text-[11px] text-emerald-800/75 dark:text-emerald-200/75">
          Your chosen date is a tracking aid — move at your own pace.
        </p>
      ) : null}
      <p className="mt-1 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
        In-app tracking only — Surrenderless has not filed, submitted, sent, or contacted anyone.
      </p>
    </div>
  );
}

function ApprovedNextActionOutcomeTrackingForm({
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
      className="mt-3 space-y-2 rounded-lg border border-emerald-400/50 bg-white/70 px-3 py-2.5 dark:border-emerald-600/40 dark:bg-emerald-950/40"
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

function showPreparedActionPacketFraming(intake: JusticeIntake, timeline: TimelineEntry[]): boolean {
  if (isMerchantResolved(intake)) return false;
  if (!timeline.some((e) => e.type === "submission_draft_reviewed")) return false;
  const movedOn =
    timeline.some((e) => PREP_OPENED_TYPES.includes(e.type)) ||
    timeline.some((e) => FILED_COMPLAINT_TYPES.includes(e.type)) ||
    timeline.some((e) => e.type === "ftc_practice_completed");
  return !movedOn;
}

/** Page-local session flags per case (no API / timeline writes). */
const STORAGE_PREPARED_PACKET_APPROVED_V1 = "justice_prepared_packet_approved_v1";

function readPreparedPacketApproved(caseId: string): boolean {
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

function writePreparedPacketApproved(caseId: string): void {
  if (typeof window === "undefined" || !caseId) return;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREPARED_PACKET_APPROVED_V1);
    const map: Record<string, boolean> = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    map[caseId] = true;
    sessionStorage.setItem(STORAGE_PREPARED_PACKET_APPROVED_V1, JSON.stringify(map));
  } catch {
    // ignore corrupt session data
  }
}

function isPreparedPacketApprovedInClientState(raw: unknown): boolean {
  return parseJusticeCaseClientState(raw).prepared_packet_approved === true;
}

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

/** Light background for dark-mode users; @page margin for exported print. */
const PRINT_STYLES = `
@media print {
  @page { margin: 0.6in; }
  html, body {
    background: #fff !important;
  }
}
`;

function formatTimelineTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function desiredResolutionPhrase(category: JusticeIntake["problem_category"]): string {
  switch (category) {
    case "financial_account_issue":
      return "Correction of account errors, improper charges, or clear written explanation of the issue.";
    case "online_purchase":
      return "A full refund or a correct replacement, whichever fairly applies.";
    case "subscription":
      return "Cancellation of unwanted recurring charges and any refund owed for improper renewals.";
    case "service_failed":
      return "A remedy that matches what was promised (refund, redo, or credit).";
    case "charge_dispute":
      return "Reversal of the charge or a clear written justification.";
    case "something_else":
      return "A fair resolution that puts me back to where I should have been.";
    default:
      return "A fair resolution that puts me back to where I should have been.";
  }
}

function evidenceTypeLabel(t: string): string {
  return JUSTICE_EVIDENCE_TYPE_LABELS[t as JusticeEvidenceType] ?? t.replace(/_/g, " ");
}

function formatEvidenceAdded(iso: string): string {
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

function buildPacketPlainText(
  intake: JusticeIntake,
  timeline: TimelineEntry[],
  evidence: JusticeCaseEvidenceRow[],
  filings: JusticeCaseFilingRow[],
  caseId: string
): string {
  const lines: string[] = [
    "JUSTICE CASE PACKET",
    "====================",
    `Generated: ${new Date().toISOString()}`,
    `Case id: ${caseId}`,
    "",
    "CASE SUMMARY",
    "--------------",
    `Company: ${intake.company_name}`,
    `Website: ${intake.company_website.trim() || "—"}`,
    `Issue category: ${intake.problem_category.replace(/_/g, " ")}`,
    `Product / service: ${intake.purchase_or_signup.trim() || "—"}`,
    `Money involved: ${intake.money_involved}`,
    `Order or problem date: ${intake.pay_or_order_date}`,
    intake.order_confirmation_details.trim()
      ? `Order / confirmation details: ${intake.order_confirmation_details.trim()}`
      : "",
    `Consumer name: ${intake.user_display_name}`,
    `Reply email: ${intake.reply_email}`,
    intake.consumer_us_state?.trim()
      ? `Consumer state (if noted): ${intake.consumer_us_state.trim().toUpperCase()}`
      : "",
    `Already contacted company: ${intake.already_contacted}`,
    intake.already_contacted === "yes" && intake.contact_method
      ? `Contact method: ${intake.contact_method.replace(/_/g, " ")}`
      : "",
    intake.contact_date ? `Contact date: ${intake.contact_date}` : "",
    intake.merchant_response_type
      ? `Their response (as recorded): ${intake.merchant_response_type.replace(/_/g, " ")}`
      : "",
    "",
    "WHAT HAPPENED",
    "---------------",
    intake.story.trim(),
    "",
    "REQUESTED RESOLUTION",
    "--------------------",
    desiredResolutionPhrase(intake.problem_category),
    "",
    "TIMELINE",
    "--------",
  ];

  const sorted = [...timeline].sort((a, b) => a.ts.localeCompare(b.ts));
  if (sorted.length === 0) {
    lines.push("(No timeline events yet.)");
  } else {
    for (const row of sorted) {
      const when = formatTimelineTs(row.ts);
      const detail = row.detail?.trim();
      lines.push(`- ${when} — ${row.label}${detail ? ` — ${detail}` : ""}`);
    }
  }

  lines.push("", "SAVED EVIDENCE (notes)", "----------------------");
  if (evidence.length === 0) {
    lines.push("(No saved evidence records yet.)");
  } else {
    evidence.forEach((row, i) => {
      lines.push(
        `${i + 1}. ${row.title}`,
        `   Type: ${evidenceTypeLabel(row.evidence_type)}`,
        row.evidence_date ? `   Date: ${row.evidence_date}` : "",
        row.description?.trim() ? `   Description: ${row.description.trim()}` : "",
        row.source_url?.trim() ? `   Source URL: ${row.source_url.trim()}` : "",
        row.storage_note?.trim() ? `   Storage: ${row.storage_note.trim()}` : "",
        `   Recorded: ${formatEvidenceAdded(row.created_at)}`,
        ""
      );
    });
  }

  lines.push("", "FILING RECORDS", "---------------");
  if (filings.length === 0) {
    lines.push("(No filing records yet.)");
  } else {
    filings.forEach((row, i) => {
      lines.push(
        `${i + 1}. ${row.destination}`,
        row.filed_at ? `   Filed at: ${row.filed_at}` : "",
        row.confirmation_number ? `   Confirmation: ${row.confirmation_number}` : "",
        row.filing_url ? `   URL: ${row.filing_url}` : "",
        row.notes?.trim() ? `   Notes: ${row.notes.trim()}` : "",
        `   Recorded: ${formatEvidenceAdded(row.created_at)}`,
        ""
      );
    });
  }

  lines.push("---", "End of packet");
  return lines.filter(Boolean).join("\n").trim();
}

export default function JusticePacketPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const { status: hydrationStatus, intake } = useJusticeActionPageHydration();
  const [caseId, setCaseId] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [evidence, setEvidence] = useState<JusticeCaseEvidenceRow[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState(false);
  const [filings, setFilings] = useState<JusticeCaseFilingRow[]>([]);
  const [filingsLoading, setFilingsLoading] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [timelineTick, setTimelineTick] = useState(0);
  const [packetApproved, setPacketApproved] = useState(false);
  const [approvedNextAction, setApprovedNextAction] = useState<JusticeApprovedNextAction | undefined>(
    undefined
  );
  const [approveChecked, setApproveChecked] = useState(false);
  const [clearingFollowUp, setClearingFollowUp] = useState(false);
  const [requestingHandling, setRequestingHandling] = useState(false);
  const [updatingHandlingNote, setUpdatingHandlingNote] = useState(false);
  const [acknowledgingHandling, setAcknowledgingHandling] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? "");
    setSessionReady(true);
    const t0 = window.setTimeout(() => setCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? ""), 0);
    const t1 = window.setTimeout(() => setCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? ""), 200);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [hydrationStatus, intake]);

  const timeline = useMemo(() => {
    if (!caseId) return [];
    return readTimeline(caseId);
  }, [caseId, intake, hydrationStatus]);

  const loadEvidence = useCallback(async () => {
    const cid = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) ?? "" : "";
    if (!cid || !isLoaded || !isSignedIn) {
      setEvidence([]);
      return;
    }
    setEvidenceLoading(true);
    setEvidenceError(false);
    try {
      const res = await fetch(`/api/justice/evidence?case_id=${encodeURIComponent(cid)}`);
      if (!res.ok) {
        setEvidenceError(true);
        setEvidence([]);
        return;
      }
      const data = (await res.json()) as JusticeCaseEvidenceRow[];
      setEvidence(Array.isArray(data) ? data : []);
    } catch {
      setEvidenceError(true);
      setEvidence([]);
    } finally {
      setEvidenceLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  const loadFilings = useCallback(async () => {
    const cid = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) ?? "" : "";
    if (!cid || !isLoaded || !isSignedIn) {
      setFilings([]);
      setFilingsLoading(false);
      return;
    }
    setFilingsLoading(true);
    try {
      const res = await fetch(`/api/justice/filings?case_id=${encodeURIComponent(cid)}`);
      if (!res.ok) {
        setFilings([]);
        return;
      }
      const data = (await res.json()) as JusticeCaseFilingRow[];
      setFilings(Array.isArray(data) ? data : []);
    } catch {
      setFilings([]);
    } finally {
      setFilingsLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (hydrationStatus !== "ready" || !intake || !isLoaded || !isSignedIn) return;
    const cid = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    if (!cid) return;
    void Promise.all([loadEvidence(), loadFilings()]);
  }, [hydrationStatus, intake, isLoaded, isSignedIn, loadEvidence, loadFilings, caseId]);

  useEffect(() => {
    if (!caseId) {
      setPacketApproved(false);
      setApprovedNextAction(undefined);
      setApproveChecked(false);
      return;
    }
    const sessionApproved = readPreparedPacketApproved(caseId);
    const sessionNextAction = hydrateApprovedNextActionForDisplay(caseId);
    if (!isLoaded || !isSignedIn || !isUuid(caseId)) {
      setPacketApproved(sessionApproved);
      setApprovedNextAction(sessionNextAction);
      return;
    }

    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
          signal: ac.signal,
        });
        if (!res.ok) {
          if (!ac.signal.aborted) {
            setPacketApproved(sessionApproved);
            setApprovedNextAction(sessionNextAction);
          }
          return;
        }
        const data = (await res.json()) as { client_state?: unknown };
        if (ac.signal.aborted) return;
        const parsed = parseJusticeCaseClientState(data.client_state);
        const serverApproved = parsed.prepared_packet_approved === true;
        if (serverApproved) writePreparedPacketApproved(caseId);
        const hydrated =
          hydrateApprovedNextActionForDisplay(caseId, data.client_state) ?? sessionNextAction;
        if (hydrated) writeSessionApprovedNextAction(caseId, hydrated);
        setPacketApproved(sessionApproved || serverApproved);
        setApprovedNextAction(hydrated);
      } catch {
        if (!ac.signal.aborted) {
          setPacketApproved(sessionApproved);
          setApprovedNextAction(sessionNextAction);
        }
      }
    })();

    return () => ac.abort();
  }, [caseId, hydrationStatus, isLoaded, isSignedIn]);

  const packetText = useMemo(() => {
    if (!intake || !caseId) return "";
    return buildPacketPlainText(intake, timeline, evidence, filings, caseId);
  }, [intake, timeline, evidence, filings, caseId]);

  async function copyPacket() {
    if (!packetText) return;
    try {
      await navigator.clipboard.writeText(packetText);
      setCopyHint("Copied to clipboard.");
      window.setTimeout(() => setCopyHint(null), 2500);
    } catch {
      setCopyHint("Copy failed — select the text and copy manually.");
    }
  }

  function downloadPacket() {
    if (!packetText || !caseId) return;
    const blob = new Blob([packetText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `justice-case-packet-${caseId}.txt`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function printPacket() {
    window.print();
  }

  if (hydrationStatus === "needs_sign_in") {
    return <JusticeActionResumeSignInPrompt />;
  }

  if (!sessionReady || hydrationStatus === "loading" || hydrationStatus === "redirecting") {
    return (
      <>
        <Header />
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
          Loading…
        </main>
      </>
    );
  }

  if (hydrationStatus !== "ready" || !intake) {
    return (
      <>
        <Header />
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
          Loading…
        </main>
      </>
    );
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-lg px-4 py-8">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Sign in to view your case packet.</p>
          <Link href="/justice/cases" className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline">
            Saved cases
          </Link>
        </main>
      </>
    );
  }

  if (!caseId) {
    return (
      <>
        <Header />
        <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            <Link href="/justice/chat-ai" className="text-blue-600 hover:underline dark:text-blue-400">
              Update in chat
            </Link>
            {" · "}
            <Link href="/justice" className="text-blue-600 hover:underline dark:text-blue-400">
              Justice workspace
            </Link>
            {" · "}
            <Link href="/justice/evidence" className="text-blue-600 hover:underline dark:text-blue-400">
              Evidence
            </Link>
            {" · "}
            <Link href="/justice/cases" className="text-blue-600 hover:underline dark:text-blue-400">
              Saved cases
            </Link>
          </p>
          <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Case packet</h1>
          <div className={`mt-6 ${cardCls}`}>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              No active case id in this browser. Open a saved case from your list, then return here.
            </p>
            <Link
              href="/justice/cases"
              className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-blue-700"
            >
              Saved cases
            </Link>
          </div>
        </main>
      </>
    );
  }

  const resolution = desiredResolutionPhrase(intake.problem_category);
  const showPreparedActionFraming = showPreparedActionPacketFraming(intake, timeline);
  const approvedNextActionCompleted = approvedNextAction?.status === "completed";
  const approvedNextActionStarted = approvedNextAction?.status === "started";
  const showApprovedPacketExplainer =
    showPreparedActionFraming && packetApproved && Boolean(approvedNextAction?.label);

  const showPreparedReviewExplainer = showPreparedActionFraming && !packetApproved;
  let preparedNextAction: ReturnType<typeof pickPreparedNextAction> | null = null;
  let basicsReady = false;
  let evidenceReady = false;
  let draftReviewed = false;
  let readyToEscalate = false;

  if (showPreparedReviewExplainer) {
    const manualFtc =
      typeof window !== "undefined" && sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
    const contacted = intake.already_contacted === "yes";
    const cfpbRel = cfpbLikelyRelevant(intake);
    const fccRel = fccLikelyRelevant(intake);
    const dotRel = dotLikelyRelevant(intake);
    const useCompanyContactLabels = cfpbRel || fccRel || dotRel;
    const destinations = computeJusticeDestinations(intake, { manualFtc, useCompanyContactLabels });
    preparedNextAction = pickPreparedNextAction({ contacted, useCompanyContactLabels, destinations });
    basicsReady = isBasicCaseInfoReadyForEscalation(intake);
    evidenceReady = evidence.length >= 1;
    draftReviewed = timeline.some((e) => e.type === "submission_draft_reviewed");
    readyToEscalate = basicsReady && evidenceReady;
  }

  const handlingTrackingBasicsReady = isBasicCaseInfoReadyForEscalation(intake);
  const handlingTrackingDraftReviewed = timeline.some((e) => e.type === "submission_draft_reviewed");
  const packetHandlingReadinessLoading = isSignedIn && (evidenceLoading || filingsLoading);

  async function persistApprovedNextAction(
    next: JusticeApprovedNextAction,
    mergeApprovedNext?: JusticeApprovedNextAction
  ) {
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, next);
    if (caseId) writeSessionApprovedNextAction(caseId, withTracking);
    setApprovedNextAction(withTracking);
    if (isLoaded && isSignedIn && caseId && isUuid(caseId)) {
      await persistApprovedNextActionClientState(caseId, mergeApprovedNext ?? withTracking);
    }
  }

  async function handleClearApprovedNextActionFollowUp() {
    if (!approvedNextAction || approvedNextAction.status !== "completed") return;
    if (approvedNextAction.follow_up_needed !== true) return;

    setClearingFollowUp(true);
    try {
      const cleared = clearFollowUpFromApprovedNextAction(approvedNextAction);
      await persistApprovedNextAction(cleared);
    } finally {
      setClearingFollowUp(false);
    }
  }

  async function handleSaveApprovedNextActionTracking(draft: {
    outcome_note: string;
    follow_up_needed: boolean;
    follow_up_at: string;
  }) {
    if (!approvedNextAction || approvedNextAction.status !== "completed") return;
    const trimmedNote = draft.outcome_note.trim();
    const next: JusticeApprovedNextAction = { ...approvedNextAction };
    if (trimmedNote) next.outcome_note = trimmedNote;
    else delete next.outcome_note;
    if (draft.follow_up_needed) {
      next.follow_up_needed = true;
      if (draft.follow_up_at.trim()) {
        next.follow_up_at = new Date(`${draft.follow_up_at}T12:00:00`).toISOString();
      } else {
        delete next.follow_up_at;
      }
    } else {
      delete next.follow_up_needed;
      delete next.follow_up_at;
    }
    await persistApprovedNextAction(next);
  }

  async function handleMarkApprovedNextActionHandled() {
    if (!approvedNextAction || approvedNextAction.status !== "started") return;
    const next: JusticeApprovedNextAction = {
      ...approvedNextAction,
      status: "completed",
      completed_at: new Date().toISOString(),
    };
    await persistApprovedNextAction(next);
  }

  async function handleRequestSurrenderlessHandling(note?: string) {
    if (!approvedNextAction || approvedNextAction.status === "completed") return;
    if (approvedNextAction.handling_requested_at?.trim()) return;
    setRequestingHandling(true);
    try {
      const next: JusticeApprovedNextAction = {
        ...approvedNextAction,
        handling_requested_at: new Date().toISOString(),
        ...(note ? { handling_request_note: note } : {}),
      };
      await persistApprovedNextAction(next);
    } finally {
      setRequestingHandling(false);
    }
  }

  async function handleUpdateHandlingRequestNote(note?: string) {
    if (!approvedNextAction?.handling_requested_at?.trim()) return;
    setUpdatingHandlingNote(true);
    try {
      const withNoteUpdate = applyHandlingRequestNoteToApprovedNextAction(
        approvedNextAction,
        note ?? ""
      );
      await persistApprovedNextAction(
        omitClearedHandlingRequestNoteFromApprovedNextAction(withNoteUpdate),
        withNoteUpdate
      );
    } finally {
      setUpdatingHandlingNote(false);
    }
  }

  async function handleAcknowledgeHandlingRequest() {
    if (!approvedNextAction?.handling_requested_at?.trim()) return;
    if (approvedNextAction.handling_acknowledged_at?.trim()) return;
    setAcknowledgingHandling(true);
    try {
      const acknowledged = acknowledgeHandlingRequestInApprovedNextAction(approvedNextAction);
      await persistApprovedNextAction(acknowledged, acknowledged);
    } finally {
      setAcknowledgingHandling(false);
    }
  }

  async function handleApprovedNextActionOpen(href: string) {
    if (approvedNextActionCompleted) {
      router.push(href || approvedNextAction?.href || "/justice/packet");
      return;
    }
    const label = approvedNextAction?.label;
    const targetHref = href || approvedNextAction?.href || "/justice/packet";
    const next: JusticeApprovedNextAction = {
      ...(approvedNextAction ?? {}),
      ...(label ? { label } : {}),
      href: approvedNextAction?.href ?? targetHref,
      status: "started",
      started_at: approvedNextAction?.started_at ?? new Date().toISOString(),
      ...(approvedNextAction?.approved_at ? { approved_at: approvedNextAction.approved_at } : {}),
    };

    if (caseId) {
      try {
        const raw = sessionStorage.getItem(STORAGE_PREPARED_PACKET_APPROVED_V1);
        const map: Record<string, boolean> = raw
          ? (JSON.parse(raw) as Record<string, boolean>)
          : {};
        map[caseId] = true;
        sessionStorage.setItem(STORAGE_PREPARED_PACKET_APPROVED_V1, JSON.stringify(map));
      } catch {
        // ignore corrupt session data
      }
    }

    await persistApprovedNextAction(next);
    router.push(targetHref);
  }

  async function handleApprovePreparedPacket() {
    if (!caseId || !approveChecked || !intake) return;

    const manualFtc =
      typeof window !== "undefined" && sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
    const contacted = intake.already_contacted === "yes";
    const cfpbRel = cfpbLikelyRelevant(intake);
    const fccRel = fccLikelyRelevant(intake);
    const dotRel = dotLikelyRelevant(intake);
    const useCompanyContactLabels = cfpbRel || fccRel || dotRel;
    const destinations = computeJusticeDestinations(intake, { manualFtc, useCompanyContactLabels });
    const prepared = pickPreparedNextAction({ contacted, useCompanyContactLabels, destinations });
    const nextActionTarget = buildApprovedNextActionTarget(prepared);
    const withTracking = mergeApprovedNextActionTrackingFields(
      approvedNextAction,
      nextActionTarget
    );

    writePreparedPacketApproved(caseId);
    writeSessionApprovedNextAction(caseId, withTracking);
    setPacketApproved(true);
    setApprovedNextAction(withTracking);

    if (caseId && (!isSignedIn || !isUuid(caseId))) {
      router.push("/justice/chat-ai");
      return;
    }

    if (!isLoaded || !isSignedIn || !isUuid(caseId)) return;

    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice packet: GET /api/justice/cases/[id] (client_state) failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged: JusticeCaseClientState = {
        ...parseJusticeCaseClientState(existing.client_state),
        prepared_packet_approved: true,
        approved_next_action: withTracking,
      };
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice packet: PATCH /api/justice/cases/[id] (client_state) failed", patchRes.status);
        return;
      }
      router.push("/justice/chat-ai");
    } catch (e) {
      console.warn("justice packet: PATCH /api/justice/cases/[id] (client_state) error", e);
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <div className="print:hidden">
        <Header />
        <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-2xl bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            <Link href="/justice/chat-ai" className="text-blue-600 hover:underline dark:text-blue-400">
              Update in chat
            </Link>
            {" · "}
            <Link href="/justice" className="text-blue-600 hover:underline dark:text-blue-400">
              Justice workspace
            </Link>
            {" · "}
            <Link href="/justice/evidence" className="text-blue-600 hover:underline dark:text-blue-400">
              Evidence
            </Link>
            {" · "}
            <Link href="/justice/cases" className="text-blue-600 hover:underline dark:text-blue-400">
              Saved cases
            </Link>
          </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Case packet</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {showPreparedActionFraming
            ? "Prepared in-app review of your case: summary, timeline, evidence notes, and filing records in one place."
            : "One copy-ready bundle: summary, resolution, timeline, evidence notes, and filing records."}
        </p>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Case id: {caseId}</p>

        {showPreparedActionFraming ? (
          <>
          <div
            className="mt-4 rounded-xl border border-emerald-200/90 bg-emerald-50/80 px-4 py-4 text-sm shadow-sm ring-1 ring-emerald-950/[0.05] dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:ring-emerald-400/10"
            role="status"
            aria-label={
              showApprovedPacketExplainer ? "Approved case packet" : "Prepared action review packet"
            }
          >
            <p className="font-semibold text-emerald-950 dark:text-emerald-100">
              {showApprovedPacketExplainer ? "Your approved case packet" : "Your prepared action review"}
            </p>
            {showApprovedPacketExplainer && approvedNextAction?.label ? (
              <>
                <p className="mt-2 leading-relaxed text-emerald-900/95 dark:text-emerald-100/95">
                  Surrenderless assembled this packet from your reviewed submission draft. Your case summary,
                  timeline, evidence notes, and filing records stay below for reference — in-app tracking only; nothing
                  has been filed automatically, and Surrenderless has not submitted, filed, or contacted anyone on your
                  behalf.
                </p>
                <p
                  className="mt-2 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/90"
                  aria-label={getApprovedPacketNextStepExplainer({
                    stepLabel: approvedNextAction.label,
                    started: approvedNextActionStarted,
                    completed: approvedNextActionCompleted,
                  })}
                >
                  {approvedNextActionCompleted ? (
                    <>
                      You recorded that your approved next step was handled for now (
                      <strong>{approvedNextAction.label}</strong>
                      ). This is in-app tracking only — Surrenderless has not filed, submitted, sent, or contacted
                      anyone on your behalf.
                    </>
                  ) : approvedNextActionStarted ? (
                    <>
                      You opened your approved next in-app step (
                      <strong>{approvedNextAction.label}</strong>
                      ). Surrenderless has not filed, submitted, sent, or contacted anyone on your behalf. Record handled
                      status with Record action handled for now on the approved next action card below, from chat intake when ready.
                    </>
                  ) : (
                    <>
                      Your approved in-app step is <strong>{approvedNextAction.label}</strong> — open it below or
                      continue in chat. Nothing is sent automatically.
                    </>
                  )}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                  Need to fix details or add proof notes?{" "}
                  <Link
                    href="/justice/chat-ai"
                    className="font-medium text-emerald-900 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-100 dark:hover:text-emerald-50"
                  >
                    Update in chat
                  </Link>
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 leading-relaxed text-emerald-900/95 dark:text-emerald-100/95">
                  Surrenderless assembled this packet from your reviewed submission draft so you can confirm your case
                  details, proof, and records before your next step. This is in-app preparation and review — nothing has
                  been filed automatically, and Surrenderless has not submitted, filed, or contacted anyone on your
                  behalf.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                  When you complete an external filing yourself, record confirmations in the filing section below.
                  Surrenderless does not submit or queue government complaints for you yet.
                </p>
                {!packetApproved && preparedNextAction ? (
                  <>
                    <p className="mt-2 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                      When you approve below, Surrenderless marks this packet ready for{" "}
                      <strong>{preparedNextAction.stepLabel}</strong>
                      {" "}
                      — the next in-app step from your reviewed draft. Surrenderless does not file or submit for you.
                    </p>
                    {isSignedIn && !readyToEscalate ? (
                      <p className="mt-2 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                        Before you approve, finish readiness:{" "}
                        {!basicsReady ? (
                          <Link href="/justice/chat-ai" className={packetChecklistLinkCls}>
                            Update in chat
                          </Link>
                        ) : null}
                        {!basicsReady && !evidenceReady ? (
                          <span className="text-emerald-800/70 dark:text-emerald-200/70"> · </span>
                        ) : null}
                        {!evidenceReady ? (
                          <Link href="/justice/chat-ai" className={packetChecklistLinkCls}>
                            Add proof in chat
                          </Link>
                        ) : null}
                        {(!basicsReady || !evidenceReady) && !draftReviewed ? (
                          <span className="text-emerald-800/70 dark:text-emerald-200/70"> · </span>
                        ) : null}
                        {!draftReviewed ? (
                          <Link href="/justice/preview" className={packetChecklistLinkCls}>
                            Review submission draft
                          </Link>
                        ) : null}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                      Need to fix details or add proof notes?{" "}
                      <Link
                        href="/justice/chat-ai"
                        className="font-medium text-emerald-900 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-100 dark:hover:text-emerald-50"
                      >
                        Update in chat
                      </Link>
                    </p>
                  </>
                ) : null}
              </>
            )}
            <Link
              href="/justice/chat-ai"
              className="mt-3 inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
            >
              Continue in chat
            </Link>
          </div>
          {packetApproved && approvedNextAction ? (
            <>
              {approvedNextAction.handling_requested_at?.trim() ? (
                approvedNextAction.status === "completed" ? (
                  <ApprovedNextActionHandlingRequestedReadOnly
                    requestedAt={approvedNextAction.handling_requested_at.trim()}
                    requestNote={approvedNextAction.handling_request_note}
                    acknowledgedAt={approvedNextAction.handling_acknowledged_at}
                  />
                ) : (
                  <ApprovedNextActionHandlingRequestBlock
                    action={approvedNextAction}
                    acknowledgedAt={approvedNextAction.handling_acknowledged_at}
                    onRequest={handleRequestSurrenderlessHandling}
                    onUpdateNote={handleUpdateHandlingRequestNote}
                    allowEditNote
                    requesting={requestingHandling}
                    updatingNote={updatingHandlingNote}
                  />
                )
              ) : approvedNextAction.status !== "completed" ? (
                <ApprovedNextActionHandlingRequestBlock
                  action={approvedNextAction}
                  onRequest={handleRequestSurrenderlessHandling}
                  onUpdateNote={handleUpdateHandlingRequestNote}
                  allowEditNote
                  requesting={requestingHandling}
                  updatingNote={updatingHandlingNote}
                />
              ) : null}
              {approvedNextAction.handling_requested_at?.trim() ? (
                <>
                  <ApprovedNextActionHandlingQueueStatusReadOnly
                    handlingRequestedAt={approvedNextAction.handling_requested_at.trim()}
                    handlingAcknowledgedAt={approvedNextAction.handling_acknowledged_at}
                    className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90"
                  />
                  <PacketHandlingTrackingStatusReadOnly
                    readinessLoading={packetHandlingReadinessLoading}
                    approvedNextAction={approvedNextAction}
                    basicsReady={handlingTrackingBasicsReady}
                    draftReviewed={handlingTrackingDraftReviewed}
                    preparedPacketApproved={packetApproved}
                    evidenceCount={evidence.length}
                    filings={filings}
                    markAcknowledgedOnScreen={!approvedNextAction.handling_acknowledged_at?.trim()}
                  />
                  {approvedNextAction.status === "completed" &&
                  !approvedNextAction.handling_acknowledged_at?.trim() ? (
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
                  {!approvedNextAction.handling_acknowledged_at?.trim() ? (
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
              ) : (
                <PacketHandlingTrackingStatusReadOnly
                  readinessLoading={packetHandlingReadinessLoading}
                  approvedNextAction={approvedNextAction}
                  basicsReady={handlingTrackingBasicsReady}
                  draftReviewed={handlingTrackingDraftReviewed}
                  preparedPacketApproved={packetApproved}
                  evidenceCount={evidence.length}
                  filings={filings}
                  markAcknowledgedOnScreen={false}
                />
              )}
            </>
          ) : approvedNextAction?.handling_requested_at?.trim() ? (
            <>
              <ApprovedNextActionHandlingRequestedReadOnly
                requestedAt={approvedNextAction.handling_requested_at.trim()}
                requestNote={approvedNextAction.handling_request_note}
                acknowledgedAt={approvedNextAction.handling_acknowledged_at}
              />
              <ApprovedNextActionHandlingQueueStatusReadOnly
                handlingRequestedAt={approvedNextAction.handling_requested_at.trim()}
                handlingAcknowledgedAt={approvedNextAction.handling_acknowledged_at}
                className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90"
              />
              <PacketHandlingTrackingStatusReadOnly
                readinessLoading={packetHandlingReadinessLoading}
                approvedNextAction={approvedNextAction}
                basicsReady={handlingTrackingBasicsReady}
                draftReviewed={handlingTrackingDraftReviewed}
                preparedPacketApproved={packetApproved}
                evidenceCount={evidence.length}
                filings={filings}
              />
              {approvedNextActionCompleted &&
              !approvedNextAction.handling_acknowledged_at?.trim() ? (
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
          {packetApproved ? (
              <div
                className="mt-3 rounded-xl border border-emerald-300/80 bg-emerald-50/90 px-4 py-3 text-sm ring-1 ring-emerald-600/15 dark:border-emerald-700/80 dark:bg-emerald-950/40 dark:ring-emerald-400/15"
                role="status"
              >
                <p className="font-semibold text-emerald-950 dark:text-emerald-100">
                  {approvedNextActionCompleted
                    ? "Next action recorded as handled"
                    : approvedNextActionStarted
                      ? "Next action started"
                      : "Packet approved for next action"}
                </p>
                <p className="mt-1.5 text-emerald-900/90 dark:text-emerald-100/90">
                  {approvedNextActionCompleted ? (
                    <>
                      You recorded that your approved next step was handled for now
                      {approvedNextAction?.label ? (
                        <>
                          {" "}
                          (<strong>{approvedNextAction.label}</strong>)
                        </>
                      ) : null}
                      . This is in-app tracking only — Surrenderless has not filed, submitted, sent, or contacted
                      anyone on your behalf.
                    </>
                  ) : approvedNextActionStarted ? (
                    <>
                      You opened your approved next in-app step
                      {approvedNextAction?.label ? (
                        <>
                          {" "}
                          (<strong>{approvedNextAction.label}</strong>)
                        </>
                      ) : null}
                      . Surrenderless has not filed, submitted, sent, or contacted anyone on your behalf. Use Record
                      action handled for now when ready.
                    </>
                  ) : (
                    <>
                      You reviewed this prepared packet
                      {approvedNextAction?.label ? (
                        <>
                          {" "}
                          for <strong>{approvedNextAction.label}</strong>
                        </>
                      ) : null}
                      . Surrenderless has not filed, submitted, sent, or contacted anyone on your behalf. Continue in
                      chat when you are ready for the next in-app step.
                    </>
                  )}
                </p>
                {approvedNextActionCompleted && approvedNextAction?.completed_at?.trim() ? (
                  <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                    Handled for now{" "}
                    {formatApprovedNextActionHandlingTimestamp(
                      approvedNextAction.completed_at.trim()
                    )}
                  </p>
                ) : null}
                {approvedNextActionStarted ? (
                  <>
                    <p className="mt-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                      Opened for next step.
                    </p>
                    {approvedNextAction?.started_at?.trim() ? (
                      <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                        Opened{" "}
                        {formatApprovedNextActionHandlingTimestamp(
                          approvedNextAction.started_at.trim()
                        )}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleMarkApprovedNextActionHandled()}
                      className="mt-2 inline-flex rounded-lg border border-emerald-400/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-600/60 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
                    >
                      Record action handled for now
                    </button>
                    <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                      Tracking only — not automatic filing or submission.
                    </p>
                  </>
                ) : null}
                {packetApproved && approvedNextActionCompleted && approvedNextAction ? (
                  <>
                    <ApprovedNextActionTrackingSummary action={approvedNextAction} />
                    <ApprovedNextActionOutcomeTrackingForm
                      action={approvedNextAction}
                      onSave={handleSaveApprovedNextActionTracking}
                    />
                    {approvedNextAction.follow_up_needed === true ? (
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        <button
                          type="button"
                          disabled={clearingFollowUp}
                          onClick={() => void handleClearApprovedNextActionFollowUp()}
                          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          {clearingFollowUp ? "Saving…" : "Mark follow-up handled"}
                        </button>
                        <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80 sm:max-w-[14rem]">
                          Clears this from Needs attention on Saved cases. Your outcome note and dates stay saved. Not automatic filing or submission.
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {!approvedNextActionStarted &&
                !approvedNextActionCompleted &&
                approvedNextAction?.href &&
                approvedNextAction.label ? (
                  <>
                    <p className="mt-2 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                      Opens your in-app {approvedNextAction.label} preparation for tracking — nothing is filed or sent
                      automatically.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleApprovedNextActionOpen(approvedNextAction.href!)}
                      className="mt-2 inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                    >
                      Open {approvedNextAction.label}
                    </button>
                  </>
                ) : (approvedNextActionStarted || approvedNextActionCompleted) &&
                  approvedNextAction?.href &&
                  approvedNextAction.label ? (
                  <Link
                    href={approvedNextAction.href}
                    className="mt-2 inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                  >
                    Open {approvedNextAction.label}
                  </Link>
                ) : null}
                {isApprovedPacketActionWithoutHandlingRequest({
                  prepared_packet_approved: packetApproved,
                  approved_next_action: approvedNextAction,
                }) ? (
                  <>
                    <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80 dark:text-emerald-200/80">
                      Approved case packet and next in-app step — not a Surrenderless handling request.
                      Request Surrenderless handling from chat intake when you want internal triage tracking.
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
                <Link
                  href="/justice/chat-ai"
                  className={`${approvedNextAction?.href ? "mt-2 ml-4" : "mt-2"} inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100`}
                >
                  Continue in chat
                </Link>
              </div>
            ) : (
              <div
                className={`mt-3 ${cardCls}`}
                aria-labelledby="packet-approve-heading"
              >
                <h2
                  id="packet-approve-heading"
                  className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
                >
                  Approve for next action
                </h2>
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  Review the case summary, timeline, evidence, and filing records below. When this packet looks right,
                  approve it so Surrenderless can treat it as ready for your next in-app step — nothing is filed or sent
                  automatically.
                </p>
                <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-neutral-800 dark:text-neutral-200">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                    checked={approveChecked}
                    onChange={(e) => setApproveChecked(e.target.checked)}
                  />
                  <span>I reviewed this prepared packet</span>
                </label>
                <button
                  type="button"
                  disabled={!approveChecked}
                  onClick={() => void handleApprovePreparedPacket()}
                  className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  Approve prepared packet for next action
                </button>
              </div>
            )}
          </>
        ) : null}

        <section className={`mt-6 ${cardCls}`} aria-labelledby="packet-summary">
          <h2 id="packet-summary" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Case summary
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-neutral-800 dark:text-neutral-200">
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Company:</span> {intake.company_name}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Website:</span>{" "}
              {intake.company_website.trim() || "—"}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Issue:</span>{" "}
              {intake.problem_category.replace(/_/g, " ")}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Product / service:</span>{" "}
              {intake.purchase_or_signup.trim() || "—"}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Money:</span> {intake.money_involved}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Date:</span> {intake.pay_or_order_date}
            </li>
          </ul>
        </section>

        <section className={`mt-5 ${cardCls}`} aria-labelledby="packet-resolution">
          <h2 id="packet-resolution" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Requested resolution
          </h2>
          <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{resolution}</p>
        </section>

        <section className={`mt-5 ${cardCls}`} aria-labelledby="packet-timeline">
          <h2 id="packet-timeline" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Timeline
          </h2>
          {timeline.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">No timeline events yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {[...timeline]
                .sort((a, b) => a.ts.localeCompare(b.ts))
                .map((row) => (
                  <li key={row.id} className="text-sm text-neutral-800 dark:text-neutral-200">
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatTimelineTs(row.ts)}</span>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{row.label}</p>
                    {row.detail ? (
                      <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">{row.detail}</p>
                    ) : null}
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className={`mt-5 ${cardCls}`} aria-labelledby="packet-evidence">
          <h2 id="packet-evidence" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Saved evidence
          </h2>
          {evidenceLoading ? (
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Loading evidence…</p>
          ) : evidenceError ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">Could not load evidence.</p>
          ) : evidence.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              No evidence saved yet.{" "}
              <Link href="/justice/evidence" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                Add evidence
              </Link>
            </p>
          ) : (
            <ul className="mt-3 space-y-4">
              {evidence.map((row) => (
                <li key={row.id} className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0 dark:border-neutral-700/80">
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">{row.title}</p>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{evidenceTypeLabel(row.evidence_type)}</p>
                  {row.evidence_date ? (
                    <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{row.evidence_date}</p>
                  ) : null}
                  {row.description?.trim() ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                      {row.description.trim()}
                    </p>
                  ) : null}
                  {row.source_url?.trim() ? (
                    <p className="mt-1 text-xs break-all text-blue-600 dark:text-blue-400">
                      <a href={row.source_url.trim()} target="_blank" rel="noopener noreferrer" className="underline">
                        {row.source_url.trim()}
                      </a>
                    </p>
                  ) : null}
                  {row.storage_note?.trim() ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">Stored: </span>
                      {row.storage_note.trim()}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div id="packet-filings">
          <JusticeFilingRecords onFilingsChange={() => void loadFilings()} />
        </div>

        <JusticeCaseTasks onCaseTimelineSynced={() => setTimelineTick((n) => n + 1)} />

        <section className={`mt-5 ${cardCls}`} aria-labelledby="packet-bundle">
          <h2 id="packet-bundle" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Complaint packet (copy all)
          </h2>
          <textarea
            readOnly
            className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]"
            rows={28}
            value={packetText}
            aria-label="Full case packet text"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void copyPacket()}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
            >
              Copy packet
            </button>
            <button
              type="button"
              disabled={!packetText}
              onClick={() => downloadPacket()}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Download .txt
            </button>
            <button
              type="button"
              onClick={() => printPacket()}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Print packet
            </button>
            {copyHint ? <span className="text-xs text-emerald-700 dark:text-emerald-400">{copyHint}</span> : null}
          </div>
        </section>
        </main>
      </div>

      <div
        className="justice-packet-print-root hidden text-black print:block print:bg-white print:p-0"
      >
        <div className="print:p-[0.6in]">
          <h1 className="text-xl font-bold text-neutral-900 print:text-black">Justice case packet</h1>
          <p className="mt-1 text-sm text-neutral-700 print:text-black">Case id: {caseId}</p>
          <pre className="mt-4 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-neutral-900 print:text-black print:text-[10pt]">
            {packetText}
          </pre>
        </div>
      </div>
    </>
  );
}
