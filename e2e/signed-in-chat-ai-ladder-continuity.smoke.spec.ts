import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  activeCaseBanner,
  activeCaseChecklist,
  clickAndAssertStaysOnChatAi,
  expectNoOptionalDestinationPrepOrEvidenceHubLinks,
  expectNoRequiredMainLadderOffChatLinks,
  expectUrlStaysOnChatAi,
  seedActiveCaseDraftNotReviewed,
  seedActiveCaseMerchantFilingStep,
  seedActiveCasePacketNotApproved,
  seedActiveCaseStateAgQueued,
} from "./helpers/chat-ai-ladder-continuity-e2e";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test.describe("signed-in chat-ai main ladder continuity", () => {
  test("active case checklist stays in chat for draft and packet steps", async ({ page }) => {
    test.setTimeout(120_000);

    await seedActiveCaseDraftNotReviewed(page);
    await waitForClerkBrowserApiSession(page);

    const banner = activeCaseBanner(page);
    const checklist = activeCaseChecklist(page);
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(checklist.getByText("Submission draft reviewed: not yet")).toBeVisible();
    await expectNoRequiredMainLadderOffChatLinks(checklist);

    const reviewBelow = checklist.getByRole("button", { name: "Review below" });
    await expect(reviewBelow).toBeVisible();
    await clickAndAssertStaysOnChatAi(page, () => reviewBelow.click());
    await expect(page.locator("#chat-ai-inline-submission-draft-review")).toBeVisible();
    await expect(
      page.locator("#chat-ai-inline-submission-draft-review").getByRole("link", {
        name: "Open full submission preview",
      })
    ).toHaveCount(0);

    await seedActiveCasePacketNotApproved(page);
    await waitForClerkBrowserApiSession(page);

    await expect(checklist.getByText("Prepared case packet reviewed: not yet")).toBeVisible({
      timeout: 30_000,
    });
    await expectNoRequiredMainLadderOffChatLinks(checklist);

    const approveBelow = checklist.getByRole("button", { name: "Approve below" });
    await expect(approveBelow).toBeVisible();
    await clickAndAssertStaysOnChatAi(page, () => approveBelow.click());
    await expect(page.locator("#chat-ai-inline-prepared-packet-approval")).toBeVisible();
    await expect(
      page.locator("#chat-ai-inline-prepared-packet-approval").getByRole("link", {
        name: "Open full packet page",
      })
    ).toHaveCount(0);
    await expectUrlStaysOnChatAi(page);
  });

  test("operator queue notice stays in chat without handling workbench link", async ({ page }) => {
    test.setTimeout(120_000);

    await seedActiveCaseStateAgQueued(page);
    await waitForClerkBrowserApiSession(page);

    const tracking = page.locator("#chat-ai-approved-action-tracking");
    await tracking.scrollIntoViewIfNeeded();
    await expect(tracking).toBeVisible({ timeout: 30_000 });
    await expect(tracking.getByText("State AG filing queued.")).toBeVisible({ timeout: 30_000 });
    await expect(
      tracking.getByText("Stay in this chat — operator updates will appear here.")
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Handling workbench" })).toHaveCount(0);
    await expectUrlStaysOnChatAi(page);
  });

  test("owned merchant step queues in chat without DIY filing capture", async ({ page }) => {
    test.setTimeout(120_000);

    await seedActiveCaseMerchantFilingStep(page);
    await waitForClerkBrowserApiSession(page);

    await expect(activeCaseChecklist(page).getByText("Evidence: yes")).toBeVisible({
      timeout: 30_000,
    });

    const tracking = page.locator("#chat-ai-approved-action-tracking");
    await tracking.scrollIntoViewIfNeeded();
    await expect(tracking).toBeVisible({ timeout: 30_000 });
    await expect(tracking.getByText("Next step:")).toContainText("Merchant contact", {
      timeout: 15_000,
    });
    await expect(page.getByText("Merchant contact queued.")).toBeVisible({ timeout: 30_000 });
    await expect(tracking.getByRole("form", { name: "Record manual filing" })).toHaveCount(0);
    await expect(tracking.locator('a[href="/justice/packet"]')).toHaveCount(0);
    await expectNoOptionalDestinationPrepOrEvidenceHubLinks(page.locator("main"));
    await expectUrlStaysOnChatAi(page);
  });

  test("evidence hub redirects and merchant owned prep stays Surrenderless-owned", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await seedActiveCaseMerchantFilingStep(page);
    await waitForClerkBrowserApiSession(page);

    await page.goto("/justice/evidence");
    await page.waitForURL(/\/justice\/chat-ai/, { timeout: 30_000 });
    await expect(page.locator("#chat-ai-proof-evidence-panel")).toBeVisible({ timeout: 30_000 });
    await expectUrlStaysOnChatAi(page);
    await expect(page.getByRole("link", { name: "Organize evidence" })).toHaveCount(0);

    await page.goto("/justice/merchant");
    await expect(
      page.getByRole("heading", { name: "Surrenderless is handling this step" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/justice\/merchant/);
  });
});
