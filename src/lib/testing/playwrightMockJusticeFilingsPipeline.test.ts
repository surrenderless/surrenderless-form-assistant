import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE } from "@/lib/justice/assistedSubmissionLane";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  buildPlaywrightMockCaseGetResponse,
  resetPlaywrightMockCaseHydrationSnapshotsForTests,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import {
  buildPlaywrightMockJusticeFilingPostResponse,
  buildPlaywrightMockJusticeFilingsGetResponse,
  isPlaywrightMockJusticeFilingsCaseId,
  isPlaywrightMockJusticeFilingsPipelineEnabled,
  resetPlaywrightMockJusticeFilingsForCase,
  resetPlaywrightMockJusticeFilingsForTests,
} from "@/lib/testing/playwrightMockJusticeFilingsPipeline";

describe("playwrightMockJusticeFilingsPipeline", () => {
  const caseId = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;
  const userId = "playwright_e2e_user";

  beforeEach(() => {
    resetPlaywrightMockCaseHydrationSnapshotsForTests();
    resetPlaywrightMockJusticeFilingsForTests();
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE", "1");
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_FILINGS_PIPELINE", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetPlaywrightMockCaseHydrationSnapshotsForTests();
    resetPlaywrightMockJusticeFilingsForTests();
  });

  it("is disabled unless PLAYWRIGHT_MOCK_JUSTICE_FILINGS_PIPELINE=1", () => {
    vi.unstubAllEnvs();
    expect(isPlaywrightMockJusticeFilingsPipelineEnabled()).toBe(false);
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_FILINGS_PIPELINE", "1");
    expect(isPlaywrightMockJusticeFilingsPipelineEnabled()).toBe(true);
  });

  it("is disabled on deployed production even when the flag is set", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_FILINGS_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockJusticeFilingsPipelineEnabled()).toBe(false);
  });

  it("matches only the deterministic E2E case id", () => {
    expect(isPlaywrightMockJusticeFilingsCaseId(caseId)).toBe(true);
    expect(isPlaywrightMockJusticeFilingsCaseId("00000000-0000-4000-8000-000000000001")).toBe(false);
  });

  it("returns production POST /api/justice/filings shape with filing_recorded timeline for the fixed case", () => {
    const result = buildPlaywrightMockJusticeFilingPostResponse(caseId, userId, {
      destination: MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.filingDestination,
      filed_at: "2026-06-21T00:00:02.000Z",
      confirmation_number: MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.filingConfirmation,
      notes: "Mock FTC practice autofill completed (/mock/ftc-complaint).",
    });

    expect(result.id).toBe("playwright_e2e_ftc_practice_filing");
    expect(result.case_id).toBe(caseId);
    expect(result.user_id).toBe(userId);
    expect(result.destination).toBe("FTC (practice)");
    expect(result.confirmation_number).toBe("FTC mock practice complete");
    expect(result.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "case_started" }),
        expect.objectContaining({
          type: "filing_recorded",
          label: "Filing recorded",
          detail: "FTC (practice) filed — FTC mock practice complete",
        }),
      ])
    );

    const hydrated = buildPlaywrightMockCaseGetResponse(caseId);
    expect(hydrated.timeline).toEqual(result.timeline);
  });

  it("accumulates GET /api/justice/filings rows for the fixed E2E case id", () => {
    buildPlaywrightMockJusticeFilingPostResponse(caseId, userId, {
      destination: MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.filingDestination,
      confirmation_number: MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.filingConfirmation,
    });

    const rows = buildPlaywrightMockJusticeFilingsGetResponse(caseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.destination).toBe("FTC (practice)");
    expect(rows[0]?.confirmation_number).toBe("FTC mock practice complete");
  });

  it("resets cumulative filing rows for the fixed E2E case id only", () => {
    buildPlaywrightMockJusticeFilingPostResponse(caseId, userId, {
      destination: MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.filingDestination,
      confirmation_number: MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.filingConfirmation,
    });
    resetPlaywrightMockJusticeFilingsForCase(caseId);
    expect(buildPlaywrightMockJusticeFilingsGetResponse(caseId)).toEqual([]);
    resetPlaywrightMockJusticeFilingsForCase("00000000-0000-4000-8000-000000000001");
  });
});
