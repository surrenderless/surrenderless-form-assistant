import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  CHAT_AI_MAIN_LADDER_OFF_CHAT_PATHS,
  clickAndAssertStaysOnChatAi,
  expectNoRequiredMainLadderOffChatLinks,
  expectUrlStaysOnChatAi,
  seedActiveCaseForPacketHandlingResume,
  seedActiveCaseForPacketNotApprovedResume,
} from "./helpers/chat-ai-ladder-continuity-e2e";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test.describe("signed-in packet ladder continuity", () => {
  test("prepared packet review resumes in chat without preview or handling detours", async ({ page }) => {
    test.setTimeout(120_000);

    await seedActiveCaseForPacketNotApprovedResume(page);
    await waitForClerkBrowserApiSession(page);

    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Case packet" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(main.getByText("Approve for next action")).toBeVisible({ timeout: 30_000 });
    await expectNoRequiredMainLadderOffChatLinks(main);

    for (const path of CHAT_AI_MAIN_LADDER_OFF_CHAT_PATHS) {
      if (path === "/justice/packet") continue;
      await expect(main.locator(`a[href="${path}"]`)).toHaveCount(0);
    }

    const continueInChat = main.getByRole("link", { name: "Continue in chat" }).first();
    await expect(continueInChat).toBeVisible();
    await clickAndAssertStaysOnChatAi(page, () => continueInChat.click());
    await expectUrlStaysOnChatAi(page);
  });

  test("approved packet handling section continues in chat without handling workbench detour", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await seedActiveCaseForPacketHandlingResume(page);
    await waitForClerkBrowserApiSession(page);

    const main = page.locator("main");
    await expect(main.getByText("Packet approved for next action")).toBeVisible({
      timeout: 30_000,
    });
    await expect(main.getByRole("link", { name: "Handling workbench" })).toHaveCount(0);
    await expect(
      main.getByRole("link", { name: /View in handling workbench|View on handling workbench/i })
    ).toHaveCount(0);

    for (const path of CHAT_AI_MAIN_LADDER_OFF_CHAT_PATHS) {
      if (path === "/justice/packet") continue;
      await expect(main.locator(`a[href="${path}"]`)).toHaveCount(0);
    }

    const continueInChat = main.getByRole("link", { name: "Continue in chat" }).first();
    await expect(continueInChat).toBeVisible();
    await clickAndAssertStaysOnChatAi(page, () => continueInChat.click());
    await expectUrlStaysOnChatAi(page);
  });
});
