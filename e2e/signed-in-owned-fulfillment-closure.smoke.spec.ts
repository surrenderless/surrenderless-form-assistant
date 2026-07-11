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
} from "./helpers/clerk-e2e";
import {
  archiveCaseViaChat,
  chatAiTranscript,
  driveConsumerToOwnedFulfillmentResolutionInChat,
  expectConsumerChatCaseArchivedClosed,
  expectConsumerChatStaysArchivedAfterReload,
  markFollowUpHandledViaChat,
} from "./helpers/chat-ai-owned-fulfillment-e2e";
import { buildChatCaseProgressNarrationMessage } from "@/lib/justice/chatCaseProgressNarration";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
  test.skip(
    !isOperatorClerkE2eConfigured() || !operatorClerkStorageStateExists(),
    operatorClerkE2eSkipReason()
  );
});

test("consumer completes owned-fulfillment escalation, closes case in chat, reload stays archived", async ({
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

  await driveConsumerToOwnedFulfillmentResolutionInChat(consumerPage, operatorPage);

  const chatTranscript = chatAiTranscript(consumerPage);
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

  await markFollowUpHandledViaChat(consumerPage);
  await archiveCaseViaChat(consumerPage);
  await expectConsumerChatCaseArchivedClosed(consumerPage);
  await expectConsumerChatStaysArchivedAfterReload(consumerPage);

  await consumerContext.close();
  await operatorContext.close();
});
