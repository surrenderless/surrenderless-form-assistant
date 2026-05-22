"use client";

import { useEffect, useId, useState } from "react";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

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
  return `Acknowledged ${formatApprovedNextActionHandlingTimestamp(acknowledgedAt)} — internal triage only.`;
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
  wrapperClassName = `mt-3 ${HANDLING_REQUESTED_EMERALD_BOX_CLS}`,
  recordedClassName = "mt-0.5",
  disclaimerClassName = `mt-1.5 ${HANDLING_REQUESTED_DISCLAIMER_CLS}`,
}: {
  requestedAt: string;
  requestNote?: string;
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
      <p className={disclaimerClassName}>{APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER_WITH_YET}</p>
    </div>
  );
}

export function ApprovedNextActionHandlingRequestBlock({
  action,
  onRequest,
  requesting,
  allowEditNote = false,
  onUpdateNote,
  updatingNote = false,
  wrapperClassName = `mt-3 ${HANDLING_REQUESTED_EMERALD_BOX_CLS}`,
  recordedClassName = "mt-1",
}: {
  action: JusticeApprovedNextAction;
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
