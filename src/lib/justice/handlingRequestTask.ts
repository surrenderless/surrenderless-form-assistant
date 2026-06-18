import type { SupabaseClient } from "@supabase/supabase-js";
import { handlingRequestTimelineEntryId } from "@/lib/justice/handlingRequestTimeline";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const MAX_TITLE = 500;
const MAX_NOTES = 8000;
const HANDLING_TASK_TITLE_PREFIX = "Surrenderless handling: ";
const HANDLING_TASK_TITLE_FALLBACK = "Approved next action";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Stable idempotency marker stored in task notes (matches timeline entry id). */
export function handlingRequestTaskNotesMarker(caseId: string): string {
  return handlingRequestTimelineEntryId(caseId);
}

export function buildHandlingRequestTaskTitle(approvedNext: JusticeApprovedNextAction): string {
  const label = approvedNext.label?.trim() || HANDLING_TASK_TITLE_FALLBACK;
  return clampLen(`${HANDLING_TASK_TITLE_PREFIX}${label}`, MAX_TITLE);
}

export function buildHandlingRequestTaskNotes(
  caseId: string,
  approvedNext: JusticeApprovedNextAction
): string {
  const marker = handlingRequestTaskNotesMarker(caseId);
  const requestNote = approvedNext.handling_request_note?.trim();
  const notes = requestNote ? `${marker}\n${requestNote}` : marker;
  return clampLen(notes, MAX_NOTES);
}

export function taskNotesMatchHandlingRequestMarker(notes: string | null | undefined, caseId: string): boolean {
  const marker = handlingRequestTaskNotesMarker(caseId);
  const trimmed = notes?.trim() ?? "";
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

export type EnsureHandlingRequestTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  created: boolean;
};

/**
 * Ensures one handling-request task exists for the case (idempotent by notes marker).
 * Appends `task_added` timeline only when a new row is inserted.
 */
export async function ensureHandlingRequestTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  approvedNext: JusticeApprovedNextAction
): Promise<EnsureHandlingRequestTaskResult> {
  const marker = handlingRequestTaskNotesMarker(caseId);

  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (existingErr) {
    console.warn("justice handling request task: select existing", existingErr.message);
    return { task: null, timeline: null, created: false };
  }

  const existing = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (existing) {
    return { task: existing, timeline: null, created: false };
  }

  const title = buildHandlingRequestTaskTitle(approvedNext);
  const notes = buildHandlingRequestTaskNotes(caseId, approvedNext);

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .insert({
      user_id: userId,
      case_id: caseId,
      title,
      notes,
    })
    .select(TASK_SELECT)
    .single();

  if (error) {
    console.warn("justice handling request task: insert", error.message);
    return { task: null, timeline: null, created: false };
  }

  const task = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `justice_task_add:${task.id}`,
    type: "task_added",
    label: "Follow-up task added",
    detail: task.title,
  });

  return { task, timeline, created: true };
}
