import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  buildPlaywrightMockCasePatchResponse,
  buildPlaywrightMockE2eCaseIntake,
  resetPlaywrightMockCaseHydrationSnapshotsForTests,
} from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import {
  ensurePlaywrightMockFollowUpResponseReviewTaskForCase,
  getPlaywrightMockHumanFulfillmentTasks,
  isPlaywrightMockHumanFulfillmentOperatorFilingEnabled,
  PLAYWRIGHT_MOCK_FOLLOW_UP_RESPONSE_REVIEW_TASK_ID,
  resetPlaywrightMockHumanFulfillmentLadderForTests,
  syncPlaywrightMockHumanFulfillmentLadderFromCasePatch,
} from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";
import { taskNotesMatchFollowUpResponseReviewMarker } from "@/lib/justice/followUpResponseReviewTask";
import { hasPendingHumanFulfillmentEscalation } from "@/lib/justice/escalationLadderResolution";

describe("isPlaywrightMockHumanFulfillmentOperatorFilingEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is enabled outside production when PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE=1", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE", "1");
    expect(isPlaywrightMockHumanFulfillmentOperatorFilingEnabled()).toBe(true);
  });

  it("is disabled in production even when the mock env flag is set", () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isPlaywrightMockHumanFulfillmentOperatorFilingEnabled()).toBe(false);
  });
});

describe("ensurePlaywrightMockFollowUpResponseReviewTaskForCase", () => {
  const caseId = PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID;
  const userId = "user_clerk_e2e";

  const terminalResolutionClientState = {
    prepared_packet_approved: true,
    approved_next_action: {
      label: "Small claims / demand letter",
      href: "/justice/demand-letter",
      status: "completed" as const,
      completed_at: "2026-06-23T12:00:00.000Z",
      handling_requested_at: "2026-06-23T12:00:00.000Z",
      outcome_note:
        "Escalation complete for Acme Retail (widget order). BBB, State AG, and demand letter steps recorded. Awaiting responses.",
      follow_up_needed: true,
      follow_up_at: "2026-08-07T12:00:00.000Z",
    },
  };

  beforeEach(() => {
    resetPlaywrightMockHumanFulfillmentLadderForTests();
    resetPlaywrightMockCaseHydrationSnapshotsForTests();
    vi.stubEnv("PLAYWRIGHT_MOCK_JUSTICE_TASKS_PIPELINE", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetPlaywrightMockHumanFulfillmentLadderForTests();
    resetPlaywrightMockCaseHydrationSnapshotsForTests();
  });

  it("does not auto-create response-review on sync after resolution is seeded", () => {
    const intake = buildPlaywrightMockE2eCaseIntake();
    buildPlaywrightMockCasePatchResponse(caseId, {
      intake,
      client_state: terminalResolutionClientState,
    });
    syncPlaywrightMockHumanFulfillmentLadderFromCasePatch(
      caseId,
      userId,
      terminalResolutionClientState,
      intake,
      null
    );
    const rows = getPlaywrightMockHumanFulfillmentTasks(caseId, userId);
    expect(
      rows.some((row) => taskNotesMatchFollowUpResponseReviewMarker(row.notes, caseId))
    ).toBe(false);
    expect(
      hasPendingHumanFulfillmentEscalation({
        caseId,
        tasks: rows,
        approvedAction: terminalResolutionClientState.approved_next_action,
      })
    ).toBe(false);
  });

  it("creates a response-review task only when explicitly ensured", () => {
    buildPlaywrightMockCasePatchResponse(caseId, {
      intake: buildPlaywrightMockE2eCaseIntake(),
      client_state: terminalResolutionClientState,
    });
    expect(ensurePlaywrightMockFollowUpResponseReviewTaskForCase(caseId, userId)).toBe(true);
    const rows = getPlaywrightMockHumanFulfillmentTasks(caseId, userId);
    const review = rows.find((row) =>
      taskNotesMatchFollowUpResponseReviewMarker(row.notes, caseId)
    );
    expect(review?.id).toBe(PLAYWRIGHT_MOCK_FOLLOW_UP_RESPONSE_REVIEW_TASK_ID);
    expect(review?.completed_at).toBeNull();
    expect(ensurePlaywrightMockFollowUpResponseReviewTaskForCase(caseId, userId)).toBe(false);
  });

  it("preserves an ensured response-review task across sync", () => {
    const intake = buildPlaywrightMockE2eCaseIntake();
    buildPlaywrightMockCasePatchResponse(caseId, {
      intake,
      client_state: terminalResolutionClientState,
    });
    ensurePlaywrightMockFollowUpResponseReviewTaskForCase(caseId, userId);
    syncPlaywrightMockHumanFulfillmentLadderFromCasePatch(
      caseId,
      userId,
      terminalResolutionClientState,
      intake,
      null
    );
    const rows = getPlaywrightMockHumanFulfillmentTasks(caseId, userId);
    expect(
      rows.some((row) => taskNotesMatchFollowUpResponseReviewMarker(row.notes, caseId))
    ).toBe(true);
  });
});
