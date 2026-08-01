import { expect, test } from "@playwright/test";
import {
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  expectNoOptionalDestinationPrepOrEvidenceHubLinks,
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

  // TEMPORARY diagnostic: capture the JS call stack of any fetch() that PATCHes
  // /api/justice/cases/ with a body claiming prepared_packet_approved:true, and relay it to
  // Node test output. Playwright's trace console capture has not surfaced any call to the
  // known production producer despite the PATCH provably occurring, so this bypasses trace
  // capture entirely via an exposed binding. Logs only the request URL, a timestamp, and the
  // stack — never the request body or any user/chat content. Must be wired before any
  // navigation so the init script attaches to the very first document.
  await page.exposeBinding(
    "__e2ePatchStackRelay",
    (_source, payload: { url: string; time: number; stack: string }) => {
      console.log(
        `[e2e-fetch-diag] PATCH prepared_packet_approved:true url=${payload.url} time=${payload.time}\n${payload.stack}`
      );
    }
  );
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      try {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        const body = init?.body;
        if (
          method === "PATCH" &&
          url.includes("/api/justice/cases/") &&
          typeof body === "string" &&
          body.includes('"prepared_packet_approved":true')
        ) {
          const stack = new Error().stack ?? "";
          const time = Date.now();
          void (
            window as unknown as {
              __e2ePatchStackRelay: (p: { url: string; time: number; stack: string }) => void;
            }
          ).__e2ePatchStackRelay({ url, time, stack });
        }
      } catch {
        // Diagnostics must never break the real fetch call.
      }
      return originalFetch(input, init);
    };
  });

  await driveConsumerToSavedCaseForEvidenceUpload(page);
  await uploadEvidenceFileViaChat(page);
  await expectUrlStaysOnChatAi(page);

  const draftReview = page.locator("#chat-ai-inline-submission-draft-review");
  await expect(draftReview).toBeVisible({ timeout: 30_000 });
  const draftBody = draftReview.locator("pre").filter({ hasText: "DRAFT FOR YOUR REVIEW" });
  await expect(draftBody).toBeVisible();
  const showMoreDraft = draftReview.getByRole("button", { name: "Show more" });
  if (await showMoreDraft.isVisible().catch(() => false)) {
    await showMoreDraft.click();
  }
  await expect(draftBody).toContainText(/Surrenderless carries the next owned outreach and filings/i);
  await expect(draftBody).not.toContainText(/file outside Surrenderless/i);
  await expect(draftBody).not.toContainText(/Evidence page/i);
  await expect(draftReview.getByText(/approve your prepared packet so Surrenderless can carry owned/i)).toBeVisible();
  await expect(draftReview.getByRole("button", { name: "Copy draft for your records" })).toBeVisible();
  await expect(draftReview.getByRole("button", { name: "Generate AI-assisted draft" })).toBeVisible();
  await expect(draftReview.getByRole("link", { name: "Open full submission preview" })).toHaveCount(0);
  await expect(draftReview.locator('a[href="/justice/preview"]')).toHaveCount(0);
  await expect(draftReview.locator('a[href="/justice/evidence"]')).toHaveCount(0);

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
  await expectNoOptionalDestinationPrepOrEvidenceHubLinks(page.locator("main"));

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
  await expectNoOptionalDestinationPrepOrEvidenceHubLinks(page.locator("main"));
  expect(page.url()).not.toContain("/justice/preview");
  expect(page.url()).not.toContain("/justice/packet");
});
