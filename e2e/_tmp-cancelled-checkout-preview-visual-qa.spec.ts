import { expect, test } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import fs from "fs";
import path from "path";
import { clerkE2eUserIdentifier, waitForClerkBrowserApiSession } from "./helpers/clerk-e2e";
import { buildPlaywrightMockE2eCaseIntake } from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";

/**
 * One-off, throwaway visual QA against PR #1021's live Vercel Preview deployment — not part of
 * the permanent suite, never merged. Signs in fresh (this origin has no baked-in storageState)
 * and drives the cancelled-checkout notice through a fully page.route-mocked random-UUID case,
 * identical in technique to the merged
 * e2e/signed-in-chat-ai-deep-link-hydration-guards.smoke.spec.ts test, so the only real network
 * traffic against the Preview's backend is Clerk sign-in itself plus the provably read-only
 * GET /api/justice/cases?e2eSessionProbe=1 session probe. No real Stripe Checkout session is ever
 * created — the Approve button is asserted visible/enabled but never clicked.
 */

const PREVIEW_URL = "https://surrenderless-form-assistant-dzec-fz1vihg1d.vercel.app";
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const SCREENSHOT_DIR = path.join("test-results", "visual-qa");
const STORAGE_SUBMISSION_DRAFT_REVIEWED_V1 = "justice_submission_draft_reviewed_v1";
const CANCELLED_NOTICE_SELECTOR = "#chat-ai-checkout-cancelled-notice";
const CANCELLED_NOTICE_TEXT =
  /Checkout wasn't completed\. We don't see a confirmed payment/;

test.use({ baseURL: PREVIEW_URL });

async function captureBothViewports(
  page: import("@playwright/test").Page,
  slug: string
): Promise<void> {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${slug}-desktop.png`), fullPage: true });
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${slug}-mobile.png`), fullPage: true });
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test("cancelled-checkout notice visual QA on the live PR #1021 Preview deployment", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await clerkSetup();
  await page.goto("/");
  await clerk.signIn({
    page,
    signInParams: {
      strategy: "password",
      identifier: clerkE2eUserIdentifier(),
      password: process.env.E2E_CLERK_USER_PASSWORD!.trim(),
    },
  });

  const caseId = crypto.randomUUID();
  const intake = { ...buildPlaywrightMockE2eCaseIntake(), company_contact_email: "merchant@example.com" };

  await page.goto("/justice/chat-ai");
  await waitForClerkBrowserApiSession(page);

  await page.evaluate(
    ({ caseId, intake, storageCaseIdKey, storageIntakeKey, draftReviewedKey }) => {
      sessionStorage.setItem(storageCaseIdKey, caseId);
      sessionStorage.setItem(storageIntakeKey, JSON.stringify(intake));
      sessionStorage.setItem(draftReviewedKey, JSON.stringify({ [caseId]: true }));
    },
    {
      caseId,
      intake,
      storageCaseIdKey: STORAGE_CASE_ID,
      storageIntakeKey: STORAGE_INTAKE,
      draftReviewedKey: STORAGE_SUBMISSION_DRAFT_REVIEWED_V1,
    }
  );

  async function routeCaseGet(paidAt: string | null): Promise<void> {
    await page.route(`**/api/justice/cases/${caseId}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: caseId,
          intake,
          client_state: {},
          timeline: [],
          archived_at: null,
          paid_at: paidAt,
        }),
      });
    });
  }
  await routeCaseGet(null);
  await page.route(`**/api/justice/cases/${caseId}/checkout`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ unitAmount: 4900, currency: "usd" }),
    });
  });
  const escapedCaseId = caseId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [resource, body] of [
    ["evidence", "[]"],
    ["filings", "[]"],
    ["tasks", "[]"],
    ["chat-messages", JSON.stringify({ messages: [] })],
  ] as const) {
    await page.route(new RegExp(`/api/justice/${resource}\\?case_id=${escapedCaseId}$`), async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body });
    });
  }

  // ---- Scenario A: unpaid case returns from cancelled Checkout ----
  await page.goto(`/justice/chat-ai?case=${caseId}&checkout=cancelled`);
  await waitForClerkBrowserApiSession(page);
  const notice = page.locator(CANCELLED_NOTICE_SELECTOR);
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toHaveText(CANCELLED_NOTICE_TEXT);
  await expect.poll(() => page.url()).not.toContain("checkout=");
  expect(page.url()).toContain(`case=${caseId}`);
  const packetApproval = page.locator("#chat-ai-inline-prepared-packet-approval");
  await expect(packetApproval).toBeVisible({ timeout: 30_000 });
  const approveButton = packetApproval.getByRole("button", { name: "Approve prepared packet" });
  await expect(approveButton).toBeVisible();
  await captureBothViewports(page, "A-cancelled-unpaid-notice-with-retry");

  // ---- Scenario B: paid-state race protection (notice must NOT appear) ----
  await routeCaseGet(new Date().toISOString());
  await page.goto(`/justice/chat-ai?case=${caseId}&checkout=cancelled`);
  await waitForClerkBrowserApiSession(page);
  await page.waitForTimeout(1_500);
  await expect(page.locator(CANCELLED_NOTICE_SELECTOR)).toHaveCount(0);
  await expect.poll(() => page.url()).not.toContain("checkout=");
  await captureBothViewports(page, "B-paid-race-no-notice");

  // ---- Scenario C: successful-checkout return unaffected ----
  await page.goto(`/justice/chat-ai?case=${caseId}&checkout=success`);
  await waitForClerkBrowserApiSession(page);
  await page.waitForTimeout(1_500);
  await expect(page.locator(CANCELLED_NOTICE_SELECTOR)).toHaveCount(0);
  await captureBothViewports(page, "C-success-return-no-notice");
});
