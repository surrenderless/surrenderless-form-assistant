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

/**
 * Appends one timeline entry to the case in DB. Uses `entry.id` for idempotent dedupe (safe if handler retries).
 * Returns the full sorted timeline after update, or null on failure.
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
  const { data: row, error: fetchErr } = await supabase
    .from("justice_cases")
    .select("timeline")
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
    ts: entry.ts ?? new Date().toISOString(),
    ...(entry.detail !== undefined && entry.detail !== "" ? { detail: entry.detail } : {}),
  };

  timeline = sortByTs([...timeline, newEntry]);

  const { error: upErr } = await supabase
    .from("justice_cases")
    .update({ timeline })
    .eq("id", caseId)
    .eq("user_id", userId);

  if (upErr) {
    console.warn("justice timeline append: update", upErr.message);
    return null;
  }

  return timeline;
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
