import { expect, test } from "@playwright/test";
import {
  REAL_BBB_COMPLAINT_SUBMIT_URL,
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
  waitForClerkBrowserApiSession,
} from "./helpers/clerk-e2e";

const REAL_BBB_SUBMIT_USER_DATA = {
  email: "e2e-signed-in@example.com",
  business_name: "E2E Co",
  issue_type: "billing",
  complaint_description: "Real BBB lane assisted submit exercised during Playwright E2E.",
  incident_date: "2026-01-01",
  contact_full_name: "E2E User",
  contact_email: "e2e-signed-in@example.com",
};

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("signed-in POST /api/submit-form succeeds on real BBB complaint URL via mocked bounded submit", async ({
  page,
}) => {
  // Use the live browser session (Clerk JS refreshes cookies) rather than the static
  // storageState request fixture, which can expire before late-suite authenticated tests.
  await page.goto("/justice/chat-ai");
  await waitForClerkBrowserApiSession(page);

  const submitRes = await page.request.post("/api/submit-form", {
    data: {
      url: REAL_BBB_COMPLAINT_SUBMIT_URL,
      userData: REAL_BBB_SUBMIT_USER_DATA,
    },
  });

  expect(submitRes.status()).toBe(200);
  const body = await submitRes.json();
  expect(body).toEqual(
    expect.objectContaining({
      result: "Success",
      fillResult: expect.objectContaining({
        status: "success",
        stopReason: "terminal_confirmation",
        storageSkipped: true,
      }),
    })
  );
  expect(body.fillResult.stepsExecuted).toBeGreaterThan(0);
});
