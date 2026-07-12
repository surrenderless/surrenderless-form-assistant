import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  expectUrlStaysOnChatAi,
  seedActiveCaseDraftNotReviewed,
  seedActiveCaseStateAgQueued,
} from "./helpers/chat-ai-ladder-continuity-e2e";
import { MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test.describe("signed-in legacy ladder direct-entry guards", () => {
  test("direct /justice/preview entry resumes chat-ai for active case", async ({ page }) => {
    test.setTimeout(120_000);

    await seedActiveCaseDraftNotReviewed(page);
    await waitForClerkBrowserApiSession(page);

    await page.goto("/justice/preview");
    await expect(page).toHaveURL(/\/justice\/chat-ai(?:#.*)?$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Submission draft preview" })).toHaveCount(0);
    await expectUrlStaysOnChatAi(page);
  });

  test("direct /justice/handling entry resumes chat-ai for active consumer case", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await seedActiveCaseStateAgQueued(page);
    await waitForClerkBrowserApiSession(page);

    await page.goto("/justice/handling");
    await expect(page).toHaveURL(/\/justice\/chat-ai(?:#.*)?$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Handling workbench" })).toHaveCount(0);
    await expectUrlStaysOnChatAi(page);
  });

  test("prep page /justice/state-ag redirects signed-in resumable consumers into chat-ai", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await seedActiveCaseStateAgQueued(page);
    await waitForClerkBrowserApiSession(page);

    await page.goto(MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF);
    await expect(page).toHaveURL(/\/justice\/chat-ai(?:#.*)?$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /State AG complaint prep/i })).toHaveCount(0);
    await expect(page.locator("#chat-ai-approved-action-tracking")).toBeVisible({
      timeout: 30_000,
    });
    await expectUrlStaysOnChatAi(page);
  });
});
