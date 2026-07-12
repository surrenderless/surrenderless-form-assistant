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
  archiveCaseViaChat,
  driveConsumerToOwnedFulfillmentResolutionInChat,
  expectConsumerChatCaseArchivedClosed,
  expectConsumerChatCaseRestoredActive,
  expectConsumerChatStaysOnSelectedAcmeAfterReload,
  listCasesViaChat,
  markFollowUpHandledViaChat,
  selectActiveBetaCaseViaChatCompany,
  selectArchivedAcmeCaseViaChatNumber,
  selectStaleListedAcmeCaseViaChatCompanyAfterArchive,
  startSecondBetaCaseViaChatAfterArchive,
} from "./helpers/chat-ai-owned-fulfillment-e2e";
import { expectUrlStaysOnChatAi } from "./helpers/chat-ai-ladder-continuity-e2e";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
  test.skip(
    !isOperatorClerkE2eConfigured() || !operatorClerkStorageStateExists(),
    operatorClerkE2eSkipReason()
  );
});

test("consumer lists dual cases in chat, restores stale-archived via live status, switches active without restore PATCH, reload persists", async ({
  browser,
}) => {
  test.setTimeout(600_000);

  const consumerContext = await browser.newContext({
    storageState: CLERK_STORAGE_STATE_PATH,
  });
  const consumerPage = await consumerContext.newPage();

  const operatorContext = await browser.newContext({
    storageState: OPERATOR_CLERK_STORAGE_STATE_PATH,
  });
  const operatorPage = await operatorContext.newPage();

  await driveConsumerToOwnedFulfillmentResolutionInChat(consumerPage, operatorPage);
  await markFollowUpHandledViaChat(consumerPage);
  await archiveCaseViaChat(consumerPage);
  await expectConsumerChatCaseArchivedClosed(consumerPage);

  await startSecondBetaCaseViaChatAfterArchive(consumerPage);
  await listCasesViaChat(consumerPage);
  await selectArchivedAcmeCaseViaChatNumber(consumerPage);
  await expectConsumerChatCaseRestoredActive(consumerPage);

  // Fresh list marks Acme active; archive without re-listing leaves a stale "active" offer.
  await listCasesViaChat(consumerPage, [/Acme Retail.*active/, /Beta Corp.*active/]);
  await selectStaleListedAcmeCaseViaChatCompanyAfterArchive(consumerPage);
  await expectConsumerChatCaseRestoredActive(consumerPage);
  await expectConsumerChatStaysOnSelectedAcmeAfterReload(consumerPage);

  await selectActiveBetaCaseViaChatCompany(consumerPage);
  await expectUrlStaysOnChatAi(consumerPage);

  await consumerContext.close();
  await operatorContext.close();
});
