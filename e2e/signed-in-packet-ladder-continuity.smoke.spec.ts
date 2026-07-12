import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  expectNoRequiredMainLadderOffChatLinks,
  expectUrlStaysOnChatAi,
  seedActiveCaseForPacketHandlingResume,
  seedActiveCaseForPacketNotApprovedResume,
} from "./helpers/chat-ai-ladder-continuity-e2e";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test.describe("signed-in packet ladder continuity", () => {
  test("direct /justice/packet entry redirects to in-chat packet approval", async ({ page }) => {
    test.setTimeout(120_000);

    await seedActiveCaseForPacketNotApprovedResume(page);
    await waitForClerkBrowserApiSession(page);

    await expectUrlStaysOnChatAi(page);
    const packetApproval = page.locator("#chat-ai-inline-prepared-packet-approval");
    await expect(packetApproval).toBeVisible({ timeout: 30_000 });
    await expect(
      packetApproval.locator("p.text-xs.font-medium").filter({ hasText: "Approve prepared packet" })
    ).toBeVisible();
    await expect(packetApproval.getByRole("link", { name: "Open full packet page" })).toHaveCount(0);

    const checklist = page.getByRole("status", { name: "Active case" }).locator("ul").first();
    await expectNoRequiredMainLadderOffChatLinks(checklist);
  });

  test("direct /justice/packet entry with approved action resumes tracking in chat", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await seedActiveCaseForPacketHandlingResume(page);
    await waitForClerkBrowserApiSession(page);

    await expectUrlStaysOnChatAi(page);
    const tracking = page.locator("#chat-ai-approved-action-tracking");
    await expect(tracking).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Handling workbench" })).toHaveCount(0);
    await expect(page.locator('a[href="/justice/packet"]')).toHaveCount(0);
  });
});
