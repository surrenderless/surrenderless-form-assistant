import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  activeCaseChecklist,
  expectNoOptionalDestinationPrepOrEvidenceHubLinks,
  expectUrlStaysOnChatAi,
  seedActiveCaseDemandLetterFilingStepWithCompanyEmail,
} from "./helpers/chat-ai-ladder-continuity-e2e";
import { chatAiActionTracking, chatAiTranscript } from "./helpers/chat-ai-owned-fulfillment-e2e";
import { buildChatCaseProgressNarrationMessage } from "@/lib/justice/chatCaseProgressNarration";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("owned demand letter auto email delivery completes in chat without DIY or operator UI", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await seedActiveCaseDemandLetterFilingStepWithCompanyEmail(page);
  await waitForClerkBrowserApiSession(page);

  await expect(activeCaseChecklist(page).getByText("Evidence: yes")).toBeVisible({
    timeout: 30_000,
  });

  const tracking = chatAiActionTracking(page);
  await tracking.scrollIntoViewIfNeeded();
  await expect(tracking).toBeVisible({ timeout: 30_000 });
  await expect(tracking.getByRole("form", { name: "Record manual filing" })).toHaveCount(0);
  await expectNoOptionalDestinationPrepOrEvidenceHubLinks(page.locator("main"));

  const chatTranscript = chatAiTranscript(page);
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("demand_letter_sent"))
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    chatTranscript.getByText(buildChatCaseProgressNarrationMessage("resolution_ready"))
  ).toBeVisible({ timeout: 30_000 });

  const expectedOutcomeNote =
    "Escalation complete for Acme Retail (widget order). BBB, State AG, and demand letter steps recorded. Awaiting responses.";
  const outcomeTrackingForm = page.getByRole("form", {
    name: "Outcome and follow-up tracking",
  });
  await expect(outcomeTrackingForm).toBeVisible({ timeout: 30_000 });
  await expect(tracking.getByText(`Outcome: ${expectedOutcomeNote}`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    outcomeTrackingForm.getByPlaceholder("What happened, or what should Surrenderless track next?")
  ).toHaveValue(expectedOutcomeNote);

  await expect(page.getByText("Demand letter sent.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Demand letter queued with Surrenderless.")).toHaveCount(0);
  await expect(page.getByText("Demand letter sending.")).toHaveCount(0);

  await expectUrlStaysOnChatAi(page);
  await expect(tracking.getByRole("form", { name: "Record manual filing" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save contact|Mark .* filed/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open full .+ page|Open approved step/i })).toHaveCount(
    0
  );
});
