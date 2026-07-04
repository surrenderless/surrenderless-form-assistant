import { expect, test } from "@playwright/test";
import { REAL_BBB_COMPLAINT_FILING_DESTINATION } from "@/lib/justice/recordRealBbbComplaintFiling";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
} from "./helpers/clerk-e2e";
import {
  REAL_BBB_COMPLAINT_FILING_CONFIRMATION,
  hydrateChatAiSessionForRealBbbAutofill,
  seedPlaywrightMockCaseForRealBbbChatAutofill,
} from "./helpers/real-bbb-chat-autofill-e2e";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("signed-in chat Run BBB autofill completes via mocked real-BBB submit-form lane", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  await page.route("**://www.bbb.org/**", () => {
    throw new Error("Live BBB navigation must not occur during Playwright E2E.");
  });

  const { caseId, intake } = await seedPlaywrightMockCaseForRealBbbChatAutofill(request);
  await hydrateChatAiSessionForRealBbbAutofill(page, { caseId, intake });

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(page.locator("#chat-ai-input")).toBeVisible({ timeout: 30_000 });

  const realBbbAutofillBlock = page
    .locator("div.mt-3.space-y-2.rounded-lg.border")
    .filter({
      has: page.locator("p.text-xs.font-medium").filter({ hasText: "BBB complaint" }),
    })
    .filter({ has: page.getByText("www.bbb.org/complain/") });

  await expect(realBbbAutofillBlock).toBeVisible({ timeout: 15_000 });
  await expect(realBbbAutofillBlock.getByRole("button", { name: "Run BBB autofill" })).toBeVisible();
  await expect(realBbbAutofillBlock.getByRole("button", { name: "Run BBB autofill" })).toBeDisabled();

  await realBbbAutofillBlock
    .getByRole("checkbox", { name: "I confirm this information is accurate to the best of my knowledge." })
    .check();
  await realBbbAutofillBlock.getByRole("button", { name: "Run BBB autofill" }).click();

  await expect(page).toHaveURL(/\/justice\/chat-ai/);

  const assistedSubmissionSnapshot = page
    .locator("div.rounded-lg.border")
    .filter({ has: page.getByText("Last assisted submission attempt", { exact: true }) });
  await expect(assistedSubmissionSnapshot).toBeVisible({ timeout: 60_000 });
  await expect(
    assistedSubmissionSnapshot.getByText(REAL_BBB_COMPLAINT_FILING_DESTINATION, { exact: true })
  ).toBeVisible();
  await expect(assistedSubmissionSnapshot).toContainText(
    `Confirmation: ${REAL_BBB_COMPLAINT_FILING_CONFIRMATION}`
  );
  await expect(assistedSubmissionSnapshot).toContainText("Filing id: playwright_e2e_ftc_practice_filing");
  await expect(assistedSubmissionSnapshot).toContainText("Assisted after packet approval");
});
