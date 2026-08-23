import { expect, test, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import {
  clerkE2eSkipReason,
  clerkE2eUserIdentifier,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";
import {
  chatAiTranscript,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_FICTIONAL_USER_MESSAGE,
} from "./helpers/chat-ai-owned-fulfillment-e2e";
import {
  PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE,
  PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE,
} from "@/lib/testing/playwrightMockIntakeChatPipeline";
import { CHAT_INTAKE_COMMIT_MESSAGE } from "@/lib/justice/chatIntakeCommitGates";
import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import { STORAGE_INTAKE_DRAFT_V1 } from "@/lib/justice/intakeDraftPersistence";

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

/** Drive a signed-in consumer through chat-ai far enough to commit the deterministic Acme case. */
async function commitAcmeCaseViaChat(page: Page): Promise<string> {
  await page.goto("/justice/chat-ai");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();

  const chatInput = page.locator("#chat-ai-input");
  await expect(chatInput).toBeVisible({ timeout: 30_000 });
  await waitForClerkBrowserApiSession(page);

  const chatTranscript = chatAiTranscript(page);
  const continueButton = page.getByRole("button", { name: "Save and continue in chat" });

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_ASSISTANT_MESSAGE)).toBeVisible();
  await expect(continueButton).toBeEnabled({ timeout: 15_000 });

  await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE)
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_SECOND_ASSISTANT_MESSAGE)).toBeVisible();
  await expect(continueButton).toBeEnabled();

  const createCaseResponse = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/api/justice/cases"),
    { timeout: 30_000 }
  );
  await chatInput.fill(CHAT_INTAKE_COMMIT_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();
  const created = await createCaseResponse;
  expect(created.ok()).toBeTruthy();
  const createdBody = (await created.json()) as { id?: string };
  expect(createdBody.id).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
  await expect(page.getByText("I've saved your case.")).toBeVisible({ timeout: 15_000 });

  const caseId = await page.evaluate(
    (key) => sessionStorage.getItem(key)?.trim() ?? "",
    STORAGE_CASE_ID
  );
  expect(caseId).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
  return caseId;
}

/** Clear session so the next mount looks like a returning consumer with no local state. */
async function clearJusticeSession(page: Page): Promise<void> {
  await page.evaluate((keys) => {
    keys.forEach((key) => sessionStorage.removeItem(key));
  }, [STORAGE_CASE_ID, STORAGE_INTAKE, STORAGE_INTAKE_DRAFT_V1]);
}

test.describe("signed-in chat-ai resumes the latest case after a cleared session", () => {
  test("reload with empty sessionStorage restores the existing case and updates (not duplicates) it", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await commitAcmeCaseViaChat(page);

    // Simulate a returning consumer in a new tab/session: sessionStorage (and any pre-commit
    // draft) is gone, but the case still exists on the server.
    await clearJusticeSession(page);
    await page.reload();

    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);

    // The fallback hydration effect resumes the existing case instead of starting fresh.
    await expect
      .poll(
        async () =>
          page.evaluate((key) => sessionStorage.getItem(key)?.trim() ?? "", STORAGE_CASE_ID),
        { timeout: 30_000 }
      )
      .toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);

    const reloadedTranscript = chatAiTranscript(page);
    await expect(
      reloadedTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      reloadedTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_SECOND_USER_MESSAGE)
    ).toBeVisible();
    await expect(page.getByText("Company: Acme Retail")).toBeVisible();

    // Continuing must PATCH the existing case (mode: "update"), never re-POST a duplicate.
    let duplicateCreatePosted = false;
    const onRequest = (req: import("@playwright/test").Request) => {
      if (req.method() === "POST" && /\/api\/justice\/cases(?:\?|$)/.test(req.url())) {
        duplicateCreatePosted = true;
      }
    };
    page.on("request", onRequest);

    const continueButton = page.getByRole("button", { name: "Save and continue in chat" });
    try {
      const updateCaseResponse = page.waitForResponse(
        (res) =>
          res.request().method() === "PATCH" &&
          res.url().includes(`/api/justice/cases/${PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID}`),
        { timeout: 30_000 }
      );
      await expect(continueButton).toBeEnabled({ timeout: 15_000 });
      await continueButton.click();
      const updated = await updateCaseResponse;
      expect(updated.ok()).toBeTruthy();
    } finally {
      page.off("request", onRequest);
    }

    expect(duplicateCreatePosted, "resuming an existing case must not re-POST a new one").toBe(
      false
    );

    const caseIdAfterUpdate = await page.evaluate(
      (key) => sessionStorage.getItem(key)?.trim() ?? "",
      STORAGE_CASE_ID
    );
    expect(caseIdAfterUpdate).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);

    const savedList = await page.request.get("/api/justice/cases");
    expect(savedList.ok()).toBeTruthy();
    const savedPayload = (await savedList.json()) as {
      cases?: Array<{ id: string; archived_at?: string | null }>;
    };
    const activeCases = (savedPayload.cases ?? []).filter((row) => !row.archived_at?.trim());
    expect(activeCases).toHaveLength(1);
    expect(activeCases[0]?.id).toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);
  });

  test("an auto-seeded reply-email draft with no real conversation does not block resumption", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await commitAcmeCaseViaChat(page);
    await clearJusticeSession(page);

    // Hold the fallback hydration's GET /api/justice/cases so the signed-in reply-email
    // auto-seed effect (page.tsx: seeds parts.reply_email from the verified account, touching
    // `parts` only — never `messages`) has time to fire and autosave its own draft before the
    // fetch resolves. That draft must not be mistaken for a real in-progress conversation.
    let releaseCasesFetch: () => void = () => {};
    const casesFetchHeld = new Promise<void>((resolve) => {
      releaseCasesFetch = resolve;
    });
    let casesFetchIntercepted = false;

    await page.route(/\/api\/justice\/cases$/, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      casesFetchIntercepted = true;
      await casesFetchHeld;
      await route.continue();
    });

    await page.reload();

    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);

    await expect.poll(() => casesFetchIntercepted, { timeout: 30_000 }).toBe(true);

    // Confirm the auto-seed draft actually lands before proceeding.
    await expect
      .poll(
        async () => page.evaluate((key) => sessionStorage.getItem(key), STORAGE_INTAKE_DRAFT_V1),
        { timeout: 15_000 }
      )
      .not.toBeNull();

    // And that it is exactly what it claims to be: reply_email seeded, no real (non-greeting)
    // turn in it — only the opening greeting.
    const draftAfterSeed = await page.evaluate((key) => {
      const raw = sessionStorage.getItem(key);
      return raw
        ? (JSON.parse(raw) as {
            parts?: { reply_email?: string };
            messages?: Array<{ role: string; text: string }>;
          })
        : null;
    }, STORAGE_INTAKE_DRAFT_V1);
    expect(draftAfterSeed?.parts?.reply_email?.trim()).toBeTruthy();
    expect(draftAfterSeed?.messages ?? []).toHaveLength(1);
    expect(draftAfterSeed?.messages?.[0]?.role).toBe("assistant");

    releaseCasesFetch();

    // The benign auto-seed draft must not have suppressed resumption.
    await expect
      .poll(
        async () =>
          page.evaluate((key) => sessionStorage.getItem(key)?.trim() ?? "", STORAGE_CASE_ID),
        { timeout: 30_000 }
      )
      .toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);

    const resumedTranscript = chatAiTranscript(page);
    await expect(
      resumedTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Company: Acme Retail")).toBeVisible();
  });

  test("signing in via the in-page modal (no reload) still resumes the existing case", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);

    // Seed a real, server-persisted case using the already-authenticated default page.
    await commitAcmeCaseViaChat(page);

    // A fresh, unauthenticated context reproduces "lands signed out, signs in via the modal
    // without navigating away" — the exact scenario the latestCaseHydrationAttemptedRef guard
    // must not foreclose by marking itself attempted before isSignedIn is known. A bare
    // browser.newContext() is NOT enough here: Playwright Test injects the "authenticated"
    // project's full resolved test options — including its default `storageState` — into any
    // browser.newContext() call, not just baseURL (confirmed via a CI trace's own
    // context-options record showing the signed-in cookies present on a "fresh" context with no
    // options at all). Explicitly overriding storageState to empty is the only way to get a
    // genuinely signed-out context; baseURL inheritance is unaffected and still applies.
    const freshContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const freshPage = await freshContext.newPage();
      await freshPage.goto("/justice/chat-ai");

      await expect(freshPage.getByRole("button", { name: "Sign in" })).toBeVisible({
        timeout: 30_000,
      });

      await clerk.signIn({
        page: freshPage,
        signInParams: {
          strategy: "password",
          identifier: clerkE2eUserIdentifier(),
          password: process.env.E2E_CLERK_USER_PASSWORD!.trim(),
        },
      });

      // No navigation/reload here — isSignedIn must flip reactively on the still-mounted page.
      await waitForClerkBrowserApiSession(freshPage);

      await expect
        .poll(
          async () =>
            freshPage.evaluate((key) => sessionStorage.getItem(key)?.trim() ?? "", STORAGE_CASE_ID),
          { timeout: 30_000 }
        )
        .toBe(PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID);

      const freshTranscript = chatAiTranscript(freshPage);
      await expect(
        freshTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)
      ).toBeVisible({ timeout: 15_000 });
      await expect(freshPage.getByText("Company: Acme Retail")).toBeVisible();
    } finally {
      await freshContext.close();
    }
  });

  test("a new conversation started while the latest-case fetch is pending is not clobbered", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await commitAcmeCaseViaChat(page);
    await clearJusticeSession(page);

    // Hold the fallback hydration's GET /api/justice/cases (no query string — distinct from the
    // paginated list/archived-list requests) so we can start a brand-new conversation while it
    // is still in flight, then release it and confirm the new conversation survives.
    let releaseCasesFetch: () => void = () => {};
    const casesFetchHeld = new Promise<void>((resolve) => {
      releaseCasesFetch = resolve;
    });
    let casesFetchIntercepted = false;

    await page.route(/\/api\/justice\/cases$/, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      casesFetchIntercepted = true;
      await casesFetchHeld;
      await route.continue();
    });

    await page.reload();

    const chatInput = page.locator("#chat-ai-input");
    await expect(chatInput).toBeVisible({ timeout: 30_000 });
    await waitForClerkBrowserApiSession(page);

    await expect.poll(() => casesFetchIntercepted, { timeout: 30_000 }).toBe(true);

    // Start a genuinely new, unrelated conversation while the old case's fetch is held.
    const chatTranscript = chatAiTranscript(page);
    await chatInput.fill(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_FICTIONAL_USER_MESSAGE);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(
      chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_FICTIONAL_USER_MESSAGE)
    ).toBeVisible({ timeout: 15_000 });

    // Confirm the draft this new turn produces is actually on disk before releasing the fetch,
    // so the release below genuinely lands after a draft exists (not merely after the message
    // is on screen).
    await expect
      .poll(
        async () => page.evaluate((key) => sessionStorage.getItem(key), STORAGE_INTAKE_DRAFT_V1),
        { timeout: 15_000 }
      )
      .not.toBeNull();

    releaseCasesFetch();

    // Give the (correctly-aborted) hydration a moment to have clobbered state if it were going to.
    await page.waitForTimeout(1_500);

    await expect(
      chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_FICTIONAL_USER_MESSAGE)
    ).toBeVisible();
    await expect(chatTranscript.getByText(PLAYWRIGHT_MOCK_INTAKE_CHAT_E2E_USER_MESSAGE)).toHaveCount(
      0
    );
    await expect(page.getByText("Company: Acme Retail")).toHaveCount(0);

    const caseIdAfterRelease = await page.evaluate(
      (key) => sessionStorage.getItem(key)?.trim() ?? "",
      STORAGE_CASE_ID
    );
    expect(caseIdAfterRelease).toBe("");
  });
});
