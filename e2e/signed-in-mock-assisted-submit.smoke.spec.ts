import { expect, test } from "@playwright/test";
import {
  MOCK_FTC_PRACTICE_SUBMIT_URL,
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
} from "./helpers/clerk-e2e";

const MOCK_SUBMIT_USER_DATA = {
  email: "e2e-signed-in@example.com",
  business_name: "E2E Co",
  issue_type: "billing",
  complaint_description: "Practice complaint submitted during Playwright E2E.",
  incident_date: "2026-01-01",
  contact_full_name: "E2E User",
};

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("signed-in POST /api/submit-form succeeds on mock FTC practice URL", async ({ request }) => {
  const submitRes = await request.post("/api/submit-form", {
    data: {
      url: MOCK_FTC_PRACTICE_SUBMIT_URL,
      userData: MOCK_SUBMIT_USER_DATA,
    },
  });

  expect(submitRes.status()).toBe(200);
  expect(await submitRes.json()).toEqual(
    expect.objectContaining({
      result: "Success",
      fillResult: expect.objectContaining({ status: "success" }),
    })
  );
});
