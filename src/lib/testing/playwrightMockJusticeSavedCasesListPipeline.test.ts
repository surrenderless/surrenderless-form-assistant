import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  buildPlaywrightMockCaseGetResponse,
  buildPlaywrightMockCasePatchResponse,
  resetPlaywrightMockCaseHydrationSnapshotsForTests,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import {
  buildPlaywrightMockSavedCasesListResponse,
  isPlaywrightMockJusticeSavedCasesListPipelineEnabled,
} from "@/lib/testing/playwrightMockJusticeSavedCasesListPipeline";

describe("playwrightMockJusticeSavedCasesListPipeline", () => {
  const caseId = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;

  beforeEach(() => {
    resetPlaywrightMockCaseHydrationSnapshotsForTests();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_SAVED_CASES_LIST_PIPELINE", "1");
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetPlaywrightMockCaseHydrationSnapshotsForTests();
  });

  it("is disabled unless PLAYWRIGHT_MOCK_JUSTICE_SAVED_CASES_LIST_PIPELINE=1", () => {
    vi.unstubAllEnvs();
    expect(isPlaywrightMockJusticeSavedCasesListPipelineEnabled()).toBe(false);
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_SAVED_CASES_LIST_PIPELINE", "1");
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE", "1");
    expect(isPlaywrightMockJusticeSavedCasesListPipelineEnabled()).toBe(true);
  });

  it("is disabled on deployed production even when the flag is set", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_SAVED_CASES_LIST_PIPELINE", "1");
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockJusticeSavedCasesListPipelineEnabled()).toBe(false);
  });

  it("requires hydration pipeline to be enabled", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_SAVED_CASES_LIST_PIPELINE", "1");
    expect(isPlaywrightMockJusticeSavedCasesListPipelineEnabled()).toBe(false);
  });

  it("returns the fixed E2E case when hydration snapshot is active (archived_at null)", () => {
    buildPlaywrightMockCaseGetResponse(caseId);
    const result = buildPlaywrightMockSavedCasesListResponse(10, 0);

    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]?.id).toBe(caseId);
    expect(result.cases[0]?.archived_at).toBeNull();
    expect(result.cases[0]?.intake).toMatchObject({ company_name: "Acme Retail" });
    expect(result.has_more).toBe(false);
  });

  it("returns an empty saved list after archive PATCH on the hydration snapshot", () => {
    buildPlaywrightMockCaseGetResponse(caseId);
    buildPlaywrightMockCasePatchResponse(caseId, {
      archived_at: "2026-06-21T00:00:02.000Z",
    });

    const result = buildPlaywrightMockSavedCasesListResponse(10, 0);

    expect(result.cases).toEqual([]);
    expect(result.has_more).toBe(false);
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(10);
  });

  it("returns the fixed E2E case again after restore PATCH clears archived_at", () => {
    buildPlaywrightMockCaseGetResponse(caseId);
    buildPlaywrightMockCasePatchResponse(caseId, {
      archived_at: "2026-06-21T00:00:02.000Z",
    });
    buildPlaywrightMockCasePatchResponse(caseId, { archived_at: null });

    const result = buildPlaywrightMockSavedCasesListResponse(10, 0);

    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]?.id).toBe(caseId);
    expect(result.cases[0]?.archived_at).toBeNull();
    expect(result.cases[0]?.intake).toMatchObject({ company_name: "Acme Retail" });
  });
});
