import {
  PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
  type PlaywrightMockCaseCreateResponse,
} from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  buildPlaywrightMockCaseGetResponse,
  isPlaywrightMockIntakeCaseHydrationPipelineEnabled,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";

export type PlaywrightMockSavedCasesListResponse = {
  cases: PlaywrightMockCaseCreateResponse[];
  has_more: boolean;
  offset: number;
  limit: number;
};

/** Enabled only when Playwright webServer sets PLAYWRIGHT_MOCK_JUSTICE_SAVED_CASES_LIST_PIPELINE=1. */
export function isPlaywrightMockJusticeSavedCasesListPipelineEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_JUSTICE_SAVED_CASES_LIST_PIPELINE !== "1") {
    return false;
  }
  // Never allow on deployed production, even if the env var is set.
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  // Saved list reads active state from the hydration mock snapshot.
  return isPlaywrightMockIntakeCaseHydrationPipelineEnabled();
}

/**
 * Deterministic GET /api/justice/cases response for Playwright E2E.
 * Returns the fixed E2E case only when its hydration snapshot has archived_at null.
 */
export function buildPlaywrightMockSavedCasesListResponse(
  limit: number,
  offset: number
): PlaywrightMockSavedCasesListResponse {
  const snapshot = buildPlaywrightMockCaseGetResponse(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
  const savedCases = snapshot.archived_at ? [] : [snapshot];
  const window = savedCases.slice(offset, offset + limit);
  const has_more = savedCases.length > offset + limit;

  return {
    cases: window.map((row) => ({ ...row })),
    has_more,
    offset,
    limit,
  };
}
