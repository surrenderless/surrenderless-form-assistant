import { expect, type Locator, type Page } from "@playwright/test";
import {
  PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE,
} from "@/lib/testing/playwrightMockIntakeChatPipeline";
import { buildChatCaseProgressNarrationMessage } from "@/lib/justice/chatCaseProgressNarration";
import {
  CHAT_INTAKE_COMMIT_MESSAGE,
} from "@/lib/justice/chatIntakeCommitGates";
import {
  CHAT_LEGAL_CONSENT_BBB_ACCURACY_AND_RUN_MESSAGE,
  CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE,
  CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE,
} from "@/lib/justice/chatLegalConsentGates";
import { waitForClerkBrowserApiSession } from "./clerk-e2e";
import { expectUrlStaysOnChatAi } from "./chat-ai-ladder-continuity-e2e";

export function chatAiTranscript(page: Page): Locator {
  return page
    .locator("div:has(> textarea#chat-ai-input)")
    .locator("xpath=preceding-sibling::div[1]");
}

export function chatAiActionTracking(page: Page): Locator {
  return page.locator("#chat-ai-approved-action-tracking");
}

/**
 * Drive a signed-in consumer through chat-ai UI until State AG is queued for operator fulfillment.
 * Uses production chat gates and mock pipelines only — no direct client_state patches.
 */
export async function driveConsumerToStateAgQueuedFromChat(page: Page): Promise<void> {
  await page.route("**://www.bbb.org/**", () => {
    throw new Error("Live BBB navigation must not occur during Playwright E2E.");
  });
  await page.goto("/justice/chat-ai");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();

  const chatInput = page.locator("#chat-ai-input");
  await expect(chatInput).toBeVisible({ timeout: 30_000 });
  await waitForClerkBrowserApiSession(page);

  const chatTranscript = chatAiTranscript(page);

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE)).toBeVisible();

  const continueButton = page.getByRole("button", { name: "Save and continue in chat" });
  await expect(continueButton).toBeDisabled();

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE)).toBeVisible();
  await expect(continueButton).toBeEnabled();

  const intakeCommitResponse = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/api/justice/cases"),
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_INTAKE_COMMIT_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  expect((await intakeCommitResponse).ok()).toBeTruthy();
  await expect(page.getByText("I've saved your case.")).toBeVisible({ timeout: 15_000 });
  await expectUrlStaysOnChatAi(page);

  const draftReviewedResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/justice/submission-draft-reviewed"),
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  expect((await draftReviewedResponse).ok()).toBeTruthy();
  await expect(page.getByText("Submission draft reviewed: yes")).toBeVisible({ timeout: 30_000 });
  await expectUrlStaysOnChatAi(page);

  const packetApproval = page.locator("#chat-ai-inline-prepared-packet-approval");
  await expect(packetApproval).toBeVisible({ timeout: 30_000 });

  await chatInput.fill(CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    chatTranscript.getByText(CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(packetApproval).not.toBeVisible({ timeout: 15_000 });
  await expectUrlStaysOnChatAi(page);

  const actionTracking = chatAiActionTracking(page);
  await expect(actionTracking).toBeVisible({ timeout: 15_000 });
  await expect(actionTracking.getByText("Next step:")).toContainText("Better Business Bureau", {
    timeout: 15_000,
  });

  const realBbbAutofillBlock = page
    .locator("div.mt-3.space-y-2.rounded-lg.border")
    .filter({
      has: page.locator("p.text-xs.font-medium").filter({ hasText: "BBB complaint" }),
    })
    .filter({ has: page.getByText("www.bbb.org/complain/") });
  await expect(realBbbAutofillBlock).toBeVisible({ timeout: 15_000 });

  await chatInput.fill(CHAT_LEGAL_CONSENT_BBB_ACCURACY_AND_RUN_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    chatTranscript.getByText(CHAT_LEGAL_CONSENT_BBB_ACCURACY_AND_RUN_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expectUrlStaysOnChatAi(page);

  await expect(actionTracking.getByText("Next step:")).toContainText("State Attorney General", {
    timeout: 60_000,
  });
  await expect(chatTranscript.getByText(buildChatCaseProgressNarrationMessage("bbb_filed"))).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("State AG filing queued.")).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("state_ag_queued"))
  ).toBeVisible({ timeout: 30_000 });
  await expectUrlStaysOnChatAi(page);
}

/** Complete State AG fulfillment for Acme Retail via operator fulfillment UI (real click, not request.post). */
export async function completeStateAgFulfillmentViaOperatorUi(operatorPage: Page): Promise<void> {
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
}

/** Complete demand-letter fulfillment for Acme Retail via operator fulfillment UI (real click, not request.post). */
export async function completeDemandLetterFulfillmentViaOperatorUi(operatorPage: Page): Promise<void> {
  await operatorPage.goto("/operator/fulfillment");
  await expect(operatorPage.getByRole("heading", { name: "Operator fulfillment queue" })).toBeVisible({
    timeout: 30_000,
  });

  const demandLetterItem = operatorPage
    .locator("li")
    .filter({ hasText: "Demand letter" })
    .filter({ hasText: "Acme Retail" })
    .first();
  await expect(demandLetterItem).toBeVisible({ timeout: 30_000 });

  await demandLetterItem.locator('input[type="date"]').fill("2026-06-23");
  await demandLetterItem
    .getByPlaceholder("Portal confirmation or reference number")
    .fill("e2e-ui-demand-letter-999");
  const completeResponsePromise = operatorPage.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/justice/demand-letter-filing/complete"),
    { timeout: 30_000 }
  );
  await demandLetterItem.getByRole("button", { name: "Mark fulfillment complete" }).click();
  const completeResponse = await completeResponsePromise;
  expect(completeResponse.ok()).toBeTruthy();

  await expect(
    operatorPage.locator("li").filter({ hasText: "Demand letter" }).filter({ hasText: "Acme Retail" })
  ).toHaveCount(0, { timeout: 30_000 });
}

/**
 * Drive consumer chat to queued demand letter: intake → BBB → State AG queued → operator completes State AG via UI.
 */
export async function driveConsumerToDemandLetterQueuedFromChat(
  consumerPage: Page,
  operatorPage: Page
): Promise<void> {
  await driveConsumerToStateAgQueuedFromChat(consumerPage);

  const actionTracking = chatAiActionTracking(consumerPage);
  await actionTracking.scrollIntoViewIfNeeded();
  await expect(actionTracking.getByText("State AG filing queued.")).toBeVisible({ timeout: 15_000 });
  await expectUrlStaysOnChatAi(consumerPage);

  await completeStateAgFulfillmentViaOperatorUi(operatorPage);

  const chatTranscript = chatAiTranscript(consumerPage);
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
  await expectUrlStaysOnChatAi(consumerPage);
}
