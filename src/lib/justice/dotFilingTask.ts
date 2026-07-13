import type { SupabaseClient } from "@supabase/supabase-js";
import { parseJusticeCaseClientState } from "@/lib/justice/approvedNextActionState";
import { buildDotAviationComplaintDraft } from "@/lib/justice/buildDotAviationComplaintDraft";
import {
  filingsForApprovedActionManualTracking,
  MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,
  type ManualActionTrackingFiling,
} from "@/lib/justice/handlingTrackingProgress";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const MAX_TITLE = 500;
const MAX_NOTES = 8000;
const DOT_FILING_TASK_TITLE_PREFIX = "DOT filing: ";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

const EVIDENCE_SELECT = "title, evidence_type, evidence_date" as const;

function clampLen(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Stable idempotency marker stored at the start of task notes. */
export function dotFilingTaskNotesMarker(caseId: string): string {
  return `dot_filing_queue:${caseId.trim()}`;
}

export function buildDotFilingTaskTitle(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "consumer complaint";
  return clampLen(`${DOT_FILING_TASK_TITLE_PREFIX}${company}`, MAX_TITLE);
}

export type DotEvidenceSummaryLine = {
  title: string;
  evidence_type: string;
  evidence_date?: string | null;
};

export function buildDotEvidenceInventory(evidence: readonly DotEvidenceSummaryLine[]): string {
  if (evidence.length === 0) {
    return "(no saved evidence rows on this case yet)";
  }
  return evidence
    .map((row, index) => {
      const title = row.title.trim() || "(untitled)";
      const type = row.evidence_type.trim() || "other";
      const date = row.evidence_date?.trim();
      return date
        ? `${index + 1}. [${type}] ${title} (${date})`
        : `${index + 1}. [${type}] ${title}`;
    })
    .join("\n");
}

export function buildDotFilingTaskNotes(
  caseId: string,
  intake: JusticeIntake,
  evidence: readonly DotEvidenceSummaryLine[] = []
): string {
  const marker = dotFilingTaskNotesMarker(caseId);
  const company = intake.company_name.trim() || "(unknown company)";
  const draft = buildDotAviationComplaintDraft(intake);
  const evidenceBlock = buildDotEvidenceInventory(evidence);
  const header = [
    marker,
    `case_id: ${caseId.trim()}`,
    `company: ${company}`,
    "evidence:",
    evidenceBlock,
    "draft:",
  ].join("\n");
  const remaining = MAX_NOTES - header.length - 1;
  const draftBody = remaining > 0 ? draft.slice(0, remaining) : "";
  return `${header}\n${draftBody}`;
}

export function taskNotesMatchDotFilingMarker(
  notes: string | null | undefined,
  caseId: string
): boolean {
  const marker = dotFilingTaskNotesMarker(caseId);
  const trimmed = notes?.trim() ?? "";
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

export function findOpenDotFilingTask(
  tasks: readonly JusticeCaseTaskRow[],
  caseId: string
): JusticeCaseTaskRow | undefined {
  return tasks.find(
    (task) => taskNotesMatchDotFilingMarker(task.notes, caseId) && !task.completed_at?.trim()
  );
}

export function parseDotFilingTaskDraft(notes: string | null | undefined): string {
  const trimmed = notes?.trim() ?? "";
  const draftIndex = trimmed.indexOf("\ndraft:\n");
  if (draftIndex < 0) return "";
  return trimmed.slice(draftIndex + "\ndraft:\n".length).trim();
}

/** True when client_state calls for an open DOT operator filing queue entry. */
export function shouldQueueDotFilingTask(clientState: unknown): boolean {
  const parsed = parseJusticeCaseClientState(clientState);
  if (!parsed.prepared_packet_approved) return false;
  const next = parsed.approved_next_action;
  if (!next) return false;
  if (next.href?.trim() !== MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF) return false;
  if (next.status === "completed") return false;
  return true;
}

export function isApprovedDotFilingAction(
  next: JusticeApprovedNextAction | undefined
): next is JusticeApprovedNextAction {
  if (!next) return false;
  return next.href?.trim() === MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF;
}

const DOT_APPROVED_ACTION_FOR_FILING_TRACKING = {
  href: MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,
  label: "USDOT / aviation consumer",
} as const;

export function dotFilingsForManualTracking<T extends ManualActionTrackingFiling>(
  filings: readonly T[]
): T[] {
  return filingsForApprovedActionManualTracking(filings, DOT_APPROVED_ACTION_FOR_FILING_TRACKING);
}

export function hasDotFilingRecord(filings: readonly ManualActionTrackingFiling[]): boolean {
  return dotFilingsForManualTracking(filings).length > 0;
}

export function hasDotFilingWithConfirmation(
  filings: readonly ManualActionTrackingFiling[]
): boolean {
  return dotFilingsForManualTracking(filings).some((f) => Boolean(f.confirmation_number?.trim()));
}

export function findDotFilingWithConfirmation(
  filings: readonly JusticeCaseFilingRow[]
): JusticeCaseFilingRow | undefined {
  return dotFilingsForManualTracking(filings).find((f) => Boolean(f.confirmation_number?.trim()));
}

/** Stable idempotent timeline id when a DOT operator filing task is completed. */
export function dotFilingTaskCompletedTimelineId(taskId: string): string {
  return `dot_filing_task_done:${taskId}`;
}

export type CompleteDotFilingTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  completed: boolean;
};

/**
 * Completes the DOT operator filing task when filing is recorded.
 * Idempotent: no-op when task is missing or already completed.
 */
export async function completeDotFilingTaskIfOpen(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  taskId?: string
): Promise<CompleteDotFilingTaskResult> {
  const marker = dotFilingTaskNotesMarker(caseId);

  let query = supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (taskId?.trim()) {
    query = supabase
      .from("justice_case_tasks")
      .select(TASK_SELECT)
      .eq("user_id", userId)
      .eq("case_id", caseId)
      .eq("id", taskId.trim())
      .limit(1);
  }

  const { data: existingRows, error: existingErr } = await query;

  if (existingErr) {
    console.warn("justice dot filing task: select for complete", existingErr.message);
    return { task: null, timeline: null, completed: false };
  }

  const task = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (!task || !taskNotesMatchDotFilingMarker(task.notes, caseId)) {
    return { task: null, timeline: null, completed: false };
  }
  if (task.completed_at?.trim()) {
    return { task, timeline: null, completed: false };
  }

  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .update({ completed_at: completedAt })
    .eq("id", task.id)
    .eq("user_id", userId)
    .select(TASK_SELECT)
    .maybeSingle();

  if (error || !data) {
    console.warn("justice dot filing task: complete update", error?.message ?? "not found");
    return { task, timeline: null, completed: false };
  }

  const updated = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: dotFilingTaskCompletedTimelineId(task.id),
    type: "task_completed",
    label: "DOT filing completed",
    detail: updated.title.trim(),
    ts: completedAt,
  });

  return { task: updated, timeline, completed: true };
}

export type EnsureDotFilingTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  created: boolean;
};

/**
 * Ensures one DOT operator filing task exists for the case (idempotent by notes marker).
 * Appends `task_added` timeline only when a new row is inserted.
 */
export async function ensureDotFilingTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  intake: JusticeIntake
): Promise<EnsureDotFilingTaskResult> {
  const marker = dotFilingTaskNotesMarker(caseId);

  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(1);

  if (existingErr) {
    console.warn("justice dot filing task: select existing", existingErr.message);
    return { task: null, timeline: null, created: false };
  }

  const existing = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (existing) {
    return { task: existing, timeline: null, created: false };
  }

  let evidence: DotEvidenceSummaryLine[] = [];
  const { data: evidenceRows, error: evidenceErr } = await supabase
    .from("justice_case_evidence")
    .select(EVIDENCE_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .order("created_at", { ascending: true })
    .limit(40);

  if (evidenceErr) {
    console.warn("justice dot filing task: list evidence", evidenceErr.message);
  } else {
    evidence = ((evidenceRows ?? []) as DotEvidenceSummaryLine[]).map((row) => ({
      title: typeof row.title === "string" ? row.title : "",
      evidence_type: typeof row.evidence_type === "string" ? row.evidence_type : "other",
      evidence_date: typeof row.evidence_date === "string" ? row.evidence_date : null,
    }));
  }

  const title = buildDotFilingTaskTitle(intake);
  const notes = buildDotFilingTaskNotes(caseId, intake, evidence);

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
    console.warn("justice dot filing task: insert", error.message);
    return { task: null, timeline: null, created: false };
  }

  const task = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `justice_task_add:${task.id}`,
    type: "task_added",
    label: "DOT filing queued",
    detail: task.title,
  });

  return { task, timeline, created: true };
}
