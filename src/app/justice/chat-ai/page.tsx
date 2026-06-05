"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validate as isUuid } from "uuid";
import Header from "@/app/components/Header";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import { ApprovedNextActionFollowUpTimingLine } from "@/lib/justice/approvedNextActionFollowUp";
import {
  APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER,
  APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER,
  ApprovedNextActionHandlingHandledOpenTriageNote,
  ApprovedNextActionHandlingQueueStatusReadOnly,
  ApprovedNextActionHandlingRequestBlock,
  ApprovedNextActionHandlingRequestedReadOnly,
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
import {
  applyServerTimelineFromResponse,
  readTimeline,
  SUBMISSION_DRAFT_REVIEWED_TIMELINE_ID,
} from "@/lib/justice/timeline";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
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
  "Hi â€” tell me whatâ€™s going on with your consumer issue. Iâ€™ll ask follow-up questions and keep track of your case details. When weâ€™re done, you can review everything and continue to your submission preview.";

const UPDATE_GREETING =
  "Your current case is loaded in the recap below. Tell me what youâ€™d like to add or change â€” Iâ€™ll update the details as we go. When youâ€™re ready, continue to your submission preview.";

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

function resolveActiveCaseWorkHref(
  draftReviewed: boolean,
  packetApproved: boolean
): string {
  if (!draftReviewed) return "/justice/preview";
  if (!packetApproved) return "/justice/packet";
  return "/justice/plan";
}

function resolveActiveCaseWorkLabel(
  draftReviewed: boolean,
  packetApproved: boolean
): string {
  if (!draftReviewed) return "Submission preview";
  if (!packetApproved) return "Review prepared case packet";
  return "Action plan";
}

type ContinueHandoffStepsInput = {
  isUpdatingExistingCase: boolean;
  stagedCount: number;
  isStagedFlushRetry: boolean;
  savedEvidenceCount: number;
  sessionChangeLines?: string[];
};

function getContinueHandoffSteps(input: ContinueHandoffStepsInput): string[] {
  const previewStep =
    "Open submission draft preview to review your case text (nothing is filed automatically).";
  const postPreviewFunnelStep =
    "After preview, review your prepared case packet, then continue to your action plan when ready. Nothing is filed automatically.";

  if (input.isStagedFlushRetry) {
    const noteWord = input.stagedCount === 1 ? "note" : "notes";
    return [
      `Save ${input.stagedCount} pending proof ${noteWord} to your case.`,
      previewStep,
      postPreviewFunnelStep,
    ];
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

  steps.push(previewStep, postPreviewFunnelStep);
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

const CHAT_RECENT_EVIDENCE_MAX = 3;
const CHAT_EVIDENCE_DESC_PREVIEW_MAX = 120;

function chatEvidenceTypeLabel(t: string): string {
  return isJusticeEvidenceType(t) ? JUSTICE_EVIDENCE_TYPE_LABELS[t] : t.replace(/_/g, " ");
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
  const evidenceRefetchAbortRef = useRef<AbortController | null>(null);
  const proofKeywordNudgeOfferedRef = useRef(false);

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

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) {
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
      router.push(navigateHref);
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
      setRecentEvidenceRows([]);
      return;
    }
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId || !isUuid(caseId)) {
      setSavedEvidenceCount(null);
      setRecentEvidenceRows([]);
      return;
    }
    try {
      const res = await fetch(`/api/justice/evidence?case_id=${encodeURIComponent(caseId)}`, {
        signal,
      });
      if (!res.ok) {
        if (!signal.aborted) {
          setSavedEvidenceCount(null);
          setRecentEvidenceRows([]);
        }
        return;
      }
      const evJson: unknown = await res.json();
      if (!signal.aborted) {
        const rows = Array.isArray(evJson) ? (evJson as JusticeCaseEvidenceRow[]) : [];
        const count = rows.length;
        if (sessionBaselineEvidenceCountRef.current === null) {
          sessionBaselineEvidenceCountRef.current = count;
        }
        setSavedEvidenceCount(count);
        setRecentEvidenceRows(rows.slice(0, CHAT_RECENT_EVIDENCE_MAX));
      }
    } catch {
      if (!signal.aborted) {
        setSavedEvidenceCount(null);
        setRecentEvidenceRows([]);
      }
    }
  }, [isUpdatingExistingCase, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isUpdatingExistingCase || !isLoaded || !isSignedIn) {
      setSavedEvidenceCount(null);
      setRecentEvidenceRows([]);
      return;
    }
    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
    if (!caseId || !isUuid(caseId)) {
      setSavedEvidenceCount(null);
      setRecentEvidenceRows([]);
      return;
    }

    const ac = new AbortController();
    void loadSavedEvidencePreview(ac.signal);
    return () => ac.abort();
  }, [isUpdatingExistingCase, isLoaded, isSignedIn, loadSavedEvidencePreview]);

  useEffect(() => {
    if (!isUpdatingExistingCase || !isLoaded || !isSignedIn) return;

    function refetchEvidence() {
      const caseId =
        typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
      if (!caseId || !isUuid(caseId)) return;
      evidenceRefetchAbortRef.current?.abort();
      const ac = new AbortController();
      evidenceRefetchAbortRef.current = ac;
      void loadSavedEvidencePreview(ac.signal);
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
  }, [isUpdatingExistingCase, isLoaded, isSignedIn, loadSavedEvidencePreview]);

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
      setProofNoteTitle("");
      setProofNoteEvidenceDate("");
      setProofNoteDescription("");
      setProofNoteSuccess("Proof note saved.");
      setShowProofKeywordNudge(false);
      const ac = new AbortController();
      void loadSavedEvidencePreview(ac.signal);
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
      const ac = new AbortController();
      void loadSavedEvidencePreview(ac.signal);
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
      const ac = new AbortController();
      void loadSavedEvidencePreview(ac.signal);
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
      setRecentEvidenceRows([]);
      setEditingRecentEvidenceId(null);
      setRecentEvidenceEditError(null);
      setRecentEvidenceEditSuccess(null);
      setDeletingRecentEvidenceId(null);
      setRecentEvidenceDeleteError(null);
      setRecentEvidenceDeleteSuccess(null);
      setShowProofKeywordNudge(false);
      setProofNoteDetailsOpen(false);
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
      setParts(data.parts);
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
      })
    : [];

  const activeCaseSessionCaseId =
    typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";
  const activeCaseDraftReviewed = activeCaseSessionCaseId
    ? submissionDraftReviewedInTimeline(activeCaseSessionCaseId)
    : false;
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
        : "Describe what to add or change, then continue to preview.";
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
      : activeCaseDraftReviewed && !preparedPacketApproved
        ? { href: "/justice/plan", label: "Action plan" }
        : null;

  return (
    <>
      <Header />
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-lg flex-col bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/" className="text-blue-600 hover:underline">
            Home
          </Link>
          {" Â· "}
          <Link href="/justice/plan" className="text-blue-600 hover:underline">
            Action plan
          </Link>
          {" Â· "}
          <Link href="/justice/chat" className="text-blue-600 hover:underline">
            Step-by-step chat
          </Link>
          {" Â· "}
          <Link href="/justice/intake" className="text-blue-600 hover:underline">
            Structured form
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Your consumer case
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {isUpdatingExistingCase
            ? "Update your loaded case in a conversation â€” describe what to add or change, then continue to preview."
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
                {!activeCaseDraftReviewed ? (
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
                  {!preparedPacketApproved ? (
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
              </>
            ) : null}
            <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300">{activeCaseFocusLine}</p>
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
                      Opens your in-app step for tracking — nothing is filed or sent automatically.
                    </p>
                    <button
                      type="button"
                      disabled={markingActionStarted}
                      onClick={() => void handleApprovedNextActionOpen()}
                      className="mt-2 inline-flex rounded-lg border border-emerald-400/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-600/60 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
                    >
                      {markingActionStarted ? "Saving…" : `Open ${approvedNextAction.label}`}
                    </button>
                    <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                      Tracking only — not automatic filing or submission.
                    </p>
                  </>
                ) : null}
                {approvedNextAction.status === "started" ? (
                  <>
                    <p className="mt-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                      Opened for next step.
                    </p>
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
                    <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                      Tracking only — not automatic filing or submission.
                    </p>
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
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <Link
                    href="/justice/plan"
                    className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                  >
                    Action plan
                  </Link>
                  <span className="text-emerald-700/60 dark:text-emerald-400/60">Â·</span>
                  <Link
                    href="/justice/packet"
                    className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                  >
                    Case packet
                  </Link>
                </p>
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
                      ? " (on this device until you continue to preview)."
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
                You can continue to your submission preview without proof for now. Before you escalate or submit
                complaints, saving at least one proof note helps â€” nothing is filed automatically from this app yet.
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
                        ? "Stage metadata about what you have on file (not a file upload). Staged on this device until you continue to preview."
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
                  Review these updates, then continue to your submission draft preview when ready.
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
              {submitting ? "Saving…" : "Continue to submission preview"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
