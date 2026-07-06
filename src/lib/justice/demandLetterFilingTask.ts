import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { buildDemandLetterDraft } from "@/lib/justice/buildDemandLetterDraft";
import { MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const MAX_TITLE = 500;
const MAX_NOTES = 8000;
const DEMAND_LETTER_TASK_TITLE_PREFIX = "Demand letter: ";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Stable idempotency marker stored at the start of task notes. */
export function demandLetterFilingTaskNotesMarker(caseId: string): string {
  return `demand_letter_filing_queue:${caseId.trim()}`;
}

export function buildDemandLetterFilingTaskTitle(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "consumer demand";
  return clampLen(`${DEMAND_LETTER_TASK_TITLE_PREFIX}${company}`, MAX_TITLE);
}

export function buildDemandLetterFilingTaskNotes(caseId: string, intake: JusticeIntake): string {
  const marker = demandLetterFilingTaskNotesMarker(caseId);
  const company = intake.company_name.trim() || "(unknown company)";
  const draft = buildDemandLetterDraft(intake);
  const header = [
    marker,
    `case_id: ${caseId.trim()}`,
    `company: ${company}`,
    "draft:",
  ].join("\n");
  const remaining = MAX_NOTES - header.length - 1;
  const draftBody = remaining > 0 ? draft.slice(0, remaining) : "";
  return `${header}\n${draftBody}`;
}

export function taskNotesMatchDemandLetterFilingMarker(
  notes: string | null | undefined,
  caseId: string
): boolean {
  const marker = demandLetterFilingTaskNotesMarker(caseId);
  const trimmed = notes?.trim() ?? "";
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

export function findOpenDemandLetterFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return tasks.find(
    (task) =>
      taskNotesMatchDemandLetterFilingMarker(task.notes, caseId) && !task.completed_at?.trim()
  );
}

export function parseDemandLetterFilingTaskDraft(notes: string | null | undefined): string {
  const trimmed = notes?.trim() ?? "";
  const draftIndex = trimmed.indexOf("\ndraft:\n");
  if (draftIndex < 0) return "";
  return trimmed.slice(draftIndex + "\ndraft:\n".length).trim();
}

/** True when client_state calls for an open demand-letter operator fulfillment queue entry. */
export function shouldQueueDemandLetterFilingTask(clientState: unknown): boolean {
  const parsed = parseJusticeCaseClientState(clientState);
  if (!parsed.prepared_packet_approved) return false;
  const next = parsed.approved_next_action;
  if (!next) return false;
  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF) return false;
  if (next.status === "completed") return false;
  return true;
}

export function isApprovedDemandLetterFilingAction(
  next: JusticeApprovedNextAction | undefined
): next is JusticeApprovedNextAction {
  if (!next) return false;
  return next.href?.trim() === MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF;
}

export type EnsureDemandLetterFilingTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  created: boolean;
};

/**
 * Ensures one demand-letter operator fulfillment task exists for the case (idempotent by notes marker).
 * Appends `task_added` timeline only when a new row is inserted.
 */
export async function ensureDemandLetterFilingTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  intake: JusticeIntake
): Promise<EnsureDemandLetterFilingTaskResult> {
  const marker = demandLetterFilingTaskNotesMarker(caseId);

  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (existingErr) {
    console.warn("justice demand letter filing task: select existing", existingErr.message);
    return { task: null, timeline: null, created: false };
  }

  const existing = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (existing) {
    return { task: existing, timeline: null, created: false };
  }

  const title = buildDemandLetterFilingTaskTitle(intake);
  const notes = buildDemandLetterFilingTaskNotes(caseId, intake);

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
    console.warn("justice demand letter filing task: insert", error.message);
    return { task: null, timeline: null, created: false };
  }

  const task = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `justice_task_add:${task.id}`,
    type: "task_added",
    label: "Demand letter queued",
    detail: task.title,
  });

  return { task, timeline, created: true };
}
