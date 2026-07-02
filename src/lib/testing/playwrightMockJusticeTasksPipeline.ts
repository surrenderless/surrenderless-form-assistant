import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";

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

/** Clears mock task snapshots — for unit tests only. */
export function resetPlaywrightMockJusticeTasksForTests(): void {
  // No cumulative state yet; hook for parity with filings/evidence reset helpers.
}

/** Clears mock tasks for one case — used when Playwright E2E recommits the fixed case. */
export function resetPlaywrightMockJusticeTasksForCase(caseId: string): void {
  if (!isPlaywrightMockJusticeTasksCaseId(caseId)) return;
}

/**
 * Deterministic GET /api/justice/tasks response for Playwright E2E.
 * Returns an empty list for the fixed E2E case id (no follow-up tasks on the canonical path).
 */
export function buildPlaywrightMockJusticeTasksGetResponse(
  caseId: string,
  _userId: string
): PlaywrightMockJusticeTaskRow[] {
  if (!isPlaywrightMockJusticeTasksCaseId(caseId)) {
    return [];
  }
  return [];
}
