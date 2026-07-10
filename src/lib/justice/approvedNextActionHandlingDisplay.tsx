"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";
import { isChatInlinePrepHref } from "@/lib/justice/chatInlineApprovedPrep";
import { isChatAiMainLadderOffChatHref } from "@/lib/justice/chatAiLadderNavigation";
import { resolveAssistedSubmissionLaneForApprovedHref } from "@/lib/justice/assistedSubmissionLane";

/** Read-only / interactive copy for approved-next-action handling request tracking. */

export const APPROVED_NEXT_ACTION_HANDLING_REQUESTED_LABEL =
  "Surrenderless handling requested";

export const APPROVED_NEXT_ACTION_HANDLING_TRACKING_SECTION_LABEL =
  "Surrenderless handling (tracking)";

export const APPROVED_NEXT_ACTION_HANDLING_TRACKING_ARIA_LABEL =
  "Surrenderless handling request tracking";

export const APPROVED_NEXT_ACTION_HANDLING_PENDING_DESCRIPTION =
  "Mark that you want Surrenderless to handle this approved step inside the app when that workflow exists. This does not start any external process today.";

export const APPROVED_NEXT_ACTION_REQUEST_HANDLING_BUTTON_LABEL =
  "Request Surrenderless handling";

export const APPROVED_NEXT_ACTION_REQUEST_HANDLING_SAVING_LABEL = "Saving…";

export const APPROVED_NEXT_ACTION_HANDLING_REQUEST_NOTE_PROMPT =
  "What do you want Surrenderless to handle when this workflow exists?";

export const APPROVED_NEXT_ACTION_HANDLING_REQUEST_NOTE_DISPLAY_LABEL =
  "What you asked Surrenderless to handle";

export const APPROVED_NEXT_ACTION_HANDLING_REQUEST_NOTE_MAX_LENGTH = 500;

export const APPROVED_NEXT_ACTION_SAVE_HANDLING_NOTE_BUTTON_LABEL = "Save request note";

export const APPROVED_NEXT_ACTION_SAVE_HANDLING_NOTE_SAVING_LABEL = "Saving…";

const HANDLING_NOTE_TEXTAREA_CLS =
  "mt-1 w-full resize-y rounded-lg border border-emerald-300/80 bg-white px-2.5 py-1.5 text-xs text-emerald-950 placeholder:text-emerald-800/50 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-60 dark:border-emerald-700/60 dark:bg-emerald-950/50 dark:text-emerald-50 dark:placeholder:text-emerald-200/40";

/** Emerald callout blocks (plan, chat, packet). */
export const APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER_WITH_YET =
  "In-app tracking only — Surrenderless has not filed, submitted, sent, queued externally, or contacted anyone yet.";

/** Neutral footers (hub, cases needs-attention, chat tracking footer). */
export const APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER =
  "In-app tracking only — Surrenderless has not filed, submitted, sent, queued externally, or contacted anyone.";

export const APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER =
  "Acknowledged means internal tracking triage only. Surrenderless has not filed, submitted, sent, queued externally, or contacted anyone.";

/** Shared manual-action gate copy — parity with workbench `deriveManualActionNextStep`. */
export const HANDLING_TRACKING_STEP_REVIEW_PACKET =
  "Review packet and saved proof before external manual action.";

export const HANDLING_TRACKING_STEP_OPEN_APPROVED =
  "Open the approved step and prepare the manual action.";

export const HANDLING_TRACKING_STEP_ADD_FILING =
  "Add filing records from the case packet after external submission.";

export const HANDLING_TRACKING_STEP_ADD_CONFIRMATION =
  "Add or edit the filing confirmation from the case packet after external submission.";

/** Chat-ai when inline filing capture is available (signed-in UUID). */
export const HANDLING_TRACKING_STEP_ADD_FILING_CHAT_INLINE =
  "Add filing records in chat below after external submission.";

export const HANDLING_TRACKING_STEP_ADD_CONFIRMATION_CHAT_INLINE =
  "Add or edit the filing confirmation in chat below after external submission.";

export function isHandlingTrackingAddFilingStep(derivedStep: string): boolean {
  return (
    derivedStep === HANDLING_TRACKING_STEP_ADD_FILING ||
    derivedStep === HANDLING_TRACKING_STEP_ADD_FILING_CHAT_INLINE
  );
}

export function isHandlingTrackingAddConfirmationStep(derivedStep: string): boolean {
  return (
    derivedStep === HANDLING_TRACKING_STEP_ADD_CONFIRMATION ||
    derivedStep === HANDLING_TRACKING_STEP_ADD_CONFIRMATION_CHAT_INLINE
  );
}

export function isHandlingTrackingFilingCaptureStep(derivedStep: string): boolean {
  return isHandlingTrackingAddFilingStep(derivedStep) || isHandlingTrackingAddConfirmationStep(derivedStep);
}

export const HANDLING_TRACKING_STEP_RECORD_OUTCOME = "Record the handling outcome.";

export const HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED =
  "Mark the handling request acknowledged.";

export const HANDLING_TRACKING_STEP_REVIEW_FOLLOW_UP =
  "Review follow-up timing and mark follow-up handled when complete.";

export const HANDLING_TRACKING_STEP_COMPLETE = "Tracking complete for now.";

export const PACKET_FILINGS_ANCHOR_ID = "packet-filings";

export const PACKET_FILINGS_HASH = `#${PACKET_FILINGS_ANCHOR_ID}`;

export type HandlingTrackingSurface = "packet" | "plan" | "hub" | "cases" | "chat-ai";

export type HandlingTrackingContextualLink = {
  href: string;
  label: string;
};

export function resolveHandlingTrackingContextualLink(input: {
  derivedStep: string;
  approvedNextAction?: Pick<JusticeApprovedNextAction, "href">;
  surface?: HandlingTrackingSurface;
  basicsReady?: boolean;
  evidenceCount?: number;
  markAcknowledgedOnScreen?: boolean;
  /** When approved prep is embedded in chat-ai, suppress redundant open-step link. */
  prepInlineInChat?: boolean;
  /** When Surrenderless owns the step, suppress open-step navigation links. */
  suppressOwnedStepManualNavigation?: boolean;
  /** When filing capture form is shown in chat-ai, suppress packet filing link. */
  inlineFilingCaptureInChat?: boolean;
}): HandlingTrackingContextualLink | null {
  const { derivedStep } = input;

  if (derivedStep === HANDLING_TRACKING_STEP_COMPLETE) return null;

  if (derivedStep === HANDLING_TRACKING_STEP_REVIEW_PACKET) {
    if (input.basicsReady === false || (input.evidenceCount ?? 0) < 1) {
      if (input.surface === "chat-ai") return null;
      return { href: "/justice/chat-ai", label: "Update case in chat" };
    }
    if (input.surface === "packet") return null;
    if (input.surface === "chat-ai") {
      return null;
    }
    return {
      href: "/justice/packet",
      label: "Review case packet",
    };
  }

  if (derivedStep === HANDLING_TRACKING_STEP_OPEN_APPROVED) {
    const href = input.approvedNextAction?.href?.trim() || "/justice/packet";
    if (input.surface === "packet" && href.startsWith("/justice/packet")) return null;
    if (input.surface === "chat-ai") {
      if (resolveAssistedSubmissionLaneForApprovedHref(href) !== undefined) {
        return null;
      }
      if (input.suppressOwnedStepManualNavigation) {
        return null;
      }
      if (input.prepInlineInChat && isChatInlinePrepHref(href)) {
        return null;
      }
      if (isChatAiMainLadderOffChatHref(href)) {
        return null;
      }
    }
    return {
      href,
      label: input.surface === "chat-ai" ? "Open approved step (optional)" : "Open approved step",
    };
  }

  if (
    isHandlingTrackingAddFilingStep(derivedStep) ||
    isHandlingTrackingAddConfirmationStep(derivedStep)
  ) {
    if (input.surface === "chat-ai") {
      return null;
    }
    if (input.inlineFilingCaptureInChat) {
      return null;
    }
    if (input.surface === "packet") {
      return null;
    }
    return { href: `/justice/packet${PACKET_FILINGS_HASH}`, label: "Open filing records" };
  }

  if (derivedStep === HANDLING_TRACKING_STEP_RECORD_OUTCOME) {
    if (input.surface === "plan") return null;
    if (input.surface === "chat-ai") return null;
    if (input.surface === "packet") return null;
    return { href: "/justice/chat-ai", label: "Record outcome in chat" };
  }

  if (derivedStep === HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED) {
    if (input.markAcknowledgedOnScreen) return null;
    if (input.surface === "chat-ai") return null;
    return { href: "/justice/chat-ai", label: "Mark acknowledged in chat" };
  }

  if (derivedStep === HANDLING_TRACKING_STEP_REVIEW_FOLLOW_UP) {
    if (input.surface === "plan") return null;
    if (input.surface === "chat-ai") return null;
    if (input.surface === "packet") return null;
    return { href: "/justice/chat-ai", label: "Review follow-up in chat" };
  }

  return null;
}

const HANDLING_TRACKING_CONTEXTUAL_LINK_EMERALD_CLS =
  "font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100";

const HANDLING_TRACKING_CONTEXTUAL_LINK_NEUTRAL_CLS =
  "font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100";

export function ApprovedNextActionHandlingTrackingContextualLink({
  derivedStep,
  approvedNextAction,
  surface,
  basicsReady,
  evidenceCount,
  markAcknowledgedOnScreen = false,
  prepInlineInChat = false,
  suppressOwnedStepManualNavigation = false,
  inlineFilingCaptureInChat = false,
  onNavigate,
  tone = "emerald",
  className = "mt-1 text-xs",
}: {
  derivedStep: string;
  approvedNextAction?: Pick<JusticeApprovedNextAction, "href">;
  surface?: HandlingTrackingSurface;
  basicsReady?: boolean;
  evidenceCount?: number;
  markAcknowledgedOnScreen?: boolean;
  prepInlineInChat?: boolean;
  suppressOwnedStepManualNavigation?: boolean;
  inlineFilingCaptureInChat?: boolean;
  onNavigate?: (href: string) => void;
  tone?: "emerald" | "neutral";
  className?: string;
}) {
  const link = resolveHandlingTrackingContextualLink({
    derivedStep,
    approvedNextAction,
    surface,
    basicsReady,
    evidenceCount,
    markAcknowledgedOnScreen,
    prepInlineInChat,
    suppressOwnedStepManualNavigation,
    inlineFilingCaptureInChat,
  });
  if (!link) return null;
  const linkCls =
    tone === "neutral"
      ? HANDLING_TRACKING_CONTEXTUAL_LINK_NEUTRAL_CLS
      : HANDLING_TRACKING_CONTEXTUAL_LINK_EMERALD_CLS;
  return (
    <p className={className}>
      {onNavigate ? (
        <button
          type="button"
          onClick={() => onNavigate(link.href)}
          className={`${linkCls} cursor-pointer bg-transparent p-0`}
        >
          {link.label}
        </button>
      ) : (
        <Link href={link.href} className={linkCls}>
          {link.label}
        </Link>
      )}
    </p>
  );
}

const HANDLING_REQUESTED_EMERALD_BOX_CLS =
  "rounded-lg border border-emerald-400/50 bg-white/70 px-3 py-2.5 dark:border-emerald-600/40 dark:bg-emerald-950/40";

const HANDLING_REQUESTED_TITLE_CLS =
  "text-xs font-medium text-emerald-950 dark:text-emerald-100";

const HANDLING_REQUESTED_RECORDED_CLS =
  "text-xs text-emerald-900/90 dark:text-emerald-100/90";

const HANDLING_REQUESTED_DISCLAIMER_CLS =
  "text-[11px] leading-relaxed text-emerald-800/80 dark:text-emerald-200/80";

export function formatApprovedNextActionHandlingTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatHandlingRecordedLine(requestedAt: string): string {
  return `Recorded ${formatApprovedNextActionHandlingTimestamp(requestedAt)}.`;
}

/** Lowercase “recorded …” for inline case-card lines after the handling-requested label. */
export function formatHandlingRecordedInline(requestedAt: string): string {
  return `recorded ${formatApprovedNextActionHandlingTimestamp(requestedAt)}.`;
}

export function formatHandlingAcknowledgedLine(acknowledgedAt: string): string {
  return `Acknowledged ${formatApprovedNextActionHandlingTimestamp(acknowledgedAt)} — internal tracking triage only.`;
}

/** Display-only queue state derived from existing handling_* fields (not persisted). */
export type HandlingQueueDisplayStatus =
  | "awaiting_internal_triage"
  | "acknowledged_internal_triage";

export const HANDLING_QUEUE_STATUS_AWAITING_TRIAGE_LINE =
  "Queue status: Awaiting internal triage.";

export const HANDLING_QUEUE_STATUS_ACKNOWLEDGED_LINE =
  "Queue status: Acknowledged for internal tracking triage only.";

export function deriveHandlingQueueDisplayStatus(
  action:
    | Pick<JusticeApprovedNextAction, "handling_requested_at" | "handling_acknowledged_at">
    | undefined
): HandlingQueueDisplayStatus | undefined {
  if (!action?.handling_requested_at?.trim()) return undefined;
  if (action.handling_acknowledged_at?.trim()) return "acknowledged_internal_triage";
  return "awaiting_internal_triage";
}

export function formatHandlingQueueStatusLine(status: HandlingQueueDisplayStatus): string {
  return status === "acknowledged_internal_triage"
    ? HANDLING_QUEUE_STATUS_ACKNOWLEDGED_LINE
    : HANDLING_QUEUE_STATUS_AWAITING_TRIAGE_LINE;
}

const HANDLING_QUEUE_STATUS_NEUTRAL_CLS =
  "mt-1 text-xs text-neutral-600 dark:text-neutral-400";

export function ApprovedNextActionHandlingQueueStatusReadOnly({
  handlingRequestedAt,
  handlingAcknowledgedAt,
  className,
}: {
  handlingRequestedAt?: string;
  handlingAcknowledgedAt?: string;
  className?: string;
}) {
  const status = deriveHandlingQueueDisplayStatus({
    handling_requested_at: handlingRequestedAt,
    handling_acknowledged_at: handlingAcknowledgedAt,
  });
  if (!status) return null;
  return (
    <p className={className ?? HANDLING_QUEUE_STATUS_NEUTRAL_CLS}>
      {formatHandlingQueueStatusLine(status)}
    </p>
  );
}

/** Hub + packet: handled approved action with open, unacknowledged handling request. */
export const HANDLING_HANDLED_OPEN_TRIAGE_NOTE_REDIRECT =
  "This handling request is not listed in workbench Awaiting or Saved cases Needs attention. Acknowledge it from chat intake for internal triage only. Surrenderless has not filed, submitted, or queued anything externally.";

/** Plan + chat: same case; acknowledge via Mark acknowledged on that surface. */
export const HANDLING_HANDLED_OPEN_TRIAGE_NOTE_INLINE_ACK =
  "This handling request is not listed in Awaiting or Saved cases Needs attention. Mark acknowledged below for internal triage only. Surrenderless has not filed, submitted, or queued anything externally.";

export type HandlingHandledOpenTriageNoteVariant = "redirect" | "inlineAck";

const HANDLING_HANDLED_OPEN_TRIAGE_NOTE_EMERALD_CLS =
  "mt-1 text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90";

export function formatHandlingHandledOpenTriageNote(
  variant: HandlingHandledOpenTriageNoteVariant
): string {
  return variant === "redirect"
    ? HANDLING_HANDLED_OPEN_TRIAGE_NOTE_REDIRECT
    : HANDLING_HANDLED_OPEN_TRIAGE_NOTE_INLINE_ACK;
}

export function ApprovedNextActionHandlingHandledOpenTriageNote({
  variant,
  className,
}: {
  variant: HandlingHandledOpenTriageNoteVariant;
  className?: string;
}) {
  return (
    <p className={className ?? HANDLING_HANDLED_OPEN_TRIAGE_NOTE_EMERALD_CLS}>
      {formatHandlingHandledOpenTriageNote(variant)}
    </p>
  );
}

const HANDLING_ACKNOWLEDGED_EMERALD_CLS =
  "mt-1.5 text-xs text-emerald-900/90 dark:text-emerald-100/90";

const HANDLING_ACKNOWLEDGED_NEUTRAL_CLS =
  "mt-1.5 text-xs text-neutral-700 dark:text-neutral-300";

export function ApprovedNextActionHandlingAcknowledgedReadOnly({
  acknowledgedAt,
  tone = "emerald",
  className,
}: {
  acknowledgedAt?: string;
  tone?: "emerald" | "neutral";
  className?: string;
}) {
  const trimmed = acknowledgedAt?.trim();
  if (!trimmed) return null;
  return (
    <p
      className={
        className ?? (tone === "neutral" ? HANDLING_ACKNOWLEDGED_NEUTRAL_CLS : HANDLING_ACKNOWLEDGED_EMERALD_CLS)
      }
    >
      {formatHandlingAcknowledgedLine(trimmed)}
    </p>
  );
}

export function formatHubHandlingRequestedLine(requestedAt: string): string {
  return `${APPROVED_NEXT_ACTION_HANDLING_REQUESTED_LABEL} — recorded ${formatApprovedNextActionHandlingTimestamp(requestedAt)}`;
}

export function normalizeHandlingRequestNote(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, APPROVED_NEXT_ACTION_HANDLING_REQUEST_NOTE_MAX_LENGTH);
}

const HANDLING_NOTE_EMERALD_CLS =
  "mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-emerald-900/90 dark:text-emerald-100/90";

const HANDLING_NOTE_NEUTRAL_CLS =
  "mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-neutral-700 dark:text-neutral-300";

export function ApprovedNextActionHandlingRequestNoteReadOnly({
  note,
  tone = "emerald",
  className,
}: {
  note?: string;
  tone?: "emerald" | "neutral";
  className?: string;
}) {
  const trimmed = note?.trim();
  if (!trimmed) return null;
  const labelCls =
    tone === "neutral"
      ? "font-medium text-neutral-800 dark:text-neutral-200"
      : "font-medium text-emerald-950 dark:text-emerald-100";

  return (
    <div className={className ?? (tone === "neutral" ? HANDLING_NOTE_NEUTRAL_CLS : HANDLING_NOTE_EMERALD_CLS)}>
      <p className={labelCls}>{APPROVED_NEXT_ACTION_HANDLING_REQUEST_NOTE_DISPLAY_LABEL}</p>
      <p className="mt-0.5">{trimmed}</p>
    </div>
  );
}

export function ApprovedNextActionHandlingRequestedReadOnly({
  requestedAt,
  requestNote,
  acknowledgedAt,
  wrapperClassName = `mt-3 ${HANDLING_REQUESTED_EMERALD_BOX_CLS}`,
  recordedClassName = "mt-0.5",
  disclaimerClassName = `mt-1.5 ${HANDLING_REQUESTED_DISCLAIMER_CLS}`,
}: {
  requestedAt: string;
  requestNote?: string;
  acknowledgedAt?: string;
  wrapperClassName?: string;
  recordedClassName?: string;
  disclaimerClassName?: string;
}) {
  return (
    <div className={wrapperClassName} aria-label={APPROVED_NEXT_ACTION_HANDLING_TRACKING_ARIA_LABEL}>
      <p className={HANDLING_REQUESTED_TITLE_CLS}>{APPROVED_NEXT_ACTION_HANDLING_REQUESTED_LABEL}</p>
      <p className={`${recordedClassName} ${HANDLING_REQUESTED_RECORDED_CLS}`}>
        {formatHandlingRecordedLine(requestedAt)}
      </p>
      <ApprovedNextActionHandlingRequestNoteReadOnly note={requestNote} />
      <ApprovedNextActionHandlingAcknowledgedReadOnly acknowledgedAt={acknowledgedAt} />
      <p className={disclaimerClassName}>{APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER_WITH_YET}</p>
    </div>
  );
}

export function ApprovedNextActionHandlingRequestBlock({
  action,
  acknowledgedAt,
  onRequest,
  requesting,
  allowEditNote = false,
  onUpdateNote,
  updatingNote = false,
  wrapperClassName = `mt-3 ${HANDLING_REQUESTED_EMERALD_BOX_CLS}`,
  recordedClassName = "mt-1",
}: {
  action: JusticeApprovedNextAction;
  /** Falls back to `action.handling_acknowledged_at` when omitted. */
  acknowledgedAt?: string;
  onRequest: (note?: string) => Promise<void>;
  requesting: boolean;
  allowEditNote?: boolean;
  onUpdateNote?: (note?: string) => Promise<void>;
  updatingNote?: boolean;
  wrapperClassName?: string;
  recordedClassName?: string;
}) {
  const noteFieldId = useId();
  const [noteDraft, setNoteDraft] = useState(action.handling_request_note ?? "");

  const requestedAt = action.handling_requested_at?.trim();
  const canEditNote = Boolean(allowEditNote && onUpdateNote && requestedAt);
  const inputsDisabled = requesting || updatingNote;

  useEffect(() => {
    setNoteDraft(action.handling_request_note ?? "");
  }, [action.handling_request_note, requestedAt]);

  if (action.status === "completed" && !requestedAt) return null;

  return (
    <div className={wrapperClassName} aria-label={APPROVED_NEXT_ACTION_HANDLING_TRACKING_ARIA_LABEL}>
      {requestedAt ? (
        <>
          <p className={HANDLING_REQUESTED_TITLE_CLS}>{APPROVED_NEXT_ACTION_HANDLING_REQUESTED_LABEL}</p>
          <p className={`${recordedClassName} ${HANDLING_REQUESTED_RECORDED_CLS}`}>
            {formatHandlingRecordedLine(requestedAt)}
          </p>
          {canEditNote ? (
            <>
              <label
                htmlFor={noteFieldId}
                className="mt-2 block text-[11px] font-medium text-emerald-950 dark:text-emerald-100"
              >
                {APPROVED_NEXT_ACTION_HANDLING_REQUEST_NOTE_PROMPT}
              </label>
              <textarea
                id={noteFieldId}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                maxLength={APPROVED_NEXT_ACTION_HANDLING_REQUEST_NOTE_MAX_LENGTH}
                rows={2}
                disabled={inputsDisabled}
                placeholder="Optional — leave blank to remove the saved note"
                className={HANDLING_NOTE_TEXTAREA_CLS}
              />
              <button
                type="button"
                onClick={() => void onUpdateNote!(noteDraft)}
                disabled={inputsDisabled}
                className="mt-2 inline-flex rounded-lg border border-emerald-400/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60 dark:border-emerald-600/60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {updatingNote
                  ? APPROVED_NEXT_ACTION_SAVE_HANDLING_NOTE_SAVING_LABEL
                  : APPROVED_NEXT_ACTION_SAVE_HANDLING_NOTE_BUTTON_LABEL}
              </button>
            </>
          ) : (
            <ApprovedNextActionHandlingRequestNoteReadOnly note={action.handling_request_note} />
          )}
          <ApprovedNextActionHandlingAcknowledgedReadOnly
            acknowledgedAt={acknowledgedAt ?? action.handling_acknowledged_at}
          />
        </>
      ) : (
        <>
          <p className={HANDLING_REQUESTED_TITLE_CLS}>{APPROVED_NEXT_ACTION_HANDLING_TRACKING_SECTION_LABEL}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-emerald-900/90 dark:text-emerald-100/90">
            {APPROVED_NEXT_ACTION_HANDLING_PENDING_DESCRIPTION}
          </p>
          <label
            htmlFor={noteFieldId}
            className="mt-2 block text-[11px] font-medium text-emerald-950 dark:text-emerald-100"
          >
            {APPROVED_NEXT_ACTION_HANDLING_REQUEST_NOTE_PROMPT}
          </label>
          <textarea
            id={noteFieldId}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            maxLength={APPROVED_NEXT_ACTION_HANDLING_REQUEST_NOTE_MAX_LENGTH}
            rows={2}
            disabled={inputsDisabled}
            placeholder="Optional"
            className={HANDLING_NOTE_TEXTAREA_CLS}
          />
          <button
            type="button"
            onClick={() => void onRequest(normalizeHandlingRequestNote(noteDraft))}
            disabled={inputsDisabled}
            className="mt-2 inline-flex rounded-lg border border-emerald-400/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60 dark:border-emerald-600/60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {requesting
              ? APPROVED_NEXT_ACTION_REQUEST_HANDLING_SAVING_LABEL
              : APPROVED_NEXT_ACTION_REQUEST_HANDLING_BUTTON_LABEL}
          </button>
        </>
      )}
      <p className={`mt-2 ${HANDLING_REQUESTED_DISCLAIMER_CLS}`}>
        {APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER_WITH_YET}
      </p>
    </div>
  );
}
