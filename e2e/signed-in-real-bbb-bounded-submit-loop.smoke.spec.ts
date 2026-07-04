import { expect, test } from "@playwright/test";
import {
  REAL_BBB_COMPLAINT_SUBMIT_URL,
  clerkE2eSkipReason,
  clerkStorageStateExists,
  isClerkE2eConfigured,
} from "./helpers/clerk-e2e";
import { PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_CONFIRMATION_PATH } from "@/lib/testing/playwrightMockRealBbbBoundedSubmitLoop";

const REAL_BBB_SUBMIT_USER_DATA = {
  email: "e2e-signed-in@example.com",
  business_name: "E2E Co",
  issue_type: "billing",
  complaint_description: "Real BBB bounded submit loop exercised during Playwright E2E.",
  incident_date: "2026-01-01",
  contact_full_name: "E2E User",
  contact_email: "e2e-signed-in@example.com",
};

test.beforeEach(() => {
  test.skip(!isClerkE2eConfigured() || !clerkStorageStateExists(), clerkE2eSkipReason());
});

test("signed-in POST /api/submit-form runs runRealBbbBoundedSubmit through the loopback mock wizard", async ({
  request,
}) => {
  const submitRes = await request.post("/api/submit-form", {
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

  const fillResult = body.fillResult;
  expect(fillResult.stepsExecuted).toBeGreaterThan(0);
  expect(fillResult.pageData?.url).toContain(PLAYWRIGHT_MOCK_REAL_BBB_BOUNDED_SUBMIT_LOOP_CONFIRMATION_PATH);
  expect(fillResult.pageData?.pageText).toContain("successfully submitted");

  const actions = fillResult.stepLog.map((entry: { action: string }) => entry.action);
  expect(actions).toEqual(expect.arrayContaining(["decide", "apply", "terminal_detected"]));
  expect(actions.indexOf("decide")).toBeLessThan(actions.indexOf("apply"));
  expect(actions.indexOf("apply")).toBeLessThan(actions.indexOf("terminal_detected"));
});
