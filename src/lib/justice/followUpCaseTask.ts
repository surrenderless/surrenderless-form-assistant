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

/** Upper bound on simultaneously-open follow-ups scanned per case — comfortably above the
 * handful of escalation lanes this app tracks. */
const MAX_OPEN_FOLLOW_UPS_SCAN = 20;

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

/** True when follow_up_needed goes from true to false/missing. */
export function isFirstFollowUpClearedTransition(
  existingClientState: unknown,
  incomingClientState: unknown
): boolean {
  const before = pickFollowUpNeeded(existingClientState);
  const after = pickFollowUpNeeded(incomingClientState);
  return before && !after;
}

/** Stable idempotency marker stored in task notes. */
export function followUpTaskNotesMarker(caseId: string): string {
  return `follow_up:${caseId}`;
}

const OWNER_HREF_LINE_PREFIX = "owner_href:";

export function buildFollowUpTaskTitle(approvedNext: JusticeApprovedNextAction): string {
  const label = approvedNext.label?.trim() || FOLLOW_UP_TASK_TITLE_FALLBACK;
  return clampLen(`${FOLLOW_UP_TASK_TITLE_PREFIX}${label}`, MAX_TITLE);
}

/**
 * The follow-up task's notes always start with the case-scoped marker (line 1) and — when the
 * approved action that requested it has an href — an owner_href tag (line 2) recording which
 * action/lane the follow-up was created for. The case-scoped marker alone cannot distinguish
 * whose follow-up this is (a case accumulates one closed follow-up per escalation step, all
 * sharing the same marker); the owner_href tag lets lane-scoped bounce handling verify the
 * currently-open follow-up actually belongs to it before closing it. See
 * followUpTaskOwnerHref/completeFollowUpCaseTaskIfOwnedByAction.
 */
export function buildFollowUpTaskNotes(
  caseId: string,
  approvedNext: JusticeApprovedNextAction
): string {
  const marker = followUpTaskNotesMarker(caseId);
  const href = approvedNext.href?.trim();
  const ownerLine = href ? `${OWNER_HREF_LINE_PREFIX}${href}` : null;
  const outcomeNote = approvedNext.outcome_note?.trim();
  const notes = [marker, ownerLine, outcomeNote].filter((line): line is string => Boolean(line)).join("\n");
  return clampLen(notes, MAX_NOTES);
}

export function taskNotesMatchFollowUpMarker(notes: string | null | undefined, caseId: string): boolean {
  const marker = followUpTaskNotesMarker(caseId);
  const trimmed = notes?.trim() ?? "";
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

/**
 * The approved-action href a follow-up task was created for, or null when unknown — either the
 * row predates the owner_href tag, or the action never had an href. Never guess ownership from
 * the case-scoped marker or title alone: an unknown owner must be treated as "not this lane's",
 * not assumed to belong to whichever lane happens to be asking.
 */
export function followUpTaskOwnerHref(notes: string | null | undefined): string | null {
  const lines = (notes ?? "").split("\n");
  const ownerLine = lines[1]?.trim();
  if (!ownerLine || !ownerLine.startsWith(OWNER_HREF_LINE_PREFIX)) return null;
  const href = ownerLine.slice(OWNER_HREF_LINE_PREFIX.length).trim();
  return href || null;
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
 * Ensures one follow-up task exists for the case (idempotent by notes marker), scoped to the
 * given action's own ownership rather than just the case-scoped marker.
 *
 * Multiple lanes can each have their own currently-open follow-up at once (e.g. lane A remediated
 * after the escalation ladder advanced to lane B — see completeFollowUpCaseTaskIfOwnedByAction),
 * so "already tracked" means an OPEN follow-up confirmed — via the stored owner_href tag, never
 * inferred from the case-scoped marker alone — to belong to this same action. A differently-owned
 * or unowned open row is never reused as this action's follow-up; a distinct new row is created
 * instead, leaving that other row untouched. Appends `task_added` timeline only when a new row is
 * inserted.
 *
 * When the action has no href (some in-app-tracked action types don't route anywhere), ownership
 * can't be determined; falls back to the original case-scoped-only reuse so those are unaffected.
 */
export async function ensureFollowUpCaseTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  approvedNext: JusticeApprovedNextAction
): Promise<EnsureFollowUpCaseTaskResult> {
  const marker = followUpTaskNotesMarker(caseId);
  const ownerHref = approvedNext.href?.trim() || null;

  // Only an OPEN follow-up task counts as "already tracked" — a closed one (a prior escalation
  // step's follow-up that was completed or cleared) must not block a fresh follow-up task from
  // being created for the next step, since the marker is case-scoped, not per-step.
  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .is("completed_at", null)
    .limit(MAX_OPEN_FOLLOW_UPS_SCAN);

  if (existingErr) {
    console.warn("justice follow-up task: select existing", existingErr.message);
    return { task: null, timeline: null, created: false };
  }

  const rows = (existingRows ?? []) as JusticeCaseTaskRow[];
  const existing = ownerHref ? rows.find((row) => followUpTaskOwnerHref(row.notes) === ownerHref) : rows[0];
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

/** Stable idempotent timeline id when a follow-up task is completed. */
export function followUpTaskCompletedTimelineId(taskId: string): string {
  return `follow_up_task_done:${taskId}`;
}

export type CompleteFollowUpCaseTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  completed: boolean;
};

/**
 * All currently-open follow-up tasks for the case — plural, since separate lanes can each have
 * their own open follow-up simultaneously (see completeFollowUpCaseTaskIfOwnedByAction). Callers
 * needing a specific one must filter by followUpTaskOwnerHref rather than assume index 0 is
 * theirs; the case-scoped marker alone can't tell them apart.
 */
async function findOpenFollowUpCaseTasks(
  supabase: SupabaseClient,
  userId: string,
  caseId: string
): Promise<JusticeCaseTaskRow[] | "error"> {
  const marker = followUpTaskNotesMarker(caseId);

  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .is("completed_at", null)
    .limit(MAX_OPEN_FOLLOW_UPS_SCAN);

  if (existingErr) {
    console.warn("justice follow-up task: select for complete", existingErr.message);
    return "error";
  }

  return (existingRows ?? []) as JusticeCaseTaskRow[];
}

async function markFollowUpTaskCompleted(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  task: JusticeCaseTaskRow
): Promise<{ task: JusticeCaseTaskRow; timeline: TimelineEntry[] | null; completed: boolean }> {
  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .update({ completed_at: completedAt })
    .eq("id", task.id)
    .eq("user_id", userId)
    .select(TASK_SELECT)
    .maybeSingle();

  if (error || !data) {
    console.warn("justice follow-up task: complete update", error?.message ?? "not found");
    return { task, timeline: null, completed: false };
  }

  const updated = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: followUpTaskCompletedTimelineId(task.id),
    type: "task_completed",
    label: "Follow-up task completed",
    detail: updated.title.trim(),
    ts: completedAt,
  });

  return { task: updated, timeline, completed: true };
}

/**
 * Completes one SPECIFIC follow-up task by id — never substitutes a different open row for the
 * case, even when another lane's follow-up is also currently open. Idempotent: a missing row, a
 * row that isn't actually a follow-up task, or an already-completed row all report
 * completed: false without error — a safe no-op, not a failure.
 *
 * Callers that only know "the case" and not a specific task id (case-scoped operator/consumer
 * actions not tied to a particular lane) must resolve the exact task id or owner_href first —
 * e.g. via completeFollowUpCaseTaskIfOwnedByAction — rather than guessing at an open row, since
 * more than one lane's follow-up can be open on the same case at once.
 */
export async function completeFollowUpCaseTaskById(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  taskId: string
): Promise<CompleteFollowUpCaseTaskResult> {
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("id", taskId)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (error || !data) {
    return { task: null, timeline: null, completed: false };
  }

  const task = data as JusticeCaseTaskRow;
  if (!taskNotesMatchFollowUpMarker(task.notes, caseId)) {
    return { task: null, timeline: null, completed: false };
  }
  if (task.completed_at?.trim()) {
    return { task, timeline: null, completed: false };
  }

  return markFollowUpTaskCompleted(supabase, userId, caseId, task);
}

export type CompleteFollowUpCaseTaskIfOwnedResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  completed: boolean;
  /** True when an open follow-up exists but isn't confirmed to be owned by ownerHref — left
   * untouched. This is a safe no-op (the bounce concerns an attempt whose follow-up has since
   * moved on to another lane, or the row predates ownership tracking), not a failure. */
  skippedNotOwned: boolean;
  /** True when the lookup or update itself failed — retriable, must not be treated as satisfied
   * even though task may be null (an error is not the same fact as "confirmed nothing open"). */
  error: boolean;
};

/**
 * Like completeFollowUpCaseTaskIfOpen, but only completes the case's open follow-up when it is
 * confirmed — via the stored owner_href tag, never inferred from the case-scoped marker alone —
 * to have been created for the given approved-action href.
 *
 * The case-scoped open-follow-up model means only one follow-up is ever open at a time, but the
 * escalation ladder can advance between when a lane's outbound email was sent and when a delayed
 * bounce/complaint for it arrives. By then the open follow-up may belong to a *later* lane's
 * escalation step; closing it unconditionally would silently kill that lane's active follow-up.
 * A follow-up whose owner can't be confirmed (created before ownership tracking existed) is
 * treated the same as a confirmed mismatch: left untouched, reported as a safe no-op.
 */
export async function completeFollowUpCaseTaskIfOwnedByAction(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  ownerHref: string
): Promise<CompleteFollowUpCaseTaskIfOwnedResult> {
  const rows = await findOpenFollowUpCaseTasks(supabase, userId, caseId);
  if (rows === "error") {
    return { task: null, timeline: null, completed: false, skippedNotOwned: false, error: true };
  }
  if (rows.length === 0) {
    return { task: null, timeline: null, completed: false, skippedNotOwned: false, error: false };
  }
  // Other lanes may each have their own open follow-up at the same time — search all of them for
  // the one owned by this action rather than assuming the first row fetched is the right one.
  const task = rows.find((row) => followUpTaskOwnerHref(row.notes) === ownerHref);
  if (!task) {
    return { task: rows[0], timeline: null, completed: false, skippedNotOwned: true, error: false };
  }
  if (task.completed_at?.trim()) {
    return { task, timeline: null, completed: false, skippedNotOwned: false, error: false };
  }

  const result = await markFollowUpTaskCompleted(supabase, userId, caseId, task);
  return { ...result, skippedNotOwned: false, error: !result.completed };
}
