import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  isOperatorClerkE2eConfigured,
  operatorClerkStorageStateExists,
  OPERATOR_CLERK_STORAGE_STATE_PATH,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE,
} from "@/lib/testing/playwrightMockIntakeChatPipeline";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { buildPlaywrightMockE2eCaseIntake } from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import { PLAYWRIGHT_MOCK_SECOND_CASE_ID } from "@/lib/testing/playwrightMockJusticeChatMessagesPipeline";
import {
  PLAYWRIGHT_MOCK_BBB_TASK_ID,
  PLAYWRIGHT_MOCK_DEMAND_LETTER_TASK_ID,
  PLAYWRIGHT_MOCK_FTC_TASK_ID,
  PLAYWRIGHT_MOCK_STATE_AG_TASK_ID,
} from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";
import { buildChatCaseProgressNarrationMessage } from "@/lib/justice/chatCaseProgressNarration";
import {
  CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE,
  CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE,
} from "@/lib/justice/chatCaseClosureGates";
import {
  CHAT_INTAKE_COMMIT_MESSAGE,
} from "@/lib/justice/chatIntakeCommitGates";
import {
  CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE,
  CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE,
} from "@/lib/justice/chatLegalConsentGates";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
  test.skip(
    !isOperatorClerkE2eConfigured() || !operatorClerkStorageStateExists(),
    "Skipped: operator Clerk E2E credentials required for fulfillment steps in roundtrip."
  );
});

test("signed-in user completes intake through FTC, BBB, human-fulfillment ladder, resolution, and archive in chat", async ({
  page,
}) => {
  test.setTimeout(480_000);
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
  // The signed-in account's verified email now seeds the consumer's reply_email, so the
  // consumer-email basic is already satisfied after the first intake message and the button
  // is enabled before the second message.
  await expect(continueButton).toBeEnabled({ timeout: 15_000 });

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

  const intakeCommitResponse = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/api/justice/cases"),
    { timeout: 30_000 }
  );
  const transcriptPersistResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" && res.url().includes("/api/justice/chat-messages"),
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_INTAKE_COMMIT_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  const commitResponse = await intakeCommitResponse;
  expect(commitResponse.ok()).toBeTruthy();
  await transcriptPersistResponse;

  await expect(chatTranscript.getByText(CHAT_INTAKE_COMMIT_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("I've saved your case.")).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await waitForClerkBrowserApiSession(page);
  await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(chatTranscript.getByText(CHAT_INTAKE_COMMIT_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });

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

  const draftReviewedResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/justice/submission-draft-reviewed"),
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  const response = await draftReviewedResponse;
  expect(response.ok()).toBeTruthy();

  await expect(
    chatTranscript.getByText(CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Submission draft reviewed: yes")).toBeVisible({ timeout: 30_000 });

  const packetApproval = page.locator("#chat-ai-inline-prepared-packet-approval");
  await expect(packetApproval).toBeVisible({ timeout: 30_000 });
  await expect(
    packetApproval.locator("p.text-xs.font-medium").filter({ hasText: "Approve prepared packet" })
  ).toBeVisible({ timeout: 15_000 });
  await expect(draftReviewBlock).toBeHidden({ timeout: 15_000 });
  await expect(
    packetApproval.locator("pre").filter({ hasText: "JUSTICE CASE PACKET" })
  ).toBeVisible({ timeout: 15_000 });
  await expect(packetApproval.locator("pre")).toContainText("Acme Retail");

  await chatInput.fill(CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    chatTranscript.getByText(CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(packetApproval).not.toBeVisible({ timeout: 15_000 });

  await expect(
    page.getByRole("button", { name: "Confirm contact details" })
  ).not.toBeVisible({ timeout: 30_000 });

  const actionTracking = page
    .locator("div.mt-4.rounded-xl")
    .filter({ has: page.getByText("Current action tracking", { exact: true }) });
  await expect(actionTracking).toBeVisible({ timeout: 15_000 });
  await expect(actionTracking.getByText("Next step:")).toContainText("FTC (consumer complaint)", {
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

  await expect(page.getByText("FTC filing queued.")).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("ftc_queued"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("form", { name: "Record manual filing" })).not.toBeVisible({
    timeout: 15_000,
  });

  const operatorContext = await page.context().browser()!.newContext({
    storageState: OPERATOR_CLERK_STORAGE_STATE_PATH,
  });
  // Refresh the operator Clerk session in-browser so late-suite API posts use live cookies
  // instead of the static storageState JWT written at global setup.
  const operatorPage = await operatorContext.newPage();
  await operatorPage.goto("/operator/fulfillment");
  await expect(operatorPage.getByRole("heading", { name: "Operator fulfillment queue" })).toBeVisible({
    timeout: 30_000,
  });
  await operatorPage.getByRole("button", { name: "Open user menu" }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  const operatorRequest = operatorPage.request;
  const ftcCompleteResponse = await operatorRequest.post("/api/justice/ftc-filing/complete", {
    data: {
      case_id: PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
      task_id: PLAYWRIGHT_MOCK_FTC_TASK_ID,
      destination: "FTC (consumer complaint)",
      filed_at: "2026-06-20T12:00:00.000Z",
      confirmation_number: "e2e-ftc-12345",
    },
  });
  expect(ftcCompleteResponse.ok()).toBeTruthy();

  await expect(actionTracking.getByText("Next step:")).toContainText("Better Business Bureau", {
    timeout: 60_000,
  });
  await expect(chatTranscript.getByText(buildChatCaseProgressNarrationMessage("ftc_confirmed"))).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("BBB filing queued.")).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("bbb_queued"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Run BBB autofill" })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Record manual filing" })).not.toBeVisible({
    timeout: 15_000,
  });

  const bbbCompleteResponse = await operatorRequest.post("/api/justice/bbb-filing/complete", {
    data: {
      case_id: PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
      task_id: PLAYWRIGHT_MOCK_BBB_TASK_ID,
      destination: "Better Business Bureau",
      filed_at: "2026-06-21T12:00:00.000Z",
      confirmation_number: "e2e-bbb-12345",
    },
  });
  expect(bbbCompleteResponse.ok()).toBeTruthy();

  await expect(actionTracking.getByText("Next step:")).toContainText("State Attorney General", {
    timeout: 60_000,
  });
  await expect(chatTranscript.getByText(buildChatCaseProgressNarrationMessage("bbb_confirmed"))).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Filing: 2 filing records · confirmation on file")).toBeVisible({
    timeout: 15_000,
  });

  await expect(page.getByText("State AG filing queued.")).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("state_ag_queued"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    actionTracking.getByRole("button", { name: "Mark step opened" })
  ).not.toBeVisible();
  await expect(
    actionTracking.getByRole("button", { name: "Record action handled for now" })
  ).not.toBeVisible();
  await expect(page.getByRole("form", { name: "Record manual filing" })).not.toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("form", { name: "Outcome and follow-up tracking" })).not.toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Archive case" })).not.toBeVisible({ timeout: 15_000 });

  const handlingTrackingLine = page.locator("p").filter({
    has: page.locator("span.font-medium").filter({ hasText: "Handling tracking:" }),
  });
  await expect(handlingTrackingLine).toBeVisible({ timeout: 15_000 });
  await expect(handlingTrackingLine).toContainText(
    "Awaiting Surrenderless operator fulfillment for the current escalation step.",
    { timeout: 30_000 }
  );

  const consumerSelfComplete = await page.request.post("/api/justice/state-ag-filing/complete", {
    data: {
      case_id: PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
      task_id: PLAYWRIGHT_MOCK_STATE_AG_TASK_ID,
      destination: "State Attorney General (consumer)",
      filed_at: "2026-06-22T12:00:00.000Z",
      confirmation_number: "consumer-should-not-complete",
    },
  });
  expect(consumerSelfComplete.status()).toBe(403);

  const stateAgCompleteResponse = await operatorRequest.post("/api/justice/state-ag-filing/complete", {
    data: {
      case_id: PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
      task_id: PLAYWRIGHT_MOCK_STATE_AG_TASK_ID,
      destination: "State Attorney General (consumer)",
      filed_at: "2026-06-22T12:00:00.000Z",
      confirmation_number: "e2e-state-ag-12345",
    },
  });
  expect(stateAgCompleteResponse.ok()).toBeTruthy();

  await expect(actionTracking).toBeVisible({ timeout: 15_000 });
  await expect(actionTracking.getByText("Next step:")).toContainText("Small claims / demand letter", {
    timeout: 30_000,
  });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("state_ag_confirmed"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Demand letter queued with Surrenderless.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("demand_letter_queued"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    actionTracking.getByRole("button", { name: "Mark step opened" })
  ).not.toBeVisible();
  await expect(page.getByRole("form", { name: "Outcome and follow-up tracking" })).not.toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Archive case" })).not.toBeVisible({ timeout: 15_000 });

  const demandLetterCompleteResponse = await operatorRequest.post(
    "/api/justice/demand-letter-filing/complete",
    {
      data: {
        case_id: PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
        task_id: PLAYWRIGHT_MOCK_DEMAND_LETTER_TASK_ID,
        destination: "Small claims / demand letter",
        filed_at: "2026-06-23T12:00:00.000Z",
        confirmation_number: "e2e-demand-letter-12345",
      },
    }
  );
  expect(demandLetterCompleteResponse.ok()).toBeTruthy();
  await operatorContext.close();

  await expect(actionTracking).toBeVisible({ timeout: 15_000 });

  const expectedOutcomeNote =
    "Escalation complete for Acme Retail (widget order). BBB, State AG, and demand letter steps recorded. Awaiting responses.";
  const outcomeTrackingForm = page.getByRole("form", {
    name: "Outcome and follow-up tracking",
  });
  await expect(outcomeTrackingForm).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("demand_letter_sent"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("resolution_ready"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(handlingTrackingLine).toContainText(
    "Review follow-up timing and mark follow-up handled when complete.",
    { timeout: 15_000 }
  );
  await expect(actionTracking.getByText(`Outcome: ${expectedOutcomeNote}`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(actionTracking.getByText(/Follow-up: flagged/)).toBeVisible({ timeout: 15_000 });
  await expect(
    outcomeTrackingForm.getByPlaceholder("What happened, or what should Surrenderless track next?")
  ).toHaveValue(expectedOutcomeNote);
  await expect(outcomeTrackingForm.getByRole("checkbox", { name: "Follow-up needed" })).toBeChecked();
  await expect(
    actionTracking.getByRole("button", { name: "Mark step opened" })
  ).not.toBeVisible();

  await expect(actionTracking.getByRole("button", { name: "Mark follow-up handled" })).toBeVisible({
    timeout: 15_000,
  });

  const followUpClearResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "PATCH" &&
      res.url().includes("/api/justice/cases/") &&
      res.request().postDataJSON()?.client_state !== undefined,
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  const followUpPatch = await followUpClearResponse;
  expect(followUpPatch.ok()).toBeTruthy();

  await expect(
    chatTranscript.getByText(CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(handlingTrackingLine).toContainText("Tracking complete for now.", {
    timeout: 15_000,
  });

  await expect(actionTracking.getByRole("button", { name: "Archive case" })).toBeVisible({
    timeout: 30_000,
  });

  const archiveResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "PATCH" &&
      res.url().includes("/api/justice/cases/") &&
      typeof res.request().postDataJSON()?.archived_at === "string",
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  const archivePatch = await archiveResponse;
  expect(archivePatch.ok()).toBeTruthy();

  await expect(page).toHaveURL(/\/justice\/chat-ai/, { timeout: 15_000 });
  const clearedCaseId = await page.evaluate((caseIdKey) => sessionStorage.getItem(caseIdKey), STORAGE_CASE_ID);
  expect(clearedCaseId).toBeNull();
  await expect(chatTranscript.getByText(CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE)).not.toBeVisible({
    timeout: 15_000,
  });

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

  await acmeSavedCaseRow.getByRole("button", { name: "Open case" }).click();
  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await waitForClerkBrowserApiSession(page);
  await expect(chatTranscript.getByText(CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });

  const secondCaseMarker = "E2E second case unique transcript marker";
  const seedSecondCase = await page.request.post("/api/justice/chat-messages", {
    data: {
      case_id: PLAYWRIGHT_MOCK_SECOND_CASE_ID,
      messages: [
        {
          client_turn_id: "playwright-second-case-user-1",
          role: "user",
          content: secondCaseMarker,
          source: "intake_chat",
        },
      ],
    },
  });
  expect(seedSecondCase.ok()).toBeTruthy();

  await page.evaluate(
    ({ caseId, intakeKey, caseIdKey, intake }) => {
      sessionStorage.setItem(caseIdKey, caseId);
      sessionStorage.setItem(intakeKey, JSON.stringify(intake));
    },
    {
      caseId: PLAYWRIGHT_MOCK_SECOND_CASE_ID,
      caseIdKey: STORAGE_CASE_ID,
      intakeKey: STORAGE_INTAKE,
      intake: {
        problem_category: "online_purchase",
        company_name: "Beta Corp",
        company_website: "",
        purchase_or_signup: "other product",
        story: secondCaseMarker,
        money_involved: "",
        pay_or_order_date: "",
        order_confirmation_details: "",
        user_display_name: "Beta User",
        reply_email: "beta@example.com",
        already_contacted: "no",
      },
    }
  );
  await page.goto("/justice/chat-ai");
  await waitForClerkBrowserApiSession(page);
  await expect(chatTranscript.getByText(secondCaseMarker)).toBeVisible({ timeout: 15_000 });
  await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)).not.toBeVisible();

  const operatorDeniedContext = await page.context().browser()!.newContext({
    storageState: OPERATOR_CLERK_STORAGE_STATE_PATH,
  });
  const operatorDeniedPage = await operatorDeniedContext.newPage();
  await operatorDeniedPage.goto("/operator/fulfillment");
  await expect(
    operatorDeniedPage.getByRole("heading", { name: "Operator fulfillment queue" })
  ).toBeVisible({ timeout: 30_000 });
  await operatorDeniedPage.getByRole("button", { name: "Open user menu" }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  const operatorDenied = await operatorDeniedPage.request.get(
    `/api/justice/chat-messages?case_id=${PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID}`
  );
  expect(operatorDenied.status()).toBe(404);
  await operatorDeniedContext.close();

  await page.evaluate(
    ({ caseId, intakeKey, caseIdKey, intake }) => {
      sessionStorage.setItem(caseIdKey, caseId);
      sessionStorage.setItem(intakeKey, JSON.stringify(intake));
    },
    {
      caseId: PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID,
      caseIdKey: STORAGE_CASE_ID,
      intakeKey: STORAGE_INTAKE,
      intake: buildPlaywrightMockE2eCaseIntake(),
    }
  );
  await page.goto("/justice/chat-ai");
  await waitForClerkBrowserApiSession(page);
  await expect(chatTranscript.getByText(CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(chatTranscript.getByText(secondCaseMarker)).not.toBeVisible();

  const sessionAfterArchivedList = await page.evaluate(
    ({ caseIdKey, intakeKey }) => ({
      caseId: sessionStorage.getItem(caseIdKey),
      intake: sessionStorage.getItem(intakeKey),
    }),
    { caseIdKey: STORAGE_CASE_ID, intakeKey: STORAGE_INTAKE }
  );
  expect(sessionAfterArchivedList.caseId).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
  expect(sessionAfterArchivedList.intake).not.toBeNull();
});
