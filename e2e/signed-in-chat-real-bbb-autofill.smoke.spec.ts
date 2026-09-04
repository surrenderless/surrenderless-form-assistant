import { expect, test } from "@playwright/test";
import { buildChatCaseProgressNarrationMessage } from "@/lib/justice/chatCaseProgressNarration";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
} from "./helpers/clerk-e2e";
import {
  hydrateChatAiSessionForRealBbbAutofill,
  seedPlaywrightMockCaseForRealBbbChatAutofill,
} from "./helpers/real-bbb-chat-autofill-e2e";
import {
  chatAiActionTracking,
  expandChatAiDetailedTracking,
} from "./helpers/chat-ai-owned-fulfillment-e2e";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("signed-in chat suppresses Run BBB autofill when Surrenderless owns BBB fulfillment", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.route("**://www.bbb.org/**", () => {
    throw new Error("Live BBB navigation must not occur during Playwright E2E.");
  });

  const { caseId, intake } = await seedPlaywrightMockCaseForRealBbbChatAutofill(page);
  await hydrateChatAiSessionForRealBbbAutofill(page, { caseId, intake });

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  // The composer collapses by design once a dedicated tracking action exists (this case is
  // seeded already BBB-queued) — the transcript, not the composer, is the correct "page loaded"
  // signal here.
  await expect(page.locator("#chat-ai-transcript")).toBeVisible({ timeout: 30_000 });

  const tracking = chatAiActionTracking(page);
  await expandChatAiDetailedTracking(tracking);
  await expect(page.getByText("BBB filing in progress.")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(buildChatCaseProgressNarrationMessage("bbb_queued"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Run BBB autofill" })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Record manual filing" })).toHaveCount(0);
});
