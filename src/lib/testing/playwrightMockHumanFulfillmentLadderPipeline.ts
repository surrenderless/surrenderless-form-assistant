import {
  mergeClientStateWithApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  parseJusticeCaseClientState,
} from "@/lib/justice/approvedNextActionState";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  buildCfpbFilingTaskNotes,
  buildCfpbFilingTaskTitle,
  parseCfpbFilingTaskDraft,
  shouldQueueCfpbFilingTask,
  taskNotesMatchCfpbFilingMarker,
} from "@/lib/justice/cfpbFilingTask";
import {
  buildDemandLetterFilingTaskNotes,
  buildDemandLetterFilingTaskTitle,
  parseDemandLetterFilingTaskDraft,
  shouldQueueDemandLetterFilingTask,
  taskNotesMatchDemandLetterFilingMarker,
} from "@/lib/justice/demandLetterFilingTask";
import {
  buildFccFilingTaskNotes,
  buildFccFilingTaskTitle,
  parseFccFilingTaskDraft,
  shouldQueueFccFilingTask,
  taskNotesMatchFccFilingMarker,
} from "@/lib/justice/fccFilingTask";
import {
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { mergeResolutionTrackingIntoClientState } from "@/lib/justice/initiateResolutionAfterEscalationTerminal";
import {
  buildPaymentDisputeFilingTaskNotes,
  buildPaymentDisputeFilingTaskTitle,
  parsePaymentDisputeFilingTaskDraft,
  resolvePaymentDisputeDraftForOperatorPacket,
  shouldQueuePaymentDisputeFilingTask,
  taskNotesMatchPaymentDisputeFilingMarker,
} from "@/lib/justice/paymentDisputeFilingTask";
import { advanceApprovedNextActionAfterCompleted } from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import {
  buildStateAgFilingTaskNotes,
  buildStateAgFilingTaskTitle,
  parseStateAgFilingTaskDraft,
  shouldQueueStateAgFilingTask,
  taskNotesMatchStateAgFilingMarker,
} from "@/lib/justice/stateAgFilingTask";
import type { JusticeApprovedNextAction, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import {
  buildPlaywrightMockCaseGetResponse,
  buildPlaywrightMockCasePatchResponse,
  isPlaywrightMockIntakeCaseHydrationCaseId,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  buildPlaywrightMockJusticeFilingPostResponse,
  type PlaywrightMockJusticeFilingRow,
} from "@/lib/testing/playwrightMockJusticeFilingsPipeline";
import type { PlaywrightMockJusticeTaskRow } from "@/lib/testing/playwrightMockJusticeTasksPipeline";

const PLAYWRIGHT_MOCK_TASK_TIMESTAMP = "2026-06-21T00:00:04.000Z";
export const PLAYWRIGHT_MOCK_STATE_AG_TASK_ID = "00000000-0000-4000-8000-000000000746";
export const PLAYWRIGHT_MOCK_DEMAND_LETTER_TASK_ID = "00000000-0000-4000-8000-000000000747";
export const PLAYWRIGHT_MOCK_CFPB_TASK_ID = "00000000-0000-4000-8000-000000000748";
export const PLAYWRIGHT_MOCK_PAYMENT_DISPUTE_TASK_ID = "00000000-0000-4000-8000-000000000749";
export const PLAYWRIGHT_MOCK_FCC_TASK_ID = "00000000-0000-4000-8000-000000000750";

const PLAYWRIGHT_MOCK_HUMAN_FULFILLMENT_TASKS_GLOBAL_KEY =
  "__playwrightMockHumanFulfillmentTasksByCaseId__";
const PLAYWRIGHT_MOCK_CASE_OWNER_GLOBAL_KEY = "__playwrightMockCaseOwnerUserIdByCaseId__";

type TasksMap = Map<string, PlaywrightMockJusticeTaskRow[]>;
type OwnerMap = Map<string, string>;

function getPlaywrightMockHumanFulfillmentTasksByCaseId(): TasksMap {
  const globalStore = globalThis as typeof globalThis & {
    [PLAYWRIGHT_MOCK_HUMAN_FULFILLMENT_TASKS_GLOBAL_KEY]?: TasksMap;
  };
  if (!globalStore[PLAYWRIGHT_MOCK_HUMAN_FULFILLMENT_TASKS_GLOBAL_KEY]) {
    globalStore[PLAYWRIGHT_MOCK_HUMAN_FULFILLMENT_TASKS_GLOBAL_KEY] = new Map();
  }
  return globalStore[PLAYWRIGHT_MOCK_HUMAN_FULFILLMENT_TASKS_GLOBAL_KEY]!;
}

function getPlaywrightMockCaseOwnerUserIdByCaseId(): OwnerMap {
  const globalStore = globalThis as typeof globalThis & {
    [PLAYWRIGHT_MOCK_CASE_OWNER_GLOBAL_KEY]?: OwnerMap;
  };
  if (!globalStore[PLAYWRIGHT_MOCK_CASE_OWNER_GLOBAL_KEY]) {
    globalStore[PLAYWRIGHT_MOCK_CASE_OWNER_GLOBAL_KEY] = new Map();
  }
  return globalStore[PLAYWRIGHT_MOCK_CASE_OWNER_GLOBAL_KEY]!;
}

export function setPlaywrightMockCaseOwnerUserId(caseId: string, userId: string): void {
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) return;
  const trimmedCaseId = caseId.trim();
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) return;
  const ownerMap = getPlaywrightMockCaseOwnerUserIdByCaseId();
  const existing = ownerMap.get(trimmedCaseId)?.trim();
  // Mock GET/hydration syncs with a synthetic user id — do not clobber the real Clerk owner.
  if (
    existing &&
    existing !== "playwright_e2e_user" &&
    trimmedUserId === "playwright_e2e_user"
  ) {
    return;
  }
  ownerMap.set(trimmedCaseId, trimmedUserId);
}

export function resetPlaywrightMockHumanFulfillmentLadderForTests(): void {
  getPlaywrightMockHumanFulfillmentTasksByCaseId().clear();
  getPlaywrightMockCaseOwnerUserIdByCaseId().clear();
}

export function resetPlaywrightMockHumanFulfillmentLadderForCase(caseId: string): void {
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) return;
  getPlaywrightMockHumanFulfillmentTasksByCaseId().delete(caseId.trim());
  getPlaywrightMockCaseOwnerUserIdByCaseId().delete(caseId.trim());
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
  intake: unknown,
  paymentDisputeDraft?: unknown
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

  if (shouldQueueCfpbFilingTask(clientState)) {
    tasks.push(
      buildOpenTask({
        id: PLAYWRIGHT_MOCK_CFPB_TASK_ID,
        userId,
        caseId: trimmedCaseId,
        title: buildCfpbFilingTaskTitle(justiceIntake),
        notes: buildCfpbFilingTaskNotes(trimmedCaseId, justiceIntake),
      })
    );
  }

  if (shouldQueuePaymentDisputeFilingTask(clientState)) {
    const draft = resolvePaymentDisputeDraftForOperatorPacket(
      trimmedCaseId,
      justiceIntake,
      paymentDisputeDraft
    );
    tasks.push(
      buildOpenTask({
        id: PLAYWRIGHT_MOCK_PAYMENT_DISPUTE_TASK_ID,
        userId,
        caseId: trimmedCaseId,
        title: buildPaymentDisputeFilingTaskTitle(justiceIntake),
        notes: buildPaymentDisputeFilingTaskNotes(trimmedCaseId, justiceIntake, draft),
      })
    );
  }

  if (shouldQueueFccFilingTask(clientState)) {
    tasks.push(
      buildOpenTask({
        id: PLAYWRIGHT_MOCK_FCC_TASK_ID,
        userId,
        caseId: trimmedCaseId,
        title: buildFccFilingTaskTitle(justiceIntake),
        notes: buildFccFilingTaskNotes(trimmedCaseId, justiceIntake),
      })
    );
  }

  getPlaywrightMockHumanFulfillmentTasksByCaseId().set(trimmedCaseId, tasks);
  if (userId.trim()) {
    setPlaywrightMockCaseOwnerUserId(trimmedCaseId, userId.trim());
  }
}

export function getPlaywrightMockHumanFulfillmentTasks(
  caseId: string,
  userId: string
): PlaywrightMockJusticeTaskRow[] {
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) return [];
  const rows = getPlaywrightMockHumanFulfillmentTasksByCaseId().get(caseId.trim()) ?? [];
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

  const tasks = getPlaywrightMockHumanFulfillmentTasksByCaseId().get(caseId) ?? [];
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
    patched.intake,
    patched.payment_dispute_draft
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

  const tasks = getPlaywrightMockHumanFulfillmentTasksByCaseId().get(caseId) ?? [];
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
    patched.intake,
    patched.payment_dispute_draft
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

export function completePlaywrightMockCfpbOperatorFiling(
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

  const tasks = getPlaywrightMockHumanFulfillmentTasksByCaseId().get(caseId) ?? [];
  const task = tasks.find((row) => row.id === input.taskId.trim());
  if (!task || !taskNotesMatchCfpbFilingMarker(task.notes, caseId)) {
    return { ok: false, error: "CFPB operator task not found", status: 404 };
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
    approvedNext?.href?.trim() === MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF &&
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
    patched.intake,
    patched.payment_dispute_draft
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

export function completePlaywrightMockPaymentDisputeOperatorFiling(
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

  const tasks = getPlaywrightMockHumanFulfillmentTasksByCaseId().get(caseId) ?? [];
  const task = tasks.find((row) => row.id === input.taskId.trim());
  if (!task || !taskNotesMatchPaymentDisputeFilingMarker(task.notes, caseId)) {
    return { ok: false, error: "Payment dispute operator task not found", status: 404 };
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
    approvedNext?.href?.trim() === MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF &&
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
    patched.intake,
    patched.payment_dispute_draft
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

export function completePlaywrightMockFccOperatorFiling(
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

  const tasks = getPlaywrightMockHumanFulfillmentTasksByCaseId().get(caseId) ?? [];
  const task = tasks.find((row) => row.id === input.taskId.trim());
  if (!task || !taskNotesMatchFccFilingMarker(task.notes, caseId)) {
    return { ok: false, error: "FCC operator task not found", status: 404 };
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
    approvedNext?.href?.trim() === MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF &&
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
    patched.intake,
    patched.payment_dispute_draft
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

export function resolvePlaywrightMockCaseOwnerUserId(caseId: string): string | null {
  const trimmedCaseId = caseId.trim();
  const ownerFromMap = getPlaywrightMockCaseOwnerUserIdByCaseId().get(trimmedCaseId)?.trim();
  if (ownerFromMap && ownerFromMap !== "playwright_e2e_user") {
    return ownerFromMap;
  }
  const tasks = getPlaywrightMockHumanFulfillmentTasksByCaseId().get(trimmedCaseId) ?? [];
  const ownerFromTask = tasks
    .map((task) => task.user_id?.trim() ?? "")
    .find((id) => id.length > 0 && id !== "playwright_e2e_user");
  if (ownerFromTask) return ownerFromTask;
  if (ownerFromMap) return ownerFromMap;
  return null;
}

/** Whether operator filing mock routes should handle the fixed E2E case. */
export function isPlaywrightMockHumanFulfillmentOperatorFilingCaseId(caseId: string): boolean {
  return isPlaywrightMockIntakeCaseHydrationCaseId(caseId);
}

export function isPlaywrightMockHumanFulfillmentOperatorFilingEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE !== "1") {
    return false;
  }
  // Never allow on deployed production, even if the env var is set.
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  return true;
}

export function buildPlaywrightMockOperatorFulfillmentQueue(): import("@/lib/justice/operatorFulfillmentQueue").OperatorFulfillmentQueueItem[] {
  const caseId = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;
  if (!isPlaywrightMockIntakeCaseHydrationCaseId(caseId)) return [];

  const snapshot = buildPlaywrightMockCaseGetResponse(caseId);
  const storedTasks = getPlaywrightMockHumanFulfillmentTasksByCaseId().get(caseId) ?? [];
  const consumerUserId = storedTasks.find((task) => task.user_id?.trim())?.user_id?.trim() ?? "";
  if (consumerUserId) {
    syncPlaywrightMockHumanFulfillmentLadderFromCasePatch(
      caseId,
      consumerUserId,
      snapshot.client_state,
      snapshot.intake,
      snapshot.payment_dispute_draft
    );
  }

  if (!isJusticeIntakePayload(snapshot.intake)) return [];

  const intake = snapshot.intake as JusticeIntake;
  const tasks = getPlaywrightMockHumanFulfillmentTasksByCaseId().get(caseId) ?? [];
  const items: import("@/lib/justice/operatorFulfillmentQueue").OperatorFulfillmentQueueItem[] = [];

  for (const task of tasks) {
    if (task.completed_at?.trim()) continue;
    const ownerId = task.user_id?.trim() || consumerUserId;
    if (taskNotesMatchStateAgFilingMarker(task.notes, caseId)) {
      items.push({
        case_id: caseId,
        case_owner_user_id: ownerId,
        task_id: task.id,
        step: "state_ag",
        task_title: task.title?.trim() || "State AG filing",
        company_name: intake.company_name.trim() || "Consumer case",
        consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
        draft_excerpt: parseStateAgFilingTaskDraft(task.notes).slice(0, 400),
      });
      continue;
    }
    if (taskNotesMatchDemandLetterFilingMarker(task.notes, caseId)) {
      items.push({
        case_id: caseId,
        case_owner_user_id: ownerId,
        task_id: task.id,
        step: "demand_letter",
        task_title: task.title?.trim() || "Demand letter",
        company_name: intake.company_name.trim() || "Consumer case",
        consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
        draft_excerpt: parseDemandLetterFilingTaskDraft(task.notes).slice(0, 400),
      });
      continue;
    }
    if (taskNotesMatchCfpbFilingMarker(task.notes, caseId)) {
      items.push({
        case_id: caseId,
        case_owner_user_id: ownerId,
        task_id: task.id,
        step: "cfpb",
        task_title: task.title?.trim() || "CFPB filing",
        company_name: intake.company_name.trim() || "Consumer case",
        consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
        draft_excerpt: parseCfpbFilingTaskDraft(task.notes).slice(0, 400),
      });
      continue;
    }
    if (taskNotesMatchPaymentDisputeFilingMarker(task.notes, caseId)) {
      items.push({
        case_id: caseId,
        case_owner_user_id: ownerId,
        task_id: task.id,
        step: "payment_dispute",
        task_title: task.title?.trim() || "Payment dispute",
        company_name: intake.company_name.trim() || "Consumer case",
        consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
        draft_excerpt: parsePaymentDisputeFilingTaskDraft(task.notes).slice(0, 400),
      });
      continue;
    }
    if (taskNotesMatchFccFilingMarker(task.notes, caseId)) {
      items.push({
        case_id: caseId,
        case_owner_user_id: ownerId,
        task_id: task.id,
        step: "fcc",
        task_title: task.title?.trim() || "FCC filing",
        company_name: intake.company_name.trim() || "Consumer case",
        consumer_us_state: intake.consumer_us_state?.trim().toUpperCase() || null,
        draft_excerpt: parseFccFilingTaskDraft(task.notes).slice(0, 400),
      });
    }
  }

  return items;
}
