import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  getPlaywrightMockHumanFulfillmentTasks,
  resetPlaywrightMockHumanFulfillmentLadderForCase,
  resetPlaywrightMockHumanFulfillmentLadderForTests,
  syncPlaywrightMockHumanFulfillmentLadderFromCasePatch,
} from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";
import { buildPlaywrightMockCaseGetResponse } from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";

export type PlaywrightMockJusticeTaskRow = {
  id: string;
  user_id: string;
  case_id: string;
  title: string;
  due_date: string | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Enabled only when Playwright webServer sets PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE=1. */
export function isPlaywrightMockJusticeTasksPipelineEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE !== "1") {
    return false;
  }
  // Never allow on deployed production, even if the env var is set.
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  return true;
}

/** True when GET /api/justice/tasks should use the deterministic Playwright mock. */
export function isPlaywrightMockJusticeTasksCaseId(caseId: string): boolean {
  return caseId.trim() === PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;
}

/** Clears mock tasks for unit tests only. */
export function resetPlaywrightMockJusticeTasksForTests(): void {
  resetPlaywrightMockHumanFulfillmentLadderForTests();
}

/** Clears mock tasks for one case — used when Playwright E2E recommits the fixed case. */
export function resetPlaywrightMockJusticeTasksForCase(caseId: string): void {
  resetPlaywrightMockHumanFulfillmentLadderForCase(caseId);
}

export function resetPlaywrightMockHumanFulfillmentTasksForCase(caseId: string): void {
  resetPlaywrightMockHumanFulfillmentLadderForCase(caseId);
}

/**
 * Deterministic GET /api/justice/tasks response for Playwright E2E.
 * Returns human-fulfillment operator tasks synced from case client_state.
 */
export function buildPlaywrightMockJusticeTasksGetResponse(
  caseId: string,
  userId: string
): PlaywrightMockJusticeTaskRow[] {
  if (!isPlaywrightMockJusticeTasksCaseId(caseId)) {
    return [];
  }
  const snapshot = buildPlaywrightMockCaseGetResponse(caseId);
  syncPlaywrightMockHumanFulfillmentLadderFromCasePatch(
    caseId,
    userId,
    snapshot.client_state,
    snapshot.intake
  );
  return getPlaywrightMockHumanFulfillmentTasks(caseId, userId);
}
