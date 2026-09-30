import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimelineEntry, TimelineEntryType } from "@/lib/justice/types";

function normalizeTimeline(v: unknown): TimelineEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item)) as TimelineEntry[];
}

function sortByTs(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort((a, b) => a.ts.localeCompare(b.ts));
}

const MAX_APPEND_ATTEMPTS = 5;

/**
 * Appends one timeline entry to the case in DB. Uses `entry.id` for idempotent dedupe (safe if
 * handler retries). Returns the full sorted timeline after update, or null on failure.
 *
 * case_version-guarded with a bounded read-merge-write retry: an unconditional read-then-write
 * here would let two concurrent appends (e.g. two operator actions, or a consumer PATCH racing an
 * automated flow) silently lose one entry — the second write's merge would be computed from the
 * same stale `timeline` the first one started from, overwriting the first append instead of
 * combining with it. Every retry re-reads fresh timeline + case_version and recomputes the merge
 * from that fresh state — never resubmits the array computed on a prior attempt — so this is
 * "recompute against current state and try again," not the stale-content auto-retry this
 * codebase otherwise forbids.
 */
export async function appendCaseTimelineEntry(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  entry: {
    id: string;
    type: TimelineEntryType;
    label: string;
    detail?: string;
    ts?: string;
  }
): Promise<TimelineEntry[] | null> {
  const ts = entry.ts ?? new Date().toISOString();

  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    const { data: row, error: fetchErr } = await supabase
      .from("justice_cases")
      .select("timeline, case_version")
      .eq("id", caseId)
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchErr || !row) {
      console.warn("justice timeline append: load case", fetchErr?.message ?? "not found");
      return null;
    }

    let timeline = normalizeTimeline(row.timeline);
    if (timeline.some((e) => e.id === entry.id)) {
      return sortByTs(timeline);
    }

    const newEntry: TimelineEntry = {
      id: entry.id,
      case_id: caseId,
      type: entry.type,
      label: entry.label,
      ts,
      ...(entry.detail !== undefined && entry.detail !== "" ? { detail: entry.detail } : {}),
    };

    timeline = sortByTs([...timeline, newEntry]);

    const { data: updated, error: upErr } = await supabase
      .from("justice_cases")
      .update({ timeline })
      .eq("id", caseId)
      .eq("user_id", userId)
      .eq("case_version", row.case_version as number)
      .select("id")
      .maybeSingle();

    if (upErr) {
      console.warn("justice timeline append: update", upErr.message);
      return null;
    }
    if (updated) {
      return timeline;
    }
    // CAS miss — a concurrent writer advanced case_version between the read and write above.
    // Loop: re-read fresh timeline + case_version and recompute the merge from that.
  }

  console.warn("justice timeline append: exhausted retries on case_version conflict", caseId);
  return null;
}

/** Latest persisted timeline for a case (sorted by ts). */
export async function getJusticeCaseTimelineForUser(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<TimelineEntry[] | null> {
  const { data: row, error } = await supabase
    .from("justice_cases")
    .select("timeline")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !row) {
    console.warn("justice timeline read:", error?.message ?? "not found");
    return null;
  }
  return sortByTs(normalizeTimeline(row.timeline));
}

/** Completion events use a fresh id each time (re-open + complete again is allowed). */
export function newTaskCompletedTimelineId(): string {
  return randomUUID();
}
