import { expect, test } from "@playwright/test";
import {
  archivePlaywrightMockActiveCaseIfAny,
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import { chatAiTranscript } from "./helpers/chat-ai-owned-fulfillment-e2e";
import {
  PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE,
} from "@/lib/testing/playwrightMockIntakeChatPipeline";
import { STORAGE_INTAKE_DRAFT_V1 } from "@/lib/justice/intakeDraftPersistence";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

type DraftShape = {
  parts: Record<string, string>;
  messages: Array<{ id: string; role: string; text: string }>;
};

async function readDraft(page: import("@playwright/test").Page): Promise<DraftShape | null> {
  const raw = await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_INTAKE_DRAFT_V1);
  return raw ? (JSON.parse(raw) as DraftShape) : null;
}

test.describe("signed-in chat-ai pre-commit intake draft restore", () => {
  test("multi-turn draft survives two reloads in transcript, Recap, and sessionStorage", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // This intends a genuinely blank intake — detach any case a prior test left active so
    // chat-ai's resume-on-mount fallback can't silently resume it instead.
    await archivePlaywrightMockActiveCaseIfAny(page);
    await page.goto("/justice/chat-ai");
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();

    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);

    const chatTranscript = chatAiTranscript(page);

    await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(
      chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE)).toBeVisible();

    await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(
      chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE)
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE)).toBeVisible();

    // Draft is genuinely saved before ever reloading — pins the "save works during normal
    // conversation" half so a future regression there can't hide behind this test.
    const savedBeforeReload = await readDraft(page);
    expect(savedBeforeReload).not.toBeNull();
    expect(savedBeforeReload?.parts.company_name).toBe("Acme Retail");
    expect(savedBeforeReload?.messages.length).toBeGreaterThanOrEqual(4);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await page.reload();
      await expect(page.locator("#chat-ai-input")).toBeVisible({ timeout: 30_000 });

      // The exact root cause this test guards: the mount-time save effect must not fire with
      // fresh-mount defaults before the restore effect reads the real draft back — if it did,
      // the transcript would collapse to only the opening greeting.
      const reloadedTranscript = chatAiTranscript(page);
      await expect(
        reloadedTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        reloadedTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE)
      ).toBeVisible();

      // Real captured values, not just the ever-present default "Category" recap line — under
      // the bug, this is exactly the line that kept showing while everything else vanished.
      await expect(page.getByText("Company: Acme Retail")).toBeVisible();
      await expect(page.getByText("Product / service: widget order")).toBeVisible();

      const draftAfterReload = await readDraft(page);
      expect(draftAfterReload).not.toBeNull();
      expect(draftAfterReload?.parts.company_name).toBe("Acme Retail");
      expect(draftAfterReload?.messages.length).toBeGreaterThanOrEqual(4);
    }
  });

  test("a fresh session writes no draft until the first real message", async ({ page }) => {
    // This intends a genuinely blank intake — detach any case a prior test left active so
    // chat-ai's resume-on-mount fallback can't silently resume it instead.
    await archivePlaywrightMockActiveCaseIfAny(page);
    await page.goto("/justice/chat-ai");
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();

    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);
    // Let any unrelated mount-time effects (e.g. seeding reply_email from the verified signed-in
    // account) settle — this fix only concerns conversational content, not that pre-existing
    // seed, so the assertions below are scoped to conversational fields only.
    await page.waitForTimeout(1_000);

    const beforeAnyMessage = await readDraft(page);
    if (beforeAnyMessage) {
      expect(beforeAnyMessage.messages).toHaveLength(1);
      expect(beforeAnyMessage.parts.company_name).toBe("");
      expect(beforeAnyMessage.parts.story).toBe("");
    }

    await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(
      chatAiTranscript(page).getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)
    ).toBeVisible({ timeout: 15_000 });

    const afterFirstMessage = await readDraft(page);
    expect(afterFirstMessage).not.toBeNull();
    expect(afterFirstMessage?.parts.company_name).toBe("Acme Retail");
    expect(afterFirstMessage?.messages.length).toBeGreaterThanOrEqual(2);
  });
});
