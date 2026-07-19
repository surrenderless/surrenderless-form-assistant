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
  seedActiveCasePaymentDisputeFilingStep,
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

test("owned payment dispute queue → operator completes → resolution endgame stays in chat", async ({
  browser,
}) => {
  test.setTimeout(300_000);

  const consumerContext = await browser.newContext({
    storageState: CLERK_STORAGE_STATE_PATH,
  });
  const consumerPage = await consumerContext.newPage();

  await seedActiveCasePaymentDisputeFilingStep(consumerPage);
  await waitForClerkBrowserApiSession(consumerPage);

  await expect(activeCaseChecklist(consumerPage).getByText("Evidence: yes")).toBeVisible({
    timeout: 30_000,
  });

  const tracking = consumerPage.locator("#chat-ai-approved-action-tracking");
  await tracking.scrollIntoViewIfNeeded();
  await expect(tracking).toBeVisible({ timeout: 30_000 });
  await expect(tracking.getByText("Next step:")).toContainText("Payment dispute", {
    timeout: 15_000,
  });
  await expect(consumerPage.getByText("Payment dispute filing queued.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(tracking.getByRole("form", { name: "Record manual filing" })).toHaveCount(0);
  await expectNoOptionalDestinationPrepOrEvidenceHubLinks(consumerPage.locator("main"));

  const chatTranscript = chatAiTranscript(consumerPage);
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("payment_dispute_queued"))
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

  const paymentDisputeItem = operatorPage.locator("li").filter({ hasText: "Acme Retail" }).first();
  await expect(paymentDisputeItem).toBeVisible({ timeout: 30_000 });
  await expect(paymentDisputeItem.getByText("Step: Payment dispute filing")).toBeVisible();

  await paymentDisputeItem.locator('input[type="date"]').fill("2026-06-22");
  // Guided payment-dispute workspace uses issuer-case wording (not the portal placeholder).
  await paymentDisputeItem
    .getByPlaceholder("Issuer case / dispute reference")
    .fill("e2e-ui-pd-999");
  const completeResponsePromise = operatorPage.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/justice/payment-dispute-filing/complete"),
    { timeout: 30_000 }
  );
  await paymentDisputeItem.getByRole("button", { name: "Mark fulfillment complete" }).click();
  const completeResponse = await completeResponsePromise;
  expect(completeResponse.ok()).toBeTruthy();
  const completeBody = (await completeResponse.json()) as { advanced?: boolean };
  expect(completeBody.advanced).toBe(false);

  await expect(operatorPage.locator("li").filter({ hasText: "Payment dispute filing" })).toHaveCount(
    0,
    { timeout: 30_000 }
  );

  await expectUrlStaysOnChatAi(consumerPage);
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("payment_dispute_confirmed"))
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
