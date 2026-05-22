"use client";

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

export function ApprovedNextActionHandlingRequestedReadOnly({
  requestedAt,
  wrapperClassName = `mt-3 ${HANDLING_REQUESTED_EMERALD_BOX_CLS}`,
  recordedClassName = "mt-0.5",
  disclaimerClassName = `mt-1.5 ${HANDLING_REQUESTED_DISCLAIMER_CLS}`,
}: {
  requestedAt: string;
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
      <p className={disclaimerClassName}>{APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER_WITH_YET}</p>
    </div>
  );
}
