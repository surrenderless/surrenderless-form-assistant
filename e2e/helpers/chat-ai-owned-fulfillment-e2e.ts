import { expect, type Locator, type Page, type Request } from "@playwright/test";
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
  CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE,
  CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE,
} from "@/lib/justice/chatLegalConsentGates";
import {
  CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE,
  CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE,
} from "@/lib/justice/chatCaseClosureGates";
import { CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE } from "@/lib/justice/chatCaseRestoreGates";
import {
  CHAT_CASE_SELECTION_LIST_MESSAGE,
  CHAT_CASE_SELECTION_OPEN_CASE_NUMBER_MESSAGE,
} from "@/lib/justice/chatCaseSelectionGates";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { PLAYWRIGHT_MOCK_SECOND_CASE_ID } from "@/lib/testing/playwrightMockJusticeChatMessagesOwnership";
import { waitForClerkBrowserApiSession } from "./clerk-e2e";
import { expectUrlStaysOnChatAi } from "./chat-ai-ladder-continuity-e2e";

/** Deterministic second-case intake messages for multi-case selection E2E. */
export const PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_BETA_USER_MESSAGE =
  "I ordered a gadget from Beta Corp for $19.99. They charged me twice and never refunded.";

export const PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_BETA_SECOND_USER_MESSAGE =
  "My email is e2e-chat@example.com and my name is Jordan Lee. I emailed Beta Corp on 2026-01-20 and they refused a refund.";


export const OWNED_FULFILLMENT_RESOLUTION_OUTCOME_NOTE =
  "Escalation complete for Acme Retail (widget order). BBB, State AG, and demand letter steps recorded. Awaiting responses.";

export function chatAiTranscript(page: Page): Locator {
  return page
    .locator("div:has(> textarea#chat-ai-input)")
    .locator("xpath=preceding-sibling::div[1]");
}

export function chatAiActionTracking(page: Page): Locator {
  return page.locator("#chat-ai-approved-action-tracking");
}

/**
 * Drive a signed-in consumer through chat-ai UI until FTC is queued for operator fulfillment.
 * Uses production chat gates and mock pipelines only — no direct client_state patches.
 */
export async function driveConsumerToFtcQueuedFromChat(page: Page): Promise<void> {
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
  // The signed-in account's verified email now seeds the consumer's reply_email, so the
  // consumer-email basic is already satisfied after the first intake message and the button
  // is enabled before the second message.
  await expect(continueButton).toBeEnabled({ timeout: 15_000 });

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
  await expect(actionTracking.getByText("Next step:")).toContainText("FTC (consumer complaint)", {
    timeout: 15_000,
  });

  await expect(page.getByText("FTC filing queued.")).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("ftc_queued"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(actionTracking.getByRole("form", { name: "Record manual filing" })).toHaveCount(0);
  await expectUrlStaysOnChatAi(page);
}

/** Complete FTC fulfillment for Acme Retail via operator fulfillment UI (real click, not request.post). */
export async function completeFtcFulfillmentViaOperatorUi(operatorPage: Page): Promise<void> {
  await operatorPage.goto("/operator/fulfillment");
  await expect(operatorPage.getByRole("heading", { name: "Operator fulfillment queue" })).toBeVisible({
    timeout: 30_000,
  });

  const ftcItem = operatorPage.locator("li").filter({ hasText: "Acme Retail" }).first();
  await expect(ftcItem).toBeVisible({ timeout: 30_000 });
  await expect(ftcItem.getByText("Step: FTC filing")).toBeVisible();

  await ftcItem.locator('input[type="date"]').fill("2026-06-20");
  await ftcItem.getByPlaceholder("Portal confirmation or reference number").fill("e2e-ui-ftc-888");
  const completeResponsePromise = operatorPage.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/justice/ftc-filing/complete"),
    { timeout: 30_000 }
  );
  await ftcItem.getByRole("button", { name: "Mark fulfillment complete" }).click();
  const completeResponse = await completeResponsePromise;
  expect(completeResponse.ok()).toBeTruthy();
  const completeBody = (await completeResponse.json()) as { advanced?: boolean };
  expect(completeBody.advanced).toBe(true);

  await expect(operatorPage.locator("li").filter({ hasText: "FTC filing" })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(
    operatorPage.locator("li").filter({ hasText: "BBB filing" }).filter({ hasText: "Acme Retail" })
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Drive a signed-in consumer through chat-ai UI until BBB is queued for operator fulfillment.
 * Completes owned FTC first (normal retail failed-contact ladder now queues FTC before BBB).
 */
export async function driveConsumerToBbbQueuedFromChat(
  page: Page,
  operatorPage: Page
): Promise<void> {
  await driveConsumerToFtcQueuedFromChat(page);
  await completeFtcFulfillmentViaOperatorUi(operatorPage);

  const actionTracking = chatAiActionTracking(page);
  const chatTranscript = chatAiTranscript(page);
  await expect(actionTracking.getByText("Next step:")).toContainText("Better Business Bureau", {
    timeout: 60_000,
  });
  await expect(chatTranscript.getByText(buildChatCaseProgressNarrationMessage("ftc_confirmed"))).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("BBB filing queued.")).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("bbb_queued"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(actionTracking.getByRole("form", { name: "Record manual filing" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run BBB autofill" })).toHaveCount(0);
  await expectUrlStaysOnChatAi(page);
}

/** Complete BBB fulfillment for Acme Retail via operator fulfillment UI (real click, not request.post). */
export async function completeBbbFulfillmentViaOperatorUi(operatorPage: Page): Promise<void> {
  await operatorPage.goto("/operator/fulfillment");
  await expect(operatorPage.getByRole("heading", { name: "Operator fulfillment queue" })).toBeVisible({
    timeout: 30_000,
  });

  const bbbItem = operatorPage.locator("li").filter({ hasText: "Acme Retail" }).first();
  await expect(bbbItem).toBeVisible({ timeout: 30_000 });
  await expect(bbbItem.getByText("Step: BBB filing")).toBeVisible();

  await bbbItem.locator('input[type="date"]').fill("2026-06-21");
  await bbbItem.getByPlaceholder("Portal confirmation or reference number").fill("e2e-ui-bbb-888");
  const completeResponsePromise = operatorPage.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/justice/bbb-filing/complete"),
    { timeout: 30_000 }
  );
  await bbbItem.getByRole("button", { name: "Mark fulfillment complete" }).click();
  const completeResponse = await completeResponsePromise;
  expect(completeResponse.ok()).toBeTruthy();
  const completeBody = (await completeResponse.json()) as { advanced?: boolean };
  expect(completeBody.advanced).toBe(true);

  await expect(operatorPage.locator("li").filter({ hasText: "BBB filing" })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(
    operatorPage
      .locator("li")
      .filter({ hasText: "State Attorney General filing" })
      .filter({ hasText: "Acme Retail" })
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Drive a signed-in consumer through chat-ai UI until State AG is queued for operator fulfillment.
 * Uses production chat gates and mock pipelines only — no direct client_state patches.
 * Operator completes owned BBB (consumer autofill is suppressed).
 */
export async function driveConsumerToStateAgQueuedFromChat(
  page: Page,
  operatorPage: Page
): Promise<void> {
  await driveConsumerToBbbQueuedFromChat(page, operatorPage);
  await completeBbbFulfillmentViaOperatorUi(operatorPage);

  const actionTracking = chatAiActionTracking(page);
  const chatTranscript = chatAiTranscript(page);
  await expect(actionTracking.getByText("Next step:")).toContainText("State Attorney General", {
    timeout: 60_000,
  });
  await expect(chatTranscript.getByText(buildChatCaseProgressNarrationMessage("bbb_confirmed"))).toBeVisible({
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
  // The guided demand letter workspace uses "Send confirmation…" (email/mail send), unlike the
  // portal-submission panels (BBB/FTC/State AG) which use "Portal confirmation…".
  await demandLetterItem
    .getByPlaceholder("Send confirmation or reference number")
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
  await driveConsumerToStateAgQueuedFromChat(consumerPage, operatorPage);

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

export function chatAiHandlingTrackingLine(page: Page): Locator {
  return page.locator("p").filter({
    has: page.locator("span.font-medium").filter({ hasText: "Handling tracking:" }),
  });
}

export function chatAiInput(page: Page): Locator {
  return page.locator("#chat-ai-input");
}

async function sendChatClosureMessage(page: Page, message: string): Promise<void> {
  const chatInput = chatAiInput(page);
  await expect(chatInput).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Send" })).toHaveText("Send", { timeout: 30_000 });
  await chatInput.click();
  await chatInput.fill(message);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("button", { name: "Send" }).click();
}

/**
 * Real chat path through operator UI completions to terminal resolution/outcome tracking.
 */
export async function driveConsumerToOwnedFulfillmentResolutionInChat(
  consumerPage: Page,
  operatorPage: Page
): Promise<void> {
  await driveConsumerToDemandLetterQueuedFromChat(consumerPage, operatorPage);
  await completeDemandLetterFulfillmentViaOperatorUi(operatorPage);

  const actionTracking = chatAiActionTracking(consumerPage);
  const chatTranscript = chatAiTranscript(consumerPage);
  const outcomeTrackingForm = consumerPage.getByRole("form", {
    name: "Outcome and follow-up tracking",
  });
  const handlingTrackingLine = chatAiHandlingTrackingLine(consumerPage);

  await expectUrlStaysOnChatAi(consumerPage);
  await expect(outcomeTrackingForm).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("demand_letter_sent"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("resolution_ready"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(handlingTrackingLine).toContainText(
    "Review follow-up timing and mark follow-up handled when complete.",
    { timeout: 15_000 }
  );
  await expect(actionTracking.getByText(`Outcome: ${OWNED_FULFILLMENT_RESOLUTION_OUTCOME_NOTE}`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(actionTracking.getByText(/Follow-up: flagged/)).toBeVisible({ timeout: 15_000 });
  await expect(actionTracking.getByRole("button", { name: "Mark follow-up handled" })).toBeVisible({
    timeout: 15_000,
  });
}

/** Mark follow-up handled via chat closure gate (real Send, not request.post). */
export async function markFollowUpHandledViaChat(page: Page): Promise<void> {
  const chatTranscript = chatAiTranscript(page);
  const handlingTrackingLine = chatAiHandlingTrackingLine(page);
  const actionTracking = chatAiActionTracking(page);

  const followUpClearResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "PATCH" &&
      res.url().includes("/api/justice/cases/") &&
      res.request().postDataJSON()?.client_state !== undefined,
    { timeout: 30_000 }
  );
  await sendChatClosureMessage(page, CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE);
  const followUpPatch = await followUpClearResponse;
  expect(followUpPatch.ok()).toBeTruthy();

  await expect(chatTranscript.getByText(CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    chatTranscript.getByText("I've marked follow-up as handled for this case.")
  ).toBeVisible({ timeout: 15_000 });
  await expect(handlingTrackingLine).toContainText("Tracking complete for now.", {
    timeout: 30_000,
  });
  await expect(actionTracking.getByRole("button", { name: "Archive case" })).toBeVisible({
    timeout: 30_000,
  });
  await expectUrlStaysOnChatAi(page);
}

/** Archive the active case via chat closure gate (real Send, not request.post). */
export async function archiveCaseViaChat(page: Page): Promise<void> {
  const archiveResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "PATCH" &&
      res.url().includes("/api/justice/cases/") &&
      typeof res.request().postDataJSON()?.archived_at === "string",
    { timeout: 30_000 }
  );
  await sendChatClosureMessage(page, CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE);
  const archivePatch = await archiveResponse;
  expect(archivePatch.ok()).toBeTruthy();

  await expect
    .poll(
      async () =>
        page.evaluate((caseIdKey) => sessionStorage.getItem(caseIdKey), STORAGE_CASE_ID),
      { timeout: 15_000 }
    )
    .toBeNull();

  await expectUrlStaysOnChatAi(page);
}

/** Assert chat shows a closed/archived consumer session with no active case loaded. */
export async function expectConsumerChatCaseArchivedClosed(page: Page): Promise<void> {
  const clearedCaseId = await page.evaluate(
    (caseIdKey) => sessionStorage.getItem(caseIdKey),
    STORAGE_CASE_ID
  );
  expect(clearedCaseId).toBeNull();

  await expect(page.getByRole("form", { name: "Outcome and follow-up tracking" })).not.toBeVisible({
    timeout: 15_000,
  });
  await expect(chatAiActionTracking(page)).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Demand letter queued with Surrenderless.")).not.toBeVisible({
    timeout: 15_000,
  });
  await expectUrlStaysOnChatAi(page);
}

/** Reload chat and confirm archived state persists without re-opening the case or duplicating narration. */
export async function expectConsumerChatStaysArchivedAfterReload(page: Page): Promise<void> {
  const chatTranscript = chatAiTranscript(page);

  await page.reload();
  await waitForClerkBrowserApiSession(page);

  await expectConsumerChatCaseArchivedClosed(page);

  expect(
    await chatTranscript
      .getByText(buildChatCaseProgressNarrationMessage("demand_letter_sent"))
      .count()
  ).toBe(0);
  expect(
    await chatTranscript
      .getByText(buildChatCaseProgressNarrationMessage("resolution_ready"))
      .count()
  ).toBe(0);
  expect(await chatTranscript.getByText(CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE).count()).toBe(0);
  expect(await chatTranscript.getByText(CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE).count()).toBe(0);
}

/** Restore the most recently archived case via chat restore gate (real Send, not request.post). */
export async function restoreMostRecentArchivedCaseViaChat(page: Page): Promise<void> {
  const restoreResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "PATCH" &&
      res.url().includes("/api/justice/cases/") &&
      res.request().postDataJSON()?.archived_at === null,
    { timeout: 30_000 }
  );
  await sendChatClosureMessage(page, CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE);
  const restorePatch = await restoreResponse;
  expect(restorePatch.ok()).toBeTruthy();

  await expect
    .poll(
      async () =>
        page.evaluate((caseIdKey) => sessionStorage.getItem(caseIdKey), STORAGE_CASE_ID),
      { timeout: 30_000 }
    )
    .toBeTruthy();

  const chatTranscript = chatAiTranscript(page);
  await expect(chatTranscript.getByText(CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(chatTranscript.getByText("I've restored your archived case for Acme Retail.")).toBeVisible({
    timeout: 30_000,
  });
  await expectUrlStaysOnChatAi(page);
}

/** Assert the restored case is active in chat with persisted transcript and tracking UI. */
export async function expectConsumerChatCaseRestoredActive(page: Page): Promise<void> {
  const restoredCaseId = await page.evaluate(
    (caseIdKey) => sessionStorage.getItem(caseIdKey),
    STORAGE_CASE_ID
  );
  expect(restoredCaseId).toBeTruthy();

  const chatTranscript = chatAiTranscript(page);
  await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)).toBeVisible({
    timeout: 30_000,
  });
  await expect(chatTranscript.getByText(CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE).last()).toBeVisible({
    timeout: 15_000,
  });
  const actionTracking = chatAiActionTracking(page);
  await expect(actionTracking).toBeVisible({ timeout: 30_000 });
  // Follow-up was cleared before archive; restored case must not reopen the outcome form.
  await expect(page.getByRole("form", { name: "Outcome and follow-up tracking" })).not.toBeVisible({
    timeout: 15_000,
  });
  await expect(chatAiHandlingTrackingLine(page)).toContainText("Tracking complete for now.", {
    timeout: 30_000,
  });
  await expect(actionTracking.getByRole("button", { name: "Archive case" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(actionTracking.getByText(`Outcome: ${OWNED_FULFILLMENT_RESOLUTION_OUTCOME_NOTE}`)).toBeVisible({
    timeout: 15_000,
  });
  await expectUrlStaysOnChatAi(page);

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
}

/** Reload chat and confirm restored case stays active without duplicate narration. */
export async function expectConsumerChatStaysRestoredAfterReload(page: Page): Promise<void> {
  const chatTranscript = chatAiTranscript(page);
  const demandLetterSent = buildChatCaseProgressNarrationMessage("demand_letter_sent");
  const resolutionReady = buildChatCaseProgressNarrationMessage("resolution_ready");

  await page.reload();
  await waitForClerkBrowserApiSession(page);

  await expectConsumerChatCaseRestoredActive(page);
  expect(await chatTranscript.getByText(demandLetterSent).count()).toBe(1);
  expect(await chatTranscript.getByText(resolutionReady).count()).toBe(1);
  expect(await chatTranscript.getByText(CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE).count()).toBe(1);
}

/** After archive, start a second Beta Corp case via chat intake commit (real UI path). */
export async function startSecondBetaCaseViaChatAfterArchive(page: Page): Promise<void> {
  const chatInput = chatAiInput(page);
  const chatTranscript = chatAiTranscript(page);

  await expect(chatInput).toBeVisible({ timeout: 30_000 });
  await waitForClerkBrowserApiSession(page);

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_BETA_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_BETA_USER_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    chatTranscript.getByText("Thanks — I've noted Beta Corp. What email should we use for updates on this case?")
  ).toBeVisible({ timeout: 15_000 });

  const continueButton = page.getByRole("button", { name: "Save and continue in chat" });
  // The signed-in account's verified email seeds the consumer's reply_email (persisted across
  // cases for the same user), so the consumer-email basic is already satisfied after the first
  // intake message and the button is enabled before the second message.
  await expect(continueButton).toBeEnabled({ timeout: 15_000 });

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_BETA_SECOND_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_BETA_SECOND_USER_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(continueButton).toBeEnabled({ timeout: 15_000 });

  const intakeCommitResponse = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/api/justice/cases"),
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_INTAKE_COMMIT_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  const created = await intakeCommitResponse;
  expect(created.ok()).toBeTruthy();
  const createdBody = (await created.json()) as { id?: string; intake?: { company_name?: string } };
  expect(createdBody.id).toBe(PLAYWRIGHT_MOCK_SECOND_CASE_ID);
  expect(createdBody.intake?.company_name).toBe("Beta Corp");

  await expect(page.getByText("I've saved your case.")).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () =>
        page.evaluate((caseIdKey) => sessionStorage.getItem(caseIdKey), STORAGE_CASE_ID),
      { timeout: 30_000 }
    )
    .toBe(PLAYWRIGHT_MOCK_SECOND_CASE_ID);
  await expectUrlStaysOnChatAi(page);
}

/** Ask chat to list active + archived cases (real Send; waits for list GETs). */
export async function listCasesViaChat(
  page: Page,
  expectedLinePatterns: RegExp[] = [/Beta Corp.*active/, /Acme Retail.*archived/]
): Promise<void> {
  const activeListResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "GET" &&
      /\/api\/justice\/cases(?:\?|$)/.test(res.url()) &&
      !res.url().includes("archived=1"),
    { timeout: 30_000 }
  );
  const archivedListResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "GET" &&
      res.url().includes("/api/justice/cases") &&
      res.url().includes("archived=1"),
    { timeout: 30_000 }
  );
  await sendChatClosureMessage(page, CHAT_CASE_SELECTION_LIST_MESSAGE);
  expect((await activeListResponse).ok()).toBeTruthy();
  expect((await archivedListResponse).ok()).toBeTruthy();

  const chatTranscript = chatAiTranscript(page);
  await expect(chatTranscript.getByText(CHAT_CASE_SELECTION_LIST_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(chatTranscript.getByText("Here are your cases:")).toBeVisible({ timeout: 30_000 });
  for (const pattern of expectedLinePatterns) {
    await expect(chatTranscript.getByText(pattern)).toBeVisible({ timeout: 15_000 });
  }
  await expectUrlStaysOnChatAi(page);
}

/** Assert selection never navigates to cases hub or other justice hubs. */
async function expectCaseSelectionStaysOnChatWithoutHubNav(
  page: Page,
  action: () => Promise<void>
): Promise<void> {
  const forbiddenPaths: string[] = [];
  const onNav = (frame: { url: () => string }) => {
    if (frame !== page.mainFrame()) return;
    let pathname = "";
    try {
      pathname = new URL(frame.url()).pathname;
    } catch {
      return;
    }
    if (
      pathname === "/justice/cases" ||
      pathname.startsWith("/justice/cases/") ||
      pathname === "/justice/preview" ||
      pathname === "/justice/packet" ||
      pathname === "/justice/handling"
    ) {
      forbiddenPaths.push(pathname);
    }
  };
  page.on("framenavigated", onNav);
  try {
    await action();
    await expectUrlStaysOnChatAi(page);
    expect(new URL(page.url()).pathname).toBe("/justice/chat-ai");
    expect(forbiddenPaths, `unexpected hub navigation: ${forbiddenPaths.join(", ")}`).toEqual([]);
  } finally {
    page.off("framenavigated", onNav);
  }
}

/**
 * After listing both cases as active (offer still says Acme is active), archive Acme via chat
 * without re-listing, then open Acme by company. Live status must restore via PATCH before hydration.
 */
export async function selectStaleListedAcmeCaseViaChatCompanyAfterArchive(
  page: Page
): Promise<void> {
  await archiveCaseViaChat(page);
  await expectConsumerChatCaseArchivedClosed(page);

  await expectCaseSelectionStaysOnChatWithoutHubNav(page, async () => {
    const restoreResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res.url().includes(`/api/justice/cases/${PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID}`) &&
        res.request().postDataJSON()?.archived_at === null,
      { timeout: 30_000 }
    );
    await sendChatClosureMessage(page, "Please open my Acme Retail case in chat.");
    const restorePatch = await restoreResponse;
    expect(restorePatch.ok()).toBeTruthy();

    await expect
      .poll(
        async () =>
          page.evaluate((caseIdKey) => sessionStorage.getItem(caseIdKey), STORAGE_CASE_ID),
        { timeout: 30_000 }
      )
      .toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);

    const chatTranscript = chatAiTranscript(page);
    await expect(
      chatTranscript
        .getByText(
          "I've restored your archived case for Acme Retail and opened it here in chat."
        )
        .last()
    ).toBeVisible({ timeout: 30_000 });
  });
}

/**
 * Select archived Acme (case 2 in dual-case list) via chat — real PATCH restore + hydrate.
 * Assumes list was offered with Beta active (#1) and Acme archived (#2).
 */
export async function selectArchivedAcmeCaseViaChatNumber(page: Page): Promise<void> {
  const transcriptProbe = await page.evaluate(async (caseId) => {
    const res = await fetch(`/api/justice/chat-messages?case_id=${encodeURIComponent(caseId)}`);
    const text = await res.text();
    return { status: res.status, text };
  }, PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
  expect(
    transcriptProbe.status,
    `Acme transcript probe failed: ${transcriptProbe.status} ${transcriptProbe.text}`
  ).toBe(200);
  const transcriptBody = JSON.parse(transcriptProbe.text) as { messages?: unknown[] };
  expect(Array.isArray(transcriptBody.messages)).toBeTruthy();
  expect((transcriptBody.messages ?? []).length).toBeGreaterThan(0);

  await expectCaseSelectionStaysOnChatWithoutHubNav(page, async () => {
    const restoreResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res.url().includes(`/api/justice/cases/${PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID}`) &&
        res.request().postDataJSON()?.archived_at === null,
      { timeout: 30_000 }
    );
    await sendChatClosureMessage(page, CHAT_CASE_SELECTION_OPEN_CASE_NUMBER_MESSAGE);
    const restorePatch = await restoreResponse;
    expect(restorePatch.ok()).toBeTruthy();

    await expect
      .poll(
        async () =>
          page.evaluate((caseIdKey) => sessionStorage.getItem(caseIdKey), STORAGE_CASE_ID),
        { timeout: 30_000 }
      )
      .toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);

    const chatTranscript = chatAiTranscript(page);
    await expect(
      chatTranscript.getByText(
        "I've restored your archived case for Acme Retail and opened it here in chat."
      )
    ).toBeVisible({ timeout: 30_000 });
  });
}

/** Select active Beta Corp case by company name while Acme is loaded in chat. */
export async function selectActiveBetaCaseViaChatCompany(page: Page): Promise<void> {
  const betaRestorePatches: string[] = [];
  const onRequest = (req: Request) => {
    if (req.method() !== "PATCH") return;
    if (!req.url().includes(`/api/justice/cases/${PLAYWRIGHT_MOCK_SECOND_CASE_ID}`)) return;
    const body = req.postDataJSON() as { archived_at?: unknown } | null;
    if (body && body.archived_at === null) {
      betaRestorePatches.push(req.url());
    }
  };
  page.on("request", onRequest);

  try {
    await expectCaseSelectionStaysOnChatWithoutHubNav(page, async () => {
      const getBetaResponse = page.waitForResponse(
        (res) =>
          res.request().method() === "GET" &&
          res.url().includes(`/api/justice/cases/${PLAYWRIGHT_MOCK_SECOND_CASE_ID}`),
        { timeout: 30_000 }
      );
      await sendChatClosureMessage(page, "Please open my Beta Corp case in chat.");
      expect((await getBetaResponse).ok()).toBeTruthy();

      await expect
        .poll(
          async () =>
            page.evaluate((caseIdKey) => sessionStorage.getItem(caseIdKey), STORAGE_CASE_ID),
          { timeout: 30_000 }
        )
        .toBe(PLAYWRIGHT_MOCK_SECOND_CASE_ID);

      const chatTranscript = chatAiTranscript(page);
      await expect(
        chatTranscript.getByText("I've opened your Beta Corp case here in chat.")
      ).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_BETA_USER_MESSAGE)
      ).toBeVisible({
        timeout: 30_000,
      });
    });
    expect(betaRestorePatches, "active Beta select must not send restore PATCH").toEqual([]);
  } finally {
    page.off("request", onRequest);
  }
}

/** Reload after multi-case selection and confirm Acme stays active without duplicate narration. */
export async function expectConsumerChatStaysOnSelectedAcmeAfterReload(page: Page): Promise<void> {
  const chatTranscript = chatAiTranscript(page);
  const demandLetterSent = buildChatCaseProgressNarrationMessage("demand_letter_sent");
  const resolutionReady = buildChatCaseProgressNarrationMessage("resolution_ready");

  await page.reload();
  await waitForClerkBrowserApiSession(page);

  await expect
    .poll(
      async () =>
        page.evaluate((caseIdKey) => sessionStorage.getItem(caseIdKey), STORAGE_CASE_ID),
      { timeout: 30_000 }
    )
    .toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);

  await expectConsumerChatCaseRestoredActive(page);
  expect(await chatTranscript.getByText(demandLetterSent).count()).toBe(1);
  expect(await chatTranscript.getByText(resolutionReady).count()).toBe(1);
  expect(await chatTranscript.getByText(CHAT_CASE_SELECTION_OPEN_CASE_NUMBER_MESSAGE).count()).toBe(1);
}
