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
  activeCaseChecklist,
  expectNoOptionalDestinationPrepOrEvidenceHubLinks,
  expectUrlStaysOnChatAi,
  seedActiveCaseDotFilingStep,
} from "./helpers/chat-ai-ladder-continuity-e2e";
import {
  archiveCaseViaChat,
  chatAiTranscript,
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

test("owned DOT queue → operator completes → resolution endgame stays in chat", async ({
  browser,
}) => {
  test.setTimeout(300_000);

  const consumerContext = await browser.newContext({
    storageState: CLERK_STORAGE_STATE_PATH,
  });
  const consumerPage = await consumerContext.newPage();

  await seedActiveCaseDotFilingStep(consumerPage);
  await waitForClerkBrowserApiSession(consumerPage);

  await expect(activeCaseChecklist(consumerPage).getByText("Evidence: yes")).toBeVisible({
    timeout: 30_000,
  });

  const tracking = consumerPage.locator("#chat-ai-approved-action-tracking");
  await tracking.scrollIntoViewIfNeeded();
  await expect(tracking).toBeVisible({ timeout: 30_000 });
  await expect(tracking.getByText("Next step:")).toContainText("USDOT / aviation consumer", {
    timeout: 15_000,
  });
  await expect(consumerPage.getByText("DOT filing queued.")).toBeVisible({ timeout: 30_000 });
  await expect(tracking.getByRole("form", { name: "Record manual filing" })).toHaveCount(0);
  await expectNoOptionalDestinationPrepOrEvidenceHubLinks(consumerPage.locator("main"));

  const chatTranscript = chatAiTranscript(consumerPage);
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("dot_queued"))
  ).toBeVisible({ timeout: 30_000 });

  const operatorContext = await browser.newContext({
    storageState: OPERATOR_CLERK_STORAGE_STATE_PATH,
  });
  const operatorPage = await operatorContext.newPage();
  await operatorPage.goto("/operator/fulfillment");
  await expect(
    operatorPage.getByRole("heading", { name: "Operator fulfillment queue" })
  ).toBeVisible({
    timeout: 30_000,
  });

  const dotItem = operatorPage.locator("li").filter({ hasText: "Acme Air" }).first();
  await expect(dotItem).toBeVisible({ timeout: 30_000 });
  await expect(dotItem.getByText("Step: DOT filing")).toBeVisible();

  await dotItem.locator('input[type="date"]').fill("2026-06-22");
  await dotItem.getByPlaceholder("Portal confirmation or reference number").fill("e2e-ui-dot-999");
  const completeResponsePromise = operatorPage.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/justice/dot-filing/complete"),
    { timeout: 30_000 }
  );
  await dotItem.getByRole("button", { name: "Mark fulfillment complete" }).click();
  const completeResponse = await completeResponsePromise;
  expect(completeResponse.ok()).toBeTruthy();
  const completeBody = (await completeResponse.json()) as { advanced?: boolean };
  expect(completeBody.advanced).toBe(false);

  await expect(operatorPage.locator("li").filter({ hasText: "DOT filing" })).toHaveCount(0, {
    timeout: 30_000,
  });

  await expectUrlStaysOnChatAi(consumerPage);
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("dot_confirmed"))
  ).toBeVisible({ timeout: 30_000 });

  const outcomeTrackingForm = consumerPage.getByRole("form", {
    name: "Outcome and follow-up tracking",
  });
  await expect(outcomeTrackingForm).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("resolution_ready"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(tracking.getByRole("form", { name: "Record manual filing" })).toHaveCount(0);

  await markFollowUpHandledViaChat(consumerPage);
  await archiveCaseViaChat(consumerPage);
  await expectConsumerChatCaseArchivedClosed(consumerPage);
  await expectConsumerChatStaysArchivedAfterReload(consumerPage);

  await consumerContext.close();
  await operatorContext.close();
});
