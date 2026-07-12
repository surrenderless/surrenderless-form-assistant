import { expect, test } from "@playwright/test";
import {
  CLERK_STORAGE_STATE_PATH,
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  activeCaseChecklist,
  expectNoOptionalDestinationPrepOrEvidenceHubLinks,
  expectUrlStaysOnChatAi,
  seedActiveCaseCfpbFilingStep,
} from "./helpers/chat-ai-ladder-continuity-e2e";
import {
  archiveCaseViaChat,
  chatAiTranscript,
  expectConsumerChatCaseArchivedClosed,
  expectConsumerChatStaysArchivedAfterReload,
  markFollowUpHandledViaChat,
} from "./helpers/chat-ai-owned-fulfillment-e2e";
import { buildChatCaseProgressNarrationMessage } from "@/lib/justice/chatCaseProgressNarration";

test.use({ storageState: CLERK_STORAGE_STATE_PATH });

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("manual CFPB lane completes filing → confirmation endgame → follow-up → archive in chat", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await seedActiveCaseCfpbFilingStep(page);
  await waitForClerkBrowserApiSession(page);

  await expect(activeCaseChecklist(page).getByText("Evidence: yes")).toBeVisible({
    timeout: 30_000,
  });

  const tracking = page.locator("#chat-ai-approved-action-tracking");
  await tracking.scrollIntoViewIfNeeded();
  await expect(tracking).toBeVisible({ timeout: 30_000 });

  const filingForm = tracking.getByRole("form", { name: "Record manual filing" });
  await expect(filingForm).toBeVisible({ timeout: 30_000 });
  await expect(filingForm.getByLabel(/Where you filed or acted/i)).toHaveValue("CFPB");
  await expect(filingForm.getByLabel(/Where you filed or acted/i)).toHaveAttribute("readonly", "");
  await expectNoOptionalDestinationPrepOrEvidenceHubLinks(page.locator("main"));

  const filingPost = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/api/justice/filings"),
    { timeout: 30_000 }
  );
  await filingForm.getByLabel(/Confirmation number/i).fill("CFPB-E2E-42");
  await filingForm.getByRole("button", { name: "Save filing record" }).click();
  expect((await filingPost).ok()).toBeTruthy();

  const outcomeTrackingForm = page.getByRole("form", {
    name: "Outcome and follow-up tracking",
  });
  await expect(outcomeTrackingForm).toBeVisible({ timeout: 30_000 });
  await expect(outcomeTrackingForm.getByRole("checkbox", { name: "Follow-up needed" })).toBeChecked();
  await expect(
    outcomeTrackingForm.getByPlaceholder("What happened, or what should Surrenderless track next?")
  ).toHaveValue(/CFPB filing recorded/);

  const chatTranscript = chatAiTranscript(page);
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("resolution_ready"))
  ).toBeVisible({ timeout: 30_000 });

  await expectUrlStaysOnChatAi(page);

  await markFollowUpHandledViaChat(page);
  await archiveCaseViaChat(page);
  await expectConsumerChatCaseArchivedClosed(page);
  await expectConsumerChatStaysArchivedAfterReload(page);
});
