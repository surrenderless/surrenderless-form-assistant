import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  isOperatorClerkE2eConfigured,
  operatorClerkStorageStateExists,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  chatAiTranscript,
  driveConsumerToFtcQueuedFromChat,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_FICTIONAL_SECOND_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_FICTIONAL_USER_MESSAGE,
} from "./helpers/chat-ai-owned-fulfillment-e2e";
import { expectUrlStaysOnChatAi } from "./helpers/chat-ai-ladder-continuity-e2e";
import { CHAT_INTAKE_COMMIT_MESSAGE } from "@/lib/justice/chatIntakeCommitGates";
import { CHAT_START_NEW_CASE_MESSAGE } from "@/lib/justice/chatStartNewCaseGates";
import { MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import { OWNED_FILING_DRY_RUN_BLOCK_MARKER } from "@/lib/justice/ownedFilingDryRunState";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { PLAYWRIGHT_MOCK_SECOND_CASE_ID } from "@/lib/testing/playwrightMockJusticeChatMessagesOwnership";
import {
  PLAYWRIGHT_MOCK_FTC_TASK_ID,
  PLAYWRIGHT_MOCK_SECOND_CASE_FTC_TASK_ID,
} from "@/lib/testing/playwrightMockHumanFulfillmentLadderPipeline";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
  test.skip(
    !isOperatorClerkE2eConfigured() || !operatorClerkStorageStateExists(),
    "Skipped: operator Clerk E2E credentials required for fulfillment steps."
  );
});

type TaskRow = {
  id: string;
  case_id: string;
  notes: string | null;
  completed_at: string | null;
};

test("start a new case detaches the active case and creates an independent second case", async ({
  page,
}) => {
  test.setTimeout(360_000);

  await driveConsumerToFtcQueuedFromChat(page);
  await waitForClerkBrowserApiSession(page);

  const primaryCaseId = await page.evaluate(
    (key) => sessionStorage.getItem(key)?.trim() ?? "",
    STORAGE_CASE_ID
  );
  expect(primaryCaseId).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);

  const seededTasksRes = await page.request.get(
    `/api/justice/tasks?case_id=${encodeURIComponent(primaryCaseId)}`,
    { headers: { "x-playwright-seed-owned-filing-dry-run": "ftc" } }
  );
  expect(seededTasksRes.ok()).toBeTruthy();
  const seededTasks = (await seededTasksRes.json()) as TaskRow[];
  const primaryFtc = seededTasks.find(
    (row) => row.id === PLAYWRIGHT_MOCK_FTC_TASK_ID && !row.completed_at
  );
  expect(primaryFtc?.notes ?? "").toContain(OWNED_FILING_DRY_RUN_BLOCK_MARKER);
  expect(primaryFtc?.notes ?? "").toContain(`case_id: ${primaryCaseId}`);

  const primaryBefore = await page.request.get(
    `/api/justice/cases/${encodeURIComponent(primaryCaseId)}`
  );
  expect(primaryBefore.ok()).toBeTruthy();
  const primaryBeforeBody = (await primaryBefore.json()) as {
    id: string;
    intake?: { company_name?: string };
    archived_at?: string | null;
  };
  expect(primaryBeforeBody.intake?.company_name).toBe("Acme Retail");
  expect(primaryBeforeBody.archived_at ?? null).toBeNull();

  const chatInput = page.locator("#chat-ai-input");
  const chatTranscript = chatAiTranscript(page);

  let primaryPatched = false;
  page.on("request", (req) => {
    if (
      req.method() === "PATCH" &&
      req.url().includes(`/api/justice/cases/${PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID}`)
    ) {
      primaryPatched = true;
    }
  });

  await chatInput.fill(CHAT_START_NEW_CASE_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(chatTranscript.getByText(CHAT_START_NEW_CASE_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(chatTranscript.getByText(/still saved|not changed/i)).toBeVisible({
    timeout: 15_000,
  });
  await expect(chatTranscript.getByText(primaryCaseId)).toBeVisible({ timeout: 15_000 });
  await expectUrlStaysOnChatAi(page);

  const sessionAfterDetach = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    STORAGE_CASE_ID
  );
  expect(sessionAfterDetach).toBeNull();
  expect(primaryPatched).toBe(false);

  const primaryAfterDetach = await page.request.get(
    `/api/justice/cases/${encodeURIComponent(primaryCaseId)}`
  );
  expect(primaryAfterDetach.ok()).toBeTruthy();
  const primaryAfterBody = (await primaryAfterDetach.json()) as {
    id: string;
    intake?: { company_name?: string };
    archived_at?: string | null;
  };
  expect(primaryAfterBody.id).toBe(primaryCaseId);
  expect(primaryAfterBody.intake?.company_name).toBe("Acme Retail");
  expect(primaryAfterBody.archived_at ?? null).toBeNull();

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_FICTIONAL_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_FICTIONAL_USER_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator("li").filter({ hasText: "Company:" }).filter({ hasText: "Fictional Digital Services" })
  ).toBeVisible({ timeout: 15_000 });

  const continueButton = page.getByRole("button", { name: "Save and continue in chat" });
  await expect(continueButton).toBeEnabled({ timeout: 15_000 });

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_FICTIONAL_SECOND_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_FICTIONAL_SECOND_USER_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(continueButton).toBeEnabled();

  const createCaseResponse = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/api/justice/cases"),
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_INTAKE_COMMIT_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  const created = await createCaseResponse;
  expect(created.ok()).toBeTruthy();
  const createdBody = (await created.json()) as { id?: string; intake?: { company_name?: string } };
  expect(createdBody.id).toBe(PLAYWRIGHT_MOCK_SECOND_CASE_ID);
  expect(createdBody.intake?.company_name).toBe("Fictional Digital Services");
  await expect(page.getByText("I've saved your case.")).toBeVisible({ timeout: 15_000 });

  const sessionAfterCreate = await page.evaluate(
    (key) => sessionStorage.getItem(key)?.trim() ?? "",
    STORAGE_CASE_ID
  );
  expect(sessionAfterCreate).toBe(PLAYWRIGHT_MOCK_SECOND_CASE_ID);
  expect(sessionAfterCreate).not.toBe(primaryCaseId);

  const savedList = await page.request.get("/api/justice/cases");
  expect(savedList.ok()).toBeTruthy();
  const savedPayload = (await savedList.json()) as {
    cases?: Array<{
      id: string;
      intake?: { company_name?: string };
      archived_at?: string | null;
    }>;
  };
  const activeCases = (savedPayload.cases ?? []).filter((row) => !row.archived_at?.trim());
  expect(activeCases.some((row) => row.id === primaryCaseId)).toBe(true);
  expect(activeCases.some((row) => row.id === PLAYWRIGHT_MOCK_SECOND_CASE_ID)).toBe(true);

  const primaryStillUnchanged = await page.request.get(
    `/api/justice/cases/${encodeURIComponent(primaryCaseId)}`
  );
  expect(primaryStillUnchanged.ok()).toBeTruthy();
  const primaryStillBody = (await primaryStillUnchanged.json()) as {
    intake?: { company_name?: string };
  };
  expect(primaryStillBody.intake?.company_name).toBe("Acme Retail");

  const primaryTasksAfterCreate = await page.request.get(
    `/api/justice/tasks?case_id=${encodeURIComponent(primaryCaseId)}`
  );
  expect(primaryTasksAfterCreate.ok()).toBeTruthy();
  const primaryTasksAfter = (await primaryTasksAfterCreate.json()) as TaskRow[];
  const primaryFtcAfterCreate = primaryTasksAfter.find(
    (row) => row.id === PLAYWRIGHT_MOCK_FTC_TASK_ID && !row.completed_at
  );
  expect(primaryFtcAfterCreate?.notes ?? "").toContain(OWNED_FILING_DRY_RUN_BLOCK_MARKER);

  const secondTasksBeforeQueue = await page.request.get(
    `/api/justice/tasks?case_id=${encodeURIComponent(PLAYWRIGHT_MOCK_SECOND_CASE_ID)}`
  );
  expect(secondTasksBeforeQueue.ok()).toBeTruthy();
  expect(await secondTasksBeforeQueue.json()).toEqual([]);

  const queueSecondFtcRes = await page.request.patch(
    `/api/justice/cases/${encodeURIComponent(PLAYWRIGHT_MOCK_SECOND_CASE_ID)}`,
    {
      data: {
        client_state: {
          prepared_packet_approved: true,
          approved_next_action: {
            label: "FTC (consumer complaint)",
            href: MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
            status: "approved",
            approved_at: "2026-06-21T00:00:00.000Z",
          },
        },
      },
    }
  );
  expect(queueSecondFtcRes.ok()).toBeTruthy();

  const secondTasksRes = await page.request.get(
    `/api/justice/tasks?case_id=${encodeURIComponent(PLAYWRIGHT_MOCK_SECOND_CASE_ID)}`
  );
  expect(secondTasksRes.ok()).toBeTruthy();
  const secondTasks = (await secondTasksRes.json()) as TaskRow[];
  const secondFtc = secondTasks.find(
    (row) => row.id === PLAYWRIGHT_MOCK_SECOND_CASE_FTC_TASK_ID && !row.completed_at
  );
  expect(secondFtc).toBeTruthy();
  expect(secondFtc!.id).not.toBe(PLAYWRIGHT_MOCK_FTC_TASK_ID);
  expect(secondFtc!.case_id).toBe(PLAYWRIGHT_MOCK_SECOND_CASE_ID);
  expect(secondFtc!.notes ?? "").toContain(`ftc_filing_queue:${PLAYWRIGHT_MOCK_SECOND_CASE_ID}`);
  expect(secondFtc!.notes ?? "").not.toContain(OWNED_FILING_DRY_RUN_BLOCK_MARKER);
  expect(secondFtc!.notes ?? "").not.toContain(`case_id: ${primaryCaseId}`);
});
