import type { SupabaseClient } from "@supabase/supabase-js";
import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import { parseDueDateToLocalYmd } from "@/lib/justice/taskDueStatus";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const MAX_TITLE = 500;
const MAX_NOTES = 8000;
const FOLLOW_UP_TASK_TITLE_PREFIX = "Surrenderless follow-up: ";
const FOLLOW_UP_TASK_TITLE_FALLBACK = "Approved next action";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function pickFollowUpNeeded(clientState: unknown): boolean {
  return parseApprovedNextActionFromClientState(clientState)?.follow_up_needed === true;
}

/** True when follow_up_needed goes from false/missing to true. */
export function isFirstFollowUpNeededTransition(
  existingClientState: unknown,
  incomingClientState: unknown
): boolean {
  const before = pickFollowUpNeeded(existingClientState);
  const after = pickFollowUpNeeded(incomingClientState);
  return !before && after;
}

/** Stable idempotency marker stored in task notes. */
export function followUpTaskNotesMarker(caseId: string): string {
  return `follow_up:${caseId}`;
}

export function buildFollowUpTaskTitle(approvedNext: JusticeApprovedNextAction): string {
  const label = approvedNext.label?.trim() || FOLLOW_UP_TASK_TITLE_FALLBACK;
  return clampLen(`${FOLLOW_UP_TASK_TITLE_PREFIX}${label}`, MAX_TITLE);
}

export function buildFollowUpTaskNotes(
  caseId: string,
  approvedNext: JusticeApprovedNextAction
): string {
  const marker = followUpTaskNotesMarker(caseId);
  const outcomeNote = approvedNext.outcome_note?.trim();
  const notes = outcomeNote ? `${marker}\n${outcomeNote}` : marker;
  return clampLen(notes, MAX_NOTES);
}

export function taskNotesMatchFollowUpMarker(notes: string | null | undefined, caseId: string): boolean {
  const marker = followUpTaskNotesMarker(caseId);
  const trimmed = notes?.trim() ?? "";
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

/** Maps follow_up_at to a calendar due date when parseable. */
export function followUpTaskDueDateFromApprovedNext(
  approvedNext: Pick<JusticeApprovedNextAction, "follow_up_at">
): string | null {
  return parseDueDateToLocalYmd(approvedNext.follow_up_at);
}

export type EnsureFollowUpCaseTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  created: boolean;
};

/**
 * Ensures one follow-up task exists for the case (idempotent by notes marker).
 * Appends `task_added` timeline only when a new row is inserted.
 */
export async function ensureFollowUpCaseTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  approvedNext: JusticeApprovedNextAction
): Promise<EnsureFollowUpCaseTaskResult> {
  const marker = followUpTaskNotesMarker(caseId);

  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (existingErr) {
    console.warn("justice follow-up task: select existing", existingErr.message);
    return { task: null, timeline: null, created: false };
  }

  const existing = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (existing) {
    return { task: existing, timeline: null, created: false };
  }

  const title = buildFollowUpTaskTitle(approvedNext);
  const notes = buildFollowUpTaskNotes(caseId, approvedNext);
  const dueDate = followUpTaskDueDateFromApprovedNext(approvedNext);

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .insert({
      user_id: userId,
      case_id: caseId,
      title,
      notes,
      ...(dueDate ? { due_date: dueDate } : {}),
    })
    .select(TASK_SELECT)
    .single();

  if (error) {
    console.warn("justice follow-up task: insert", error.message);
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
