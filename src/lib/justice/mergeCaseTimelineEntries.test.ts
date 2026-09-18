import { describe, expect, it } from "vitest";
import { mergeCaseTimelineEntries } from "@/lib/justice/mergeCaseTimelineEntries";
import type { TimelineEntry } from "@/lib/justice/types";

function entry(id: string, ts: string, label = id): TimelineEntry {
  return { id, case_id: "case-1", type: "task_added", label, ts };
}

describe("mergeCaseTimelineEntries", () => {
  it("returns the incoming entries as-is when there is no current timeline", () => {
    const incoming = [entry("a", "2026-01-01T00:00:00.000Z")];
    expect(mergeCaseTimelineEntries(null, incoming)).toEqual(incoming);
    expect(mergeCaseTimelineEntries(undefined, incoming)).toEqual(incoming);
    expect(mergeCaseTimelineEntries([], incoming)).toEqual(incoming);
  });

  it("never drops a current entry the incoming array simply omits", () => {
    const current = [entry("server_only", "2026-01-01T00:10:00.000Z")];
    const incoming = [entry("client_only", "2026-01-01T00:05:00.000Z")];
    const merged = mergeCaseTimelineEntries(current, incoming);
    expect(merged.map((e) => e.id).sort()).toEqual(["client_only", "server_only"]);
  });

  it("dedupes by id — the incoming entry's version of a shared id wins", () => {
    const current = [entry("shared", "2026-01-01T00:00:00.000Z", "old label")];
    const incoming = [entry("shared", "2026-01-01T00:00:00.000Z", "new label")];
    const merged = mergeCaseTimelineEntries(current, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe("new label");
  });

  it("sorts the merged result by ts, regardless of input order", () => {
    const current = [entry("late", "2026-01-03T00:00:00.000Z")];
    const incoming = [entry("early", "2026-01-01T00:00:00.000Z"), entry("mid", "2026-01-02T00:00:00.000Z")];
    const merged = mergeCaseTimelineEntries(current, incoming);
    expect(merged.map((e) => e.id)).toEqual(["early", "mid", "late"]);
  });

  it("ignores malformed current entries (non-objects, missing id) without throwing", () => {
    const current = [null, "not an object", { no_id: true }, entry("valid", "2026-01-01T00:00:00.000Z")] as unknown[];
    const merged = mergeCaseTimelineEntries(current, []);
    expect(merged.map((e) => e.id)).toEqual(["valid"]);
  });

  it("is idempotent: merging the same incoming array twice produces the same result", () => {
    const current = [entry("a", "2026-01-01T00:00:00.000Z")];
    const incoming = [entry("b", "2026-01-01T00:05:00.000Z")];
    const once = mergeCaseTimelineEntries(current, incoming);
    const twice = mergeCaseTimelineEntries(once, incoming);
    expect(twice).toEqual(once);
  });
});
