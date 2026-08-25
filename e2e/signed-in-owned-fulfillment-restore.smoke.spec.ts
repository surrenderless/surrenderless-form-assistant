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
  chatAiTranscript,
  closeOwnedFulfillmentCaseViaOperatorUi,
  driveConsumerToOwnedFulfillmentResolutionInChat,
  expectConsumerChatCaseArchivedClosed,
  expectConsumerChatCaseRestoredActive,
  expectConsumerChatStaysRestoredAfterReload,
  restoreMostRecentArchivedCaseViaChat,
} from "./helpers/chat-ai-owned-fulfillment-e2e";
import { CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE } from "@/lib/justice/chatCaseRestoreGates";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import { STORAGE_STAGED_PROOF_NOTES_V1 } from "@/lib/justice/stagedProofNotes";

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

  // Stage a proof note about a new/unrelated problem while no case is active — it has no
  // case_id of its own (see stagedProofNotes.ts), so restoring a different case out from under
  // it would silently attach it to that case's evidence on next save.
  await consumerPage.getByText("Add a proof note").click();
  await consumerPage.locator("#chat-ai-proof-title").fill("Screenshot of a new billing error");
  await consumerPage.getByRole("button", { name: "Stage proof note" }).click();
  await expect(consumerPage.getByText("Proof note staged on this device.")).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(
      async () =>
        consumerPage.evaluate((key) => sessionStorage.getItem(key), STORAGE_STAGED_PROOF_NOTES_V1),
      { timeout: 15_000 }
    )
    .not.toBeNull();

  const consumerChatInput = consumerPage.locator("#chat-ai-input");
  const consumerChatTranscript = chatAiTranscript(consumerPage);
  await consumerChatInput.fill(CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE);
  await consumerPage.getByRole("button", { name: "Send" }).click();
  await expect(
    consumerChatTranscript.getByText(
      "You have a proof note staged that hasn't been saved to a case yet. Save and continue in chat to attach it to your current case before switching to a different case."
    )
  ).toBeVisible({ timeout: 15_000 });

  // The restore must not have gone through, and the staged note must survive untouched.
  const caseIdAfterBlockedRestore = await consumerPage.evaluate(
    (key) => sessionStorage.getItem(key)?.trim() ?? "",
    STORAGE_CASE_ID
  );
  expect(caseIdAfterBlockedRestore).toBe("");
  const stagedAfterBlockedRestore = await consumerPage.evaluate(
    (key) => sessionStorage.getItem(key),
    STORAGE_STAGED_PROOF_NOTES_V1
  );
  expect(stagedAfterBlockedRestore).not.toBeNull();
  expect(JSON.parse(stagedAfterBlockedRestore!)).toHaveLength(1);

  // Clear the staged note (simulating the consumer following the guidance above) so the
  // existing successful-restore assertions below still hold.
  await consumerPage.evaluate(
    (key) => sessionStorage.removeItem(key),
    STORAGE_STAGED_PROOF_NOTES_V1
  );

  await restoreMostRecentArchivedCaseViaChat(consumerPage);
  await expectConsumerChatCaseRestoredActive(consumerPage);
  await expectConsumerChatStaysRestoredAfterReload(consumerPage);

  await consumerContext.close();
  await operatorContext.close();
});
