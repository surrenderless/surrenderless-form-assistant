"use client";

export type ApprovedNextActionFollowUpTiming = "passed" | "today" | "upcoming";

export type ApprovedNextActionFollowUpTimingInfo = {
  timing: ApprovedNextActionFollowUpTiming;
  label: string;
  dateDisplay: string;
};

function parseFollowUpAtToLocalDay(iso?: string): Date | null {
  if (!iso?.trim()) return null;
  const trimmed = iso.trim();
  const datePart = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, d] = datePart.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const t = Date.parse(trimmed);
  if (Number.isNaN(t)) return null;
  const dt = new Date(t);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function todayLocalMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** User-chosen follow-up date pacing (not a deadline). */
export function getApprovedNextActionFollowUpTiming(
  iso?: string
): ApprovedNextActionFollowUpTimingInfo | null {
  const followUpDay = parseFollowUpAtToLocalDay(iso);
  if (!followUpDay) return null;
  const dateDisplay = followUpDay.toLocaleDateString(undefined, { dateStyle: "medium" });
  const today = todayLocalMidnight();
  const diff = followUpDay.getTime() - today.getTime();
  if (diff < 0) {
    return { timing: "passed", label: "Follow-up date passed", dateDisplay };
  }
  if (diff === 0) {
    return { timing: "today", label: "Follow-up today", dateDisplay };
  }
  return { timing: "upcoming", label: "Upcoming follow-up", dateDisplay };
}

export function followUpTimingTextClass(timing: ApprovedNextActionFollowUpTiming): string {
  const base = "text-xs font-medium";
  switch (timing) {
    case "passed":
      return `${base} text-neutral-600 dark:text-neutral-400`;
    case "today":
      return `${base} text-amber-800/90 dark:text-amber-200/90`;
    case "upcoming":
      return `${base} text-sky-800/90 dark:text-sky-200/90`;
  }
}

export function ApprovedNextActionFollowUpTimingLine({
  followUpAt,
  className,
}: {
  followUpAt?: string;
  className?: string;
}) {
  const info = getApprovedNextActionFollowUpTiming(followUpAt);
  if (!info) return null;
  return (
    <p className={className ?? followUpTimingTextClass(info.timing)}>
      {info.label}
      <span className="font-normal text-neutral-600 dark:text-neutral-400"> ({info.dateDisplay})</span>
    </p>
  );
}
