import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  casesSavedRowChecklist,
  clickAndAssertStaysOnChatAi,
  expectNoRequiredMainLadderOffChatLinks,
  expectUrlStaysOnChatAi,
  hubCurrentCaseChecklist,
  seedActiveCaseForCasesListResume,
  seedActiveCaseForHubResume,
  seedActiveCaseFtcFilingStep,
  seedActiveCasePacketNotApproved,
} from "./helpers/chat-ai-ladder-continuity-e2e";
import { buildPlaywrightMockE2eCaseIntake } from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test.describe("signed-in hub and saved-cases ladder continuity", () => {
  test("justice hub current-case checklist resumes in chat without preview/packet detours", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await seedActiveCaseForHubResume(page);
    await waitForClerkBrowserApiSession(page);

    const checklist = hubCurrentCaseChecklist(page);
    await expect(checklist.getByText("Submission draft reviewed: not yet")).toBeVisible();
    await expectNoRequiredMainLadderOffChatLinks(checklist);

    const reviewInChat = checklist.getByRole("link", { name: "Review in chat" });
    await expect(reviewInChat).toBeVisible();
    await clickAndAssertStaysOnChatAi(page, () => reviewInChat.click());
    await expectUrlStaysOnChatAi(page);
  });

  test("hub owned approved step stays chat-aligned without destination DIY open-step", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await seedActiveCaseFtcFilingStep(page);
    await page.goto("/justice");
    await waitForClerkBrowserApiSession(page);
    await page.getByText("Current case", { exact: true }).waitFor({
      state: "visible",
      timeout: 30_000,
    });

    const currentCase = page
      .locator("main")
      .getByText("Current case", { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'mt-8')][1]");

    await expect(
      currentCase.getByText(/Awaiting Surrenderless operator fulfillment/i)
    ).toBeVisible({ timeout: 30_000 });
    await expect(currentCase.getByRole("link", { name: /Open approved step/i })).toHaveCount(0);
    await expect(currentCase.locator('a[href="/justice/ftc"]')).toHaveCount(0);
    await expect(currentCase.locator('a[href="/justice/cfpb"]')).toHaveCount(0);
    await expect(currentCase.locator('a[href="/justice/bbb"]')).toHaveCount(0);
    await expect(currentCase.getByRole("button", { name: /Record action handled/i })).toHaveCount(
      0
    );
    await expect(
      currentCase.getByText(/Request Surrenderless handling from chat intake/i)
    ).toHaveCount(0);
    await expect(currentCase.getByRole("link", { name: "Continue in chat" }).first()).toBeVisible();
  });

  test("saved cases row checklist resumes in chat for draft and packet steps", async ({ page }) => {
    test.setTimeout(120_000);

    await seedActiveCaseForCasesListResume(page);
    await waitForClerkBrowserApiSession(page);

    const companyName = buildPlaywrightMockE2eCaseIntake().company_name;
    const draftCaseCard = page.locator("main > ul > li").filter({ hasText: companyName }).first();
    await expect(draftCaseCard).toBeVisible({ timeout: 30_000 });

    const checklist = casesSavedRowChecklist(page, companyName);
    await expect(checklist.getByText("Submission draft reviewed: not yet")).toBeVisible();
    await expectNoRequiredMainLadderOffChatLinks(checklist);

    const reviewInChat = checklist.getByRole("button", { name: "Review in chat" });
    await expect(reviewInChat).toBeVisible();
    await clickAndAssertStaysOnChatAi(page, () => reviewInChat.click());
    await expectUrlStaysOnChatAi(page);

    await seedActiveCasePacketNotApproved(page);
    await page.goto("/justice/cases");
    await waitForClerkBrowserApiSession(page);
    const packetCaseCard = page.locator("main > ul > li").filter({ hasText: companyName }).first();
    await expect(packetCaseCard).toBeVisible({ timeout: 30_000 });

    const packetChecklist = casesSavedRowChecklist(page, companyName);
    await expect(packetChecklist.getByText("Prepared case packet reviewed: not yet")).toBeVisible({
      timeout: 30_000,
    });
    await expectNoRequiredMainLadderOffChatLinks(packetChecklist);

    const approveInChat = packetChecklist.getByRole("button", { name: "Approve in chat" });
    await expect(approveInChat).toBeVisible();
    await clickAndAssertStaysOnChatAi(page, () => approveInChat.click());
    await expectUrlStaysOnChatAi(page);
  });

  test("saved cases owned approved step has no destination DIY open-step or record-handled", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await seedActiveCaseFtcFilingStep(page);
    await page.goto("/justice/cases");
    await waitForClerkBrowserApiSession(page);

    const companyName = buildPlaywrightMockE2eCaseIntake().company_name;
    const caseCard = page.locator("main > ul > li").filter({ hasText: companyName }).first();
    await expect(caseCard).toBeVisible({ timeout: 30_000 });
    await expect(
      caseCard.getByText(/Awaiting Surrenderless operator fulfillment/i)
    ).toBeVisible({ timeout: 30_000 });
    await expect(caseCard.getByRole("link", { name: /Open approved step/i })).toHaveCount(0);
    await expect(caseCard.locator('a[href="/justice/ftc"]')).toHaveCount(0);
    await expect(caseCard.getByRole("button", { name: /Record action handled/i })).toHaveCount(0);
    await expect(caseCard.getByRole("link", { name: "Continue in chat" }).first()).toBeVisible();
  });
});
