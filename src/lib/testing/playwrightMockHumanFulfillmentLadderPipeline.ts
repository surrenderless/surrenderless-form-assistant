import {
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  parseJusticeCaseClientState,
} from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  buildDemandLetterFilingTaskNotes,
  buildDemandLetterFilingTaskTitle,
  shouldQueueDemandLetterFilingTask,
  taskNotesMatchDemandLetterFilingMarker,
} from "@/lib/justice/demandLetterFilingTask";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { mergeResolutionTrackingIntoClientState } from "@/lib/justice/initiateResolutionAfterEscalationTerminal";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import {
  buildStateAgFilingTaskNotes,
  buildStateAgFilingTaskTitle,
  shouldQueueStateAgFilingTask,
  taskNotesMatchStateAgFilingMarker,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeApprovedNextAction, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import {
  buildPlaywrightMockCaseGetResponse,
  buildPlaywrightMockCasePatchResponse,
  isPlaywrightMockIntakeCaseHydrationCaseId,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import {
  buildPlaywrightMockJusticeFilingPostResponse,
  type PlaywrightMockJusticeFilingRow,
} from "@/lib/testing/playwrightMockJusticeFilingsPipeline";
import type { PlaywrightMockJusticeTaskRow } from "@/lib/testing/playwrightMockJusticeTasksPipeline";

const PLAYWRIGHT_MOCK_TASK_TIMESTAMP = "2026-06-21T00:00:04.000Z";
export const PLAYWRIGHT_MOCK_STATE_AG_TASK_ID = "00000000-0000-4000-8000-000000000746";
export const PLAYWRIGHT_MOCK_DEMAND_LETTER_TASK_ID = "00000000-0000-4000-8000-000000000747";

const playwrightMockHumanFulfillmentTasksByCaseId = new Map<
  string,
  PlaywrightMockJusticeTaskRow[]
>();

export function resetPlaywrightMockHumanFulfillmentLadderForTests(): void {
  playwrightMockHumanFulfillmentTasksByCaseId.clear();
}

export function resetPlaywrightMockHumanFulfillmentLadderForCase(caseId: string): void {
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) return;
  playwrightMockHumanFulfillmentTasksByCaseId.delete(caseId.trim());
}

function buildOpenTask(input: {
  id: string;
  userId: string;
  caseId: string;
  title: string;
  notes: string;
}): PlaywrightMockJusticeTaskRow {
  return {
    id: input.id,
    user_id: input.userId,
    case_id: input.caseId,
    title: input.title,
    due_date: null,
    notes: input.notes,
    completed_at: null,
    created_at: PLAYWRIGHT_MOCK_TASK_TIMESTAMP,
    updated_at: PLAYWRIGHT_MOCK_TASK_TIMESTAMP,
  };
}

function buildCompletedApprovedNextAction(approvedNextAction: JusticeApprovedNextAction): JusticeApprovedNextAction {
  return {
    ...approvedNextAction,
    status: "completed",
    completed_at: approvedNextAction.completed_at ?? new Date().toISOString(),
  };
}

/** Sync mock operator tasks from cumulative case client_state after PATCH. */
export function syncPlaywrightMockHumanFulfillmentLadderFromCasePatch(
  caseId: string,
  userId: string,
  clientState: unknown,
  intake: unknown
): void {
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) return;
  if (!isJusticeIntakePayload(intake)) return;

  const justiceIntake = intake as JusticeIntake;
  const tasks: PlaywrightMockJusticeTaskRow[] = [];
  const trimmedCaseId = caseId.trim();

  if (shouldQueueStateAgFilingTask(clientState)) {
    tasks.push(
      buildOpenTask({
        id: PLAYWRIGHT_MOCK_STATE_AG_TASK_ID,
        userId,
        caseId: trimmedCaseId,
        title: buildStateAgFilingTaskTitle(justiceIntake),
        notes: buildStateAgFilingTaskNotes(trimmedCaseId, justiceIntake),
      })
    );
  }

  if (shouldQueueDemandLetterFilingTask(clientState)) {
    tasks.push(
      buildOpenTask({
        id: PLAYWRIGHT_MOCK_DEMAND_LETTER_TASK_ID,
        userId,
        caseId: trimmedCaseId,
        title: buildDemandLetterFilingTaskTitle(justiceIntake),
        notes: buildDemandLetterFilingTaskNotes(trimmedCaseId, justiceIntake),
      })
    );
  }

  playwrightMockHumanFulfillmentTasksByCaseId.set(trimmedCaseId, tasks);
}

export function getPlaywrightMockHumanFulfillmentTasks(
  caseId: string,
  userId: string
): PlaywrightMockJusticeTaskRow[] {
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) return [];
  const rows = playwrightMockHumanFulfillmentTasksByCaseId.get(caseId.trim()) ?? [];
  return rows.map((row) => ({ ...row, user_id: userId }));
}

export type PlaywrightMockOperatorFilingCompleteInput = {
  caseId: string;
  userId: string;
  taskId: string;
  destination: string;
  filedAt: string;
  confirmationNumber: string;
  notes?: string | null;
};

export type PlaywrightMockOperatorFilingCompleteResult =
  | {
      ok: true;
      filing: PlaywrightMockJusticeFilingRow;
      task: PlaywrightMockJusticeTaskRow;
      client_state: unknown;
      timeline?: TimelineEntry[];
      advanced: boolean;
    }
  | { ok: false; error: string; status: number };

export function completePlaywrightMockStateAgOperatorFiling(
  input: PlaywrightMockOperatorFilingCompleteInput
): PlaywrightMockOperatorFilingCompleteResult {
  const caseId = input.caseId.trim();
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) {
    return { ok: false, error: "Not found", status: 404 };
  }

  const snapshot = buildPlaywrightMockCaseGetResponse(caseId);
  if (!isJusticeIntakePayload(snapshot.intake)) {
    return { ok: false, error: "Case intake is invalid", status: 400 };
  }
  const intake = snapshot.intake as JusticeIntake;

  const tasks = playwrightMockHumanFulfillmentTasksByCaseId.get(caseId) ?? [];
  const task = tasks.find((row) => row.id === input.taskId.trim());
  if (!task || !taskNotesMatchStateAgFilingMarker(task.notes, caseId)) {
    return { ok: false, error: "State AG operator task not found", status: 404 };
  }

  const filing = buildPlaywrightMockJusticeFilingPostResponse(caseId, input.userId, {
    destination: input.destination.trim(),
    filed_at: input.filedAt.trim(),
    confirmation_number: input.confirmationNumber.trim(),
    notes: input.notes ?? null,
  });

  const parsedClientState = parseJusticeCaseClientState(snapshot.client_state);
  const approvedNext = parsedClientState.approved_next_action;
  let clientState: Record<string, unknown> = (snapshot.client_state ?? {}) as Record<string, unknown>;
  let advanced = false;

  if (
    approvedNext?.href?.trim() === MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF &&
    approvedNext.status !== "completed"
  ) {
    const completedHref = approvedNext.href.trim();
    const completedWithTracking = buildCompletedApprovedNextAction(approvedNext);
    const advancedAction = advanceApprovedNextActionAfterCompleted(intake, completedHref, {
      existing: completedWithTracking,
    });
    const nextApprovedNext =
      advancedAction?.href?.trim() &&
      advancedAction.href.trim() !== completedHref &&
      advancedAction.status === "approved"
        ? omitClearedHandlingRequestNoteFromApprovedNextAction(advancedAction)
        : completedWithTracking;
    advanced = Boolean(
      advancedAction?.href?.trim() &&
        advancedAction.href.trim() !== completedHref &&
        advancedAction.status === "approved"
    );
    clientState = mergeClientStateWithApprovedNextAction(snapshot.client_state, nextApprovedNext);
  }

  const patched = buildPlaywrightMockCasePatchResponse(caseId, { client_state: clientState });
  syncPlaywrightMockHumanFulfillmentLadderFromCasePatch(
    caseId,
    input.userId,
    patched.client_state,
    patched.intake
  );

  return {
    ok: true,
    filing,
    task: { ...task, completed_at: PLAYWRIGHT_MOCK_TASK_TIMESTAMP, updated_at: PLAYWRIGHT_MOCK_TASK_TIMESTAMP },
    client_state: patched.client_state,
    timeline: filing.timeline,
    advanced,
  };
}

export function completePlaywrightMockDemandLetterOperatorFiling(
  input: PlaywrightMockOperatorFilingCompleteInput
): PlaywrightMockOperatorFilingCompleteResult {
  const caseId = input.caseId.trim();
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) {
    return { ok: false, error: "Not found", status: 404 };
  }

  const snapshot = buildPlaywrightMockCaseGetResponse(caseId);
  if (!isJusticeIntakePayload(snapshot.intake)) {
    return { ok: false, error: "Case intake is invalid", status: 400 };
  }
  const intake = snapshot.intake as JusticeIntake;

  const tasks = playwrightMockHumanFulfillmentTasksByCaseId.get(caseId) ?? [];
  const task = tasks.find((row) => row.id === input.taskId.trim());
  if (!task || !taskNotesMatchDemandLetterFilingMarker(task.notes, caseId)) {
    return { ok: false, error: "Demand letter operator task not found", status: 404 };
  }

  const filing = buildPlaywrightMockJusticeFilingPostResponse(caseId, input.userId, {
    destination: input.destination.trim(),
    filed_at: input.filedAt.trim(),
    confirmation_number: input.confirmationNumber.trim(),
    notes: input.notes ?? null,
  });

  const parsedClientState = parseJusticeCaseClientState(snapshot.client_state);
  const approvedNext = parsedClientState.approved_next_action;
  let clientState: Record<string, unknown> = (snapshot.client_state ?? {}) as Record<string, unknown>;
  let advanced = false;

  if (
    approvedNext?.href?.trim() === MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF &&
    approvedNext.status !== "completed"
  ) {
    const completedHref = approvedNext.href.trim();
    const completedWithTracking = buildCompletedApprovedNextAction(approvedNext);
    const advancedAction = advanceApprovedNextActionAfterCompleted(intake, completedHref, {
      existing: completedWithTracking,
    });
    const nextApprovedNext =
      advancedAction?.href?.trim() &&
      advancedAction.href.trim() !== completedHref &&
      advancedAction.status === "approved"
        ? omitClearedHandlingRequestNoteFromApprovedNextAction(advancedAction)
        : completedWithTracking;
    advanced = Boolean(
      advancedAction?.href?.trim() &&
        advancedAction.href.trim() !== completedHref &&
        advancedAction.status === "approved"
    );
    clientState = mergeClientStateWithApprovedNextAction(snapshot.client_state, nextApprovedNext);
    const resolutionMerged = mergeResolutionTrackingIntoClientState(clientState, intake);
    if (resolutionMerged) {
      clientState = resolutionMerged;
    }
  }

  const patched = buildPlaywrightMockCasePatchResponse(caseId, { client_state: clientState });
  syncPlaywrightMockHumanFulfillmentLadderFromCasePatch(
    caseId,
    input.userId,
    patched.client_state,
    patched.intake
  );

  return {
    ok: true,
    filing,
    task: { ...task, completed_at: PLAYWRIGHT_MOCK_TASK_TIMESTAMP, updated_at: PLAYWRIGHT_MOCK_TASK_TIMESTAMP },
    client_state: patched.client_state,
    timeline: filing.timeline,
    advanced,
  };
}

/** Whether operator filing mock routes should handle the fixed E2E case. */
export function isPlaywrightMockHumanFulfillmentOperatorFilingCaseId(caseId: string): boolean {
  return isPlaywrightMockIntakeCaseHydrationCaseId(caseId);
}

export function isPlaywrightMockHumanFulfillmentOperatorFilingEnabled(): boolean {
  return process.env.PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE === "1";
}
