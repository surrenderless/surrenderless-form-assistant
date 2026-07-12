import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
} from "./helpers/clerk-e2e";
import {
  driveConsumerToSavedCaseForEvidenceUpload,
  expectEvidenceFilePersistsAfterReload,
  expectPrivateEvidenceFileAccess,
  uploadEvidenceFileViaChat,
} from "./helpers/chat-ai-evidence-upload-e2e";
import { expectUrlStaysOnChatAi } from "./helpers/chat-ai-ladder-continuity-e2e";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("consumer uploads evidence file in chat, private access works, reload retains file metadata", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await driveConsumerToSavedCaseForEvidenceUpload(page);
  const { evidenceId } = await uploadEvidenceFileViaChat(page);
  await expectPrivateEvidenceFileAccess(page, evidenceId);
  await expectEvidenceFilePersistsAfterReload(page);
  await expectUrlStaysOnChatAi(page);
  await expect(page.getByRole("link", { name: "Organize evidence" })).toHaveCount(0);
  expect(page.url()).not.toContain("/justice/evidence");
  expect(page.url()).not.toContain("/justice/packet");
  expect(page.url()).not.toContain("/justice/handling");
  expect(page.url()).not.toContain("/justice/cases");
});
