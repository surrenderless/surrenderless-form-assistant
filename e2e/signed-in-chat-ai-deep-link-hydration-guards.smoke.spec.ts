import { expect, test, type Page } from "@playwright/test";
import {
  resetPlaywrightMockActiveCaseIfAny,
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import { STORAGE_STAGED_PROOF_NOTES_V1 } from "@/lib/justice/stagedProofNotes";
import { PLAYWRIGHT_MOCK_SECOND_CASE_ID } from "@/lib/testing/playwrightMockJusticeChatMessagesOwnership";
import { buildPlaywrightMockE2eCaseIntake } from "@/lib/testing/playwrightMockIntakeCaseHydrationPipeline";

// Mirrors the page-local (unexported) key in src/app/justice/chat-ai/page.tsx — matches the same
// redeclaration pattern already used by e2e/helpers/chat-ai-ladder-continuity-e2e.ts.
const STORAGE_SUBMISSION_DRAFT_REVIEWED_V1 = "justice_submission_draft_reviewed_v1";

// Doesn't need to resolve to a real task — both guards under test fire before the deep link's
// case/task lookup ever runs, so a well-formed UUID is all `parseReviewTaskDeepLinkParams`
// requires to route into the effect's hydrate branch.
const OTHER_CASE_REVIEW_TASK_ID = "00000000-0000-4000-8000-000000000001";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

/** Land on a genuinely fresh, uncommitted, signed-in chat-ai session — no case, no draft. */
async function bootstrapFreshUncommittedSession(page: Page): Promise<void> {
  await resetPlaywrightMockActiveCaseIfAny(page);
  await page.goto("/justice/chat-ai");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();

  const chatInput = page.locator("#chat-ai-input");
  await expect(chatInput).toBeVisible({ timeout: 30_000 });
  await waitForClerkBrowserApiSession(page);
}

/** Stage a proof note via the chat-ai UI (only reachable with no case committed/loaded yet). */
async function stageProofNote(page: Page): Promise<void> {
  await page.getByText("Add a proof note").click();
  await page.locator("#chat-ai-proof-title").fill("Screenshot of a new billing error");
  await page.getByRole("button", { name: "Stage proof note" }).click();
  await expect(page.getByText("Proof note staged on this device.")).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(
      async () => page.evaluate((key) => sessionStorage.getItem(key), STORAGE_STAGED_PROOF_NOTES_V1),
      { timeout: 15_000 }
    )
    .not.toBeNull();
}

test.describe("signed-in chat-ai deep-link hydration guards", () => {
  test("a review-task deep link does not hydrate a different case while a proof note is staged", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await bootstrapFreshUncommittedSession(page);
    await stageProofNote(page);

    // The pre-fetch guard must stop the effect before it ever looks the linked case up.
    let caseLookupRequested = false;
    await page.route(
      `**/api/justice/cases/${PLAYWRIGHT_MOCK_SECOND_CASE_ID}`,
      async (route) => {
        caseLookupRequested = true;
        await route.continue();
      }
    );

    await page.goto(
      `/justice/chat-ai?case=${PLAYWRIGHT_MOCK_SECOND_CASE_ID}&task=${OTHER_CASE_REVIEW_TASK_ID}`
    );
    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);

    // Give the (correctly-blocked) effect a moment to have hydrated/fetched if it were going to.
    await page.waitForTimeout(1_500);

    expect(
      caseLookupRequested,
      "staged-note guard must stop the deep link before it looks the case up"
    ).toBe(false);

    const caseIdAfterDeepLink = await page.evaluate(
      (key) => sessionStorage.getItem(key)?.trim() ?? "",
      STORAGE_CASE_ID
    );
    expect(caseIdAfterDeepLink).toBe("");

    const stagedAfterDeepLink = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      STORAGE_STAGED_PROOF_NOTES_V1
    );
    expect(stagedAfterDeepLink).not.toBeNull();
    expect(JSON.parse(stagedAfterDeepLink!)).toHaveLength(1);
  });

  test("a checkout-return redirect does not hydrate a different case while a proof note is staged", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await bootstrapFreshUncommittedSession(page);
    await stageProofNote(page);

    // The pre-fetch guard must stop the effect before it ever looks the returned case up.
    let caseLookupRequested = false;
    await page.route(
      `**/api/justice/cases/${PLAYWRIGHT_MOCK_SECOND_CASE_ID}`,
      async (route) => {
        caseLookupRequested = true;
        await route.continue();
      }
    );

    await page.goto(`/justice/chat-ai?case=${PLAYWRIGHT_MOCK_SECOND_CASE_ID}&checkout=success`);
    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);

    // Give the (correctly-blocked) effect a moment to have hydrated/fetched/polled if it were
    // going to.
    await page.waitForTimeout(1_500);

    expect(
      caseLookupRequested,
      "staged-note guard must stop the checkout-return redirect before it looks the case up"
    ).toBe(false);

    const caseIdAfterCheckoutReturn = await page.evaluate(
      (key) => sessionStorage.getItem(key)?.trim() ?? "",
      STORAGE_CASE_ID
    );
    expect(caseIdAfterCheckoutReturn).toBe("");

    const stagedAfterCheckoutReturn = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      STORAGE_STAGED_PROOF_NOTES_V1
    );
    expect(stagedAfterCheckoutReturn).not.toBeNull();
    expect(JSON.parse(stagedAfterCheckoutReturn!)).toHaveLength(1);
  });
});

test.describe("signed-in chat-ai cancelled-checkout acknowledgment", () => {
  const CANCELLED_NOTICE_SELECTOR = "#chat-ai-checkout-cancelled-notice";
  const CANCELLED_NOTICE_TEXT = /Checkout wasn't completed\. We don't see a confirmed payment/;

  test("cancelled-checkout notice: shown for an unpaid case with real retry control, suppressed when already paid, and untouched on a successful return", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // The three scenarios below share a single bootstrap + case setup rather than three separate
    // tests each re-running the full fresh-session bootstrap, since each bootstrap is a handful
    // of real network round-trips this suite doesn't need to repeat three times for what is
    // otherwise the same fake case id and mocked responses.
    //
    // Entirely self-contained: seeds a local "existing case, draft reviewed" session directly
    // (same technique as hydrateChatAiSession in helpers/chat-ai-ladder-continuity-e2e.ts) and
    // mocks the case GET / price GET this fake id's checkout-return effect calls. This test's own
    // code never issues a real write against any shared fixture case (an earlier version of this
    // test drove the real, shared PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID through
    // intake+draft-review, which left that id in a state the mock-reset helper could not fully
    // clear for later tests reusing it — this version avoids that fixture entirely instead).
    const caseId = PLAYWRIGHT_MOCK_SECOND_CASE_ID;
    // company_contact_email is required here: this destination blocks approval on a missing
    // merchant recipient address (the recipient-required gate), which isn't what this test is
    // about — a real case at this exact ladder point would already have it on file.
    const intake = { ...buildPlaywrightMockE2eCaseIntake(), company_contact_email: "merchant@example.com" };

    await bootstrapFreshUncommittedSession(page);
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
      // Playwright resolves the most-recently-registered matching route first, so a later call
      // to this same pattern (scenario B below) takes over from this one without needing to
      // unroute it first.
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

    // --- Scenario A: unpaid case returns from a cancelled/abandoned Checkout ---
    // No real Checkout session is created or visited; the return effect only reads the URL params
    // and re-checks the (mocked-unpaid) case, so this is a faithful way to exercise it without
    // ever contacting Stripe.
    await page.goto(`/justice/chat-ai?case=${caseId}&checkout=cancelled`);
    await waitForClerkBrowserApiSession(page);

    const notice = page.locator(CANCELLED_NOTICE_SELECTOR);
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toHaveText(CANCELLED_NOTICE_TEXT);
    await expect(notice).toHaveAttribute("role", "status");

    // Query cleanup: checkout is gone, case id is preserved, so a manual reload can't replay it
    // and any other page logic keyed off ?case= keeps working.
    await expect.poll(() => page.url()).not.toContain("checkout=");
    expect(page.url()).toContain(`case=${caseId}`);

    // Retry availability: the message says "You can try again below" — verify the real payment
    // control it refers to, not merely that the chat input is present. The price disclosure must
    // have loaded a real amount (not stuck loading/unavailable), and once the packet is marked
    // reviewed, "Approve prepared packet" — the control that starts Checkout again — must be
    // visible and enabled. It is deliberately never clicked, so no Checkout session is created.
    const packetApproval = page.locator("#chat-ai-inline-prepared-packet-approval");
    await expect(packetApproval).toBeVisible({ timeout: 30_000 });
    await expect(packetApproval.getByText(/One-time fee: /)).toBeVisible({ timeout: 30_000 });
    await packetApproval.getByLabel("I reviewed this prepared packet").check();
    const approveButton = packetApproval.getByRole("button", { name: "Approve prepared packet" });
    await expect(approveButton).toBeVisible();
    await expect(approveButton).toBeEnabled();

    // One-time display: reloading the now-cleaned URL must not replay the notice. The case/price
    // routes stay mocked-unpaid here (page.route stays active for the whole page context, not
    // just one navigation), but that's irrelevant to this check — the checkout query param is
    // what gates the entire cancelled-branch code path, and it's already gone, so this proves the
    // query cleanup itself is what prevents a replay, independent of paid_at.
    await page.reload();
    await waitForClerkBrowserApiSession(page);
    await expect(page.locator(CANCELLED_NOTICE_SELECTOR)).toHaveCount(0);

    // --- Scenario B: paid-state race protection ---
    // A real paid case can't be created here without triggering an actual Stripe payment, which
    // is out of scope for this suite — so this re-routes the same case GET to report paid_at set,
    // then returns from a fresh cancelled-checkout navigation for it. The notice must never appear
    // once the freshly-refreshed server state shows a confirmed payment.
    await routeCaseGet(new Date().toISOString());
    await page.goto(`/justice/chat-ai?case=${caseId}&checkout=cancelled`);
    await waitForClerkBrowserApiSession(page);
    await page.waitForTimeout(1_500);
    await expect(page.locator(CANCELLED_NOTICE_SELECTOR)).toHaveCount(0);
    await expect.poll(() => page.url()).not.toContain("checkout=");
    expect(page.url()).toContain(`case=${caseId}`);

    // --- Scenario C: a successful-checkout return is unaffected by the cancelled-notice logic ---
    // The success path never sets the cancelled notice, and (unlike cancelled) intentionally
    // leaves the checkout param in the URL — that branch is untouched by this change. Paid state
    // doesn't matter for this check, so the still-paid mock from scenario B is left as-is.
    await page.goto(`/justice/chat-ai?case=${caseId}&checkout=success`);
    await waitForClerkBrowserApiSession(page);
    await page.waitForTimeout(1_500);
    await expect(page.locator(CANCELLED_NOTICE_SELECTOR)).toHaveCount(0);
  });
});
