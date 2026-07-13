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
  driveConsumerToStateAgQueuedFromChat,
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

test("consumer queues State AG in chat, operator completes via fulfillment UI, chat advances escalation", async ({
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

  await driveConsumerToStateAgQueuedFromChat(consumerPage, operatorPage);

  const actionTracking = chatAiActionTracking(consumerPage);
  await actionTracking.scrollIntoViewIfNeeded();
  await expect(actionTracking.getByText("State AG filing queued.")).toBeVisible({ timeout: 15_000 });
  await expectUrlStaysOnChatAi(consumerPage);

  const chatTranscript = chatAiTranscript(consumerPage);

  await operatorPage.goto("/operator/fulfillment");
  await expect(operatorPage.getByRole("heading", { name: "Operator fulfillment queue" })).toBeVisible({
    timeout: 30_000,
  });

  const stateAgItem = operatorPage.locator("li").filter({ hasText: "Acme Retail" }).first();
  await expect(stateAgItem).toBeVisible({ timeout: 30_000 });
  await expect(stateAgItem.getByText("State Attorney General filing")).toBeVisible();

  await stateAgItem.locator('input[type="date"]').fill("2026-06-22");
  await stateAgItem
    .getByPlaceholder("Portal confirmation or reference number")
    .fill("e2e-ui-state-ag-999");
  const completeResponsePromise = operatorPage.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/justice/state-ag-filing/complete"),
    { timeout: 30_000 }
  );
  await stateAgItem.getByRole("button", { name: "Mark fulfillment complete" }).click();
  const completeResponse = await completeResponsePromise;
  expect(completeResponse.ok()).toBeTruthy();
  const completeBody = (await completeResponse.json()) as { advanced?: boolean };
  expect(completeBody.advanced).toBe(true);

  await expect(
    operatorPage.locator("li").filter({ hasText: "State Attorney General filing" })
  ).toHaveCount(0, { timeout: 30_000 });
  await expect(
    operatorPage.locator("li").filter({ hasText: "Demand letter" }).filter({ hasText: "Acme Retail" })
  ).toBeVisible({ timeout: 30_000 });

  await expectUrlStaysOnChatAi(consumerPage);
  await expect(actionTracking.getByText("Next step:")).toContainText("Small claims / demand letter", {
    timeout: 30_000,
  });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("state_ag_confirmed"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(consumerPage.getByText("Demand letter queued with Surrenderless.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("demand_letter_queued"))
  ).toBeVisible({ timeout: 30_000 });

  expect(
    await chatTranscript
      .getByText(buildChatCaseProgressNarrationMessage("state_ag_confirmed"))
      .count()
  ).toBe(1);

  await consumerPage.reload();
  await waitForClerkBrowserApiSession(consumerPage);
  await expectUrlStaysOnChatAi(consumerPage);
  await expect(actionTracking).toBeVisible({ timeout: 30_000 });
  await expect(actionTracking.getByText("Next step:")).toContainText("Small claims / demand letter", {
    timeout: 30_000,
  });
  await expect(consumerPage.getByText("Demand letter queued with Surrenderless.")).toBeVisible({
    timeout: 30_000,
  });
  expect(
    await chatTranscript
      .getByText(buildChatCaseProgressNarrationMessage("state_ag_confirmed"))
      .count()
  ).toBe(1);
  expect(
    await chatTranscript
      .getByText(buildChatCaseProgressNarrationMessage("demand_letter_queued"))
      .count()
  ).toBe(1);

  await consumerContext.close();
  await operatorContext.close();
});
