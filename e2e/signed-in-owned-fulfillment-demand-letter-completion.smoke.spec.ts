import { expect, test } from "@playwright/test";
import {
  CLERK_STORAGE_STATE_PATH,
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  isOperatorClerkE2eConfigured,
  operatorClerkE2eSkipReason,
  operatorClerkStorageStateExists,
  OPERATOR_CLERK_STORAGE_STATE_PATH,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  chatAiActionTracking,
  chatAiTranscript,
  completeDemandLetterFulfillmentViaOperatorUi,
  driveConsumerToDemandLetterQueuedFromChat,
} from "./helpers/chat-ai-owned-fulfillment-e2e";
import { expectUrlStaysOnChatAi } from "./helpers/chat-ai-ladder-continuity-e2e";
import { buildChatCaseProgressNarrationMessage } from "@/lib/justice/chatCaseProgressNarration";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
  test.skip(
    !isOperatorClerkE2eConfigured() || !operatorClerkStorageStateExists(),
    operatorClerkE2eSkipReason()
  );
});

test("consumer queues demand letter in chat, operator completes via fulfillment UI, chat reaches resolution", async ({
  browser,
}) => {
  test.setTimeout(480_000);

  const consumerContext = await browser.newContext({
    storageState: CLERK_STORAGE_STATE_PATH,
  });
  const consumerPage = await consumerContext.newPage();

  const operatorContext = await browser.newContext({
    storageState: OPERATOR_CLERK_STORAGE_STATE_PATH,
  });
  const operatorPage = await operatorContext.newPage();

  await driveConsumerToDemandLetterQueuedFromChat(consumerPage, operatorPage);

  const actionTracking = chatAiActionTracking(consumerPage);
  const chatTranscript = chatAiTranscript(consumerPage);
  await expect(consumerPage.getByText("Demand letter queued with Surrenderless.")).toBeVisible({
    timeout: 15_000,
  });
  await expectUrlStaysOnChatAi(consumerPage);

  await completeDemandLetterFulfillmentViaOperatorUi(operatorPage);

  const expectedOutcomeNote =
    "Escalation complete for Acme Retail (widget order). BBB, State AG, and demand letter steps recorded. Awaiting responses.";
  const outcomeTrackingForm = consumerPage.getByRole("form", {
    name: "Outcome and follow-up tracking",
  });
  const handlingTrackingLine = consumerPage.locator("p").filter({
    has: consumerPage.locator("span.font-medium").filter({ hasText: "Handling tracking:" }),
  });

  await expectUrlStaysOnChatAi(consumerPage);
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
  await expect(
    outcomeTrackingForm.getByPlaceholder("What happened, or what should Surrenderless track next?")
  ).toHaveValue(expectedOutcomeNote);

  expect(
    await chatTranscript
      .getByText(buildChatCaseProgressNarrationMessage("demand_letter_sent"))
      .count()
  ).toBe(1);
  expect(
    await chatTranscript
      .getByText(buildChatCaseProgressNarrationMessage("resolution_ready"))
      .count()
  ).toBe(1);

  await consumerPage.reload();
  await waitForClerkBrowserApiSession(consumerPage);
  await expectUrlStaysOnChatAi(consumerPage);
  await expect(outcomeTrackingForm).toBeVisible({ timeout: 30_000 });
  await expect(actionTracking.getByText(`Outcome: ${expectedOutcomeNote}`)).toBeVisible({
    timeout: 15_000,
  });
  expect(
    await chatTranscript
      .getByText(buildChatCaseProgressNarrationMessage("demand_letter_sent"))
      .count()
  ).toBe(1);
  expect(
    await chatTranscript
      .getByText(buildChatCaseProgressNarrationMessage("resolution_ready"))
      .count()
  ).toBe(1);

  await consumerContext.close();
  await operatorContext.close();
});
