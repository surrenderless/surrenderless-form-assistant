"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { validate as isUuid } from "uuid";
import Header from "@/app/components/Header";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import { ApprovedNextActionFollowUpTimingLine } from "@/lib/justice/approvedNextActionFollowUp";
import { clearLocalJusticeSession } from "@/lib/justice/clearLocalJusticeSession";
import {
  APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER,
  APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER,
  ApprovedNextActionHandlingHandledOpenTriageNote,
  ApprovedNextActionHandlingQueueStatusReadOnly,
  ApprovedNextActionHandlingRequestBlock,
  ApprovedNextActionHandlingRequestedReadOnly,
  ApprovedNextActionHandlingTrackingContextualLink,
  formatApprovedNextActionHandlingTimestamp,
  HANDLING_TRACKING_STEP_ADD_CONFIRMATION,
  HANDLING_TRACKING_STEP_ADD_FILING,
  HANDLING_TRACKING_STEP_COMPLETE,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  acknowledgeHandlingRequestInApprovedNextAction,
  applyHandlingRequestNoteToApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  approvedNextActionStatusLabel,
  clearFollowUpFromApprovedNextAction,
  hydrateApprovedNextActionForDisplay,
  mergeApprovedNextActionTrackingFields,
  parseJusticeCaseClientState,
  mergeClientStateWithAcknowledgedHandling,
  mergeClientStateWithApprovedNextAction,
  mergeClientStateWithClearedFollowUp,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import {
  isJusticeEvidenceType,
  JUSTICE_EVIDENCE_TYPE_LABELS,
  JUSTICE_EVIDENCE_TYPES,
  type JusticeCaseEvidenceRow,
  type JusticeEvidenceType,
} from "@/lib/justice/evidence";
import { buildSubmissionDraftPreview } from "@/lib/justice/buildSubmissionDraftPreview";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import {
  applyServerTimelineFromResponse,
  appendSubmissionDraftReviewedOnce,
  readTimeline,
  SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID,
} from "@/lib/justice/timeline";
import {
  buildApprovedNextActionTarget,
  pickPreparedNextAction,
} from "@/lib/justice/preparedNextAction";
import {
  cfpbLikelyRelevant,
  computeJusticeDestinations,
  dotLikelyRelevant,
  fccLikelyRelevant,
} from "@/lib/justice/rules";
import type {
  JusticeApprovedNextAction,
  JusticeCaseClientState,
  JusticeDestination,
} from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK } from "@/lib/justice/types";
import {
  buildJusticeIntakeFromParts,
  justiceIntakeToBuildJusticeIntakeParts,
  type BuildJusticeIntakeParts,
  validateContactProofForIntake,
} from "@/lib/justice/buildJusticeIntake";
import { isBasicCaseInfoReadyForEscalation } from "@/lib/justice/caseReadiness";
import { commitIntakeToSessionAndServer } from "@/lib/justice/commitIntakeToSessionAndServer";
import { readValidLocalJusticeIntake } from "@/lib/justice/hydrateActiveCaseFromServer";
import {
  clearPreviewChatUpdateSummary,
  writePreviewChatUpdateSummary,
} from "@/lib/justice/previewChatUpdateHandoff";
import {
  cloneBuildJusticeIntakeParts,
  summarizeBuildJusticeIntakePartsSessionChanges,
} from "@/lib/justice/summarizeBuildJusticeIntakePartsSessionChanges";
import {
  appendStagedProofNote,
  readStagedProofNotes,
  removeStagedProofNotesByClientIds,
  type StagedProofNote,
} from "@/lib/justice/stagedProofNotes";
import {
  defaultBuildJusticeIntakeParts,
  MAX_INTAKE_CHAT_USER_MESSAGE,
} from "@/lib/justice/parseIntakeChatAiResponse";
import type { JusticeIntake } from "@/lib/justice/types";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const CATEGORIES: { value: JusticeIntake["problem_category"]; label: string }[] = [
  { value: "online_purchase", label: "Something I bought online" },
  {
    value: "financial_account_issue",
    label: "Bank, credit, loan, payment, debt, billing, or financial account issue",
  },
  { value: "subscription", label: "A subscription or recurring charge" },
  { value: "service_failed", label: "A service that didnâ€™t work as promised" },
  { value: "charge_dispute", label: "A charge I didnâ€™t agree to" },
  { value: "something_else", label: "Something else" },
];

const OPENING_GREETING =
  "Hi â€” tell me whatâ€™s going on with your consumer issue. Iâ€™ll ask follow-up questions and keep track of your case details. When weâ€™re done, you can review everything and save and continue in chat.";

const UPDATE_GREETING =
  "Your current case is loaded in the recap below. Tell me what youâ€™d like to add or change â€” Iâ€™ll update the details as we go. When youâ€™re ready, save and continue in chat.";

const RECAP_STORY_MAX_LEN = 120;
const ACTIVE_CASE_PRODUCT_MAX_LEN = 80;
const activeCaseChecklistLinkCls =
  "inline-flex text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400";

function getPreviewBasicsMissing(parts: BuildJusticeIntakeParts): string[] {
  const missing: string[] = [];
  if (!parts.company_name.trim()) missing.push("company");
  if (!parts.purchase_or_signup.trim()) missing.push("product/service");
  if (!parts.story.trim()) missing.push("what happened");
  if (!parts.reply_email.trim().includes("@")) missing.push("reply email");
  if (!parts.money_amount.trim() && !parts.desired_resolution.trim()) missing.push("requested outcome");
  return missing;
}

function stillNeededBeforePreviewMessage(missing: string[]): string {
  return `Still needed before preview: ${missing.join(", ")}.`;
}

/** When the model sets contacted=yes but omits proof text, reuse the user's answer for Continue validation. */
function synthesizeContactProofTextFromChat(
  parts: BuildJusticeIntakeParts,
  latestUserMessage: string
): string {
  const userText = latestUserMessage.trim();
  if (userText) return userText;

  const segments: string[] = [];
  if (parts.contact_date.trim()) {
    segments.push(`Contact date: ${parts.contact_date.trim()}`);
  }
  if (parts.contact_method) {
    segments.push(`Contact method: ${parts.contact_method.replace(/_/g, " ")}`);
  }
  if (parts.merchant_response_type) {
    segments.push(`Merchant response: ${parts.merchant_response_type.replace(/_/g, " ")}`);
  }
  return segments.join(". ");
}

function enrichContactProofPartsAfterChatTurn(
  parts: BuildJusticeIntakeParts,
  latestUserMessage: string
): BuildJusticeIntakeParts {
  if (parts.already_contacted !== "yes" || parts.contact_proof_text.trim()) {
    return parts;
  }

  const synthesized = synthesizeContactProofTextFromChat(parts, latestUserMessage).trim();
  if (!synthesized) return parts;

  const candidate: BuildJusticeIntakeParts = {
    ...parts,
    contact_proof_text: synthesized,
  };
  const proofCheck = validateContactProofForIntake({
    already_contacted: candidate.already_contacted,
    contact_proof_type: candidate.contact_proof_type,
    contact_proof_text: candidate.contact_proof_text,
  });
  return proofCheck.ok ? candidate : parts;
}

const SESSION_PROOF_ADDED_LINE = "Added proof note(s) this visit";

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

function resolveActiveCaseWorkHref(
  draftReviewed: boolean,
  packetApproved: boolean
): string {
  if (!draftReviewed) return "/justice/preview";
  if (!packetApproved) return "/justice/packet";
  return "/justice/chat-ai";
}

function resolveActiveCaseWorkLabel(
  draftReviewed: boolean,
  packetApproved: boolean
): string {
  if (!draftReviewed) return "Submission preview";
  if (!packetApproved) return "Review prepared case packet";
  return "Continue in chat";
}

type ContinueHandoffStepsInput = {
  isUpdatingExistingCase: boolean;
  stagedCount: number;
  isStagedFlushRetry: boolean;
  savedEvidenceCount: number;
  sessionChangeLines?: string[];
  chatFirstContinuity?: boolean;
};

function getContinueHandoffSteps(input: ContinueHandoffStepsInput): string[] {
  const previewStep =
    "Open submission draft preview to review your case text (nothing is filed automatically).";
  const postPreviewFunnelStep =
    "After preview, review your prepared case packet, then continue in chat when ready. Nothing is filed automatically.";
  const chatFirstDraftStep =
    "Review your submission draft in the Active case checklist below (nothing is filed automatically).";
  const chatFirstPacketStep = "Approve your prepared packet in chat when ready.";
  const chatFirstTrackingStep =
    "Continue next steps in Current action tracking below. Nothing is filed automatically.";
  const funnelSteps = input.chatFirstContinuity
    ? [chatFirstDraftStep, chatFirstPacketStep, chatFirstTrackingStep]
    : [previewStep, postPreviewFunnelStep];

  if (input.isStagedFlushRetry) {
    const noteWord = input.stagedCount === 1 ? "note" : "notes";
    return [`Save ${input.stagedCount} pending proof ${noteWord} to your case.`, ...funnelSteps];
  }

  const steps: string[] = [];
  const sessionChangeLines = input.sessionChangeLines ?? [];

  if (input.isUpdatingExistingCase) {
    if (sessionChangeLines.length > 0) {
      steps.push("Save your updates from this chat to your case:");
      steps.push(...sessionChangeLines);
    } else {
      steps.push("Save updates to your case.");
    }
    const proofAddedInSession = sessionChangeLines.includes(SESSION_PROOF_ADDED_LINE);
    if (input.savedEvidenceCount > 0 && !proofAddedInSession) {
      const itemWord = input.savedEvidenceCount === 1 ? "item" : "items";
      steps.push(`Your ${input.savedEvidenceCount} saved proof ${itemWord} stay on your case.`);
    }
  } else {
    steps.push("Save your case.");
    if (input.stagedCount > 0) {
      const noteWord = input.stagedCount === 1 ? "note" : "notes";
      steps.push(`Save ${input.stagedCount} pending proof ${noteWord} to your case.`);
    }
  }

  steps.push(...funnelSteps);
  return steps;
}

function recapStoryDisplay(story: string): string {
  const trimmed = story.trim();
  if (!trimmed) return "â€”";
  if (trimmed.length <= RECAP_STORY_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, RECAP_STORY_MAX_LEN)}â€¦`;
}

function formatIntakeChatApiError(status: number, serverError?: string): string {
  const err = serverError?.trim() ?? "";
  if (status === 401) {
    return "Your session may have expired. Sign in again, then resend your message.";
  }
  if (status === 429) {
    return "Youâ€™re sending messages too quickly. Wait a moment, then try again.";
  }
  if (status === 502) {
    return "We couldnâ€™t get a usable AI reply. Check your message and try again.";
  }
  if (status === 500) {
    if (err.includes("OPENAI_API_KEY")) {
      return "AI intake isnâ€™t available right now. Please try again later.";
    }
    return "Something went wrong on our side. Please try again.";
  }
  if (status === 413 || err.toLowerCase().includes("too large")) {
    return "That message is too large. Shorten it and try again.";
  }
  if (status === 400) {
    return "Something went wrong sending your message. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

function msgId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function categoryLabel(cat: JusticeIntake["problem_category"]): string {
  return CATEGORIES.find((c) => c.value === cat)?.label ?? cat.replace(/_/g, " ");
}

function truncateAttentionNote(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen).trimEnd()}…`;
}

function truncateActiveCaseProduct(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= ACTIVE_CASE_PRODUCT_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, ACTIVE_CASE_PRODUCT_MAX_LEN)}…`;
}

function submissionDraftReviewedInTimeline(caseId: string): boolean {
  const entries = caseId ? readTimeline(caseId) : [];
  return entries.some(
    (e) => e.id === SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID || e.type === "submission_draft_reviewed"
  );
}

function shouldStayInChatAfterSignedInUuidCaseSave(input: {
  isUpdatingExistingCase: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  caseId: string;
  serverPersisted?: boolean;
}): boolean {
  if (!input.isLoaded || !input.isSignedIn) return false;
  if (!input.caseId || !isUuid(input.caseId)) return false;
  if (input.isUpdatingExistingCase) return true;
  return Boolean(input.serverPersisted);
}

const CHAT_DRAFT_PREVIEW_TRUNCATE = 720;

function isChatPreviewSelectableDestination(d: JusticeDestination): boolean {
  return d.status === "recommended" || d.status === "available";
}

function resolveChatPreviewDestination(intake: JusticeIntake): JusticeDestination | null {
  const manualFtc =
    typeof window !== "undefined" && sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
  const useCompanyContactLabels = cfpbLikelyRelevant(intake) || fccLikelyRelevant(intake);
  const destinations = computeJusticeDestinations(intake, { manualFtc, useCompanyContactLabels });
  const selectable = destinations.filter(isChatPreviewSelectableDestination);
  const options = selectable.length > 0 ? selectable : destinations;
  return options[0] ?? null;
}

function ChatInlineSubmissionDraftReviewBlock({
  draftText,
  destinationLabel,
  checked,
  onCheckedChange,
  expanded,
  onExpandedChange,
  saving,
  error,
  onSubmit,
}: {
  draftText: string;
  destinationLabel?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  saving: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const canTruncate = draftText.length > CHAT_DRAFT_PREVIEW_TRUNCATE;
  const displayText =
    expanded || !canTruncate ? draftText : `${draftText.slice(0, CHAT_DRAFT_PREVIEW_TRUNCATE)}…`;

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-blue-300/80 bg-blue-50/60 px-3 py-2.5 dark:border-blue-800/60 dark:bg-blue-950/30">
      <p className="text-xs font-medium text-blue-950 dark:text-blue-100">Review submission draft</p>
      <p className="text-[11px] leading-relaxed text-blue-900/90 dark:text-blue-100/90">
        Deterministic draft for your review — not filed or sent automatically.
        {destinationLabel ? (
          <>
            {" "}
            Related action: <strong>{destinationLabel}</strong>.
          </>
        ) : null}
      </p>
      {draftText ? (
        <>
          <pre className="max-h-[min(280px,40vh)] overflow-auto whitespace-pre-wrap rounded-md border border-blue-200/80 bg-white/80 p-2 text-[11px] leading-relaxed text-neutral-900 dark:border-blue-900/40 dark:bg-neutral-950/80 dark:text-neutral-100">
            {displayText}
          </pre>
          {canTruncate ? (
            <button
              type="button"
              onClick={() => onExpandedChange(!expanded)}
              className="text-[11px] font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-[11px] text-blue-900/90 dark:text-blue-100/90">
          Draft preview is not available yet. Use the full submission preview to review your case
          text.
        </p>
      )}
      <label className="flex cursor-pointer items-start gap-2 text-[11px] text-blue-900 dark:text-blue-100">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          disabled={!draftText}
          className="mt-0.5"
        />
        I reviewed the submission draft shown above.
      </label>
      {error ? <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p> : null}
      <button
        type="button"
        disabled={!checked || !draftText || saving}
        onClick={() => void onSubmit()}
        className="inline-flex rounded-lg border border-blue-500/80 bg-blue-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
      >
        {saving ? "Saving…" : "Mark draft reviewed"}
      </button>
      <p className="text-xs text-blue-800 dark:text-blue-200">
        <Link
          href="/justice/preview"
          className="font-medium underline underline-offset-2 hover:text-blue-950 dark:text-blue-300 dark:hover:text-blue-100"
        >
          Open full submission preview
        </Link>
        <span className="text-[11px] text-blue-900/80 dark:text-blue-100/80">
          {" "}
          (optional — includes AI-assisted draft)
        </span>
      </p>
    </div>
  );
}

const CHAT_FILING_INPUT_CLS =
  "mt-1 w-full rounded-md border border-emerald-300/80 bg-white px-2 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 dark:border-emerald-700 dark:bg-neutral-950 dark:text-neutral-100";

function showChatApprovedPacketActionHandlingTracking(input: {
  preparedPacketApproved: boolean;
  approvedNextAction: JusticeApprovedNextAction;
}): boolean {
  if (!input.preparedPacketApproved) return false;
  if (input.approvedNextAction.handling_requested_at?.trim()) return false;
  const status = input.approvedNextAction.status;
  return status === "approved" || status === "started" || status === "completed";
}

function chatOutcomeTrackingFormOpen(action: JusticeApprovedNextAction): boolean {
  if (!action.outcome_note?.trim()) return true;
  return action.follow_up_needed === true;
}

function chatReadyForManualReview(input: {
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
}): boolean {
  return input.basicsReady && input.draftReviewed && input.preparedPacketApproved;
}

function deriveChatManualActionNextStep(input: {
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
  return HANDLING_TRACKING_STEP_COMPLETE;
}

function deriveChatHandlingTrackingLine(input: {
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
  evidenceCount: number;
  filings: JusticeCaseFilingRow[];
  next: JusticeApprovedNextAction;
}): string {
  const readyForManualReview = chatReadyForManualReview({
    basicsReady: input.basicsReady,
    draftReviewed: input.draftReviewed,
    preparedPacketApproved: input.preparedPacketApproved,
  });
  const readyForExternalManualAction =
    readyForManualReview && input.evidenceCount > 0;
  const actionOpened = input.next.status === "started" || input.next.status === "completed";
  const hasFilingRecord = input.filings.length > 0;
  const hasConfirmationOnFile = input.filings.some((f) => f.confirmation_number?.trim());
  return deriveChatManualActionNextStep({
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

function findChatFilingMissingConfirmation(
  filings: JusticeCaseFilingRow[]
): JusticeCaseFilingRow | undefined {
  return filings.find((row) => !row.confirmation_number?.trim());
}

function ChatManualFilingCaptureForm({
  mode,
  caseId,
  approvedNextAction,
  filings,
  onSaved,
}: {
  mode: "add_filing" | "add_confirmation";
  caseId: string;
  approvedNextAction: JusticeApprovedNextAction;
  filings: JusticeCaseFilingRow[];
  onSaved: () => void;
}) {
  const confirmationTarget = findChatFilingMissingConfirmation(filings);
  const [destination, setDestination] = useState(() => approvedNextAction.label?.trim() ?? "");
  const [filedAt, setFiledAt] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "add_filing") return;
    const label = approvedNextAction.label?.trim();
    if (label) setDestination(label);
  }, [mode, approvedNextAction.label]);

  async function handleAddFiling(e: FormEvent) {
    e.preventDefault();
    const dest = destination.trim();
    if (!dest) {
      setError("Destination is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        case_id: caseId,
        destination: dest,
      };
      const fa = filedAt.trim();
      if (fa) body.filed_at = fa;
      const cn = confirmationNumber.trim();
      if (cn) body.confirmation_number = cn;
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
        setError(err.error ?? "Could not save filing record.");
        return;
      }
      applyServerTimelineFromResponse(caseId, payload);
      setFiledAt("");
      setConfirmationNumber("");
      setNotes("");
      onSaved();
    } catch {
      setError("Could not save filing record.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddConfirmation(e: FormEvent) {
    e.preventDefault();
    if (!confirmationTarget) {
      setError("No filing record found to update.");
      return;
    }
    const cn = confirmationNumber.trim();
    const n = notes.trim();
    if (!cn && !n) {
      setError("Enter a confirmation number or notes.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        destination: confirmationTarget.destination,
        filed_at: confirmationTarget.filed_at?.trim() ? confirmationTarget.filed_at.trim() : null,
        filing_url: confirmationTarget.filing_url?.trim() ? confirmationTarget.filing_url.trim() : null,
        confirmation_number: cn ? cn : confirmationTarget.confirmation_number?.trim() || null,
        notes: n ? n : confirmationTarget.notes?.trim() || null,
      };
      const res = await fetch(`/api/justice/filings/${encodeURIComponent(confirmationTarget.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as {
          error?: string;
        };
        setError(err.error ?? "Could not update filing record.");
        return;
      }
      setConfirmationNumber("");
      setNotes("");
      onSaved();
    } catch {
      setError("Could not update filing record.");
    } finally {
      setSaving(false);
    }
  }

  if (mode === "add_confirmation" && !confirmationTarget) {
    return null;
  }

  return (
    <form
      onSubmit={(e) =>
        void (mode === "add_filing" ? handleAddFiling(e) : handleAddConfirmation(e))
      }
      className="mt-2 space-y-2 rounded-lg border border-emerald-400/50 bg-white/70 px-3 py-2.5 dark:border-emerald-600/40 dark:bg-emerald-950/40"
      aria-label="Record manual filing"
    >
      <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">Record a manual action</p>
      <p className="text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
        This records what was done outside Surrenderless. It does not submit or file anything for you.
      </p>
      {mode === "add_filing" ? (
        <>
          <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
            Where you filed or acted (required)
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              required
              placeholder="e.g. BBB complaint, bank dispute"
              className={CHAT_FILING_INPUT_CLS}
            />
          </label>
          <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
            Date filed or acted (optional)
            <input
              type="text"
              value={filedAt}
              onChange={(e) => setFiledAt(e.target.value)}
              placeholder="e.g. 2026-03-01"
              className={CHAT_FILING_INPUT_CLS}
            />
          </label>
          <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
            Confirmation number (optional)
            <input
              type="text"
              value={confirmationNumber}
              onChange={(e) => setConfirmationNumber(e.target.value)}
              className={CHAT_FILING_INPUT_CLS}
            />
          </label>
          <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
            Notes (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={`${CHAT_FILING_INPUT_CLS} resize-y`}
            />
          </label>
        </>
      ) : (
        <>
          <p className="text-[11px] text-emerald-900/90 dark:text-emerald-100/90">
            Filing: <strong>{confirmationTarget!.destination}</strong>
          </p>
          <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
            Confirmation number
            <input
              type="text"
              value={confirmationNumber}
              onChange={(e) => setConfirmationNumber(e.target.value)}
              className={CHAT_FILING_INPUT_CLS}
            />
          </label>
          <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
            Notes (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={`${CHAT_FILING_INPUT_CLS} resize-y`}
            />
          </label>
        </>
      )}
      {error ? (
        <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {saving ? "Saving…" : mode === "add_filing" ? "Save filing record" : "Save confirmation"}
      </button>
    </form>
  );
}

function ChatHandlingTrackingStatusReadOnly({
  readinessLoading,
  approvedNextAction,
  basicsReady,
  draftReviewed,
  preparedPacketApproved,
  evidenceCount,
  filings,
  markAcknowledgedOnScreen = false,
  canCaptureFiling = false,
  caseId = "",
  onFilingsSaved,
  canArchiveCase = false,
  onArchiveCase,
  archiving = false,
}: {
  readinessLoading: boolean;
  approvedNextAction: JusticeApprovedNextAction;
  basicsReady: boolean;
  draftReviewed: boolean;
  preparedPacketApproved: boolean;
  evidenceCount: number;
  filings: JusticeCaseFilingRow[];
  markAcknowledgedOnScreen?: boolean;
  canCaptureFiling?: boolean;
  caseId?: string;
  onFilingsSaved?: () => void;
  canArchiveCase?: boolean;
  onArchiveCase?: (caseId: string) => void;
  archiving?: boolean;
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
  const derivedStep = deriveChatHandlingTrackingLine({
    basicsReady,
    draftReviewed,
    preparedPacketApproved,
    evidenceCount,
    filings,
    next: approvedNextAction,
  });
  const showInlineFilingCapture =
    canCaptureFiling &&
    Boolean(caseId) &&
    (derivedStep === HANDLING_TRACKING_STEP_ADD_FILING ||
      derivedStep === HANDLING_TRACKING_STEP_ADD_CONFIRMATION);
  const inlineFilingMode =
    derivedStep === HANDLING_TRACKING_STEP_ADD_FILING ? "add_filing" : "add_confirmation";
  const showArchiveWhenComplete =
    canArchiveCase &&
    Boolean(caseId) &&
    derivedStep === HANDLING_TRACKING_STEP_COMPLETE &&
    Boolean(onArchiveCase);
  return (
    <>
      <p className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90">
        <span className="font-medium text-emerald-900 dark:text-emerald-100">Handling tracking:</span>{" "}
        {derivedStep}
      </p>
      <p className="mt-0.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
        In-app tracking only — not filed or submitted.
      </p>
      {!showInlineFilingCapture ? (
        <ApprovedNextActionHandlingTrackingContextualLink
          derivedStep={derivedStep}
          approvedNextAction={approvedNextAction}
          surface="chat-ai"
          basicsReady={basicsReady}
          evidenceCount={evidenceCount}
          markAcknowledgedOnScreen={markAcknowledgedOnScreen}
        />
      ) : null}
      {showInlineFilingCapture && onFilingsSaved ? (
        <ChatManualFilingCaptureForm
          mode={inlineFilingMode}
          caseId={caseId}
          approvedNextAction={approvedNextAction}
          filings={filings}
          onSaved={onFilingsSaved}
        />
      ) : null}
      {showArchiveWhenComplete ? (
        <div className="mt-2 space-y-2 rounded-lg border border-emerald-400/50 bg-white/70 px-3 py-2.5 dark:border-emerald-600/40 dark:bg-emerald-950/40">
          <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">Close this case</p>
          <p className="text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
            This archives the case in Surrenderless. It does not submit, file, or contact anyone.
          </p>
          <button
            type="button"
            disabled={archiving}
            onClick={() => onArchiveCase?.(caseId)}
            className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {archiving ? "Archiving…" : "Archive case"}
          </button>
        </div>
      ) : null}
    </>
  );
}

const CHAT_RECENT_EVIDENCE_MAX = 3;
const CHAT_EVIDENCE_DESC_PREVIEW_MAX = 120;

function chatEvidenceTypeLabel(t: string): string {
  return isJusticeEvidenceType(t) ? JUSTICE_EVIDENCE_TYPE_LABELS[t] : t.replace(/_/g, " ");
}

function isCreatedEvidenceRow(payload: unknown): payload is JusticeCaseEvidenceRow {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const row = payload as JusticeCaseEvidenceRow;
  return typeof row.id === "string" && typeof row.title === "string";
}

function truncateChatEvidenceDescription(text: string | null, max: number): string {
  if (!text?.trim()) return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}â€¦`;
}

const PROOF_KEYWORD_STRONG =
  /\b(screenshots?|receipts?|invoices?|tracking|confirmations?|transcripts?|call\s+notes?|chat\s+logs?|account\s+pages?)\b/i;

const PROOF_KEYWORD_NEGATIVE =
  /\b(?:no|not|don'?t|doesn'?t|didn'?t|without|never)\b[^.?!]{0,48}\b(?:proof|evidence|screenshots?|receipts?)\b/i;

function userMessageSuggestsProofNote(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (PROOF_KEYWORD_NEGATIVE.test(trimmed)) return false;
  return PROOF_KEYWORD_STRONG.test(trimmed);
}

const PROOF_NOTE_PREFILL_TITLE_MAX = 120;

function collapseProofNoteWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateProofNoteTitle(collapsed: string): string {
  if (collapsed.length <= PROOF_NOTE_PREFILL_TITLE_MAX) return collapsed;
  const slice = collapsed.slice(0, PROOF_NOTE_PREFILL_TITLE_MAX);
  const lastSpace = slice.lastIndexOf(" ");
  const cut =
    lastSpace > PROOF_NOTE_PREFILL_TITLE_MAX * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

function buildProofNotePrefillFromUserMessage(text: string): { title: string; description: string } {
  const collapsed = collapseProofNoteWhitespace(text);
  if (collapsed.length <= PROOF_NOTE_PREFILL_TITLE_MAX) {
    return { title: collapsed, description: "" };
  }
  return {
    title: truncateProofNoteTitle(collapsed),
    description: collapsed,
  };
}

function isoToDateInputValue(iso?: string): string {
  if (!iso?.trim()) return "";
  const d = iso.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
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

export default function JusticeChatAiPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendInFlightRef = useRef(false);
  const sessionHydratedRef = useRef(false);
  const sessionBaselinePartsRef = useRef<BuildJusticeIntakeParts | null>(null);
  const sessionBaselineEvidenceCountRef = useRef<number | null>(null);

  const [parts, setParts] = useState<BuildJusticeIntakeParts>(() => defaultBuildJusticeIntakeParts());
  const [isUpdatingExistingCase, setIsUpdatingExistingCase] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>(() => [
    { id: msgId(), role: "assistant", text: OPENING_GREETING },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [contactProofError, setContactProofError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clearingFollowUp, setClearingFollowUp] = useState(false);
  const [requestingHandling, setRequestingHandling] = useState(false);
  const [updatingHandlingNote, setUpdatingHandlingNote] = useState(false);
  const [acknowledgingHandling, setAcknowledgingHandling] = useState(false);
  const [markingActionHandled, setMarkingActionHandled] = useState(false);
  const [markingActionStarted, setMarkingActionStarted] = useState(false);
  const [approvedNextAction, setApprovedNextAction] = useState<JusticeApprovedNextAction | undefined>(
    undefined
  );
  const [preparedPacketApproved, setPreparedPacketApproved] = useState(false);
  const [savedEvidenceCount, setSavedEvidenceCount] = useState<number | null>(null);
  const [savedFilings, setSavedFilings] = useState<JusticeCaseFilingRow[]>([]);
  const [chatHandlingReadinessLoading, setChatHandlingReadinessLoading] = useState(false);
  const [recentEvidenceRows, setRecentEvidenceRows] = useState<JusticeCaseEvidenceRow[]>([]);
  const [proofNoteTitle, setProofNoteTitle] = useState("");
  const [proofNoteType, setProofNoteType] = useState<JusticeEvidenceType>("other");
  const [proofNoteEvidenceDate, setProofNoteEvidenceDate] = useState("");
  const [proofNoteDescription, setProofNoteDescription] = useState("");
  const [savingProofNote, setSavingProofNote] = useState(false);
  const [proofNoteError, setProofNoteError] = useState<string | null>(null);
  const [proofNoteSuccess, setProofNoteSuccess] = useState<string | null>(null);
  const [editingRecentEvidenceId, setEditingRecentEvidenceId] = useState<string | null>(null);
  const [editRecentEvidenceTitle, setEditRecentEvidenceTitle] = useState("");
  const [editRecentEvidenceType, setEditRecentEvidenceType] = useState<JusticeEvidenceType>("other");
  const [editRecentEvidenceDate, setEditRecentEvidenceDate] = useState("");
  const [editRecentEvidenceDescription, setEditRecentEvidenceDescription] = useState("");
  const [savingRecentEvidenceEdit, setSavingRecentEvidenceEdit] = useState(false);
  const [recentEvidenceEditError, setRecentEvidenceEditError] = useState<string | null>(null);
  const [recentEvidenceEditSuccess, setRecentEvidenceEditSuccess] = useState<string | null>(null);
  const [deletingRecentEvidenceId, setDeletingRecentEvidenceId] = useState<string | null>(null);
  const [recentEvidenceDeleteError, setRecentEvidenceDeleteError] = useState<string | null>(null);
  const [recentEvidenceDeleteSuccess, setRecentEvidenceDeleteSuccess] = useState<string | null>(null);
  const [showProofKeywordNudge, setShowProofKeywordNudge] = useState(false);
  const [proofNoteDetailsOpen, setProofNoteDetailsOpen] = useState(false);
  const [stagedProofNotes, setStagedProofNotes] = useState<StagedProofNote[]>([]);
  const [stagedProofFlushError, setStagedProofFlushError] = useState<string | null>(null);
  const [archivingCase, setArchivingCase] = useState(false);
  const [approvePreparedPacketChecked, setApprovePreparedPacketChecked] = useState(false);
  const [approvingPreparedPacket, setApprovingPreparedPacket] = useState(false);
  const [submissionDraftReviewChecked, setSubmissionDraftReviewChecked] = useState(false);
  const [markingSubmissionDraftReviewed, setMarkingSubmissionDraftReviewed] = useState(false);
  const [submissionDraftReviewError, setSubmissionDraftReviewError] = useState<string | null>(null);
  const [submissionDraftReviewOverride, setSubmissionDraftReviewOverride] = useState(false);
  const [draftPreviewExpanded, setDraftPreviewExpanded] = useState(false);
  const evidenceRefetchAbortRef = useRef<AbortController | null>(null);
  const proofKeywordNudgeOfferedRef = useRef(false);

  async function handleMarkSubmissionDraftReviewedFromChat() {
    if (!submissionDraftReviewChecked || !isLoaded) return;
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId) return;

    setMarkingSubmissionDraftReviewed(true);
    setSubmissionDraftReviewError(null);
    try {
      const intake = buildJusticeIntakeFromParts(parts);
      const destination = resolveChatPreviewDestination(intake);
      const destinationLabel = destination?.label;

      if (isSignedIn && isUuid(caseId)) {
        const res = await fetch("/api/justice/submission-draft-reviewed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case_id: caseId,
            ...(destinationLabel ? { destination_label: destinationLabel } : {}),
            used_ai: false,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { timeline?: unknown; error?: string };
        if (!res.ok) {
          setSubmissionDraftReviewError(
            data.error ??
              "The submission draft review was not saved to your case timeline. Please try again."
          );
          return;
        }
        if (!Array.isArray(data.timeline)) {
          setSubmissionDraftReviewError(
            "The submission draft review was not saved (invalid server response). Please try again."
          );
          return;
        }
        applyServerTimelineFromResponse(caseId, { timeline: data.timeline });
      } else {
        appendSubmissionDraftReviewedOnce(caseId, {
          destinationLabel,
          usedAi: false,
        });
      }

      setSubmissionDraftReviewOverride(true);
      setSubmissionDraftReviewChecked(false);
      setDraftPreviewExpanded(false);
    } catch {
      setSubmissionDraftReviewError("Could not save draft review. Please try again.");
    } finally {
      setMarkingSubmissionDraftReviewed(false);
    }
  }

  async function handleArchiveActiveCase(archiveCaseId: string) {
    if (!isLoaded) return;
    const caseId = archiveCaseId.trim();
    if (!caseId || !isUuid(caseId)) return;

    setArchivingCase(true);
    try {
      const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived_at: new Date().toISOString() }),
      });
      if (!res.ok) {
        console.warn("justice chat-ai: archive failed", res.status);
        return;
      }
      clearLocalJusticeSession();
      router.push("/justice");
    } catch (e) {
      console.warn("justice chat-ai: archive error", e);
    } finally {
      setArchivingCase(false);
    }
  }

  async function handleApprovePreparedPacketFromChat() {
    if (!approvePreparedPacketChecked || !isLoaded || !isSignedIn) return;
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId || !isUuid(caseId)) return;

    const intake = buildJusticeIntakeFromParts(parts);
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
    setPreparedPacketApproved(true);
    setApprovedNextAction(withTracking);
    setApprovePreparedPacketChecked(false);

    setApprovingPreparedPacket(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before prepared packet approve failed", getRes.status);
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
        console.warn("justice chat-ai: PATCH prepared packet approve failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice chat-ai: prepared packet approve error", e);
    } finally {
      setApprovingPreparedPacket(false);
    }
  }

  async function handleRequestSurrenderlessHandling(note?: string) {
    if (!approvedNextAction || approvedNextAction.status === "completed") return;
    if (approvedNextAction.handling_requested_at?.trim()) return;

    const next: JusticeApprovedNextAction = {
      ...approvedNextAction,
      handling_requested_at: new Date().toISOString(),
      ...(note ? { handling_request_note: note } : {}),
    };
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, next);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);

    setApprovedNextAction(local);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, local);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    setRequestingHandling(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before handling request failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH handling request failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice chat-ai: handling request error", e);
    } finally {
      setRequestingHandling(false);
    }
  }

  async function handleUpdateHandlingRequestNote(note?: string) {
    if (!approvedNextAction?.handling_requested_at?.trim()) return;

    const withNoteUpdate = applyHandlingRequestNoteToApprovedNextAction(
      approvedNextAction,
      note ?? ""
    );
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, withNoteUpdate);
    const next = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(next);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, next);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    setUpdatingHandlingNote(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before handling note update failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH handling note update failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice chat-ai: handling note update error", e);
    } finally {
      setUpdatingHandlingNote(false);
    }
  }

  async function handleAcknowledgeHandlingRequest() {
    if (!approvedNextAction?.handling_requested_at?.trim()) return;
    if (approvedNextAction.handling_acknowledged_at?.trim()) return;

    const acknowledged = acknowledgeHandlingRequestInApprovedNextAction(approvedNextAction);
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, acknowledged);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(local);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, local);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    setAcknowledgingHandling(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before acknowledge handling failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithAcknowledgedHandling(existing.client_state, acknowledged);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH acknowledge handling failed", patchRes.status);
        return;
      }
      const data = (await patchRes.json()) as { client_state?: unknown };
      if (data.client_state !== undefined) {
        const hydrated = hydrateApprovedNextActionForDisplay(caseId, data.client_state) ?? local;
        writeSessionApprovedNextAction(caseId, hydrated);
        setApprovedNextAction(hydrated);
      }
    } catch (e) {
      console.warn("justice chat-ai: acknowledge handling error", e);
    } finally {
      setAcknowledgingHandling(false);
    }
  }

  async function handleMarkApprovedNextActionHandled() {
    if (!approvedNextAction || approvedNextAction.status !== "started") return;

    const next: JusticeApprovedNextAction = {
      ...approvedNextAction,
      status: "completed",
      completed_at: new Date().toISOString(),
    };
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, next);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(local);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, local);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    setMarkingActionHandled(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before mark action handled failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH mark action handled failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice chat-ai: mark action handled error", e);
    } finally {
      setMarkingActionHandled(false);
    }
  }

  async function handleApprovedNextActionOpen() {
    if (!approvedNextAction) return;
    const targetHref = approvedNextAction.href?.trim() || "/justice/packet";
    if (approvedNextAction.status === "completed") {
      router.push(targetHref);
      return;
    }
    if (approvedNextAction.status !== "approved") return;

    const label = approvedNextAction.label?.trim();
    const next: JusticeApprovedNextAction = {
      ...approvedNextAction,
      ...(label ? { label } : {}),
      href: approvedNextAction.href ?? targetHref,
      status: "started",
      started_at: approvedNextAction.started_at ?? new Date().toISOString(),
      ...(approvedNextAction.approved_at ? { approved_at: approvedNextAction.approved_at } : {}),
    };
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, next);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(local);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, local);
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

    const navigateHref = local.href?.trim() || targetHref;
    const shouldStayInChat =
      isUpdatingExistingCase &&
      isLoaded &&
      isSignedIn &&
      Boolean(caseId) &&
      isUuid(caseId);

    if (!shouldStayInChat) {
      router.push(navigateHref);
      return;
    }

    setMarkingActionStarted(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before open approved step failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH open approved step failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice chat-ai: open approved step error", e);
    } finally {
      setMarkingActionStarted(false);
    }
  }

  async function clearApprovedNextActionFollowUp() {
    if (!approvedNextAction || approvedNextAction.follow_up_needed !== true) return;

    const cleared = clearFollowUpFromApprovedNextAction(approvedNextAction);
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, cleared);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(local);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, local);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    setClearingFollowUp(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before clear follow-up failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithClearedFollowUp(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH clear follow-up failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice chat-ai: clear follow-up error", e);
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
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, next);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(local);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, local);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before save outcome tracking failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH save outcome tracking failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice chat-ai: save outcome tracking error", e);
    }
  }

  useEffect(() => {
    if (sessionHydratedRef.current) return;
    sessionHydratedRef.current = true;
    const intake = readValidLocalJusticeIntake();
    if (intake) {
      const hydrated = justiceIntakeToBuildJusticeIntakeParts(intake);
      sessionBaselinePartsRef.current = cloneBuildJusticeIntakeParts(hydrated);
      setParts(hydrated);
      setIsUpdatingExistingCase(true);
      setMessages([{ id: msgId(), role: "assistant", text: UPDATE_GREETING }]);
    }
    setStagedProofNotes(readStagedProofNotes());
  }, []);

  const loadSavedEvidencePreview = useCallback(async (signal: AbortSignal) => {
    if (!isUpdatingExistingCase || !isLoaded || !isSignedIn) {
      setSavedEvidenceCount(null);
      setSavedFilings([]);
      setChatHandlingReadinessLoading(false);
      setRecentEvidenceRows([]);
      return;
    }
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId || !isUuid(caseId)) {
      setSavedEvidenceCount(null);
      setSavedFilings([]);
      setChatHandlingReadinessLoading(false);
      setRecentEvidenceRows([]);
      return;
    }
    setChatHandlingReadinessLoading(true);
    try {
      const [evRes, filRes] = await Promise.all([
        fetch(`/api/justice/evidence?case_id=${encodeURIComponent(caseId)}`, { signal }),
        fetch(`/api/justice/filings?case_id=${encodeURIComponent(caseId)}`, { signal }),
      ]);
      if (signal.aborted) return;
      const evJson: unknown = evRes.ok ? await evRes.json() : [];
      const filJson: unknown = filRes.ok ? await filRes.json() : [];
      const rows = Array.isArray(evJson) ? (evJson as JusticeCaseEvidenceRow[]) : [];
      const count = rows.length;
      if (sessionBaselineEvidenceCountRef.current === null) {
        sessionBaselineEvidenceCountRef.current = count;
      }
      setSavedEvidenceCount(count);
      setSavedFilings(Array.isArray(filJson) ? (filJson as JusticeCaseFilingRow[]) : []);
      setRecentEvidenceRows(rows.slice(0, CHAT_RECENT_EVIDENCE_MAX));
    } catch {
      if (!signal.aborted) {
        setSavedEvidenceCount(null);
        setSavedFilings([]);
        setRecentEvidenceRows([]);
      }
    } finally {
      if (!signal.aborted) setChatHandlingReadinessLoading(false);
    }
  }, [isUpdatingExistingCase, isLoaded, isSignedIn]);

  const requestSavedEvidencePreviewRefresh = useCallback(() => {
    evidenceRefetchAbortRef.current?.abort();
    const ac = new AbortController();
    evidenceRefetchAbortRef.current = ac;
    void loadSavedEvidencePreview(ac.signal);
  }, [loadSavedEvidencePreview]);

  useEffect(() => {
    if (!isUpdatingExistingCase || !isLoaded || !isSignedIn) {
      setSavedEvidenceCount(null);
      setSavedFilings([]);
      setChatHandlingReadinessLoading(false);
      setRecentEvidenceRows([]);
      return;
    }
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId || !isUuid(caseId)) {
      setSavedEvidenceCount(null);
      setSavedFilings([]);
      setChatHandlingReadinessLoading(false);
      setRecentEvidenceRows([]);
      return;
    }

    requestSavedEvidencePreviewRefresh();
  }, [isUpdatingExistingCase, isLoaded, isSignedIn, requestSavedEvidencePreviewRefresh]);

  const refreshChatFilings = requestSavedEvidencePreviewRefresh;

  useEffect(() => {
    if (!isUpdatingExistingCase || !isLoaded || !isSignedIn) return;

    function refetchEvidence() {
      const caseId =
        typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
      if (!caseId || !isUuid(caseId)) return;
      requestSavedEvidencePreviewRefresh();
    }

    function onFocus() {
      refetchEvidence();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        refetchEvidence();
      }
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      evidenceRefetchAbortRef.current?.abort();
    };
  }, [isUpdatingExistingCase, isLoaded, isSignedIn, requestSavedEvidencePreviewRefresh]);

  const showSavedEvidenceCount =
    isUpdatingExistingCase &&
    isLoaded &&
    isSignedIn &&
    savedEvidenceCount !== null;

  const showRecentEvidencePreview =
    showSavedEvidenceCount &&
    savedEvidenceCount > 0 &&
    recentEvidenceRows.length > 0;

  const sessionChangeLines = useMemo(() => {
    if (!isUpdatingExistingCase) return [];
    const baseline = sessionBaselinePartsRef.current;
    if (!baseline) return [];
    const evidenceAddedThisVisit =
      showSavedEvidenceCount &&
      sessionBaselineEvidenceCountRef.current !== null &&
      savedEvidenceCount !== null &&
      savedEvidenceCount > sessionBaselineEvidenceCountRef.current;
    return summarizeBuildJusticeIntakePartsSessionChanges({
      baseline,
      current: parts,
      evidenceAddedThisVisit,
    });
  }, [isUpdatingExistingCase, parts, showSavedEvidenceCount, savedEvidenceCount]);

  const chatPreviewIntake = useMemo(() => buildJusticeIntakeFromParts(parts), [parts]);
  const chatPreviewDestination = useMemo(
    () => resolveChatPreviewDestination(chatPreviewIntake),
    [chatPreviewIntake]
  );
  const chatSubmissionDraftText = useMemo(() => {
    if (!chatPreviewDestination) return "";
    return buildSubmissionDraftPreview({
      intake: chatPreviewIntake,
      destinationId: chatPreviewDestination.id,
      destinationLabel: chatPreviewDestination.label,
      evidenceLines: recentEvidenceRows.map((row) => ({ title: row.title })),
    });
  }, [chatPreviewIntake, chatPreviewDestination, recentEvidenceRows]);

  const activeUuidCaseId =
    typeof window !== "undefined"
      ? (() => {
          const id = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
          return id && isUuid(id) ? id : "";
        })()
      : "";

  const canAddProofNoteInChat =
    isUpdatingExistingCase && isLoaded && isSignedIn && Boolean(activeUuidCaseId);

  const canStageProofNoteInChat = !isUpdatingExistingCase && isLoaded && Boolean(isSignedIn);

  const canUseProofNoteForm = canAddProofNoteInChat || canStageProofNoteInChat;

  const showStagedProofNotes = Boolean(isSignedIn) && stagedProofNotes.length > 0;

  function tryShowProofKeywordNudge(userMessage: string) {
    if (proofKeywordNudgeOfferedRef.current || !canAddProofNoteInChat) return;
    if (!userMessageSuggestsProofNote(userMessage)) return;
    proofKeywordNudgeOfferedRef.current = true;
    setShowProofKeywordNudge(true);

    const { title, description } = buildProofNotePrefillFromUserMessage(userMessage);
    if (!proofNoteTitle.trim()) {
      setProofNoteTitle(title);
    }
    if (!proofNoteDescription.trim() && description) {
      setProofNoteDescription(description);
    }
    setProofNoteDetailsOpen(true);
  }

  async function handleAddProofNote(e: React.FormEvent) {
    e.preventDefault();
    setProofNoteSuccess(null);
    const trimmed = proofNoteTitle.trim();
    if (!trimmed) {
      setProofNoteError("Title is required.");
      return;
    }
    if (!isSignedIn) return;

    if (canStageProofNoteInChat) {
      setSavingProofNote(true);
      setProofNoteError(null);
      try {
        const d = proofNoteEvidenceDate.trim();
        const desc = proofNoteDescription.trim();
        const next = appendStagedProofNote({
          title: trimmed,
          evidence_type: proofNoteType,
          ...(d ? { evidence_date: d } : {}),
          ...(desc ? { description: desc } : {}),
        });
        setStagedProofNotes(next);
        setProofNoteTitle("");
        setProofNoteEvidenceDate("");
        setProofNoteDescription("");
        setProofNoteSuccess("Proof note staged on this device.");
        setStagedProofFlushError(null);
      } catch {
        setProofNoteError("Could not stage proof note.");
      } finally {
        setSavingProofNote(false);
      }
      return;
    }

    const caseId = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
    if (!caseId || !isUuid(caseId)) return;

    setSavingProofNote(true);
    setProofNoteError(null);
    try {
      const body: Record<string, unknown> = {
        case_id: caseId,
        title: trimmed,
        evidence_type: proofNoteType,
      };
      const d = proofNoteEvidenceDate.trim();
      if (d) body.evidence_date = d;
      const desc = proofNoteDescription.trim();
      if (desc) body.description = desc;

      const res = await fetch("/api/justice/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (
          payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
        ) as { error?: string };
        setProofNoteError(err.error ?? "Could not save proof note.");
        return;
      }
      applyServerTimelineFromResponse(caseId, payload);
      if (isCreatedEvidenceRow(payload)) {
        setSavedEvidenceCount((prev) => (prev ?? 0) + 1);
        setRecentEvidenceRows((prev) =>
          [payload, ...prev.filter((row) => row.id !== payload.id)].slice(0, CHAT_RECENT_EVIDENCE_MAX)
        );
      }
      setProofNoteTitle("");
      setProofNoteEvidenceDate("");
      setProofNoteDescription("");
      setProofNoteSuccess("Proof note saved.");
      setShowProofKeywordNudge(false);
      requestSavedEvidencePreviewRefresh();
    } catch {
      setProofNoteError("Could not save proof note.");
    } finally {
      setSavingProofNote(false);
    }
  }

  async function flushStagedProofNotesToServer(
    caseId: string,
    notes: StagedProofNote[]
  ): Promise<{ flushedClientIds: string[]; errorMessage: string | null }> {
    const flushedClientIds: string[] = [];
    for (const note of notes) {
      try {
        const body: Record<string, unknown> = {
          case_id: caseId,
          title: note.title,
          evidence_type: note.evidence_type,
        };
        if (note.evidence_date) body.evidence_date = note.evidence_date;
        if (note.description) body.description = note.description;

        const res = await fetch("/api/justice/evidence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const err = (
            payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
          ) as { error?: string };
          return {
            flushedClientIds,
            errorMessage:
              err.error ??
              "Some staged proof notes could not be saved. Remaining notes stay staged on this device.",
          };
        }
        applyServerTimelineFromResponse(caseId, payload);
        flushedClientIds.push(note.clientId);
      } catch {
        return {
          flushedClientIds,
          errorMessage:
            "Some staged proof notes could not be saved. Remaining notes stay staged on this device.",
        };
      }
    }
    return { flushedClientIds, errorMessage: null };
  }

  function cancelEditRecentEvidence() {
    setEditingRecentEvidenceId(null);
    setRecentEvidenceEditError(null);
  }

  function startEditRecentEvidence(row: JusticeCaseEvidenceRow) {
    setEditingRecentEvidenceId(row.id);
    setEditRecentEvidenceTitle(row.title);
    setEditRecentEvidenceType(
      isJusticeEvidenceType(row.evidence_type) ? row.evidence_type : "other"
    );
    setEditRecentEvidenceDate(row.evidence_date ?? "");
    setEditRecentEvidenceDescription(row.description ?? "");
    setRecentEvidenceEditError(null);
    setRecentEvidenceEditSuccess(null);
    setRecentEvidenceDeleteError(null);
    setRecentEvidenceDeleteSuccess(null);
  }

  async function handleSaveRecentEvidenceEdit(e: React.FormEvent, id: string) {
    e.preventDefault();
    if (!isSignedIn) return;
    const trimmedTitle = editRecentEvidenceTitle.trim();
    if (!trimmedTitle) {
      setRecentEvidenceEditError("Title is required.");
      return;
    }
    setSavingRecentEvidenceEdit(true);
    setRecentEvidenceEditError(null);
    setRecentEvidenceEditSuccess(null);
    setRecentEvidenceDeleteError(null);
    setRecentEvidenceDeleteSuccess(null);
    try {
      const body: Record<string, unknown> = {
        title: trimmedTitle,
        evidence_type: editRecentEvidenceType,
        evidence_date: editRecentEvidenceDate.trim() ? editRecentEvidenceDate.trim() : null,
        description: editRecentEvidenceDescription.trim() ? editRecentEvidenceDescription.trim() : null,
      };
      const res = await fetch(`/api/justice/evidence/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (
          payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
        ) as { error?: string };
        setRecentEvidenceEditError(err.error ?? "Could not update proof note.");
        return;
      }
      setEditingRecentEvidenceId(null);
      setRecentEvidenceEditSuccess("Proof note updated.");
      requestSavedEvidencePreviewRefresh();
    } catch {
      setRecentEvidenceEditError("Could not update proof note.");
    } finally {
      setSavingRecentEvidenceEdit(false);
    }
  }

  async function handleDeleteRecentEvidence(id: string) {
    if (!window.confirm("Delete this proof note?")) return;
    if (!isSignedIn) return;

    setDeletingRecentEvidenceId(id);
    setRecentEvidenceDeleteError(null);
    setRecentEvidenceDeleteSuccess(null);
    setRecentEvidenceEditSuccess(null);

    try {
      const res = await fetch(`/api/justice/evidence/${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (
          payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
        ) as { error?: string };
        setRecentEvidenceDeleteError(err.error ?? "Could not delete proof note.");
        return;
      }
      if (editingRecentEvidenceId === id) {
        cancelEditRecentEvidence();
      }
      setRecentEvidenceDeleteSuccess("Proof note deleted.");
      requestSavedEvidencePreviewRefresh();
    } catch {
      setRecentEvidenceDeleteError("Could not delete proof note.");
    } finally {
      setDeletingRecentEvidenceId(null);
    }
  }

  useEffect(() => {
    if (!isUpdatingExistingCase) {
      setApprovedNextAction(undefined);
      setPreparedPacketApproved(false);
      setSavedEvidenceCount(null);
      setSavedFilings([]);
      setChatHandlingReadinessLoading(false);
      setRecentEvidenceRows([]);
      setEditingRecentEvidenceId(null);
      setRecentEvidenceEditError(null);
      setRecentEvidenceEditSuccess(null);
      setDeletingRecentEvidenceId(null);
      setRecentEvidenceDeleteError(null);
      setRecentEvidenceDeleteSuccess(null);
      setShowProofKeywordNudge(false);
      setProofNoteDetailsOpen(false);
      setSubmissionDraftReviewOverride(false);
      setSubmissionDraftReviewChecked(false);
      setSubmissionDraftReviewError(null);
      setDraftPreviewExpanded(false);
      return;
    }

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (!caseId) {
      setPreparedPacketApproved(false);
      setApprovedNextAction(undefined);
      return;
    }

    const sessionFallback = hydrateApprovedNextActionForDisplay(caseId);
    setApprovedNextAction(sessionFallback);
    setPreparedPacketApproved(readSessionPreparedPacketApproved(caseId));
    setSubmissionDraftReviewOverride(false);
    setSubmissionDraftReviewChecked(false);
    setSubmissionDraftReviewError(null);
    setDraftPreviewExpanded(false);

    if (!isLoaded || !isSignedIn || !isUuid(caseId)) return;

    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
          signal: ac.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { client_state?: unknown };
        if (ac.signal.aborted) return;
        const hydrated =
          hydrateApprovedNextActionForDisplay(caseId, data.client_state) ?? sessionFallback;
        if (hydrated) writeSessionApprovedNextAction(caseId, hydrated);
        setApprovedNextAction(hydrated);
        const sessionPacketApproved = readSessionPreparedPacketApproved(caseId);
        const serverPacketApproved =
          parseJusticeCaseClientState(data.client_state).prepared_packet_approved === true;
        setPreparedPacketApproved(sessionPacketApproved || serverPacketApproved);
      } catch {
        // keep session fallback
      }
    })();

    return () => ac.abort();
  }, [isUpdatingExistingCase, isLoaded, isSignedIn]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const proofCheck = validateContactProofForIntake({
      already_contacted: parts.already_contacted,
      contact_proof_type: parts.contact_proof_type,
      contact_proof_text: parts.contact_proof_text,
    });
    if (proofCheck.ok) {
      setContactProofError(null);
    }
  }, [parts.already_contacted, parts.contact_proof_type, parts.contact_proof_text]);

  async function handleSend() {
    if (sendInFlightRef.current || loading) return;

    setApiError(null);
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_INTAKE_CHAT_USER_MESSAGE) {
      setApiError("Message is too long. Please shorten it and try again.");
      return;
    }

    const conversation_history = messages.map((m) => ({
      role: m.role,
      content: m.text,
    }));

    sendInFlightRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/justice/intake-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: trimmed,
          parts,
          conversation_history,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        assistantMessage?: string;
        parts?: BuildJusticeIntakeParts;
        error?: string;
      };

      if (!res.ok) {
        setApiError(formatIntakeChatApiError(res.status, data.error));
        return;
      }

      if (typeof data.assistantMessage !== "string" || !data.assistantMessage.trim() || !data.parts) {
        setApiError("Invalid response from AI intake. Please try again.");
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: msgId(), role: "user", text: trimmed },
        { id: msgId(), role: "assistant", text: data.assistantMessage!.trim() },
      ]);
      setParts(enrichContactProofPartsAfterChatTurn(data.parts, trimmed));
      setInputValue("");
      tryShowProofKeywordNudge(trimmed);
    } catch {
      setApiError("Could not reach AI intake. Please try again.");
    } finally {
      sendInFlightRef.current = false;
      setLoading(false);
    }
  }

  async function handleContinueToPreview() {
    setContactProofError(null);
    setStagedProofFlushError(null);
    const basicsMissing = getPreviewBasicsMissing(parts);
    if (basicsMissing.length > 0) {
      return;
    }
    const proofCheck = validateContactProofForIntake({
      already_contacted: parts.already_contacted,
      contact_proof_type: parts.contact_proof_type,
      contact_proof_text: parts.contact_proof_text,
    });
    if (!proofCheck.ok) {
      setContactProofError(proofCheck.message);
      return;
    }

    const stagedToFlush = readStagedProofNotes();
    const existingCaseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    const existingLocalIntake = readValidLocalJusticeIntake();
    const isStagedFlushRetry =
      stagedToFlush.length > 0 &&
      Boolean(existingLocalIntake) &&
      Boolean(existingCaseId && isUuid(existingCaseId));

    setSubmitting(true);
    try {
      if (isStagedFlushRetry) {
        const { flushedClientIds, errorMessage } = await flushStagedProofNotesToServer(
          existingCaseId,
          stagedToFlush
        );
        const remaining = removeStagedProofNotesByClientIds(flushedClientIds);
        setStagedProofNotes(remaining);

        if (errorMessage || remaining.length > 0) {
          setStagedProofFlushError(
            errorMessage ??
              "Some staged proof notes could not be saved. Remaining notes stay staged on this device."
          );
          return;
        }

        if (
          shouldStayInChatAfterSignedInUuidCaseSave({
            isUpdatingExistingCase,
            isLoaded,
            isSignedIn: Boolean(isSignedIn),
            caseId: existingCaseId,
            serverPersisted: true,
          })
        ) {
          return;
        }

        router.push("/justice/preview");
        return;
      }

      const intake = buildJusticeIntakeFromParts(parts);
      const commitResult = await commitIntakeToSessionAndServer({
        intake,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        commitLogLabel: "justice chat-ai",
        mode: isUpdatingExistingCase ? "update" : "create",
      });

      if (!isUpdatingExistingCase && stagedToFlush.length > 0) {
        if (!commitResult.serverPersisted || !isUuid(commitResult.caseId)) {
          setStagedProofFlushError(
            "Your case could not be saved on the server yet. Staged proof notes were not uploaded. Try again."
          );
          return;
        }

        const { flushedClientIds, errorMessage } = await flushStagedProofNotesToServer(
          commitResult.caseId,
          stagedToFlush
        );
        const remaining = removeStagedProofNotesByClientIds(flushedClientIds);
        setStagedProofNotes(remaining);

        if (errorMessage || remaining.length > 0) {
          setStagedProofFlushError(
            errorMessage ??
              "Some staged proof notes could not be saved. Remaining notes stay staged on this device."
          );
          return;
        }
      }

      if (isUpdatingExistingCase && sessionChangeLines.length > 0) {
        writePreviewChatUpdateSummary(sessionChangeLines);
      } else {
        clearPreviewChatUpdateSummary();
      }

      const caseIdAfterCommit =
        commitResult.caseId?.trim() ||
        (typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "");

      if (
        shouldStayInChatAfterSignedInUuidCaseSave({
          isUpdatingExistingCase,
          isLoaded,
          isSignedIn: Boolean(isSignedIn),
          caseId: caseIdAfterCommit,
          serverPersisted: commitResult.serverPersisted,
        })
      ) {
        if (!isUpdatingExistingCase) {
          sessionBaselinePartsRef.current = cloneBuildJusticeIntakeParts(parts);
          setIsUpdatingExistingCase(true);
        }
        return;
      }

      router.push("/justice/preview");
    } finally {
      setSubmitting(false);
    }
  }

  const activeCaseBannerCls =
    "rounded-2xl border border-blue-200/90 bg-white p-4 shadow-md shadow-neutral-900/5 ring-1 ring-blue-950/[0.06] dark:border-blue-900/50 dark:bg-neutral-900 dark:ring-blue-500/10 sm:p-5";

  const cardCls =
    "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";
  const inputCls =
    "mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]";
  const labelCls = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

  if (!isLoaded) {
    return (
      <>
        <Header />
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
          Loadingâ€¦
        </main>
      </>
    );
  }

  if (!isSignedIn) {
    return <JusticeActionResumeSignInPrompt />;
  }

  const basicsMissing = getPreviewBasicsMissing(parts);
  const stillNeededHint =
    basicsMissing.length > 0 ? stillNeededBeforePreviewMessage(basicsMissing) : null;
  const contactProofCheck = validateContactProofForIntake({
    already_contacted: parts.already_contacted,
    contact_proof_type: parts.contact_proof_type,
    contact_proof_text: parts.contact_proof_text,
  });
  const hasValidLocalIntake = Boolean(readValidLocalJusticeIntake());
  const isStagedFlushRetry =
    stagedProofNotes.length > 0 && hasValidLocalIntake && Boolean(activeUuidCaseId);
  const showContinueHandoff = basicsMissing.length === 0 && contactProofCheck.ok;
  const showSessionChangesPanel =
    sessionChangeLines.length > 0 && !showContinueHandoff;
  const continueHandoffSteps = showContinueHandoff
    ? getContinueHandoffSteps({
        isUpdatingExistingCase,
        stagedCount: stagedProofNotes.length,
        isStagedFlushRetry,
        savedEvidenceCount: savedEvidenceCount ?? 0,
        sessionChangeLines: isUpdatingExistingCase ? sessionChangeLines : [],
        chatFirstContinuity: Boolean(isSignedIn),
      })
    : [];

  const activeCaseSessionCaseId =
    typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
  const activeCaseDraftReviewed = activeCaseSessionCaseId
    ? submissionDraftReviewOverride ||
      submissionDraftReviewedInTimeline(activeCaseSessionCaseId)
    : false;
  const showInlineSubmissionDraftReview =
    isUpdatingExistingCase &&
    isLoaded &&
    Boolean(isSignedIn) &&
    Boolean(activeUuidCaseId) &&
    !activeCaseDraftReviewed;
  const showInlinePreparedPacketApproval =
    isUpdatingExistingCase &&
    isLoaded &&
    Boolean(isSignedIn) &&
    Boolean(activeUuidCaseId) &&
    activeCaseDraftReviewed &&
    !preparedPacketApproved;
  const activeCaseProductLine = truncateActiveCaseProduct(parts.purchase_or_signup);
  const activeCaseSubline = [categoryLabel(parts.problem_category), activeCaseProductLine]
    .filter(Boolean)
    .join(" · ");
  const activeCaseBasicsReady = isBasicCaseInfoReadyForEscalation(buildJusticeIntakeFromParts(parts));
  const activeCaseEvidenceReady = showSavedEvidenceCount && (savedEvidenceCount ?? 0) >= 1;
  const activeCaseFocusLine =
    basicsMissing.length > 0
      ? stillNeededBeforePreviewMessage(basicsMissing)
      : activeCaseBasicsReady && activeCaseEvidenceReady && !activeCaseDraftReviewed
        ? "Review your submission draft before continuing."
        : "Describe what to add or change, then save in chat.";
  const activeCaseWorkHref = resolveActiveCaseWorkHref(
    activeCaseDraftReviewed,
    preparedPacketApproved
  );
  const activeCaseWorkLabel = resolveActiveCaseWorkLabel(
    activeCaseDraftReviewed,
    preparedPacketApproved
  );
  const activeCaseSecondaryWorkLink =
    activeCaseDraftReviewed && preparedPacketApproved
      ? { href: "/justice/preview", label: "Submission preview" }
      : null;
  const chatFirstWorkLinkContinuity = Boolean(isSignedIn) && isUpdatingExistingCase;
  const chatFirstBreadcrumbContinuity = Boolean(isSignedIn);
  const breadcrumbWorkHref =
    chatFirstBreadcrumbContinuity || !isUpdatingExistingCase
      ? "/justice"
      : activeCaseWorkHref;
  const breadcrumbWorkLabel =
    chatFirstBreadcrumbContinuity || !isUpdatingExistingCase
      ? "Justice workspace"
      : activeCaseWorkLabel;

  return (
    <>
      <Header />
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-lg flex-col bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/" className="text-blue-600 hover:underline">
            Home
          </Link>
          {" · "}
          <Link
            href={breadcrumbWorkHref}
            className="text-blue-600 hover:underline"
          >
            {breadcrumbWorkLabel}
          </Link>
          {" · "}
          <Link href="/justice/chat" className="text-blue-600 hover:underline">
            Step-by-step chat
          </Link>
          {" · "}
          <Link href="/justice/intake" className="text-blue-600 hover:underline">
            Structured form
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Your consumer case
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {isUpdatingExistingCase
            ? "Update your loaded case in a conversation — describe what to add or change, then save in chat."
            : "Tell us what happened in a conversation; we'll ask follow-up questions and track your case details."}{" "}
          Prefer one question at a time?{" "}
          <Link href="/justice/chat" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            Use step-by-step chat
          </Link>
          .
        </p>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Messages are sent to OpenAI to help collect your case details. Nothing is filed automatically.
        </p>

        {isUpdatingExistingCase ? (
          <div className={`mt-4 ${activeCaseBannerCls}`} role="status" aria-label="Active case">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Active case
            </p>
            <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {parts.company_name.trim() || "Active case"}
            </p>
            {activeCaseSubline ? (
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{activeCaseSubline}</p>
            ) : null}
            <ul className="mt-2 space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
              <li>
                Basic case info: {activeCaseBasicsReady ? "yes" : "not yet"}
                {!activeCaseBasicsReady ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => document.getElementById("chat-ai-input")?.focus()}
                      className={activeCaseChecklistLinkCls}
                    >
                      Continue in chat below
                    </button>
                  </>
                ) : null}
              </li>
              <li>
                {!showSavedEvidenceCount ? (
                  "Evidence: loading..."
                ) : (
                  <>
                    Evidence: {activeCaseEvidenceReady ? "yes" : "not yet"}
                    {!activeCaseEvidenceReady ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          onClick={() => {
                            setProofNoteDetailsOpen(true);
                            document
                              .getElementById("chat-ai-proof-evidence-panel")
                              ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                          }}
                          className={activeCaseChecklistLinkCls}
                        >
                          Add proof below
                        </button>
                      </>
                    ) : null}
                  </>
                )}
              </li>
              <li>
                Submission draft reviewed: {activeCaseDraftReviewed ? "yes" : "not yet"}
                {!activeCaseDraftReviewed && !showInlineSubmissionDraftReview ? (
                  <>
                    {" · "}
                    <Link href="/justice/preview" className={activeCaseChecklistLinkCls}>
                      Review submission draft
                    </Link>
                  </>
                ) : null}
              </li>
              {activeCaseDraftReviewed ? (
                <li>
                  Prepared case packet reviewed: {preparedPacketApproved ? "yes" : "not yet"}
                  {!preparedPacketApproved && !showInlinePreparedPacketApproval ? (
                    <>
                      {" · "}
                      <Link href="/justice/packet" className={activeCaseChecklistLinkCls}>
                        Review prepared case packet
                      </Link>
                    </>
                  ) : null}
                </li>
              ) : null}
            </ul>
            {showInlineSubmissionDraftReview ? (
              <ChatInlineSubmissionDraftReviewBlock
                draftText={chatSubmissionDraftText}
                destinationLabel={chatPreviewDestination?.label}
                checked={submissionDraftReviewChecked}
                onCheckedChange={setSubmissionDraftReviewChecked}
                expanded={draftPreviewExpanded}
                onExpandedChange={setDraftPreviewExpanded}
                saving={markingSubmissionDraftReviewed}
                error={submissionDraftReviewError}
                onSubmit={() => void handleMarkSubmissionDraftReviewedFromChat()}
              />
            ) : null}
            {showInlinePreparedPacketApproval ? (
              <div className="mt-3 space-y-2 rounded-lg border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-700/60 dark:bg-emerald-950/30">
                <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">
                  Approve prepared packet
                </p>
                <p className="text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                  This approves the packet inside Surrenderless. It does not submit, file, or contact
                  anyone.
                </p>
                <label className="flex cursor-pointer items-start gap-2 text-[11px] text-emerald-900 dark:text-emerald-100">
                  <input
                    type="checkbox"
                    checked={approvePreparedPacketChecked}
                    onChange={(e) => setApprovePreparedPacketChecked(e.target.checked)}
                    className="mt-0.5"
                  />
                  I reviewed this prepared packet
                </label>
                <button
                  type="button"
                  disabled={!approvePreparedPacketChecked || approvingPreparedPacket}
                  onClick={() => void handleApprovePreparedPacketFromChat()}
                  className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  {approvingPreparedPacket ? "Saving…" : "Approve prepared packet"}
                </button>
              </div>
            ) : null}
            {approvedNextAction ? (
              <>
                {approvedNextAction.label?.trim() ? (
                  <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300">
                    Next step:{" "}
                    <strong className="text-neutral-800 dark:text-neutral-200">
                      {approvedNextAction.label.trim()}
                    </strong>
                  </p>
                ) : null}
                {approvedNextActionStatusLabel(approvedNextAction.status) ? (
                  <p className="mt-1 text-xs text-neutral-700 dark:text-neutral-300">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">
                      Approved next action:
                    </span>{" "}
                    {approvedNextActionStatusLabel(approvedNextAction.status)}
                  </p>
                ) : null}
                {approvedNextAction.outcome_note?.trim() ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                    {truncateAttentionNote(approvedNextAction.outcome_note.trim(), 200)}
                  </p>
                ) : null}
                {approvedNextAction.follow_up_needed === true ? (
                  <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                    Follow-up needed
                  </p>
                ) : null}
                {approvedNextAction.follow_up_at?.trim() ? (
                  <ApprovedNextActionFollowUpTimingLine
                    followUpAt={approvedNextAction.follow_up_at}
                    className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400"
                  />
                ) : null}
              </>
            ) : null}
            <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300">{activeCaseFocusLine}</p>
            {!chatFirstWorkLinkContinuity ? (
              <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <Link
                  href={activeCaseWorkHref}
                  className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {activeCaseWorkLabel}
                </Link>
                {activeCaseSecondaryWorkLink ? (
                  <>
                    <span className="text-neutral-400 dark:text-neutral-500">·</span>
                    <Link
                      href={activeCaseSecondaryWorkLink.href}
                      className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {activeCaseSecondaryWorkLink.label}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className={`mt-6 flex min-h-[280px] flex-1 flex-col ${cardCls}`}>
          <div ref={scrollRef} className="max-h-[min(420px,50vh)] flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "assistant"
                    ? "rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                    : "ml-6 rounded-xl bg-blue-600 px-3 py-2 text-sm text-white"
                }
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>
            ))}
            {loading ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Thinkingâ€¦</p>
            ) : null}
          </div>

          <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-700/80">
            <label className={labelCls} htmlFor="chat-ai-input">
              Your message
            </label>
            <textarea
              id="chat-ai-input"
              className={`${inputCls} min-h-[88px] resize-y`}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setApiError(null);
              }}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !loading && !sendInFlightRef.current) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            {apiError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{apiError}</p> : null}
            <button
              type="button"
              disabled={loading || !inputValue.trim()}
              onClick={() => void handleSend()}
              className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Sendingâ€¦" : "Send"}
            </button>
          </div>

          <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-700/80">
            <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Recap</p>
            <ul className="mt-2 space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
              <li>
                <span className="font-medium">Company:</span> {parts.company_name || "â€”"}
              </li>
              <li>
                <span className="font-medium">Category:</span> {categoryLabel(parts.problem_category)}
              </li>
              <li>
                <span className="font-medium">Product / service:</span> {parts.purchase_or_signup || "â€”"}
              </li>
              <li>
                <span className="font-medium">What happened:</span> {recapStoryDisplay(parts.story)}
              </li>
              <li>
                <span className="font-medium">Money / outcome:</span>{" "}
                {[parts.money_amount, parts.desired_resolution].filter(Boolean).join(" â€” ") || "â€”"}
              </li>
              <li>
                <span className="font-medium">Contacted company:</span> {parts.already_contacted}
              </li>
              <li>
                <span className="font-medium">Email:</span> {parts.reply_email || "â€”"}
              </li>
            </ul>
            {stillNeededHint ? (
              <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">{stillNeededHint}</p>
            ) : null}
            {contactProofError && contactProofError !== stillNeededHint ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{contactProofError}</p>
            ) : null}

            {isUpdatingExistingCase && approvedNextAction ? (
              <div className="mt-4 rounded-xl border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 ring-1 ring-emerald-600/15 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:ring-emerald-400/10">
                <p className="text-xs font-semibold text-emerald-950 dark:text-emerald-100">
                  Current action tracking
                </p>
                {approvedNextAction.label ? (
                  <p className="mt-1 text-xs text-emerald-900/95 dark:text-emerald-100/95">
                    Next step: <strong>{approvedNextAction.label}</strong>
                  </p>
                ) : null}
                {approvedNextActionStatusLabel(approvedNextAction.status) ? (
                  <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">
                      Approved next action:
                    </span>{" "}
                    {approvedNextActionStatusLabel(approvedNextAction.status)}
                  </p>
                ) : null}
                {approvedNextAction.status === "approved" &&
                approvedNextAction.href?.trim() &&
                approvedNextAction.label?.trim() ? (
                  <>
                    <p className="mt-1.5 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                      Records this step as opened in Surrenderless. It does not submit, file, or
                      contact anyone.
                    </p>
                    <button
                      type="button"
                      disabled={markingActionStarted}
                      onClick={() => void handleApprovedNextActionOpen()}
                      className="mt-2 inline-flex rounded-lg border border-emerald-400/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-600/60 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
                    >
                      {markingActionStarted ? "Saving…" : "Mark step opened"}
                    </button>
                    <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                      Tracking only — not automatic filing or submission.
                    </p>
                    <p className="mt-1.5 text-xs text-emerald-800 dark:text-emerald-200">
                      <Link
                        href={approvedNextAction.href.trim()}
                        className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                      >
                        Open {approvedNextAction.label.trim()} (optional)
                      </Link>
                    </p>
                  </>
                ) : null}
                {approvedNextAction.status === "started" ? (
                  <>
                    <p className="mt-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                      Opened for next step.
                    </p>
                    {approvedNextAction.started_at?.trim() ? (
                      <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                        Opened{" "}
                        {formatApprovedNextActionHandlingTimestamp(
                          approvedNextAction.started_at.trim()
                        )}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={markingActionHandled}
                      onClick={() => void handleMarkApprovedNextActionHandled()}
                      className="mt-2 inline-flex rounded-lg border border-emerald-400/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-600/60 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
                    >
                      {markingActionHandled ? "Saving…" : "Record action handled for now"}
                    </button>
                    <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                      Tracking only — not automatic filing or submission.
                    </p>
                  </>
                ) : null}
                {approvedNextAction.status === "completed" ? (
                  <>
                    <p className="mt-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                      Next action recorded as handled for now
                      {approvedNextAction.label ? (
                        <>
                          {": "}
                          <strong>{approvedNextAction.label}</strong>
                        </>
                      ) : null}
                      .
                    </p>
                    {approvedNextAction.completed_at?.trim() ? (
                      <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                        Handled for now{" "}
                        {formatApprovedNextActionHandlingTimestamp(
                          approvedNextAction.completed_at.trim()
                        )}
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                      Tracking only — not automatic filing or submission.
                    </p>
                    {chatOutcomeTrackingFormOpen(approvedNextAction) ? (
                      <ApprovedNextActionOutcomeTrackingForm
                        action={approvedNextAction}
                        onSave={handleSaveApprovedNextActionTracking}
                      />
                    ) : approvedNextAction.outcome_note?.trim() ? (
                      <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-emerald-900/95 dark:text-emerald-100/95">
                        {approvedNextAction.outcome_note.trim()}
                      </p>
                    ) : null}
                  </>
                ) : null}
                {showChatApprovedPacketActionHandlingTracking({
                  preparedPacketApproved,
                  approvedNextAction,
                }) ? (
                  <>
                    <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80 dark:text-emerald-200/80">
                      Approved case packet and next in-app step — not a Surrenderless handling request.
                      Request handling below when you want internal triage tracking.
                    </p>
                    <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">
                      <Link
                        href="/justice/handling"
                        className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                      >
                        View on handling workbench
                      </Link>
                    </p>
                    <ChatHandlingTrackingStatusReadOnly
                      readinessLoading={chatHandlingReadinessLoading}
                      approvedNextAction={approvedNextAction}
                      basicsReady={activeCaseBasicsReady}
                      draftReviewed={activeCaseDraftReviewed}
                      preparedPacketApproved={preparedPacketApproved}
                      evidenceCount={savedEvidenceCount ?? 0}
                      filings={savedFilings}
                      markAcknowledgedOnScreen={false}
                      canCaptureFiling={Boolean(activeUuidCaseId) && isLoaded && Boolean(isSignedIn)}
                      caseId={activeUuidCaseId}
                      onFilingsSaved={refreshChatFilings}
                      canArchiveCase={Boolean(activeUuidCaseId) && isLoaded && Boolean(isSignedIn)}
                      onArchiveCase={(id) => void handleArchiveActiveCase(id)}
                      archiving={archivingCase}
                    />
                  </>
                ) : null}
                {approvedNextAction.handling_requested_at?.trim() ? (
                  approvedNextAction.status === "completed" ? (
                    <ApprovedNextActionHandlingRequestedReadOnly
                      requestedAt={approvedNextAction.handling_requested_at.trim()}
                      requestNote={approvedNextAction.handling_request_note}
                      acknowledgedAt={approvedNextAction.handling_acknowledged_at}
                      wrapperClassName="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-2.5 py-2 dark:border-emerald-600/40 dark:bg-emerald-950/40"
                      recordedClassName="mt-0.5"
                    />
                  ) : (
                    <ApprovedNextActionHandlingRequestBlock
                      action={approvedNextAction}
                      onRequest={handleRequestSurrenderlessHandling}
                      onUpdateNote={handleUpdateHandlingRequestNote}
                      allowEditNote
                      requesting={requestingHandling}
                      updatingNote={updatingHandlingNote}
                      wrapperClassName="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-2.5 py-2 dark:border-emerald-600/40 dark:bg-emerald-950/40"
                      recordedClassName="mt-0.5"
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
                    wrapperClassName="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-2.5 py-2 dark:border-emerald-600/40 dark:bg-emerald-950/40"
                    recordedClassName="mt-0.5"
                  />
                ) : null}
                {approvedNextAction.handling_requested_at?.trim() ? (
                  <>
                    <ApprovedNextActionHandlingQueueStatusReadOnly
                      handlingRequestedAt={approvedNextAction.handling_requested_at.trim()}
                      handlingAcknowledgedAt={approvedNextAction.handling_acknowledged_at}
                      className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90"
                    />
                    <ChatHandlingTrackingStatusReadOnly
                      readinessLoading={chatHandlingReadinessLoading}
                      approvedNextAction={approvedNextAction}
                      basicsReady={activeCaseBasicsReady}
                      draftReviewed={activeCaseDraftReviewed}
                      preparedPacketApproved={preparedPacketApproved}
                      evidenceCount={savedEvidenceCount ?? 0}
                      filings={savedFilings}
                      markAcknowledgedOnScreen={!approvedNextAction.handling_acknowledged_at?.trim()}
                      canCaptureFiling={Boolean(activeUuidCaseId) && isLoaded && Boolean(isSignedIn)}
                      caseId={activeUuidCaseId}
                      onFilingsSaved={refreshChatFilings}
                      canArchiveCase={Boolean(activeUuidCaseId) && isLoaded && Boolean(isSignedIn)}
                      onArchiveCase={(id) => void handleArchiveActiveCase(id)}
                      archiving={archivingCase}
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
                          {acknowledgingHandling ? "Savingâ€¦" : "Mark acknowledged"}
                        </button>
                        <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80 sm:max-w-[14rem]">
                          {APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {approvedNextAction.status !== "completed" ? (
                  <>
                    {approvedNextAction.outcome_note?.trim() ? (
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-emerald-900/95 dark:text-emerald-100/95">
                        {approvedNextAction.outcome_note.trim()}
                      </p>
                    ) : null}
                    {approvedNextAction.follow_up_needed === true ? (
                      <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                        Follow-up needed
                      </p>
                    ) : null}
                    <ApprovedNextActionFollowUpTimingLine
                      followUpAt={approvedNextAction.follow_up_at}
                      className="mt-1 text-emerald-800 dark:text-emerald-200"
                    />
                  </>
                ) : null}
                <p className="mt-2 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                  {APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER}
                </p>
                {approvedNextAction.follow_up_needed === true ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      disabled={clearingFollowUp}
                      onClick={() => void clearApprovedNextActionFollowUp()}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      {clearingFollowUp ? "Clearingâ€¦" : "Mark follow-up handled"}
                    </button>
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-400 sm:max-w-[14rem]">
                      Clears this from Needs attention on Saved cases. Your outcome note and dates stay saved. Not automatic filing or submission.
                    </p>
                  </div>
                ) : null}
                {!chatFirstWorkLinkContinuity ? (
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <Link
                      href={activeCaseWorkHref}
                      className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                    >
                      {activeCaseWorkLabel}
                    </Link>
                    {activeCaseSecondaryWorkLink ? (
                      <>
                        <span className="text-emerald-700/60 dark:text-emerald-400/60">·</span>
                        <Link
                          href={activeCaseSecondaryWorkLink.href}
                          className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                        >
                          {activeCaseSecondaryWorkLink.label}
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div
              id="chat-ai-proof-evidence-panel"
              className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/80 p-3 ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/50 dark:ring-white/[0.04]"
            >
              <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                Proof / evidence
              </p>
              {showSavedEvidenceCount ? (
                <p className="mt-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  {savedEvidenceCount === 0
                    ? "No saved evidence yet."
                    : `Saved evidence: ${savedEvidenceCount} item${savedEvidenceCount === 1 ? "" : "s"}.`}
                </p>
              ) : null}
              {showStagedProofNotes ? (
                <>
                  <p className="mt-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    Pending proof notes: {stagedProofNotes.length} item
                    {stagedProofNotes.length === 1 ? "" : "s"}
                    {canStageProofNoteInChat
                      ? " (on this device until you save your case in chat)."
                      : " (pending upload — Continue to save to your case)."}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {stagedProofNotes.map((note) => {
                      const descPreview = truncateChatEvidenceDescription(
                        note.description ?? null,
                        CHAT_EVIDENCE_DESC_PREVIEW_MAX
                      );
                      return (
                        <li
                          key={note.clientId}
                          className="rounded-lg border border-neutral-200/80 bg-white/60 px-3 py-2 dark:border-neutral-600/80 dark:bg-neutral-900/40"
                        >
                          <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                            {note.title}
                          </p>
                          <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                            {chatEvidenceTypeLabel(note.evidence_type)}
                          </p>
                          {note.evidence_date ? (
                            <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                              {note.evidence_date}
                            </p>
                          ) : null}
                          {descPreview ? (
                            <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">
                              {descPreview}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
              {showRecentEvidencePreview ? (
                <details className="mt-2 rounded-lg border border-neutral-200/80 bg-white/60 px-3 py-2 dark:border-neutral-600/80 dark:bg-neutral-900/40">
                  <summary className="cursor-pointer text-xs font-medium text-neutral-800 dark:text-neutral-200">
                    Recent proof notes
                    {savedEvidenceCount > CHAT_RECENT_EVIDENCE_MAX
                      ? ` (${CHAT_RECENT_EVIDENCE_MAX} of ${savedEvidenceCount})`
                      : ` (${recentEvidenceRows.length})`}
                  </summary>
                  <p className="mt-2 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                    Metadata only — descriptions are shortened in the list. Edit or delete recent notes here. Use
                    Organize evidence for the full list and optional links.
                  </p>
                  {recentEvidenceEditSuccess ? (
                    <p className="mt-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                      {recentEvidenceEditSuccess}
                    </p>
                  ) : null}
                  {recentEvidenceDeleteSuccess ? (
                    <p className="mt-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                      {recentEvidenceDeleteSuccess}
                    </p>
                  ) : null}
                  {recentEvidenceDeleteError ? (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">{recentEvidenceDeleteError}</p>
                  ) : null}
                  <ul className="mt-2 space-y-2">
                    {recentEvidenceRows.map((row) => {
                      const descPreview = truncateChatEvidenceDescription(
                        row.description,
                        CHAT_EVIDENCE_DESC_PREVIEW_MAX
                      );
                      return (
                        <li
                          key={row.id}
                          className="border-t border-neutral-100 pt-2 first:border-t-0 first:pt-0 dark:border-neutral-700/80"
                        >
                          {editingRecentEvidenceId === row.id ? (
                            <form
                              className="space-y-2"
                              onSubmit={(e) => void handleSaveRecentEvidenceEdit(e, row.id)}
                            >
                              <p className="text-[11px] font-medium text-neutral-800 dark:text-neutral-200">
                                Edit proof note
                              </p>
                              <div>
                                <label className={labelCls} htmlFor={`chat-ai-edit-proof-title-${row.id}`}>
                                  Title
                                </label>
                                <input
                                  id={`chat-ai-edit-proof-title-${row.id}`}
                                  className={inputCls}
                                  value={editRecentEvidenceTitle}
                                  onChange={(e) => {
                                    setEditRecentEvidenceTitle(e.target.value);
                                    setRecentEvidenceEditError(null);
                                    setRecentEvidenceEditSuccess(null);
                                  }}
                                  required
                                  maxLength={500}
                                  autoComplete="off"
                                  disabled={savingRecentEvidenceEdit}
                                />
                              </div>
                              <div>
                                <label className={labelCls} htmlFor={`chat-ai-edit-proof-type-${row.id}`}>
                                  Type
                                </label>
                                <select
                                  id={`chat-ai-edit-proof-type-${row.id}`}
                                  className={inputCls}
                                  value={editRecentEvidenceType}
                                  onChange={(e) => {
                                    setEditRecentEvidenceType(e.target.value as JusticeEvidenceType);
                                    setRecentEvidenceEditSuccess(null);
                                  }}
                                  disabled={savingRecentEvidenceEdit}
                                >
                                  {JUSTICE_EVIDENCE_TYPES.map((t) => (
                                    <option key={t} value={t}>
                                      {JUSTICE_EVIDENCE_TYPE_LABELS[t]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className={labelCls} htmlFor={`chat-ai-edit-proof-date-${row.id}`}>
                                  Evidence date{" "}
                                  <span className="font-normal text-neutral-500 dark:text-neutral-400">
                                    (optional)
                                  </span>
                                </label>
                                <input
                                  id={`chat-ai-edit-proof-date-${row.id}`}
                                  className={inputCls}
                                  value={editRecentEvidenceDate}
                                  onChange={(e) => {
                                    setEditRecentEvidenceDate(e.target.value);
                                    setRecentEvidenceEditError(null);
                                    setRecentEvidenceEditSuccess(null);
                                  }}
                                  maxLength={200}
                                  autoComplete="off"
                                  disabled={savingRecentEvidenceEdit}
                                  placeholder="e.g. 2026-01-15 or March phone call"
                                />
                              </div>
                              <div>
                                <label className={labelCls} htmlFor={`chat-ai-edit-proof-desc-${row.id}`}>
                                  Description{" "}
                                  <span className="font-normal text-neutral-500 dark:text-neutral-400">
                                    (optional)
                                  </span>
                                </label>
                                <textarea
                                  id={`chat-ai-edit-proof-desc-${row.id}`}
                                  className={`${inputCls} min-h-[72px] resize-y`}
                                  value={editRecentEvidenceDescription}
                                  onChange={(e) => {
                                    setEditRecentEvidenceDescription(e.target.value);
                                    setRecentEvidenceEditError(null);
                                    setRecentEvidenceEditSuccess(null);
                                  }}
                                  maxLength={8000}
                                  disabled={savingRecentEvidenceEdit}
                                  placeholder="What this shows, ticket numbers, etc."
                                />
                              </div>
                              {recentEvidenceEditError ? (
                                <p className="text-xs text-red-600 dark:text-red-400">
                                  {recentEvidenceEditError}
                                </p>
                              ) : null}
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="submit"
                                  disabled={savingRecentEvidenceEdit || !editRecentEvidenceTitle.trim()}
                                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                                >
                                  {savingRecentEvidenceEdit ? "Savingâ€¦" : "Save"}
                                </button>
                                <button
                                  type="button"
                                  disabled={savingRecentEvidenceEdit}
                                  onClick={cancelEditRecentEvidence}
                                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <>
                              <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                                {row.title}
                              </p>
                              <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                                {chatEvidenceTypeLabel(row.evidence_type)}
                              </p>
                              {row.evidence_date ? (
                                <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                                  {row.evidence_date}
                                </p>
                              ) : null}
                              {descPreview ? (
                                <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">
                                  {descPreview}
                                </p>
                              ) : null}
                              <div className="mt-1.5 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={
                                    savingRecentEvidenceEdit ||
                                    deletingRecentEvidenceId !== null ||
                                    Boolean(editingRecentEvidenceId)
                                  }
                                  onClick={() => startEditRecentEvidence(row)}
                                  className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    savingRecentEvidenceEdit ||
                                    Boolean(editingRecentEvidenceId) ||
                                    deletingRecentEvidenceId !== null
                                  }
                                  onClick={() => void handleDeleteRecentEvidence(row.id)}
                                  className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-800 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/50 dark:bg-neutral-900 dark:text-red-200 dark:hover:bg-red-950/40"
                                >
                                  {deletingRecentEvidenceId === row.id ? "Deleting…" : "Delete"}
                                </button>
                              </div>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}
              <p className="mt-2 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
                As we build your case in this chat, Surrenderless can organize proof that strengthens it â€” for example
                screenshots, receipts, order confirmations, emails, account pages, tracking pages, call notes, or chat
                transcripts. Add short notes (and optional links) for what you have on file; file uploads are not
                available yet.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                You can continue in chat without proof for now. Review your submission draft in the Active case
                checklist when ready. Before you escalate or submit complaints, saving at least one proof note helps —
                nothing is filed automatically from this app yet.
              </p>
              {canAddProofNoteInChat && showProofKeywordNudge ? (
                <div className="mt-3 rounded-lg border border-amber-200/90 bg-amber-50/80 px-3 py-2 dark:border-amber-800/60 dark:bg-amber-950/30">
                  <p className="text-[11px] leading-relaxed text-amber-950 dark:text-amber-100">
                    You mentioned records that could support your case. Add a short proof note below — title,
                    type, optional date/description. This saves metadata only, not a file upload.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowProofKeywordNudge(false)}
                    className="mt-2 rounded-lg border border-amber-300/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-950 shadow-sm transition hover:bg-amber-50 dark:border-amber-700/60 dark:bg-neutral-900 dark:text-amber-100 dark:hover:bg-amber-950/50"
                  >
                    Got it
                  </button>
                </div>
              ) : null}
              {canUseProofNoteForm ? (
                <details
                  open={proofNoteDetailsOpen}
                  onToggle={(e) => setProofNoteDetailsOpen(e.currentTarget.open)}
                  className="mt-3 rounded-lg border border-neutral-200/80 bg-white/60 px-3 py-2 dark:border-neutral-600/80 dark:bg-neutral-900/40"
                >
                  <summary className="cursor-pointer text-xs font-medium text-neutral-800 dark:text-neutral-200">
                    Add a proof note
                  </summary>
                  <form className="mt-2 space-y-2" onSubmit={(e) => void handleAddProofNote(e)}>
                    <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                      {canStageProofNoteInChat
                        ? "Stage metadata about what you have on file (not a file upload). Staged on this device until you save your case in chat."
                        : "Save metadata about what you have on file (not a file upload)."}
                    </p>
                    <div>
                      <label className={labelCls} htmlFor="chat-ai-proof-title">
                        Title
                      </label>
                      <input
                        id="chat-ai-proof-title"
                        className={inputCls}
                        value={proofNoteTitle}
                        onChange={(e) => {
                          setProofNoteTitle(e.target.value);
                          setProofNoteError(null);
                          setProofNoteSuccess(null);
                        }}
                        required
                        maxLength={500}
                        autoComplete="off"
                        disabled={savingProofNote}
                        placeholder="e.g. Receipt for order #1234"
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="chat-ai-proof-type">
                        Type
                      </label>
                      <select
                        id="chat-ai-proof-type"
                        className={inputCls}
                        value={proofNoteType}
                        onChange={(e) => {
                          setProofNoteType(e.target.value as JusticeEvidenceType);
                          setProofNoteSuccess(null);
                        }}
                        disabled={savingProofNote}
                      >
                        {JUSTICE_EVIDENCE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {JUSTICE_EVIDENCE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="chat-ai-proof-date">
                        Evidence date{" "}
                        <span className="font-normal text-neutral-500 dark:text-neutral-400">(optional)</span>
                      </label>
                      <input
                        id="chat-ai-proof-date"
                        className={inputCls}
                        value={proofNoteEvidenceDate}
                        onChange={(e) => {
                          setProofNoteEvidenceDate(e.target.value);
                          setProofNoteError(null);
                          setProofNoteSuccess(null);
                        }}
                        maxLength={200}
                        autoComplete="off"
                        disabled={savingProofNote}
                        placeholder="e.g. 2026-01-15 or March phone call"
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="chat-ai-proof-desc">
                        Description{" "}
                        <span className="font-normal text-neutral-500 dark:text-neutral-400">(optional)</span>
                      </label>
                      <textarea
                        id="chat-ai-proof-desc"
                        className={`${inputCls} min-h-[72px] resize-y`}
                        value={proofNoteDescription}
                        onChange={(e) => {
                          setProofNoteDescription(e.target.value);
                          setProofNoteError(null);
                          setProofNoteSuccess(null);
                        }}
                        maxLength={8000}
                        disabled={savingProofNote}
                        placeholder="What this shows, ticket numbers, etc."
                      />
                    </div>
                    {proofNoteError ? (
                      <p className="text-xs text-red-600 dark:text-red-400">{proofNoteError}</p>
                    ) : null}
                    {proofNoteSuccess ? (
                      <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                        {proofNoteSuccess}
                      </p>
                    ) : null}
                    <button
                      type="submit"
                      disabled={savingProofNote || !proofNoteTitle.trim()}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      {savingProofNote
                        ? "Saving…"
                        : canStageProofNoteInChat
                          ? "Stage proof note"
                          : "Save proof note"}
                    </button>
                  </form>
                </details>
              ) : null}
              {stagedProofFlushError ? (
                <p className="mt-3 text-xs text-red-600 dark:text-red-400">{stagedProofFlushError}</p>
              ) : null}
              <Link
                href="/justice/evidence"
                className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm transition hover:bg-blue-50 dark:border-blue-500 dark:bg-neutral-900 dark:text-blue-400 dark:hover:bg-neutral-800"
              >
                Organize evidence
              </Link>
            </div>

            {basicsMissing.length === 0 && !contactProofCheck.ok ? (
              <p className="mt-4 text-sm text-amber-800 dark:text-amber-300">
                {contactProofCheck.message}
              </p>
            ) : null}
            {showSessionChangesPanel ? (
              <div
                className="mt-4 rounded-xl border border-blue-200/90 bg-blue-50/50 px-3 py-2.5 ring-1 ring-blue-950/[0.04] dark:border-blue-900/50 dark:bg-blue-950/20 dark:ring-blue-500/10"
                role="status"
                aria-label="Updated in this chat"
              >
                <p className="text-xs font-semibold uppercase text-blue-800 dark:text-blue-200">
                  Updated in this chat
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {sessionChangeLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                  Review these updates, then save in chat when ready.
                </p>
              </div>
            ) : null}
            {showContinueHandoff ? (
              <div className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/80 px-3 py-2.5 ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/50 dark:ring-white/[0.04]">
                <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                  What happens next
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {continueHandoffSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <button
              type="button"
              disabled={submitting || loading || basicsMissing.length > 0}
              onClick={() => void handleContinueToPreview()}
              className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save and continue in chat"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
