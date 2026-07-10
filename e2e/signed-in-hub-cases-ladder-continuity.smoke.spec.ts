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

  test("saved cases row checklist resumes in chat for draft and packet steps", async ({ page }) => {
    test.setTimeout(120_000);

    await seedActiveCaseForCasesListResume(page);
    await waitForClerkBrowserApiSession(page);

    const companyName = buildPlaywrightMockE2eCaseIntake().company_name;
    await expect(page.getByText(companyName, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

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
    await expect(page.getByText(companyName, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

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
});
