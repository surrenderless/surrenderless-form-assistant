import {
  PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
  type PlaywrightMockCaseCreateResponse,
} from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  buildPlaywrightMockCaseGetResponse,
  isPlaywrightMockIntakeCaseHydrationPipelineEnabled,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";

export type PlaywrightMockArchivedCasesListResponse = {
  cases: PlaywrightMockCaseCreateResponse[];
  has_more: boolean;
  offset: number;
  limit: number;
};

/** Enabled only when Playwright webServer sets PLAYWRIGHT_MOCK_JUSTICE_ARCHIVED_CASES_LIST_PIPELINE=1. */
export function isPlaywrightMockJusticeArchivedCasesListPipelineEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_JUSTICE_ARCHIVED_CASES_LIST_PIPELINE !== "1") {
    return false;
  }
  // Never allow on deployed production, even if the env var is set.
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  // Archived list reads archive state from the hydration mock snapshot.
  return isPlaywrightMockIntakeCaseHydrationPipelineEnabled();
}

/**
 * Deterministic GET /api/justice/cases?archived=1 response for Playwright E2E.
 * Returns the fixed E2E case only when its hydration snapshot has archived_at set.
 */
export function buildPlaywrightMockArchivedCasesListResponse(
  limit: number,
  offset: number
): PlaywrightMockArchivedCasesListResponse {
  const snapshot = buildPlaywrightMockCaseGetResponse(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
  const archivedCases = snapshot.archived_at ? [snapshot] : [];
  const window = archivedCases.slice(offset, offset + limit);
  const has_more = archivedCases.length > offset + limit;

  return {
    cases: window.map((row) => ({ ...row })),
    has_more,
    offset,
    limit,
  };
}
