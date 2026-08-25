import { expect, test, type Page } from "@playwright/test";
import {
  resetPlaywrightMockActiveCaseIfAny,
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import { STORAGE_STAGED_PROOF_NOTES_V1 } from "@/lib/justice/stagedProofNotes";
import { PLAYWRIGHT_MOCK_SECOND_CASE_ID } from "@/lib/testing/playwrightMockJusticeChatMessagesOwnership";

// Doesn't need to resolve to a real task — both guards under test fire before the deep link's
// case/task lookup ever runs, so a well-formed UUID is all `parseReviewTaskDeepLinkParams`
// requires to route into the effect's hydrate branch.
const OTHER_CASE_REVIEW_TASK_ID = "00000000-0000-4000-8000-000000000001";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

/** Land on a genuinely fresh, uncommitted, signed-in chat-ai session — no case, no draft. */
async function bootstrapFreshUncommittedSession(page: Page): Promise<void> {
  await resetPlaywrightMockActiveCaseIfAny(page);
  await page.goto("/justice/chat-ai");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();

  const chatInput = page.locator("#chat-ai-input");
  await expect(chatInput).toBeVisible({ timeout: 30_000 });
  await waitForClerkBrowserApiSession(page);
}

/** Stage a proof note via the chat-ai UI (only reachable with no case committed/loaded yet). */
async function stageProofNote(page: Page): Promise<void> {
  await page.getByText("Add a proof note").click();
  await page.locator("#chat-ai-proof-title").fill("Screenshot of a new billing error");
  await page.getByRole("button", { name: "Stage proof note" }).click();
  await expect(page.getByText("Proof note staged on this device.")).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(
      async () => page.evaluate((key) => sessionStorage.getItem(key), STORAGE_STAGED_PROOF_NOTES_V1),
      { timeout: 15_000 }
    )
    .not.toBeNull();
}

test.describe("signed-in chat-ai deep-link hydration guards", () => {
  test("a review-task deep link does not hydrate a different case while a proof note is staged", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await bootstrapFreshUncommittedSession(page);
    await stageProofNote(page);

    // The pre-fetch guard must stop the effect before it ever looks the linked case up.
    let caseLookupRequested = false;
    await page.route(
      `**/api/justice/cases/${PLAYWRIGHT_MOCK_SECOND_CASE_ID}`,
      async (route) => {
        caseLookupRequested = true;
        await route.continue();
      }
    );

    await page.goto(
      `/justice/chat-ai?case=${PLAYWRIGHT_MOCK_SECOND_CASE_ID}&task=${OTHER_CASE_REVIEW_TASK_ID}`
    );
    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);

    // Give the (correctly-blocked) effect a moment to have hydrated/fetched if it were going to.
    await page.waitForTimeout(1_500);

    expect(
      caseLookupRequested,
      "staged-note guard must stop the deep link before it looks the case up"
    ).toBe(false);

    const caseIdAfterDeepLink = await page.evaluate(
      (key) => sessionStorage.getItem(key)?.trim() ?? "",
      STORAGE_CASE_ID
    );
    expect(caseIdAfterDeepLink).toBe("");

    const stagedAfterDeepLink = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      STORAGE_STAGED_PROOF_NOTES_V1
    );
    expect(stagedAfterDeepLink).not.toBeNull();
    expect(JSON.parse(stagedAfterDeepLink!)).toHaveLength(1);
  });

  test("a checkout-return redirect does not hydrate a different case while a proof note is staged", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await bootstrapFreshUncommittedSession(page);
    await stageProofNote(page);

    // The pre-fetch guard must stop the effect before it ever looks the returned case up.
    let caseLookupRequested = false;
    await page.route(
      `**/api/justice/cases/${PLAYWRIGHT_MOCK_SECOND_CASE_ID}`,
      async (route) => {
        caseLookupRequested = true;
        await route.continue();
      }
    );

    await page.goto(`/justice/chat-ai?case=${PLAYWRIGHT_MOCK_SECOND_CASE_ID}&checkout=success`);
    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);

    // Give the (correctly-blocked) effect a moment to have hydrated/fetched/polled if it were
    // going to.
    await page.waitForTimeout(1_500);

    expect(
      caseLookupRequested,
      "staged-note guard must stop the checkout-return redirect before it looks the case up"
    ).toBe(false);

    const caseIdAfterCheckoutReturn = await page.evaluate(
      (key) => sessionStorage.getItem(key)?.trim() ?? "",
      STORAGE_CASE_ID
    );
    expect(caseIdAfterCheckoutReturn).toBe("");

    const stagedAfterCheckoutReturn = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      STORAGE_STAGED_PROOF_NOTES_V1
    );
    expect(stagedAfterCheckoutReturn).not.toBeNull();
    expect(JSON.parse(stagedAfterCheckoutReturn!)).toHaveLength(1);
  });
});
