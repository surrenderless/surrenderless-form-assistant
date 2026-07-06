import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE,
} from "@/lib/testing/playwrightMockIntakeChatPipeline";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("signed-in user completes intake through real BBB autofill, handling, follow-up, and archive in chat", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.route("**://www.bbb.org/**", () => {
    throw new Error("Live BBB navigation must not occur during Playwright E2E.");
  });
  await page.goto("/justice/chat-ai");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();

  const chatInput = page.locator("#chat-ai-input");
  await expect(chatInput).toBeVisible({ timeout: 30_000 });
  await waitForClerkBrowserApiSession(page);

  const chatTranscript = page
    .locator("div:has(> textarea#chat-ai-input)")
    .locator("xpath=preceding-sibling::div[1]");

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE)).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "Company:" }).filter({ hasText: "Acme Retail" })
  ).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "What happened:" }).filter({ hasText: "Acme Retail" })
  ).toBeVisible();

  const continueButton = page.getByRole("button", { name: "Save and continue in chat" });
  await expect(continueButton).toBeDisabled();

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE)).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "Email:" }).filter({ hasText: "e2e-chat@example.com" })
  ).toBeVisible();

  await expect(page.getByText("What happens next")).toBeVisible();
  await expect(continueButton).toBeVisible();
  await expect(continueButton).toBeEnabled();

  await continueButton.click();

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(page.getByText("Review submission draft")).toBeVisible({ timeout: 15_000 });

  const draftPreview = page.locator("pre").filter({ hasText: "DRAFT FOR YOUR REVIEW" });
  await expect(draftPreview).toBeVisible();
  await expect(draftPreview).toContainText("Jordan Lee");
  await expect(draftPreview).toContainText("Acme Retail");
  await expect(page.getByRole("button", { name: "Mark draft reviewed" })).toBeVisible();

  const persisted = await page.evaluate(
    ({ intakeKey, caseIdKey }) => {
      const rawIntake = sessionStorage.getItem(intakeKey);
      const caseId = sessionStorage.getItem(caseIdKey)?.trim() ?? "";
      if (!rawIntake) return null;
      try {
        const intake = JSON.parse(rawIntake) as {
          company_name?: string;
          reply_email?: string;
          user_display_name?: string;
        };
        return {
          caseId,
          company_name: intake.company_name ?? "",
          reply_email: intake.reply_email ?? "",
          user_display_name: intake.user_display_name ?? "",
        };
      } catch {
        return null;
      }
    },
    {
      intakeKey: STORAGE_INTAKE,
      caseIdKey: STORAGE_CASE_ID,
    }
  );

  expect(persisted).not.toBeNull();
  expect(persisted?.caseId).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
  expect(persisted?.company_name).toBe("Acme Retail");
  expect(persisted?.reply_email).toBe("e2e-chat@example.com");
  expect(persisted?.user_display_name).toBe("Jordan Lee");

  const draftReviewBlock = page.locator("#chat-ai-inline-submission-draft-review");
  await expect(draftReviewBlock).toBeVisible();

  const markDraftReviewedButton = draftReviewBlock.getByRole("button", {
    name: "Mark draft reviewed",
  });
  await expect(markDraftReviewedButton).toBeDisabled();

  await draftReviewBlock
    .getByRole("checkbox", { name: "I reviewed the submission draft shown above." })
    .check();

  await expect(draftReviewBlock).toBeVisible();
  await expect(markDraftReviewedButton).toBeEnabled();

  const packetApproval = page.locator("#chat-ai-inline-prepared-packet-approval");
  const draftReviewedResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/justice/submission-draft-reviewed"),
    { timeout: 30_000 }
  );
  await markDraftReviewedButton.click();
  const response = await draftReviewedResponse;
  expect(response.ok()).toBeTruthy();

  await expect(page.getByText("Submission draft reviewed: yes")).toBeVisible({ timeout: 30_000 });
  await expect(packetApproval).toBeVisible({ timeout: 30_000 });
  await expect(
    packetApproval.locator("p.text-xs.font-medium").filter({ hasText: "Approve prepared packet" })
  ).toBeVisible({ timeout: 15_000 });
  await expect(draftReviewBlock).toBeHidden({ timeout: 15_000 });
  await expect(
    packetApproval.locator("pre").filter({ hasText: "JUSTICE CASE PACKET" })
  ).toBeVisible({ timeout: 15_000 });
  await expect(packetApproval.locator("pre")).toContainText("Acme Retail");
  await expect(
    packetApproval.getByRole("checkbox", { name: "I reviewed this prepared packet" })
  ).toBeVisible();
  await expect(
    packetApproval.getByRole("button", { name: "Approve prepared packet" })
  ).toBeVisible();
  await expect(
    packetApproval.getByRole("button", { name: "Approve prepared packet" })
  ).toBeDisabled();

  await packetApproval
    .getByRole("checkbox", { name: "I reviewed this prepared packet" })
    .check();
  await packetApproval.getByRole("button", { name: "Approve prepared packet" }).click();

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(packetApproval).not.toBeVisible({ timeout: 15_000 });

  const merchantContactPrep = page.locator("form").filter({
    has: page.locator("p.text-xs.font-medium").filter({ hasText: "After you contact them" }),
  });
  await expect(merchantContactPrep).toBeVisible({ timeout: 15_000 });
  await expect(merchantContactPrep.getByLabel("Contact date")).toBeVisible();
  await expect(
    merchantContactPrep.getByRole("button", { name: "Save contact details" })
  ).toBeVisible();

  await merchantContactPrep.locator("#chat-merchant-contact-date").fill("2026-01-15");
  await merchantContactPrep.locator("select").nth(1).selectOption("refused_help");
  await merchantContactPrep.locator("select").nth(2).selectOption("paste");
  await merchantContactPrep.locator("#chat-merchant-contact-proof").fill(
    "E2E: Acme Retail refused a refund by email on 2026-01-15."
  );

  await merchantContactPrep.getByRole("button", { name: "Save contact details" }).click();

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(merchantContactPrep).not.toBeVisible({ timeout: 15_000 });

  const actionTracking = page
    .locator("div.mt-4.rounded-xl")
    .filter({ has: page.getByText("Current action tracking", { exact: true }) });
  await expect(actionTracking).toBeVisible({ timeout: 15_000 });
  await expect(actionTracking.getByText("Next step:")).toContainText("Better Business Bureau", {
    timeout: 15_000,
  });
  await expect(
    actionTracking.locator("p").filter({ hasText: "Approved next action:" })
  ).toContainText("Approved");
  await expect(
    actionTracking.getByRole("button", { name: "Mark step opened" })
  ).not.toBeVisible();
  await expect(
    actionTracking.getByRole("button", { name: "Record action handled for now" })
  ).not.toBeVisible();

  const realBbbAutofillBlock = page
    .locator("div.mt-3.space-y-2.rounded-lg.border")
    .filter({
      has: page.locator("p.text-xs.font-medium").filter({ hasText: "BBB complaint" }),
    })
    .filter({ has: page.getByText("www.bbb.org/complain/") });
  await expect(realBbbAutofillBlock).toBeVisible({ timeout: 15_000 });
  await expect(realBbbAutofillBlock.getByRole("button", { name: "Run BBB autofill" })).toBeVisible();
  await expect(realBbbAutofillBlock.getByRole("button", { name: "Copy draft instead" })).toBeVisible();

  await realBbbAutofillBlock
    .getByRole("checkbox", { name: "I confirm this information is accurate to the best of my knowledge." })
    .check();
  await realBbbAutofillBlock.getByRole("button", { name: "Run BBB autofill" }).click();

  await expect(page).toHaveURL(/\/justice\/chat-ai/);

  await expect(actionTracking.getByText("Next step:")).toContainText("State Attorney General", {
    timeout: 60_000,
  });
  await expect(page.getByText("Filing: 1 filing record · confirmation on file")).toBeVisible({
    timeout: 15_000,
  });

  await expect(page.getByRole("form", { name: "Record manual filing" })).not.toBeVisible({
    timeout: 15_000,
  });

  const handlingTrackingLine = page.locator("p").filter({
    has: page.locator("span.font-medium").filter({ hasText: "Handling tracking:" }),
  });
  await expect(handlingTrackingLine).toBeVisible({ timeout: 15_000 });
  await expect(handlingTrackingLine).not.toContainText(
    "Add filing records in chat below after external submission."
  );

  const outcomeTrackingForm = page.getByRole("form", {
    name: "Outcome and follow-up tracking",
  });
  await expect(outcomeTrackingForm).toBeVisible({ timeout: 15_000 });
  await expect(outcomeTrackingForm.getByText("Record outcome / follow-up")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request Surrenderless handling" })
  ).not.toBeVisible();

  const expectedOutcomeNote =
    "BBB filing recorded for Acme Retail (widget order). Confirmation on file. Awaiting BBB/merchant response.";
  await expect(handlingTrackingLine).toContainText(
    "Review follow-up timing and mark follow-up handled when complete.",
    { timeout: 15_000 }
  );
  await expect(actionTracking.getByRole("button", { name: "Mark acknowledged" })).not.toBeVisible();
  await expect(actionTracking.getByText(`Outcome: ${expectedOutcomeNote}`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(actionTracking.getByText(/Follow-up: flagged/)).toBeVisible({ timeout: 15_000 });
  await expect(
    outcomeTrackingForm.getByPlaceholder("What happened, or what should Surrenderless track next?")
  ).toHaveValue(expectedOutcomeNote);
  await expect(outcomeTrackingForm.getByRole("checkbox", { name: "Follow-up needed" })).toBeChecked();

  await actionTracking.getByRole("link", { name: "Handling workbench" }).click();
  await expect(page).toHaveURL(/\/justice\/handling\/?$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Handling workbench" })).toBeVisible({
    timeout: 15_000,
  });

  const acknowledgedHandlingSection = page.locator(
    "section[aria-labelledby='handling-acknowledged-heading']"
  );
  await expect(acknowledgedHandlingSection.getByRole("heading", { name: /^Acknowledged/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(acknowledgedHandlingSection.getByText("Acme Retail", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(acknowledgedHandlingSection.getByText("widget order", { exact: true })).toBeVisible();
  await expect(acknowledgedHandlingSection.getByText(expectedOutcomeNote)).toBeVisible();

  const followUpTrackingSection = page.locator("section[aria-labelledby='handling-follow-up-heading']");
  await expect(followUpTrackingSection.getByRole("heading", { name: /^Follow-up tracking/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(followUpTrackingSection.getByText("Acme Retail", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(followUpTrackingSection.getByText("Follow-up needed", { exact: true })).toBeVisible();

  await page.goto("/justice/chat-ai");
  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await waitForClerkBrowserApiSession(page);
  await page.reload();
  await waitForClerkBrowserApiSession(page);
  await expect(actionTracking).toBeVisible({ timeout: 15_000 });
  await expect(handlingTrackingLine).toContainText(
    "Review follow-up timing and mark follow-up handled when complete.",
    { timeout: 30_000 }
  );
  await expect(actionTracking.getByRole("button", { name: "Mark acknowledged" })).not.toBeVisible();
  await expect(actionTracking.getByRole("button", { name: "Mark follow-up handled" })).toBeVisible({
    timeout: 15_000,
  });

  await actionTracking.getByRole("button", { name: "Mark follow-up handled" }).click();
  await expect(handlingTrackingLine).toContainText("Tracking complete for now.", {
    timeout: 15_000,
  });

  const closeCaseBlock = page.locator("div").filter({ hasText: "Close this case" });
  await expect(closeCaseBlock.getByText("Close this case", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const archiveCaseButton = closeCaseBlock.getByRole("button", { name: "Archive case" });
  await expect(archiveCaseButton).toBeVisible();
  await archiveCaseButton.click();

  await expect(page).toHaveURL(/\/justice\/?$/, { timeout: 15_000 });
  const clearedCaseId = await page.evaluate((caseIdKey) => sessionStorage.getItem(caseIdKey), STORAGE_CASE_ID);
  expect(clearedCaseId).toBeNull();

  await page.goto("/justice/chat-ai");
  await waitForClerkBrowserApiSession(page);
  await page.goto("/justice/cases/archived");
  await expect(page).toHaveURL(/\/justice\/cases\/archived\/?$/);
  await expect(page.getByRole("heading", { name: "Archived cases" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Could not load archived cases.")).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Acme Retail", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("widget order")).toBeVisible();

  const acmeArchivedRow = page.locator("main li").filter({ hasText: "Acme Retail" });
  await expect(acmeArchivedRow).toBeVisible();
  await acmeArchivedRow.getByRole("button", { name: "Restore" }).click();

  await expect(page).toHaveURL(/\/justice\/cases\/archived\/?$/);
  await expect(page.getByText("Acme Retail", { exact: true })).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No archived cases.", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.goto("/justice/chat-ai");
  await waitForClerkBrowserApiSession(page);
  await page.goto("/justice/cases");
  await expect(page).toHaveURL(/\/justice\/cases\/?$/);
  await expect(page.getByRole("heading", { name: "Saved cases" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Could not load cases.")).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Acme Retail", { exact: true })).toBeVisible({ timeout: 30_000 });
  const allCasesList = page.locator("section[aria-labelledby='case-list-heading'] ~ ul");
  const acmeSavedCaseRow = allCasesList.locator("li").filter({ hasText: "Acme Retail" });
  await expect(acmeSavedCaseRow).toBeVisible({ timeout: 15_000 });
  await expect(acmeSavedCaseRow.getByText("widget order", { exact: true })).toBeVisible();

  const sessionAfterArchivedList = await page.evaluate(
    ({ caseIdKey, intakeKey }) => ({
      caseId: sessionStorage.getItem(caseIdKey),
      intake: sessionStorage.getItem(intakeKey),
    }),
    { caseIdKey: STORAGE_CASE_ID, intakeKey: STORAGE_INTAKE }
  );
  expect(sessionAfterArchivedList.caseId).toBeNull();
  expect(sessionAfterArchivedList.intake).toBeNull();
});
