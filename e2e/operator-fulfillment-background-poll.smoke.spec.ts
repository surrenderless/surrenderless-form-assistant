import { expect, test } from "@playwright/test";
import {
  isOperatorClerkE2eConfigured,
  operatorClerkE2eSkipReason,
  operatorClerkStorageStateExists,
} from "./helpers/clerk-e2e";

test.beforeEach(() => {
  test.skip(
    !isOperatorClerkE2eConfigured() || !operatorClerkStorageStateExists(),
    operatorClerkE2eSkipReason()
  );
});

const MOCK_QUEUE_ITEM = {
  case_id: "11111111-1111-4111-8111-111111111111",
  case_owner_user_id: "user_mock_owner",
  task_id: "22222222-2222-4222-8222-222222222222",
  step: "merchant_contact",
  task_title: "Merchant contact: Acme Retail",
  company_name: "Acme Retail",
  consumer_us_state: "CA",
  draft_excerpt: "Draft outreach message for Acme Retail.",
  created_at: new Date().toISOString(),
};

test("background polling refresh does not unmount the queue or erase in-progress operator form input", async ({
  page,
}) => {
  test.setTimeout(60_000);

  let queueRequestCount = 0;
  await page.route("**/api/operator/fulfillment-queue", async (route) => {
    queueRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [MOCK_QUEUE_ITEM], closable_cases: [] }),
    });
  });

  await page.goto("/operator/fulfillment");
  await expect(page.getByRole("heading", { name: "Operator fulfillment queue" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Acme Retail")).toBeVisible({ timeout: 15_000 });

  const confirmationInput = page.getByLabel("Confirmation / reference");
  await expect(confirmationInput).toBeVisible();
  const distinctiveValue = "E2E-IN-PROGRESS-REF-98765";
  await confirmationInput.fill(distinctiveValue);
  await expect(confirmationInput).toHaveValue(distinctiveValue);

  // Wait past at least two 5s background poll ticks (1 initial load + 2 polls).
  await expect
    .poll(() => queueRequestCount, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(3);

  // The fix under test: a background poll must never toggle the page's `loading` state, which
  // would unmount the queue subtree (and destroy this in-progress, unsaved form input) every 5s.
  await expect(page.getByText("Loading queue…")).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Operator fulfillment queue" })).toBeVisible();
  await expect(page.getByText("Acme Retail")).toBeVisible();
  await expect(confirmationInput).toHaveValue(distinctiveValue);
});

test("initial page load still shows the loading state before the first response resolves", async ({
  page,
}) => {
  let resolveFirstResponse: (() => void) | undefined;
  const firstResponseGate = new Promise<void>((resolve) => {
    resolveFirstResponse = resolve;
  });

  let requestCount = 0;
  await page.route("**/api/operator/fulfillment-queue", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await firstResponseGate;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], closable_cases: [] }),
    });
  });

  await page.goto("/operator/fulfillment");
  await expect(page.getByText("Loading queue…")).toBeVisible({ timeout: 15_000 });

  resolveFirstResponse?.();
  await expect(page.getByText("Loading queue…")).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/No queued merchant contact/i)).toBeVisible();
});
