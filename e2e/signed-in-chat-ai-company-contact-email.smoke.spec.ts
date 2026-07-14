import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_COMPANY_CONTACT_EMAIL_ASSISTANT_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_COMPANY_CONTACT_EMAIL_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE,
} from "@/lib/testing/playwrightMockIntakeChatPipeline";
import { CHAT_INTAKE_COMMIT_MESSAGE } from "@/lib/justice/chatIntakeCommitGates";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("chat-first company_contact_email persists on intake commit for merchant outreach", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/justice/chat-ai");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();

  const chatInput = page.locator("#chat-ai-input");
  await expect(chatInput).toBeVisible({ timeout: 30_000 });
  await waitForClerkBrowserApiSession(page);

  const chatTranscript = page
    .locator("div:has(> textarea#chat-ai-input)")
    .locator("xpath=preceding-sibling::div[1]");

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE)).toBeVisible();

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE)).toBeVisible();

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_COMPANY_CONTACT_EMAIL_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_COMPANY_CONTACT_EMAIL_USER_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_COMPANY_CONTACT_EMAIL_ASSISTANT_MESSAGE)
  ).toBeVisible();
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Company contact email:" })
      .filter({ hasText: "support@acme-retail.example" })
  ).toBeVisible();

  const continueButton = page.getByRole("button", { name: "Save and continue in chat" });
  await expect(continueButton).toBeEnabled();

  const intakeCommitResponse = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/api/justice/cases"),
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_INTAKE_COMMIT_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  const commitResponse = await intakeCommitResponse;
  expect(commitResponse.ok()).toBeTruthy();
  const commitBody = commitResponse.request().postDataJSON() as {
    intake?: { company_contact_email?: string; reply_email?: string };
  };
  expect(commitBody.intake?.company_contact_email).toBe("support@acme-retail.example");
  expect(commitBody.intake?.reply_email).toBe("e2e-chat@example.com");

  await expect(page.getByText("I've saved your case.")).toBeVisible({ timeout: 15_000 });

  const persisted = await page.evaluate(
    ({ intakeKey, caseIdKey }) => {
      const rawIntake = sessionStorage.getItem(intakeKey);
      const caseId = sessionStorage.getItem(caseIdKey)?.trim() ?? "";
      if (!rawIntake) return null;
      try {
        const intake = JSON.parse(rawIntake) as { company_contact_email?: string };
        return { caseId, company_contact_email: intake.company_contact_email ?? "" };
      } catch {
        return null;
      }
    },
    { intakeKey: STORAGE_INTAKE, caseIdKey: STORAGE_CASE_ID }
  );
  expect(persisted?.company_contact_email).toBe("support@acme-retail.example");
  expect(persisted?.caseId).toBeTruthy();
});
