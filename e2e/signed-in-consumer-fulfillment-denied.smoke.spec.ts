import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
} from "./helpers/clerk-e2e";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { PLAYWRIGHT_MOCK_STATE_AG_TASK_ID } from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("consumer cannot POST operator-owned state ag fulfillment complete", async ({ page }) => {
  const res = await page.request.post("/api/justice/state-ag-filing/complete", {
    data: {
      case_id: PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
      task_id: PLAYWRIGHT_MOCK_STATE_AG_TASK_ID,
      destination: "State Attorney General (consumer)",
      filed_at: "2026-06-22T12:00:00.000Z",
      confirmation_number: "consumer-should-not-complete",
    },
  });
  expect(res.status()).toBe(403);
});

test("consumer cannot load operator fulfillment queue", async ({ page }) => {
  const res = await page.request.get("/api/operator/fulfillment-queue");
  expect(res.status()).toBe(403);
});
