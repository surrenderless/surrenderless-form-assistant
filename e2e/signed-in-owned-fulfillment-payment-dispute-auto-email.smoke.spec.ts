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
  seedActiveCasePaymentDisputeFilingStepWithIssuerEmail,
} from "./helpers/chat-ai-ladder-continuity-e2e";
import { chatAiTranscript } from "./helpers/chat-ai-owned-fulfillment-e2e";
import { buildChatCaseProgressNarrationMessage } from "@/lib/justice/chatCaseProgressNarration";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("owned payment dispute auto email delivery completes in chat without DIY controls", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await seedActiveCasePaymentDisputeFilingStepWithIssuerEmail(page);
  await waitForClerkBrowserApiSession(page);

  await expect(activeCaseChecklist(page).getByText("Evidence: yes")).toBeVisible({
    timeout: 30_000,
  });

  const tracking = page.locator("#chat-ai-approved-action-tracking");
  await tracking.scrollIntoViewIfNeeded();
  await expect(tracking).toBeVisible({ timeout: 30_000 });
  await expect(tracking.getByRole("form", { name: "Record manual filing" })).toHaveCount(0);
  await expectNoOptionalDestinationPrepOrEvidenceHubLinks(page.locator("main"));

  const chatTranscript = chatAiTranscript(page);
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("payment_dispute_confirmed"))
  ).toBeVisible({ timeout: 30_000 });

  await expectUrlStaysOnChatAi(page);
  await expect(tracking.getByRole("form", { name: "Record manual filing" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save contact|Mark .* filed/i })).toHaveCount(0);
  await expect(page.getByText("Payment dispute filing queued.")).toHaveCount(0);
});
