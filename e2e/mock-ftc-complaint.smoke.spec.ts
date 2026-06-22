import { expect, test } from "@playwright/test";

test("mock FTC complaint page renders practice form", async ({ page }) => {
  await page.goto("/mock/ftc-complaint");

  await expect(page.getByRole("banner")).toContainText("Internal testing only");
  await expect(page.getByRole("heading", { level: 1, name: "Practice complaint form" })).toBeVisible();
  await expect(page.locator("#mock_ftc_complaint_form")).toBeVisible();
  await expect(page.locator("#issue_type")).toBeVisible();
});
