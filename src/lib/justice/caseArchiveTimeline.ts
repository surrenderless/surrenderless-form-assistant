import type { TimelineEntryType } from "@/lib/justice/types";

export const CASE_ARCHIVED_TIMELINE_LABEL = "Case archived in Surrenderless";

function pickArchivedAt(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return "";
  return value.trim();
}

/** True when archived_at goes from null/missing to a non-empty value. */
export function isFirstArchiveTransition(
  existingArchivedAt: unknown,
  incomingArchivedAt: unknown
): boolean {
  const before = pickArchivedAt(existingArchivedAt);
  const after = pickArchivedAt(incomingArchivedAt);
  return !before && Boolean(after);
}

export function caseArchivedTimelineEntryId(caseId: string): string {
  return `case_archived:${caseId}`;
}

export function buildCaseArchivedTimelineEntry(
  caseId: string,
  archivedAt: string
): {
  id: string;
  type: TimelineEntryType;
  label: string;
  ts?: string;
} {
  const ts = archivedAt.trim();
  return {
    id: caseArchivedTimelineEntryId(caseId),
    type: "case_archived",
    label: CASE_ARCHIVED_TIMELINE_LABEL,
    ...(ts ? { ts } : {}),
  };
}
