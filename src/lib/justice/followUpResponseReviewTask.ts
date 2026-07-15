import type { SupabaseClient } from "@supabase/supabase-js";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const MAX_TITLE = 500;
const MAX_NOTES = 8000;
const RESPONSE_REVIEW_TITLE_PREFIX = "Follow-up response review: ";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Stable idempotency marker for operator-owned post-follow-up response review. */
export function followUpResponseReviewTaskNotesMarker(caseId: string): string {
  return `follow_up_response_review:${caseId.trim()}`;
}

export function taskNotesMatchFollowUpResponseReviewMarker(
  notes: string | null | undefined,
  caseId: string
): boolean {
  const marker = followUpResponseReviewTaskNotesMarker(caseId);
  const trimmed = notes?.trim() ?? "";
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

export function buildFollowUpResponseReviewTaskTitle(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "consumer case";
  return clampLen(`${RESPONSE_REVIEW_TITLE_PREFIX}${company}`, MAX_TITLE);
}

export function buildFollowUpResponseReviewTaskNotes(
  caseId: string,
  intake: JusticeIntake
): string {
  const marker = followUpResponseReviewTaskNotesMarker(caseId);
  const company = intake.company_name.trim() || "(unknown company)";
  const body = [
    marker,
    `case_id: ${caseId.trim()}`,
    `company: ${company}`,
    "guidance:",
    "Follow-up date passed with no confirmed resolution on file.",
    "Review agency, merchant, or bank responses.",
    "Do not archive or mark resolved unless resolution is actually confirmed.",
    "Queue further escalation only when appropriate.",
  ].join("\n");
  return clampLen(body, MAX_NOTES);
}

export function parseFollowUpResponseReviewTaskDraft(notes: string | null | undefined): string {
  const trimmed = notes?.trim() ?? "";
  const idx = trimmed.indexOf("\nguidance:\n");
  if (idx < 0) return "";
  return trimmed.slice(idx + "\nguidance:\n".length).trim();
}

export type EnsureFollowUpResponseReviewTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  created: boolean;
};

/**
 * Ensures one operator response-review task exists for the case (idempotent by notes marker).
 */
export async function ensureFollowUpResponseReviewTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  intake: JusticeIntake
): Promise<EnsureFollowUpResponseReviewTaskResult> {
  const marker = followUpResponseReviewTaskNotesMarker(caseId);

  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (existingErr) {
    console.warn("justice follow-up response review: select existing", existingErr.message);
    return { task: null, timeline: null, created: false };
  }

  const existing = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (existing) {
    return { task: existing, timeline: null, created: false };
  }

  const title = buildFollowUpResponseReviewTaskTitle(intake);
  const notes = buildFollowUpResponseReviewTaskNotes(caseId, intake);

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
    console.warn("justice follow-up response review: insert", error.message);
    return { task: null, timeline: null, created: false };
  }

  const task = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `justice_task_add:${task.id}`,
    type: "task_added",
    label: "Follow-up response review queued",
    detail: task.title,
  });

  return { task, timeline, created: true };
}
