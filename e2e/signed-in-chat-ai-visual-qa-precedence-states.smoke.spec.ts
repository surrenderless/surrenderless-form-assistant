import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  resetPlaywrightMockActiveCaseIfAny,
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  chatAiTranscript,
  chatAiActionTracking,
  expandChatAiDetailedTracking,
  expandChatAiComposer,
} from "./helpers/chat-ai-owned-fulfillment-e2e";
import {
  PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE,
} from "@/lib/testing/playwrightMockIntakeChatPipeline";
import { CHAT_INTAKE_COMMIT_MESSAGE } from "@/lib/justice/chatIntakeCommitGates";
import { CHAT_LEGAL_CONSENT_SUBMISSION_DRAFT_REVIEW_MESSAGE } from "@/lib/justice/chatLegalConsentGates";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import {
  seedActiveCaseDemandLetterFilingStepNeedsRecipient,
  seedActiveCaseMerchantFilingStep,
} from "./helpers/chat-ai-ladder-continuity-e2e";
import {
  hydrateChatAiSessionForRealBbbAutofill,
  seedPlaywrightMockCaseForRealBbbChatAutofill,
} from "./helpers/real-bbb-chat-autofill-e2e";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

// Deterministic viewport sizes for the two required device classes — not Playwright device
// presets (which also change UA/touch emulation, irrelevant here), just the two widths that
// matter for this app's Tailwind breakpoints.
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

const SCREENSHOT_DIR = path.join("test-results", "visual-qa");

async function captureBothViewports(page: Page, slug: string): Promise<void> {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${slug}-desktop.png`),
    fullPage: true,
  });
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${slug}-mobile.png`),
    fullPage: true,
  });
  // Restore desktop before any further chat interaction in this test — the composer's
  // <details> disclosure and other layout is unaffected by viewport, but keeps subsequent
  // locator waits consistent with how the rest of the authenticated suite runs.
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

/**
 * Full-page desktop + mobile screenshots of chat-ai's 7 next-action precedence states, driven
 * entirely through the same deterministic mock-case Playwright fixtures the rest of the
 * authenticated e2e suite uses (PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID, mock chat/intake
 * pipelines) — no live Stripe, no real Supabase writes beyond the existing mock stores, and no
 * data left behind (the deterministic case is reset before this test's own setup and again,
 * verified, after the last screenshot).
 */
test.describe("chat-ai precedence states visual QA", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test("captures full-page desktop and mobile screenshots for every precedence state", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // ---- State 1: incomplete basics ----
    // Establish a real, hydrated Clerk browser session before the first authenticated API call —
    // storageState alone (no prior navigation) is not sufficient for server-side auth checks to
    // reliably see the session yet.
    await page.goto("/justice/chat-ai");
    await waitForClerkBrowserApiSession(page);
    // This intends a genuinely blank intake — detach any case a prior test left active so
    // chat-ai's resume-on-mount fallback can't silently resume it instead.
    await resetPlaywrightMockActiveCaseIfAny(page);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();

    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);

    const continueButton = page.getByRole("button", { name: "Save and continue in chat" });
    await expect(continueButton).toBeDisabled();
    await captureBothViewports(page, "1-incomplete-basics");

    // ---- State 2: basics ready, case not yet committed ----
    const chatTranscript = chatAiTranscript(page);

    await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(
      chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE)).toBeVisible();
    await expect(continueButton).toBeEnabled({ timeout: 15_000 });

    await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(
      chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE)
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE)).toBeVisible();
    await expect(continueButton).toBeEnabled();
    await expect(page.getByText("I've saved your case.")).toHaveCount(0);
    await captureBothViewports(page, "2-basics-ready");

    // ---- State 3: draft review (immediately follows case commit) ----
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
        async () => page.evaluate((key) => sessionStorage.getItem(key), STORAGE_CASE_ID),
        { timeout: 30_000 }
      )
      .toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);

    const draftReview = page.locator("#chat-ai-inline-submission-draft-review");
    await expect(draftReview).toBeVisible({ timeout: 30_000 });
    await captureBothViewports(page, "3-draft-review");

    // ---- State 4: packet approval (mark draft reviewed, stop before approving the packet) ----
    await expandChatAiComposer(page);
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

    const packetApproval = page.locator("#chat-ai-inline-prepared-packet-approval");
    await expect(packetApproval).toBeVisible({ timeout: 30_000 });
    await captureBothViewports(page, "4-packet-approval");

    // ---- State 5: demand-letter recipient required ----
    await seedActiveCaseDemandLetterFilingStepNeedsRecipient(page);
    await waitForClerkBrowserApiSession(page);
    await expect(
      page.getByText("We need the company's email to send your demand letter.")
    ).toBeVisible({ timeout: 30_000 });
    await captureBothViewports(page, "5-demand-letter-recipient-required");

    // ---- State 6: merchant-contact recipient required ----
    await seedActiveCaseMerchantFilingStep(page);
    await waitForClerkBrowserApiSession(page);
    await expect(
      page.getByText("We need the company's email to send your first contact.")
    ).toBeVisible({ timeout: 30_000 });
    await captureBothViewports(page, "6-merchant-contact-recipient-required");

    // ---- State 7: passive tracking (approved + queued action, no dedicated input needed) ----
    await page.route("**://www.bbb.org/**", () => {
      throw new Error("Live BBB navigation must not occur during Playwright E2E.");
    });
    const { caseId, intake } = await seedPlaywrightMockCaseForRealBbbChatAutofill(page);
    await hydrateChatAiSessionForRealBbbAutofill(page, { caseId, intake });
    await expect(page.locator("#chat-ai-transcript")).toBeVisible({ timeout: 30_000 });

    const tracking = chatAiActionTracking(page);
    await expandChatAiDetailedTracking(tracking);
    await expect(page.getByText("BBB filing in progress.")).toBeVisible({ timeout: 30_000 });
    await captureBothViewports(page, "7-passive-tracking");

    // ---- Cleanup, verified ----
    // State 7's "pending human fulfillment" tracking mounts a live 2s window.setInterval
    // (CHAT_PENDING_HUMAN_FULFILLMENT_POLL_MS, page.tsx) that keeps re-syncing the case from the
    // server for as long as chat-ai stays mounted on this case — racing against reset below and
    // recreating the very snapshot it's trying to remove. Navigate off chat-ai first so that
    // effect unmounts (its own cleanup clears the interval) before resetting.
    await page.goto("/justice");
    // resetPlaywrightMockActiveCaseIfAny already throws if the deterministic case is still
    // resumable afterward; the explicit GET below additionally surfaces that confirmation in the
    // test report itself rather than only in a passing/failing assertion inside the helper.
    await resetPlaywrightMockActiveCaseIfAny(page);
    const postCleanupList = await page.request.get("/api/justice/cases");
    expect(postCleanupList.ok()).toBeTruthy();
    const postCleanupBody = (await postCleanupList.json()) as {
      cases?: Array<{ id: string }>;
    };
    const stillPresent = (postCleanupBody.cases ?? []).some(
      (row) => row.id === PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID
    );
    expect(stillPresent, "deterministic visual-QA case must not survive cleanup").toBe(false);
  });
});
