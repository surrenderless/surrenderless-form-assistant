import { expect, test } from "@playwright/test";
import {
  resetPlaywrightMockActiveCaseIfAny,
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
} from "./helpers/clerk-e2e";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("signed-in user loads /justice/chat-ai shell with chat input", async ({ page }) => {
  // This intends a genuinely blank intake — detach any case a prior test left active so
  // chat-ai's resume-on-mount fallback can't silently resume it instead.
  await resetPlaywrightMockActiveCaseIfAny(page);
  await page.goto("/justice/chat-ai");

  await expect(page).toHaveURL(/\/justice\/chat-ai$/);
  const chatInput = page.locator("#chat-ai-input");
  await expect(chatInput).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Your consumer case" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});
