import { test } from "@playwright/test";
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
  closeOwnedFulfillmentCaseViaOperatorUi,
  driveConsumerToOwnedFulfillmentResolutionInChat,
  expectConsumerChatCaseArchivedClosed,
  expectConsumerChatCaseRestoredActive,
  expectConsumerChatStaysRestoredAfterReload,
  restoreMostRecentArchivedCaseViaChat,
} from "./helpers/chat-ai-owned-fulfillment-e2e";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
  test.skip(
    !isOperatorClerkE2eConfigured() || !operatorClerkStorageStateExists(),
    operatorClerkE2eSkipReason()
  );
});

test("consumer archives case in chat, restores most recent archived case in chat, reload stays restored", async ({
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
  await closeOwnedFulfillmentCaseViaOperatorUi(consumerPage, operatorPage);
  await expectConsumerChatCaseArchivedClosed(consumerPage);

  await restoreMostRecentArchivedCaseViaChat(consumerPage);
  await expectConsumerChatCaseRestoredActive(consumerPage);
  await expectConsumerChatStaysRestoredAfterReload(consumerPage);

  await consumerContext.close();
  await operatorContext.close();
});
