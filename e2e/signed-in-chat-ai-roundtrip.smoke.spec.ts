import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
} from "./helpers/clerk-e2e";
import {
  PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE,
} from "@/lib/testing/playwrightMockIntakeChatPipeline";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("signed-in user completes intake, reviews draft, and reaches packet approval in chat", async ({
  page,
}) => {
  await page.goto("/justice/chat-ai");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();

  const chatInput = page.locator("#chat-ai-input");
  await expect(chatInput).toBeVisible({ timeout: 30_000 });

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE)).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "Company:" }).filter({ hasText: "Acme Retail" })
  ).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "What happened:" }).filter({ hasText: "Acme Retail" })
  ).toBeVisible();

  const continueButton = page.getByRole("button", { name: "Save and continue in chat" });
  await expect(continueButton).toBeDisabled();

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE)).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "Email:" }).filter({ hasText: "e2e-chat@example.com" })
  ).toBeVisible();

  await expect(page.getByText("What happens next")).toBeVisible();
  await expect(continueButton).toBeVisible();
  await expect(continueButton).toBeEnabled();

  await continueButton.click();

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(page.getByText("Review submission draft")).toBeVisible({ timeout: 15_000 });

  const draftPreview = page.locator("pre").filter({ hasText: "DRAFT FOR YOUR REVIEW" });
  await expect(draftPreview).toBeVisible();
  await expect(draftPreview).toContainText("Jordan Lee");
  await expect(draftPreview).toContainText("Acme Retail");
  await expect(page.getByRole("button", { name: "Mark draft reviewed" })).toBeVisible();

  const persisted = await page.evaluate(
    ({ intakeKey, caseIdKey }) => {
      const rawIntake = sessionStorage.getItem(intakeKey);
      const caseId = sessionStorage.getItem(caseIdKey)?.trim() ?? "";
      if (!rawIntake) return null;
      try {
        const intake = JSON.parse(rawIntake) as {
          company_name?: string;
          reply_email?: string;
          user_display_name?: string;
        };
        return {
          caseId,
          company_name: intake.company_name ?? "",
          reply_email: intake.reply_email ?? "",
          user_display_name: intake.user_display_name ?? "",
        };
      } catch {
        return null;
      }
    },
    {
      intakeKey: STORAGE_INTAKE,
      caseIdKey: STORAGE_CASE_ID,
    }
  );

  expect(persisted).not.toBeNull();
  expect(persisted?.caseId).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
  expect(persisted?.company_name).toBe("Acme Retail");
  expect(persisted?.reply_email).toBe("e2e-chat@example.com");
  expect(persisted?.user_display_name).toBe("Jordan Lee");

  const draftReviewBlock = page
    .locator("div")
    .filter({ hasText: "Review submission draft" })
    .filter({ has: page.getByRole("button", { name: "Mark draft reviewed" }) });
  await draftReviewBlock
    .getByRole("checkbox", { name: "I reviewed the submission draft shown above." })
    .check();
  await draftReviewBlock.getByRole("button", { name: "Mark draft reviewed" }).click();

  await expect(page).toHaveURL(/\/justice\/chat-ai/);
  await expect(page.getByText("Review submission draft")).not.toBeVisible({ timeout: 15_000 });

  const packetApproval = page.locator("#chat-ai-inline-prepared-packet-approval");
  await expect(packetApproval).toBeVisible({ timeout: 15_000 });
  await expect(
    packetApproval.locator("p.text-xs.font-medium").filter({ hasText: "Approve prepared packet" })
  ).toBeVisible();
  await expect(
    packetApproval.locator("pre").filter({ hasText: "JUSTICE CASE PACKET" })
  ).toBeVisible();
  await expect(packetApproval.locator("pre")).toContainText("Acme Retail");
  await expect(
    packetApproval.getByRole("checkbox", { name: "I reviewed this prepared packet" })
  ).toBeVisible();
  await expect(
    packetApproval.getByRole("button", { name: "Approve prepared packet" })
  ).toBeVisible();
  await expect(
    packetApproval.getByRole("button", { name: "Approve prepared packet" })
  ).toBeDisabled();
});
