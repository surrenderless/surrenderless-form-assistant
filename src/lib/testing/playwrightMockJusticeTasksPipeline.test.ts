import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  buildPlaywrightMockJusticeTasksGetResponse,
  isPlaywrightMockJusticeTasksCaseId,
  isPlaywrightMockJusticeTasksPipelineEnabled,
  resetPlaywrightMockJusticeTasksForCase,
  resetPlaywrightMockJusticeTasksForTests,
  type PlaywrightMockJusticeTaskRow,
} from "@/lib/testing/playwrightMockJusticeTasksPipeline";

describe("playwrightMockJusticeTasksPipeline", () => {
  const caseId = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;
  const userId = "playwright_e2e_user";
  const otherCaseId = "00000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    resetPlaywrightMockJusticeTasksForTests();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetPlaywrightMockJusticeTasksForTests();
  });

  it("is disabled unless PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE=1", () => {
    vi.unstubAllEnvs();
    expect(isPlaywrightMockJusticeTasksPipelineEnabled()).toBe(false);
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE", "1");
    expect(isPlaywrightMockJusticeTasksPipelineEnabled()).toBe(true);
  });

  it("is disabled on deployed production even when the flag is set", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockJusticeTasksPipelineEnabled()).toBe(false);
  });

  it("matches only the deterministic E2E case id", () => {
    expect(isPlaywrightMockJusticeTasksCaseId(caseId)).toBe(true);
    expect(isPlaywrightMockJusticeTasksCaseId(otherCaseId)).toBe(false);
  });

  it("returns an empty task list for the fixed E2E case id", () => {
    const rows = buildPlaywrightMockJusticeTasksGetResponse(caseId, userId);

    expect(rows).toEqual([]);
  });

  it("returns an empty array for non-fixed case ids", () => {
    expect(buildPlaywrightMockJusticeTasksGetResponse(otherCaseId, userId)).toEqual([]);
  });

  it("returns production GET /api/justice/tasks array shape", () => {
    const rows = buildPlaywrightMockJusticeTasksGetResponse(caseId, userId);

    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      const task = row as PlaywrightMockJusticeTaskRow;
      expect(task).toMatchObject({
        id: expect.any(String),
        user_id: expect.any(String),
        case_id: caseId,
        title: expect.any(String),
        due_date: null,
        notes: null,
        completed_at: null,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
    }
  });

  it("reset helpers are safe for the fixed and non-fixed E2E case ids", () => {
    resetPlaywrightMockJusticeTasksForCase(caseId);
    expect(buildPlaywrightMockJusticeTasksGetResponse(caseId, userId)).toEqual([]);
    resetPlaywrightMockJusticeTasksForCase(otherCaseId);
  });
});
