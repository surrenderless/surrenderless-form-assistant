import type { SupabaseClient } from "@supabase/supabase-js";
import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  buildCaseArchivedTimelineEntry,
  isFirstArchiveTransition,
} from "@/lib/justice/caseArchiveTimeline";
import {
  OPERATOR_NO_RESOLUTION_OUTCOME_MARKER,
  OPERATOR_RESOLVED_OUTCOME_MARKER,
} from "@/lib/justice/completeFollowUpResponseReview";
import { canArchiveCaseForEscalationLadder } from "@/lib/justice/escalationLadderResolution";
import {
  taskNotesMatchFollowUpResponseReviewMarker,
} from "@/lib/justice/followUpResponseReviewTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

export type OperatorOwnedClosableOutcome = "resolved" | "no_resolution";

export type OperatorClosableCaseItem = {
  case_id: string;
  case_owner_user_id: string;
  company_name: string;
  consumer_us_state: string | null;
  outcome: OperatorOwnedClosableOutcome;
  outcome_note: string;
};

/** True when outcome_note records operator resolved or no-resolution after response review. */
export function hasOperatorTerminalResponseReviewOutcome(
  action: JusticeApprovedNextAction | null | undefined
): boolean {
  const note = action?.outcome_note?.trim() ?? "";
  if (!note) return false;
  return (
    note.includes(OPERATOR_RESOLVED_OUTCOME_MARKER) ||
    note.includes(OPERATOR_NO_RESOLUTION_OUTCOME_MARKER)
  );
}

export function operatorOwnedClosableOutcomeFromAction(
  action: JusticeApprovedNextAction | null | undefined
): OperatorOwnedClosableOutcome | null {
  const note = action?.outcome_note?.trim() ?? "";
  if (note.includes(OPERATOR_RESOLVED_OUTCOME_MARKER)) return "resolved";
  if (note.includes(OPERATOR_NO_RESOLUTION_OUTCOME_MARKER)) return "no_resolution";
  return null;
}

/**
 * Consumer archive UI/API should not close cases that Surrenderless operators own
 * after a recorded response-review terminal outcome.
 */
export function shouldSuppressConsumerArchiveForOperatorOwnedClosure(
  clientState: unknown
): boolean {
  const action = parseApprovedNextActionFromClientState(clientState);
  return hasOperatorTerminalResponseReviewOutcome(action);
}

export function detectOperatorOwnedClosableCase(params: {
  clientState: unknown;
  archivedAt: string | null | undefined;
  caseId: string;
  tasks: readonly JusticeCaseTaskRow[];
}): boolean {
  if (params.archivedAt?.trim()) return false;
  const action = parseApprovedNextActionFromClientState(params.clientState);
  if (!hasOperatorTerminalResponseReviewOutcome(action)) return false;
  if (
    !canArchiveCaseForEscalationLadder({
      approvedAction: action,
      caseId: params.caseId,
      tasks: params.tasks,
    })
  ) {
    return false;
  }
  return true;
}

export async function listOperatorClosableCases(
  supabase: SupabaseClient,
  options: { limit?: number } = {}
): Promise<OperatorClosableCaseItem[]> {
  const limit = options.limit ?? 50;
  const { data: reviewTasks, error: tasksErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .like("notes", "follow_up_response_review:%")
    .not("completed_at", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit * 3);

  if (tasksErr) {
    console.warn("operator closable cases: list review tasks", tasksErr.message);
    return [];
  }

  const caseIds = [
    ...new Set(
      ((reviewTasks ?? []) as JusticeCaseTaskRow[])
        .map((t) => t.case_id?.trim() ?? "")
        .filter(Boolean)
    ),
  ].slice(0, limit * 2);

  if (caseIds.length === 0) return [];

  const { data: caseRows, error: casesErr } = await supabase
    .from("justice_cases")
    .select("id, user_id, intake, client_state, archived_at")
    .in("id", caseIds)
    .is("archived_at", null);

  if (casesErr) {
    console.warn("operator closable cases: list cases", casesErr.message);
    return [];
  }

  const { data: allTasks, error: allTasksErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .in("case_id", caseIds);

  if (allTasksErr) {
    console.warn("operator closable cases: list case tasks", allTasksErr.message);
    return [];
  }

  const tasksByCaseId = new Map<string, JusticeCaseTaskRow[]>();
  for (const task of (allTasks ?? []) as JusticeCaseTaskRow[]) {
    const caseId = task.case_id?.trim() ?? "";
    if (!caseId) continue;
    const list = tasksByCaseId.get(caseId) ?? [];
    list.push(task);
    tasksByCaseId.set(caseId, list);
  }

  const items: OperatorClosableCaseItem[] = [];
  for (const row of caseRows ?? []) {
    const caseId = String(row.id ?? "").trim();
    const userId = String(row.user_id ?? "").trim();
    if (!caseId || !userId) continue;
    if (!isJusticeIntakePayload(row.intake)) continue;
    const intake = row.intake as JusticeIntake;
    const tasks = tasksByCaseId.get(caseId) ?? [];
    if (
      !detectOperatorOwnedClosableCase({
        clientState: row.client_state,
        archivedAt: row.archived_at as string | null,
        caseId,
        tasks,
      })
    ) {
      continue;
    }
    const action = parseApprovedNextActionFromClientState(row.client_state);
    const outcome = operatorOwnedClosableOutcomeFromAction(action);
    if (!outcome) continue;
    items.push({
      case_id: caseId,
      case_owner_user_id: userId,
      company_name: intake.company_name.trim() || "Consumer case",
      consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
      outcome,
      outcome_note: action?.outcome_note?.trim() ?? "",
    });
    if (items.length >= limit) break;
  }

  return items;
}

export type CompleteOperatorCaseArchiveInput = {
  caseId: string;
  /** Must be true — explicit operator confirmation. */
  confirmArchive: boolean;
};

export type CompleteOperatorCaseArchiveResult =
  | {
      ok: true;
      caseId: string;
      archived_at: string;
      timeline: TimelineEntry[] | null;
      outcome: OperatorOwnedClosableOutcome;
      idempotent: boolean;
    }
  | { ok: false; error: string; status: number };

/**
 * Operator-owned archive after resolved/no_resolution response review.
 * Never archives without confirmArchive, markers, and ladder eligibility.
 */
export async function completeOperatorCaseArchive(
  supabase: SupabaseClient,
  userId: string,
  input: CompleteOperatorCaseArchiveInput
): Promise<CompleteOperatorCaseArchiveResult> {
  const caseId = input.caseId.trim();
  if (!caseId) {
    return { ok: false, error: "case_id is required", status: 400 };
  }
  if (input.confirmArchive !== true) {
    return {
      ok: false,
      error: "Explicit confirm_archive is required to close the case",
      status: 400,
    };
  }

  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("id, user_id, intake, client_state, archived_at")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (caseErr || !caseRow) {
    return { ok: false, error: "Not found", status: 404 };
  }

  if (caseRow.archived_at?.trim()) {
    const action = parseApprovedNextActionFromClientState(caseRow.client_state);
    const outcome = operatorOwnedClosableOutcomeFromAction(action);
    return {
      ok: true,
      caseId,
      archived_at: caseRow.archived_at.trim(),
      timeline: null,
      outcome: outcome ?? "no_resolution",
      idempotent: true,
    };
  }

  const { data: taskRows, error: tasksErr } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .eq("case_id", caseId);

  if (tasksErr) {
    console.warn("operator case archive: list tasks", tasksErr.message);
    return { ok: false, error: "Could not load case tasks", status: 500 };
  }

  const tasks = (taskRows ?? []) as JusticeCaseTaskRow[];
  const openReview = tasks.find(
    (t) =>
      taskNotesMatchFollowUpResponseReviewMarker(t.notes, caseId) && !t.completed_at?.trim()
  );
  if (openReview) {
    return {
      ok: false,
      error: "Response review is still open; complete it before closing",
      status: 409,
    };
  }

  if (
    !detectOperatorOwnedClosableCase({
      clientState: caseRow.client_state,
      archivedAt: caseRow.archived_at,
      caseId,
      tasks,
    })
  ) {
    return {
      ok: false,
      error:
        "Case is not eligible for operator close (requires recorded resolved or no-resolution outcome)",
      status: 409,
    };
  }

  const action = parseApprovedNextActionFromClientState(caseRow.client_state);
  const outcome = operatorOwnedClosableOutcomeFromAction(action);
  if (!outcome) {
    return { ok: false, error: "Missing operator terminal outcome", status: 409 };
  }

  const archivedAt = new Date().toISOString();
  const { error: patchErr } = await supabase
    .from("justice_cases")
    .update({ archived_at: archivedAt })
    .eq("id", caseId)
    .eq("user_id", userId);

  if (patchErr) {
    console.warn("operator case archive: patch", patchErr.message);
    return { ok: false, error: "Could not archive case", status: 500 };
  }

  let timeline: TimelineEntry[] | null = null;
  if (isFirstArchiveTransition(null, archivedAt)) {
    timeline = await appendCaseTimelineEntry(
      supabase,
      userId,
      caseId,
      buildCaseArchivedTimelineEntry(caseId, archivedAt)
    );
  }

  return {
    ok: true,
    caseId,
    archived_at: archivedAt,
    timeline,
    outcome,
    idempotent: false,
  };
}
