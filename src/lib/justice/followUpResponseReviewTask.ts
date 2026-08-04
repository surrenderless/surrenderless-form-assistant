import type { SupabaseClient } from "@supabase/supabase-js";
import { followUpTaskOwnerHref } from "@/lib/justice/followUpCaseTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const MAX_TITLE = 500;
const MAX_NOTES = 8000;
const RESPONSE_REVIEW_TITLE_PREFIX = "Follow-up response review: ";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

/** Upper bound on simultaneously-tracked superseded-lane reviews scanned per case — comfortably
 * above the handful of escalation lanes this app tracks. */
const MAX_SUPERSEDED_LANE_REVIEW_SCAN = 20;

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

  // Only an OPEN response-review task counts as "already tracked" — a closed one (a prior
  // escalation step's review that was completed) must not block a fresh task from being created
  // for the next step, since the marker is case-scoped, not per-step.
  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .is("completed_at", null)
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

/** Stable idempotent timeline id when a response-review task is completed. */
export function followUpResponseReviewTaskCompletedTimelineId(taskId: string): string {
  return `follow_up_response_review_done:${taskId.trim()}`;
}

export type CompleteFollowUpResponseReviewTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  completed: boolean;
};

/**
 * Completes the operator response-review task. Idempotent when missing or already completed.
 */
export async function completeFollowUpResponseReviewTaskIfOpen(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  taskId?: string
): Promise<CompleteFollowUpResponseReviewTaskResult> {
  const marker = followUpResponseReviewTaskNotesMarker(caseId);

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
    console.warn("justice follow-up response review: select for complete", existingErr.message);
    return { task: null, timeline: null, completed: false };
  }

  const task = existingRows?.[0] as JusticeCaseTaskRow | undefined;
  if (!task || !taskNotesMatchFollowUpResponseReviewMarker(task.notes, caseId)) {
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
    console.warn(
      "justice follow-up response review: complete update",
      error?.message ?? "not found"
    );
    return { task, timeline: null, completed: false };
  }

  const updated = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: followUpResponseReviewTaskCompletedTimelineId(task.id),
    type: "task_completed",
    label: "Follow-up response review completed",
    detail: updated.title.trim(),
    ts: completedAt,
  });

  return { task: updated, timeline, completed: true };
}

/**
 * Stable idempotency marker for a SPECIFIC superseded lane's own post-follow-up response review
 * — distinct from the case-scoped follow_up_response_review above, which belongs to whichever
 * lane is CURRENTLY approved. A lane whose ladder position has already moved on gets its own
 * operator review, tagged with its own owner_href (see followUpTaskOwnerHref), never confused
 * with or substituted for the current lane's.
 */
export function supersededLaneResponseReviewTaskNotesMarker(caseId: string): string {
  return `superseded_lane_review:${caseId.trim()}`;
}

export function buildSupersededLaneResponseReviewTaskTitle(label: string): string {
  return clampLen(`${RESPONSE_REVIEW_TITLE_PREFIX}${label}`, MAX_TITLE);
}

export function taskNotesMatchSupersededLaneReviewMarker(
  notes: string | null | undefined,
  caseId: string
): boolean {
  const marker = supersededLaneResponseReviewTaskNotesMarker(caseId);
  const trimmed = notes?.trim() ?? "";
  return trimmed === marker || trimmed.startsWith(`${marker}\n`);
}

/** Extracts the guidance/draft text for display — same convention as
 * parseFollowUpResponseReviewTaskDraft (text after the "guidance:" line). */
export function parseSupersededLaneReviewTaskDraft(notes: string | null | undefined): string {
  const trimmed = notes?.trim() ?? "";
  const idx = trimmed.indexOf("\nguidance:\n");
  if (idx < 0) return "";
  return trimmed.slice(idx + "\nguidance:\n".length).trim();
}

export const SUPERSEDED_LANE_REVIEW_OUTCOMES = ["response_received", "no_response"] as const;

export type SupersededLaneReviewOutcome = (typeof SUPERSEDED_LANE_REVIEW_OUTCOMES)[number];

export function isSupersededLaneReviewOutcome(v: unknown): v is SupersededLaneReviewOutcome {
  return (
    typeof v === "string" &&
    (SUPERSEDED_LANE_REVIEW_OUTCOMES as readonly string[]).includes(v)
  );
}

const DECISION_LINE_RE = /^decision:(response_received|no_response)\s*$/m;

/** Reads the durably-recorded decision straight off the review task's own notes — this IS the
 * persisted outcome; there is no separate outcome column. Returns null when no decision has been
 * recorded yet (or the row predates this field). */
export function supersededLaneReviewOutcomeFromNotes(
  notes: string | null | undefined
): SupersededLaneReviewOutcome | null {
  const match = (notes ?? "").match(DECISION_LINE_RE);
  if (!match) return null;
  return match[1] as SupersededLaneReviewOutcome;
}

/**
 * Embeds the operator's explicit decision into the review task's own notes, replacing any prior
 * decision line so a retry never appends a duplicate. Writing the decision into notes (rather
 * than a side table) means it can be persisted in the SAME update as completed_at — the decision
 * is never separable from the row that reports it durably recorded.
 */
export function appendSupersededLaneReviewDecisionToNotes(
  notes: string | null | undefined,
  outcome: SupersededLaneReviewOutcome,
  operatorNotes?: string | null
): string {
  const withoutPriorDecision = (notes ?? "")
    .replace(/^decision:.*$/m, "")
    .replace(/^decision_note:.*$/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const note = operatorNotes?.trim();
  const lines = [withoutPriorDecision, `decision:${outcome}`];
  if (note) lines.push(`decision_note: ${clampLen(note, MAX_NOTES)}`);
  return clampLen(lines.join("\n"), MAX_NOTES);
}

const FOLLOW_UP_TASK_ID_LINE_PREFIX = "follow_up_task_id:";

/**
 * Reads the specific follow-up task this review is durably linked to — the review is scoped to
 * that EXACT attempt, never merely to (case, owner_href), so a later remediation cycle on the
 * same lane (a fresh follow-up with its own id, created once the prior one is closed) can never
 * be confused with — or have its outcome silently answered by — an older, already-decided review
 * for a different attempt on the same lane.
 */
export function supersededLaneReviewLinkedFollowUpTaskId(
  notes: string | null | undefined
): string | null {
  const lines = (notes ?? "").split("\n");
  const line = lines[2]?.trim();
  if (!line || !line.startsWith(FOLLOW_UP_TASK_ID_LINE_PREFIX)) return null;
  const id = line.slice(FOLLOW_UP_TASK_ID_LINE_PREFIX.length).trim();
  return id || null;
}

/** The follow-up-style two-line prefix (case-scoped marker, then owner_href) lets the same
 * ownership helpers (followUpTaskOwnerHref) read this task's owner regardless of task type. The
 * third line durably links this review to the exact follow-up task it was created for. */
export function buildSupersededLaneResponseReviewTaskNotes(
  caseId: string,
  ownerHref: string,
  followUpTaskId: string,
  label: string
): string {
  const marker = supersededLaneResponseReviewTaskNotesMarker(caseId);
  const body = [
    marker,
    `owner_href:${ownerHref}`,
    `${FOLLOW_UP_TASK_ID_LINE_PREFIX}${followUpTaskId.trim()}`,
    `case_id: ${caseId.trim()}`,
    "guidance:",
    `${label}'s own follow-up date passed with no recorded decision on this specific attempt.`,
    "This attempt was already superseded by later escalation — the case's current step is",
    "unaffected either way. Review this lane's own responses (email replies, mail, etc.)",
    "independently of the current step, then complete this task once you've confirmed whether",
    "this lane received a response.",
  ].join("\n");
  return clampLen(body, MAX_NOTES);
}

export type EnsureSupersededLaneResponseReviewTaskResult = {
  task: JusticeCaseTaskRow | null;
  timeline: TimelineEntry[] | null;
  created: boolean;
};

/**
 * Ensures one operator response-review task exists for this SPECIFIC superseded lane AND this
 * SPECIFIC follow-up attempt (idempotent by case + owner_href + follow_up_task_id — never by
 * case + owner_href alone). A genuinely new remediation cycle on the same lane always creates
 * its own fresh follow-up task (the prior one must already be closed for that to happen — see
 * ensureFollowUpCaseTask's open-row dedup) with its own id, so matching on that exact id here
 * means an older, already-decided review from a prior attempt is never reused for it — even
 * though it's the "same lane." True webhook replay (the same remediation event re-delivered)
 * reuses the SAME still-open follow-up row and its id, so this correctly stays idempotent.
 * Returns the existing row (open OR already completed) when one is found for this exact
 * follow-up id, so callers can read its completion state as the durable "has a decision been
 * made for THIS attempt" signal without this function inferring anything itself.
 */
export async function ensureSupersededLaneResponseReviewTask(
  supabase: SupabaseClient,
  userId: string,
  caseId: string,
  ownerHref: string,
  followUpTaskId: string,
  label: string
): Promise<EnsureSupersededLaneResponseReviewTaskResult> {
  const marker = supersededLaneResponseReviewTaskNotesMarker(caseId);
  const trimmedFollowUpTaskId = followUpTaskId.trim();

  const { data: existingRows, error: existingErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .like("notes", `${marker}%`)
    .limit(MAX_SUPERSEDED_LANE_REVIEW_SCAN);

  if (existingErr) {
    console.warn("justice superseded lane response review: select existing", existingErr.message);
    return { task: null, timeline: null, created: false };
  }

  const rows = (existingRows ?? []) as JusticeCaseTaskRow[];
  const existing = rows.find(
    (row) =>
      followUpTaskOwnerHref(row.notes) === ownerHref &&
      supersededLaneReviewLinkedFollowUpTaskId(row.notes) === trimmedFollowUpTaskId
  );
  if (existing) {
    return { task: existing, timeline: null, created: false };
  }

  const title = buildSupersededLaneResponseReviewTaskTitle(label);
  const notes = buildSupersededLaneResponseReviewTaskNotes(
    caseId,
    ownerHref,
    trimmedFollowUpTaskId,
    label
  );

  const { data, error } = await supabase
    .from("justice_case_tasks")
    .insert({ user_id: userId, case_id: caseId, title, notes })
    .select(TASK_SELECT)
    .single();

  if (error) {
    console.warn("justice superseded lane response review: insert", error.message);
    return { task: null, timeline: null, created: false };
  }

  const task = data as JusticeCaseTaskRow;
  const timeline = await appendCaseTimelineEntry(supabase, userId, caseId, {
    id: `justice_task_add:${task.id}`,
    type: "task_added",
    label: `${label}: response review queued`,
    detail: task.title,
  });

  return { task, timeline, created: true };
}

/** Stable idempotent timeline id when a superseded lane's own follow-up is closed after its
 * review is confirmed complete — distinct per task, so a retry never double-records it. */
export function supersededLaneReviewOutcomeTimelineId(caseId: string, taskId: string): string {
  return `superseded_lane_reviewed:${caseId.trim()}:${taskId.trim()}`;
}
