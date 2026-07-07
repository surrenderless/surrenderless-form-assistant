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
import { buildPlaywrightMockCasePatchResponse, resetPlaywrightMockCaseHydrationSnapshotsForTests } from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";

describe("playwrightMockJusticeTasksPipeline", () => {
  const caseId = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;
  const userId = "playwright_e2e_user";
  const otherCaseId = "00000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    resetPlaywrightMockJusticeTasksForTests();
    resetPlaywrightMockCaseHydrationSnapshotsForTests();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetPlaywrightMockJusticeTasksForTests();
    resetPlaywrightMockCaseHydrationSnapshotsForTests();
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

  it("returns synced human-fulfillment tasks when client_state queues State AG", () => {
    buildPlaywrightMockCasePatchResponse(caseId, {
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
          approved_at: "2026-06-21T00:00:00.000Z",
        },
      },
    });

    const rows = buildPlaywrightMockJusticeTasksGetResponse(caseId, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain("State AG filing:");
  });

  it("returns an empty array for non-fixed case ids", () => {
    expect(buildPlaywrightMockJusticeTasksGetResponse(otherCaseId, userId)).toEqual([]);
  });

  it("returns production GET /api/justice/tasks array shape", () => {
    buildPlaywrightMockCasePatchResponse(caseId, {
      client_state: {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
          approved_at: "2026-06-21T00:00:00.000Z",
        },
      },
    });
    const rows = buildPlaywrightMockJusticeTasksGetResponse(caseId, userId);

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const task = row as PlaywrightMockJusticeTaskRow;
      expect(task).toMatchObject({
        id: expect.any(String),
        user_id: expect.any(String),
        case_id: caseId,
        title: expect.any(String),
        due_date: null,
        completed_at: null,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
      expect(typeof task.notes).toBe("string");
      expect(task.notes?.length).toBeGreaterThan(0);
    }
  });

  it("reset helpers are safe for the fixed and non-fixed E2E case ids", () => {
    resetPlaywrightMockJusticeTasksForCase(caseId);
    expect(buildPlaywrightMockJusticeTasksGetResponse(caseId, userId)).toEqual([]);
    resetPlaywrightMockJusticeTasksForCase(otherCaseId);
  });
});
