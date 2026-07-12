import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  expectNoRequiredMainLadderOffChatLinks,
  expectUrlStaysOnChatAi,
} from "./helpers/chat-ai-ladder-continuity-e2e";
import {
  driveConsumerToSavedCaseForEvidenceUpload,
  uploadEvidenceFileViaChat,
} from "./helpers/chat-ai-evidence-upload-e2e";
import { chatAiTranscript } from "./helpers/chat-ai-owned-fulfillment-e2e";
import {
  CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE,
  CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE,
} from "@/lib/justice/chatLegalConsentGates";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("after evidence upload, consumer reviews draft and approves packet without leaving chat-ai", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await driveConsumerToSavedCaseForEvidenceUpload(page);
  await uploadEvidenceFileViaChat(page);
  await expectUrlStaysOnChatAi(page);

  const draftReview = page.locator("#chat-ai-inline-submission-draft-review");
  await expect(draftReview).toBeVisible({ timeout: 30_000 });
  await expect(draftReview.locator("pre").filter({ hasText: "DRAFT FOR YOUR REVIEW" })).toBeVisible();
  await expect(draftReview.getByRole("button", { name: "Copy draft" })).toBeVisible();
  await expect(draftReview.getByRole("button", { name: "Generate AI-assisted draft" })).toBeVisible();
  await expect(draftReview.getByRole("link", { name: "Open full submission preview" })).toHaveCount(0);
  await expect(draftReview.locator('a[href="/justice/preview"]')).toHaveCount(0);

  const chatInput = page.locator("#chat-ai-input");
  const chatTranscript = chatAiTranscript(page);

  const draftReviewedResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/justice/submission-draft-reviewed"),
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  expect((await draftReviewedResponse).ok()).toBeTruthy();
  await expect(
    chatTranscript.getByText(CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Submission draft reviewed: yes")).toBeVisible({ timeout: 30_000 });
  await expectUrlStaysOnChatAi(page);

  const packetApproval = page.locator("#chat-ai-inline-prepared-packet-approval");
  await expect(packetApproval).toBeVisible({ timeout: 30_000 });
  await expect(packetApproval.locator("pre").filter({ hasText: "JUSTICE CASE PACKET" })).toBeVisible();
  const showMorePacket = packetApproval.getByRole("button", { name: "Show more" });
  if (await showMorePacket.isVisible().catch(() => false)) {
    await showMorePacket.click();
  }
  await expect(packetApproval.locator("pre")).toContainText(/acme-refund-denial/i);
  await expect(packetApproval.getByRole("button", { name: "Copy packet" })).toBeVisible();
  await expect(packetApproval.getByRole("link", { name: "Open full packet page" })).toHaveCount(0);
  await expect(packetApproval.locator('a[href="/justice/packet"]')).toHaveCount(0);

  const checklist = page.getByRole("status", { name: "Active case" }).locator("ul").first();
  await expectNoRequiredMainLadderOffChatLinks(checklist);

  await chatInput.fill(CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    chatTranscript.getByText(CHAT_LEGAL_CONSENT_PREPARED_PACKET_APPROVAL_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(packetApproval).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Prepared case packet reviewed: yes")).toBeVisible({
    timeout: 30_000,
  });
  await expectUrlStaysOnChatAi(page);
  expect(page.url()).not.toContain("/justice/preview");
  expect(page.url()).not.toContain("/justice/packet");
});
