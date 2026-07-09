import { expect, test } from "@playwright/test";
import {
  isOperatorClerkE2eConfigured,
  operatorClerkE2eSkipReason,
  operatorClerkStorageStateExists,
} from "./helpers/clerk-e2e";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { PLAYWRIGHT_MOCK_STATE_AG_TASK_ID } from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";

test.beforeEach(() => {
  test.skip(
    !isOperatorClerkE2eConfigured() || !operatorClerkStorageStateExists(),
    operatorClerkE2eSkipReason()
  );
});

test("operator can load fulfillment queue API", async ({ page }) => {
  const res = await page.request.get("/api/operator/fulfillment-queue");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { items?: unknown[] };
  expect(Array.isArray(body.items)).toBe(true);
});

test("operator fulfillment UI loads queue surface", async ({ page }) => {
  await page.goto("/operator/fulfillment");
  await expect(page.getByRole("heading", { name: "Operator fulfillment queue" })).toBeVisible({
    timeout: 30_000,
  });
});
