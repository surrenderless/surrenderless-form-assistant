import { expect, test } from "@playwright/test";
import { MOCK_FTC_PRACTICE_SUBMIT_URL } from "./helpers/clerk-e2e";

test("POST /api/submit-form returns 401 without authentication", async ({ request }) => {
  const res = await request.post("/api/submit-form", {
    data: {
      url: MOCK_FTC_PRACTICE_SUBMIT_URL,
      userData: { email: "e2e-unauth@example.com" },
    },
  });

  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});
