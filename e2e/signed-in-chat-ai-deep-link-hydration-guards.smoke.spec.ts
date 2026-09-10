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

  test("shows a one-time notice for an unpaid case, cleans the checkout param while keeping the case id, and leaves the real payment retry control visible and enabled", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Entirely self-contained: seeds a local "existing case, draft reviewed" session directly
    // (same technique as hydrateChatAiSession in helpers/chat-ai-ladder-continuity-e2e.ts) and
    // mocks the case GET / price GET this fake id's checkout-return effect calls — no real
    // backend mutation against any shared fixture case, so nothing here can leave residue for
    // other specs in the same CI job (an earlier version of this test drove the real, shared
    // PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID through intake+draft-review, which left that
    // id in a state the mock-reset helper could not fully clear for later tests reusing it).
    const caseId = PLAYWRIGHT_MOCK_SECOND_CASE_ID;
    const intake = buildPlaywrightMockE2eCaseIntake();

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
          paid_at: null,
        }),
      });
    });
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

    // Simulate returning from a cancelled/abandoned Stripe Checkout for this exact case — no real
    // Checkout session is created or visited; the return effect only reads the URL params and
    // re-checks the (mocked-unpaid) case, so this is a faithful way to exercise it without ever
    // contacting Stripe.
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
    // routes above stay mocked-unpaid here (page.route stays active for the whole page context,
    // not just one navigation), but that's irrelevant to this check — the checkout query param is
    // what gates the entire cancelled-branch code path, and it's already gone, so this proves the
    // query cleanup itself is what prevents a replay, independent of paid_at.
    await page.reload();
    await waitForClerkBrowserApiSession(page);
    await expect(page.locator(CANCELLED_NOTICE_SELECTOR)).toHaveCount(0);
  });

  test("never shows the cancellation notice when the freshly-refreshed case is already paid (paid-state race protection)", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // A real paid case can't be created here without triggering an actual Stripe payment, which
    // is out of scope for this suite — so this test controls paid_at directly via response
    // interception, kept active for the test's one navigation (never reloaded, so there is no
    // claim here about what a later reload would see). Uses the shared fresh-session bootstrap
    // (clears sessionStorage after the initial load) so chat-ai's resume-on-mount can't leave a
    // real, previously-active case's local cache in place under this fake case id.
    await bootstrapFreshUncommittedSession(page);

    await page.evaluate(
      ([key, value]) => sessionStorage.setItem(key, value),
      [STORAGE_CASE_ID, PLAYWRIGHT_MOCK_SECOND_CASE_ID]
    );

    await page.route(
      new RegExp(`/api/justice/cases/${PLAYWRIGHT_MOCK_SECOND_CASE_ID}(\\?|$)`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: PLAYWRIGHT_MOCK_SECOND_CASE_ID,
            client_state: {},
            timeline: [],
            archived_at: null,
            paid_at: new Date().toISOString(),
          }),
        });
      }
    );

    await page.goto(
      `/justice/chat-ai?case=${PLAYWRIGHT_MOCK_SECOND_CASE_ID}&checkout=cancelled`
    );
    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);

    // Give the checkout-return effect a moment to have shown the notice if it were going to.
    await page.waitForTimeout(1_500);
    await expect(page.locator(CANCELLED_NOTICE_SELECTOR)).toHaveCount(0);

    // The checkout param is still cleaned up regardless of the paid outcome.
    await expect.poll(() => page.url()).not.toContain("checkout=");
    expect(page.url()).toContain(`case=${PLAYWRIGHT_MOCK_SECOND_CASE_ID}`);
  });

  test("a successful-checkout return is unaffected by the cancelled-notice logic", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Same fresh-session bootstrap as above, for the same reason: without clearing sessionStorage
    // first, chat-ai's resume-on-mount can leave a real, previously-active case's local cache in
    // place, which would render that other case's UI regardless of this fake ?case= id.
    await bootstrapFreshUncommittedSession(page);

    await page.evaluate(
      ([key, value]) => sessionStorage.setItem(key, value),
      [STORAGE_CASE_ID, PLAYWRIGHT_MOCK_SECOND_CASE_ID]
    );

    await page.goto(
      `/justice/chat-ai?case=${PLAYWRIGHT_MOCK_SECOND_CASE_ID}&checkout=success`
    );
    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);

    // The success path never sets the cancelled notice, and (unlike cancelled) intentionally
    // leaves the checkout param in the URL — that branch is untouched by this change.
    await page.waitForTimeout(1_500);
    await expect(page.locator(CANCELLED_NOTICE_SELECTOR)).toHaveCount(0);
  });
});
