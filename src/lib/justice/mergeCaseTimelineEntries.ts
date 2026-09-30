import type { TimelineEntry } from "@/lib/justice/types";

/**
 * Safe server-side merge for justice_cases.timeline, replacing a blind full-array overwrite: a
 * client's submitted timeline is a proposal, never authoritative truth about what already exists.
 * Entries are deduped by id (the client's submitted version of a shared id wins — it's the
 * caller's own explicit re-assertion), but any entry the client's copy simply omits (because it
 * was stale — e.g. appended server-side by an unrelated write after the client last loaded it) is
 * kept, never dropped. This is what makes justice_cases.timeline safe to write without a
 * compare-and-swap: unlike intake, two timeline writes can never really conflict, only combine.
 */
export function mergeCaseTimelineEntries(current: unknown, incoming: TimelineEntry[]): TimelineEntry[] {
  const byId = new Map<string, TimelineEntry>();
  const currentEntries = Array.isArray(current) ? (current as TimelineEntry[]) : [];
  for (const entry of currentEntries) {
    if (entry && typeof entry === "object" && typeof (entry as TimelineEntry).id === "string") {
      byId.set((entry as TimelineEntry).id, entry as TimelineEntry);
    }
  }
  for (const entry of incoming) {
    if (entry && typeof entry === "object" && typeof entry.id === "string") {
      byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values()).sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));
}
