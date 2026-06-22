import { expect, test } from "@playwright/test";

test("mock BBB complaint page renders practice form", async ({ page }) => {
  await page.goto("/mock/bbb-complaint");

  await expect(page.getByRole("banner")).toContainText("Internal testing only");
  await expect(page.getByRole("heading", { level: 1, name: "Practice BBB complaint form" })).toBeVisible();
  await expect(page.locator("#mock_bbb_complaint_form")).toBeVisible();
  await expect(page.locator("#issue_type")).toBeVisible();
});
