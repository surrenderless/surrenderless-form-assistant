import { expect, request as playwrightRequest, type Page } from "@playwright/test";
import {
  PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE,
} from "@/lib/testing/playwrightMockIntakeChatPipeline";
import { CHAT_INTAKE_COMMIT_MESSAGE } from "@/lib/justice/chatIntakeCommitGates";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import {
  isOperatorClerkE2eConfigured,
  OPERATOR_CLERK_STORAGE_STATE_PATH,
  operatorClerkStorageStateExists,
  waitForClerkBrowserApiSession,
} from "./clerk-e2e";
import { expectUrlStaysOnChatAi } from "./chat-ai-ladder-continuity-e2e";
import { chatAiTranscript } from "./chat-ai-owned-fulfillment-e2e";

/** Drive signed-in chat through intake commit so evidence file upload is available. */
export async function driveConsumerToSavedCaseForEvidenceUpload(page: Page): Promise<void> {
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
  await expect
    .poll(
      async () =>
        page.evaluate((caseIdKey) => sessionStorage.getItem(caseIdKey), STORAGE_CASE_ID),
      { timeout: 30_000 }
    )
    .toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
  await expectUrlStaysOnChatAi(page);
}

/** Upload a PNG evidence file via the chat file input (real Send path uses production upload API). */
export async function uploadEvidenceFileViaChat(page: Page): Promise<{
  evidenceId: string;
}> {
  const fileInput = page.locator("#chat-ai-evidence-file");
  await expect(fileInput).toBeVisible({ timeout: 30_000 });

  const uploadResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" && res.url().includes("/api/justice/evidence/upload"),
    { timeout: 30_000 }
  );

  await fileInput.setInputFiles({
    name: "acme-refund-denial.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    ),
  });

  const uploaded = await uploadResponse;
  expect(uploaded.ok()).toBeTruthy();
  const body = (await uploaded.json()) as {
    id?: string;
    file_name?: string;
    mime_type?: string;
    file_path?: string;
    source_url?: string | null;
    title?: string;
  };
  expect(body.id).toBeTruthy();
  expect(body.file_name).toBe("acme-refund-denial.png");
  expect(body.mime_type).toBe("image/png");
  expect(body.file_path).toBeUndefined();
  expect(body.source_url == null || body.source_url === "").toBeTruthy();
  expect(JSON.stringify(body)).not.toMatch(/\/storage\/v1\/object\/public\//i);
  expect(JSON.stringify(body)).not.toMatch(/justice-evidence\//i);

  const chatTranscript = chatAiTranscript(page);
  await expect(
    chatTranscript.getByText('I\'ve attached "acme-refund-denial" to this case.')
  ).toBeVisible({ timeout: 30_000 });
  const recentProof = page.locator("details").filter({ hasText: "Recent proof notes" });
  await expect(recentProof).toBeVisible({ timeout: 15_000 });
  await recentProof.locator("summary").click();
  await expect(recentProof.getByText(/File:\s*acme-refund-denial\.png/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(recentProof.getByRole("link", { name: "Download file" })).toBeVisible();
  await expectUrlStaysOnChatAi(page);
  expect(page.url()).not.toContain("/justice/evidence");
  expect(page.url()).not.toContain("/justice/packet");
  expect(page.url()).not.toContain("/justice/handling");
  expect(page.url()).not.toContain("/justice/cases");

  return { evidenceId: body.id! };
}

/** Owner can access private file; unauthenticated / other-user callers cannot. */
export async function expectPrivateEvidenceFileAccess(
  page: Page,
  evidenceId: string
): Promise<void> {
  const ownerJson = await page.request.get(
    `/api/justice/evidence/${encodeURIComponent(evidenceId)}/file?format=json`
  );
  expect(ownerJson.ok()).toBeTruthy();
  const body = (await ownerJson.json()) as {
    signed_url?: string;
    file_name?: string;
  };
  expect(body.file_name).toBe("acme-refund-denial.png");
  expect(body.signed_url).toBeTruthy();
  expect(body.signed_url).not.toMatch(/\/storage\/v1\/object\/public\//i);
  expect(JSON.stringify(body)).not.toMatch(/file_path/i);
  expect(JSON.stringify(body)).not.toMatch(/justice-evidence\//i);

  const ownerStream = await page.request.get(
    `/api/justice/evidence/${encodeURIComponent(evidenceId)}/file`
  );
  expect(ownerStream.ok()).toBeTruthy();
  expect(ownerStream.headers()["content-disposition"] ?? "").toContain("acme-refund-denial.png");

  const origin = new URL(page.url()).origin;
  const unauthApi = await playwrightRequest.newContext({
    baseURL: origin,
    // Explicit empty state — Playwright may otherwise reuse ambient cookies.
    storageState: { cookies: [], origins: [] },
  });
  try {
    const denied = await unauthApi.get(
      `/api/justice/evidence/${encodeURIComponent(evidenceId)}/file?format=json`,
      { maxRedirects: 0 }
    );
    expect(denied.status()).toBe(401);
    expect(await denied.json()).toEqual({ error: "Not signed in" });
  } finally {
    await unauthApi.dispose();
  }

  // Non-owner session (operator when configured as a distinct Clerk user) must not read the file.
  if (isOperatorClerkE2eConfigured() && operatorClerkStorageStateExists()) {
    const otherUser = await page.context().browser()!.newContext({
      storageState: OPERATOR_CLERK_STORAGE_STATE_PATH,
    });
    try {
      const forbidden = await otherUser.request.get(
        `/api/justice/evidence/${encodeURIComponent(evidenceId)}/file?format=json`,
        { maxRedirects: 0 }
      );
      expect(forbidden.status()).toBe(404);
      expect(await forbidden.json()).toEqual({ error: "Not found" });
    } finally {
      await otherUser.close();
    }
  }

  await expectUrlStaysOnChatAi(page);
}

/** Reload chat and confirm uploaded evidence file metadata remains visible. */
export async function expectEvidenceFilePersistsAfterReload(page: Page): Promise<void> {
  await page.reload();
  await waitForClerkBrowserApiSession(page);

  await expect
    .poll(
      async () =>
        page.evaluate((caseIdKey) => sessionStorage.getItem(caseIdKey), STORAGE_CASE_ID),
      { timeout: 30_000 }
    )
    .toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);

  await expect(page.locator("#chat-ai-evidence-file")).toBeVisible({ timeout: 30_000 });
  const recentProof = page.locator("details").filter({ hasText: "Recent proof notes" });
  await expect(recentProof).toBeVisible({ timeout: 30_000 });
  await recentProof.locator("summary").click();
  await expect(recentProof.getByText(/File:\s*acme-refund-denial\.png/)).toBeVisible({
    timeout: 30_000,
  });

  const chatTranscript = chatAiTranscript(page);
  await expect(
    chatTranscript.getByText('I\'ve attached "acme-refund-denial" to this case.')
  ).toBeVisible({ timeout: 30_000 });
  await expectUrlStaysOnChatAi(page);
}
