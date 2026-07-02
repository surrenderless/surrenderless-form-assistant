import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
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

test("signed-in user completes intake through merchant step handling, FTC and BBB practice autofill, real BBB copy-draft prep, filing confirmation, and archive in chat", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/justice/chat-ai");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();

  const chatInput = page.locator("#chat-ai-input");
  await expect(chatInput).toBeVisible({ timeout: 30_000 });

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

  const merchantContactPrepBlock = page
    .locator("div.mt-3.space-y-2.rounded-lg.border")
    .filter({ has: page.locator("p.text-xs.font-medium").filter({ hasText: "Merchant contact & proof" }) })
    .filter({ has: page.getByRole("button", { name: "Copy message" }) });
  await expect(merchantContactPrepBlock).toBeVisible({ timeout: 15_000 });
  await expect(merchantContactPrepBlock.getByRole("button", { name: "Copy message" })).toBeVisible();

  const actionTracking = page
    .locator("div.mt-4.rounded-xl")
    .filter({ has: page.getByText("Current action tracking", { exact: true }) });
  await expect(actionTracking).toBeVisible({ timeout: 15_000 });
  await expect(actionTracking.getByText("Next step:")).toContainText("Merchant contact");
  await expect(
    actionTracking.locator("p").filter({ hasText: "Approved next action:" })
  ).toContainText("Approved");
  const markStepOpenedButton = actionTracking.getByRole("button", { name: "Mark step opened" });
  await expect(markStepOpenedButton).toBeVisible();
  await expect(
    actionTracking.getByRole("button", { name: "Record action handled for now" })
  ).not.toBeVisible();

  await markStepOpenedButton.click();

  await expect(
    actionTracking.locator("p").filter({ hasText: "Approved next action:" })
  ).toContainText("Started", { timeout: 15_000 });
  await expect(actionTracking.getByText("Opened for next step.", { exact: true })).toBeVisible();
  await expect(markStepOpenedButton).not.toBeVisible();
  const recordHandledButton = actionTracking.getByRole("button", {
    name: "Record action handled for now",
  });
  await expect(recordHandledButton).toBeVisible();

  await recordHandledButton.click();

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(actionTracking.getByText("Next step:")).toContainText("FTC (consumer complaint)", {
    timeout: 15_000,
  });
  await expect(
    actionTracking.locator("p").filter({ hasText: "Approved next action:" })
  ).toContainText("Approved");
  await expect(markStepOpenedButton).toBeVisible();
  await expect(recordHandledButton).not.toBeVisible();
  await expect(actionTracking.getByText("Opened for next step.", { exact: true })).not.toBeVisible();

  const ftcPracticePrepBlock = page
    .locator("div.mt-3.space-y-2.rounded-lg.border")
    .filter({
      has: page.locator("p.text-xs.font-medium").filter({ hasText: "FTC practice complaint" }),
    })
    .filter({ has: page.getByText("/mock/ftc-complaint") });
  await expect(ftcPracticePrepBlock).toBeVisible({ timeout: 15_000 });
  await expect(
    ftcPracticePrepBlock.getByRole("button", { name: "Run practice autofill" })
  ).toBeVisible();
  await expect(
    ftcPracticePrepBlock.getByRole("button", { name: "Run practice autofill" })
  ).toBeDisabled();
  await expect(ftcPracticePrepBlock.getByRole("link", { name: "Open full FTC practice page" })).toBeVisible();

  await ftcPracticePrepBlock
    .getByRole("checkbox", { name: "I confirm this information is accurate to the best of my knowledge." })
    .check();
  await ftcPracticePrepBlock.getByRole("button", { name: "Run practice autofill" }).click();

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(page.getByText("Practice autofill completed.", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  const assistedSubmissionSnapshot = page
    .locator("div.rounded-lg.border")
    .filter({ has: page.getByText("Last assisted submission attempt", { exact: true }) });
  await expect(assistedSubmissionSnapshot).toBeVisible({ timeout: 15_000 });
  await expect(assistedSubmissionSnapshot.getByText("FTC (practice)", { exact: true })).toBeVisible();
  await expect(assistedSubmissionSnapshot).toContainText(
    "Confirmation: FTC mock practice complete"
  );

  await expect(actionTracking.getByText("Next step:")).toContainText("BBB mock practice", {
    timeout: 15_000,
  });
  await expect(
    actionTracking.locator("p").filter({ hasText: "Approved next action:" })
  ).toContainText("Approved");
  await expect(markStepOpenedButton).toBeVisible();
  await expect(recordHandledButton).not.toBeVisible();

  const bbbPracticePrepBlock = page
    .locator("div.mt-3.space-y-2.rounded-lg.border")
    .filter({
      has: page.locator("p.text-xs.font-medium").filter({ hasText: "BBB practice complaint" }),
    })
    .filter({ has: page.getByText("/mock/bbb-complaint") });
  await expect(bbbPracticePrepBlock).toBeVisible({ timeout: 15_000 });
  await expect(
    bbbPracticePrepBlock.getByRole("button", { name: "Run practice autofill" })
  ).toBeVisible();
  await expect(
    bbbPracticePrepBlock.getByRole("button", { name: "Run practice autofill" })
  ).toBeDisabled();

  await bbbPracticePrepBlock
    .getByRole("checkbox", { name: "I confirm this information is accurate to the best of my knowledge." })
    .check();
  await bbbPracticePrepBlock.getByRole("button", { name: "Run practice autofill" }).click();

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(page.getByText("Practice autofill completed.", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  const bbbAssistedSubmissionSnapshot = page
    .locator("div.rounded-lg.border")
    .filter({ has: page.getByText("Last assisted submission attempt", { exact: true }) });
  await expect(bbbAssistedSubmissionSnapshot).toBeVisible({ timeout: 15_000 });
  await expect(bbbAssistedSubmissionSnapshot.getByText("BBB (practice)", { exact: true })).toBeVisible();
  await expect(bbbAssistedSubmissionSnapshot).toContainText(
    "Confirmation: BBB mock practice complete"
  );

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(actionTracking.getByText("Next step:")).toContainText("Better Business Bureau", {
    timeout: 15_000,
  });
  await expect(
    actionTracking.locator("p").filter({ hasText: "Approved next action:" })
  ).toContainText("Approved");
  await expect(markStepOpenedButton).toBeVisible();
  await expect(recordHandledButton).not.toBeVisible();

  const realBbbPrepBlock = page
    .locator("div.mt-3.space-y-2.rounded-lg.border")
    .filter({
      has: page.locator("p.text-xs.font-medium").filter({ hasText: "Better Business Bureau" }),
    })
    .filter({ has: page.getByRole("button", { name: "Copy draft" }) });
  await expect(realBbbPrepBlock).toBeVisible({ timeout: 15_000 });
  await expect(realBbbPrepBlock.getByRole("button", { name: "Copy draft" })).toBeVisible();
  await expect(realBbbPrepBlock.getByRole("link", { name: "Open full better business bureau page" })).toBeVisible();
  await expect(realBbbPrepBlock.getByRole("link", { name: "Open full better business bureau page" })).toHaveAttribute(
    "href",
    "/justice/bbb"
  );

  await expect(bbbAssistedSubmissionSnapshot).toBeVisible({ timeout: 15_000 });
  await expect(bbbAssistedSubmissionSnapshot.getByText("BBB (practice)", { exact: true })).toBeVisible();
  await expect(bbbAssistedSubmissionSnapshot).toContainText(
    "Confirmation: BBB mock practice complete"
  );

  const handlingTrackingLine = page.locator("p").filter({
    has: page.locator("span.font-medium").filter({ hasText: "Handling tracking:" }),
  });
  await expect(handlingTrackingLine).toBeVisible({ timeout: 15_000 });
  await expect(handlingTrackingLine).not.toContainText(
    "Review packet and saved proof before external manual action."
  );
  await expect(handlingTrackingLine).toContainText(
    "Open the approved step and prepare the manual action."
  );

  await markStepOpenedButton.click();

  await expect(
    actionTracking.locator("p").filter({ hasText: "Approved next action:" })
  ).toContainText("Started", { timeout: 15_000 });
  await expect(actionTracking.getByText("Opened for next step.", { exact: true })).toBeVisible();
  await expect(handlingTrackingLine).toContainText(
    "Add filing records in chat below after external submission.",
    { timeout: 15_000 }
  );

  const manualFilingForm = page.getByRole("form", { name: "Record manual filing" });
  await expect(manualFilingForm).toBeVisible({ timeout: 15_000 });
  const destinationInput = manualFilingForm.getByLabel("Where you filed or acted (required)");
  await expect(destinationInput).toHaveValue("Better Business Bureau");
  await expect(destinationInput).toHaveAttribute("readonly", "");

  await manualFilingForm.getByLabel("Confirmation number (optional)").fill("E2E-BBB-2026-001");
  await manualFilingForm.getByRole("button", { name: "Save filing record" }).click();

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(handlingTrackingLine).toContainText("Tracking complete for now.", {
    timeout: 15_000,
  });
  await expect(handlingTrackingLine).not.toContainText(
    "Add filing records in chat below after external submission."
  );

  await page.getByRole("button", { name: "Request Surrenderless handling" }).click();

  const outcomeTrackingForm = page.getByRole("form", {
    name: "Outcome and follow-up tracking",
  });
  await expect(outcomeTrackingForm).toBeVisible({ timeout: 15_000 });
  await expect(outcomeTrackingForm.getByText("Record outcome / follow-up")).toBeVisible();
  await expect(handlingTrackingLine).toContainText("Record the handling outcome.", {
    timeout: 15_000,
  });

  const outcomeNote = "E2E: BBB filing recorded; merchant has not responded yet.";
  const followUpDate = "2026-08-15";
  await outcomeTrackingForm.getByPlaceholder(
    "What happened, or what should Surrenderless track next?"
  ).fill(outcomeNote);
  await outcomeTrackingForm.getByRole("checkbox", { name: "Follow-up needed" }).check();
  await outcomeTrackingForm.getByLabel("Follow-up date (optional, your pace)").fill(followUpDate);
  await outcomeTrackingForm.getByRole("button", { name: "Save tracking note" }).click();

  await expect(outcomeTrackingForm).toBeVisible({ timeout: 15_000 });
  await expect(outcomeTrackingForm.getByRole("checkbox", { name: "Follow-up needed" })).toBeChecked();
  await expect(outcomeTrackingForm.getByLabel("Follow-up date (optional, your pace)")).toHaveValue(
    followUpDate
  );
  await expect(
    outcomeTrackingForm.getByPlaceholder("What happened, or what should Surrenderless track next?")
  ).toHaveValue(outcomeNote);
  await expect(actionTracking.getByText(`Outcome: ${outcomeNote}`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(actionTracking.getByText(/Follow-up: flagged/)).toBeVisible({ timeout: 15_000 });
  await expect(actionTracking.getByText(/due /)).toBeVisible({ timeout: 15_000 });
  await expect(handlingTrackingLine).toContainText("Mark the handling request acknowledged.", {
    timeout: 15_000,
  });

  await actionTracking.getByRole("link", { name: "Handling workbench" }).click();
  await expect(page).toHaveURL(/\/justice\/handling\/?$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Handling workbench" })).toBeVisible({
    timeout: 15_000,
  });

  const awaitingHandlingSection = page.locator("section[aria-labelledby='handling-awaiting-heading']");
  await expect(
    awaitingHandlingSection.getByRole("heading", { name: /^Awaiting internal triage/ })
  ).toBeVisible({ timeout: 15_000 });
  await expect(awaitingHandlingSection.getByText("Acme Retail", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(awaitingHandlingSection.getByText("widget order")).toBeVisible();
  await expect(awaitingHandlingSection.getByText(outcomeNote)).toBeVisible();

  await page.goto("/justice/chat-ai");
  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(actionTracking).toBeVisible({ timeout: 15_000 });

  await actionTracking.getByRole("button", { name: "Mark acknowledged" }).click();
  await expect(handlingTrackingLine).toContainText(
    "Review follow-up timing and mark follow-up handled when complete.",
    { timeout: 15_000 }
  );

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

  await page.goto("/justice/cases/archived");
  await expect(page).toHaveURL(/\/justice\/cases\/archived\/?$/);
  await expect(page.getByRole("heading", { name: "Archived cases" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Acme Retail", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("widget order")).toBeVisible();

  const acmeArchivedRow = page.locator("main li").filter({ hasText: "Acme Retail" });
  await expect(acmeArchivedRow).toBeVisible();
  await acmeArchivedRow.getByRole("button", { name: "Restore" }).click();

  await expect(page).toHaveURL(/\/justice\/cases\/archived\/?$/);
  await expect(page.getByText("Acme Retail", { exact: true })).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No archived cases.", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.goto("/justice/cases");
  await expect(page).toHaveURL(/\/justice\/cases\/?$/);
  await expect(page.getByRole("heading", { name: "Saved cases" })).toBeVisible({ timeout: 15_000 });
  const allCasesList = page.locator("section[aria-labelledby='case-list-heading'] ~ ul");
  const acmeSavedCaseRow = allCasesList.locator("li").filter({ hasText: "Acme Retail" });
  await expect(acmeSavedCaseRow).toBeVisible({ timeout: 15_000 });
  await expect(acmeSavedCaseRow.getByText("widget order")).toBeVisible();

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
