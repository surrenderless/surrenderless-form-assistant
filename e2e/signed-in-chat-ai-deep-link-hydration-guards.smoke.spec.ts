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
    // (same technique as hydrateChatAiSession in helpers/chat-ai-ladder-continuity-e2e.ts) on a
    // freshly generated random UUID — never PLAYWRIGHT_MOCK_SECOND_CASE_ID or any other seeded
    // backend fixture. Two earlier versions of this test each left real, confirmed residue on a
    // seeded id: driving PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID through intake+draft-review
    // left that id in a state the mock-reset helper couldn't fully clear for later tests reusing
    // it, and separately, merely navigating with PLAYWRIGHT_MOCK_SECOND_CASE_ID (a case the mock
    // backend already knows about, seeded with real data from server start) caused it to newly
    // appear in this test user's real GET /api/justice/cases list afterward — confirmed via
    // before/after snapshots showing an empty list becoming non-empty, and via network traces on
    // three separate unrelated specs that ran after this one in the same job, each shown (by their
    // own trace) resuming that exact id instead of their own intended blank session. A random UUID
    // the backend has never seen can't be "discovered" by any later test's resume-on-mount fetch —
    // there's nothing for it to find. Every case-specific read this UUID's checkout-return effect
    // and its resume-on-mount siblings can issue is mocked below (case, checkout price, evidence,
    // filings, tasks, chat-messages) — all GET-only, so no real write is possible either.
    const caseId = crypto.randomUUID();
    // company_contact_email is required here: this destination blocks approval on a missing
    // merchant recipient address (the recipient-required gate), which isn't what this test is
    // about — a real case at this exact ladder point would already have it on file.
    const intake = { ...buildPlaywrightMockE2eCaseIntake(), company_contact_email: "merchant@example.com" };

    await bootstrapFreshUncommittedSession(page);

    // Real (unmocked) snapshot of this test user's actual case list, taken before this test seeds
    // anything or registers a single page.route — the baseline the "after" snapshot below must
    // exactly reproduce to prove this test leaves no server-side residue.
    const casesListBefore = await (await page.request.get("/api/justice/cases")).json();

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
    // The resume-on-mount / checkout-return hydration path also fetches these three (evidence,
    // filings, tasks — all plain arrays) and the chat transcript for whatever case id is active in
    // sessionStorage, regardless of which checkout-return scenario is running. Mocked here so none
    // of them ever reach the real backend for this random, never-seeded id. Regexes (not glob
    // strings) so the query string's literal "?" is unambiguous — Playwright's glob syntax treats
    // "?" as a single-character wildcard, not a literal, which would technically still match a
    // real "?" by coincidence but shouldn't be relied on for something this test exists to prove.
    const escapedCaseId = caseId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const [resource, body] of [
      ["evidence", "[]"],
      ["filings", "[]"],
      ["tasks", "[]"],
      ["chat-messages", JSON.stringify({ messages: [] })],
    ] as const) {
      await page.route(
        new RegExp(`/api/justice/${resource}\\?case_id=${escapedCaseId}$`),
        async (route) => {
          if (route.request().method() !== "GET") {
            await route.continue();
            return;
          }
          await route.fulfill({ status: 200, contentType: "application/json", body });
        }
      );
    }

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

    // Proof of isolation: the real (unmocked — page.request bypasses this page's own page.route
    // handlers) case list for this user must come back byte-for-byte identical to before this test
    // did anything. Nothing this test did (three checkout-return navigations, a reload, and a
    // random case id that was never sent to the real backend in any writeable form) may leave any
    // trace a later, unrelated test could resume.
    const casesListAfter = await (await page.request.get("/api/justice/cases")).json();
    expect(casesListAfter).toEqual(casesListBefore);
  });
});
