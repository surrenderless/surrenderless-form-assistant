import type { PlaywrightMockCaseCreateResponse } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  isPlaywrightMockIntakeCaseHydrationPipelineEnabled,
  listPlaywrightMockCaseHydrationSnapshots,
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
 * Returns hydration snapshots with archived_at null (newest updated_at first).
 */
export function buildPlaywrightMockSavedCasesListResponse(
  limit: number,
  offset: number
): PlaywrightMockSavedCasesListResponse {
  const savedCases = listPlaywrightMockCaseHydrationSnapshots()
    .filter((row) => !row.archived_at)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const window = savedCases.slice(offset, offset + limit);
  const has_more = savedCases.length > offset + limit;

  return {
    cases: window.map((row) => ({ ...row })),
    has_more,
    offset,
    limit,
  };
}
