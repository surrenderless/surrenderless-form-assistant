import { describe, expect, it } from "vitest";
import {
  buildCaseArchivedTimelineEntry,
  caseArchivedTimelineEntryId,
  CASE_ARCHIVED_TIMELINE_LABEL,
  isFirstArchiveTransition,
} from "@/lib/justice/caseArchiveTimeline";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const ARCHIVED_AT = "2026-06-16T14:00:00.000Z";

describe("isFirstArchiveTransition", () => {
  it("returns true when archived_at transitions from null to a timestamp", () => {
    expect(isFirstArchiveTransition(null, ARCHIVED_AT)).toBe(true);
    expect(isFirstArchiveTransition(undefined, ARCHIVED_AT)).toBe(true);
  });

  it("returns false when archived_at was already set or remains null", () => {
    expect(isFirstArchiveTransition(ARCHIVED_AT, ARCHIVED_AT)).toBe(false);
    expect(isFirstArchiveTransition(null, null)).toBe(false);
    expect(isFirstArchiveTransition(ARCHIVED_AT, null)).toBe(false);
  });
});

describe("buildCaseArchivedTimelineEntry", () => {
  it("uses a stable idempotent id and archive timestamp", () => {
    const entry = buildCaseArchivedTimelineEntry(CASE_ID, ARCHIVED_AT);

    expect(entry.id).toBe(caseArchivedTimelineEntryId(CASE_ID));
    expect(entry.id).toBe(`case_archived:${CASE_ID}`);
    expect(entry.type).toBe("case_archived");
    expect(entry.label).toBe(CASE_ARCHIVED_TIMELINE_LABEL);
    expect(entry.ts).toBe(ARCHIVED_AT);
  });
});
